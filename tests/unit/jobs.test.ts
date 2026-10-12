import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveAsset } from "@/lib/assets";
import { getBalance } from "@/lib/credits";
import { db } from "@/lib/db";
import { generationImages, generations, providerCalls } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  LOST_DISPATCH_MS,
  MAX_SHOT_DISPATCHES,
  recoverGeneration,
  runShot,
  seedFor,
  setShotDispatcher,
  signShotRequest,
  STALE_AFTER_MS,
  sweepJobs,
  verifyShotRequest,
} from "@/lib/generation/jobs";
import { createGeneration, getGeneration, runGeneration } from "@/lib/generation/service";
import { normalizeUpload } from "@/lib/image/process";
import { SIGNUP_BONUS_CREDITS, TIERS } from "@/lib/pricing";
import { makeUser, resetDb } from "./helpers";

const fixture = readFileSync("tests/fixtures/product.jpg");
const PER_IMAGE = TIERS.standard.creditsPerImage;

async function setup() {
  const user = await makeUser();
  const asset = await saveAsset(user.id, "upload", await normalizeUpload(fixture), "uploads");
  return { user, asset };
}

const input = (assetId: string, extra: Record<string, unknown> = {}) => ({
  sourceAssetId: assetId,
  category: "clothing" as const,
  options: { presentation: "on_model_full" },
  aspectRatio: "4:5",
  tier: "standard",
  count: 2,
  customNote: undefined as string | undefined,
  ...extra,
});

/** Run planning only: shots are captured instead of started, like an HTTP dispatch that hasn't been picked up yet. */
async function planOnly(count = 2) {
  const { user, asset } = await setup();
  const dispatched: string[][] = [];
  setShotDispatcher(async (ids) => {
    dispatched.push(ids);
  });
  const gen = await createGeneration(user.id, input(asset.id, { count }));
  await runGeneration(gen.id);
  setShotDispatcher(null);
  const shots = await db().select().from(generationImages).where(eq(generationImages.generationId, gen.id)).orderBy(generationImages.idx);
  return { user, gen, shots, dispatched };
}

const images = (genId: string) =>
  db().select().from(generationImages).where(eq(generationImages.generationId, genId)).orderBy(generationImages.idx);

beforeEach(async () => {
  delete process.env.MOCK_IMAGE_FAIL_PATTERN;
  delete process.env.CRON_SECRET;
  resetEnvCache();
  await resetDb();
});
afterEach(() => setShotDispatcher(null));
afterAll(async () => {
  delete process.env.CRON_SECRET;
  resetEnvCache();
  await resetDb();
});

describe("per-shot fan-out", () => {
  it("planning writes every shot's prompt and seed, then hands each shot to the dispatcher without running any", async () => {
    const { user, gen, shots, dispatched } = await planOnly(2);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toHaveLength(2);
    expect(shots.map((s) => s.status)).toEqual(["pending", "pending"]);
    expect(shots.every((s) => Boolean(s.prompt))).toBe(true);
    expect(shots.map((s) => s.seed)).toEqual([seedFor(gen.id, 0), seedFor(gen.id, 1)]);
    expect(new Set(shots.map((s) => s.seed)).size).toBe(2);

    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("running"); // not settled until the shots finish
  });

  it("each shot runs on its own, and the last one settles the generation", async () => {
    const { user, gen, shots } = await planOnly(2);
    await runShot(shots[0].id);
    expect((await db().select().from(generations).where(eq(generations.id, gen.id)))[0].status).toBe("running");
    expect((await images(gen.id)).map((i) => i.status)).toEqual(["succeeded", "pending"]);

    await runShot(shots[1].id);
    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("succeeded");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - 2 * PER_IMAGE);
    const done = await images(gen.id);
    expect(done.every((i) => i.seed !== null && i.leaseUntil === null && i.dispatchCount === 1)).toBe(true);
  });

  it("a failed shot gives its credits back immediately and never fails its siblings", async () => {
    process.env.MOCK_IMAGE_FAIL_PATTERN = "FAILME";
    const { user, gen, shots } = await planOnly(2);
    await db().update(generationImages).set({ prompt: "FAILME" }).where(eq(generationImages.id, shots[1].id));

    await runShot(shots[1].id);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - 2 * PER_IMAGE + PER_IMAGE); // refunded right away
    expect((await images(gen.id)).map((i) => i.status)).toEqual(["pending", "failed"]);

    await runShot(shots[0].id);
    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("partial");
    expect(dto.images.map((i) => i.status)).toEqual(["succeeded", "failed"]);
    expect(dto.refundedCredits).toBe(PER_IMAGE);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - PER_IMAGE); // charged only for the accepted shot
  });

  it("running the same shot twice, even concurrently, generates it once and refunds nothing twice", async () => {
    const { user, shots } = await planOnly(1);
    await Promise.all([runShot(shots[0].id), runShot(shots[0].id), runShot(shots[0].id)]);
    const calls = await db().select().from(providerCalls).where(and(eq(providerCalls.stage, "generate"), eq(providerCalls.imageId, shots[0].id)));
    expect(calls).toHaveLength(1);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - PER_IMAGE);
  });

  it("in inline mode (tests, local dev) runGeneration still runs the whole job", async () => {
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    await runGeneration(gen.id);
    expect((await getGeneration(user.id, gen.id))!.status).toBe("succeeded");
  });
});

describe("crash recovery", () => {
  it("does not steal a shot a live worker holds", async () => {
    const { shots } = await planOnly(1);
    await db()
      .update(generationImages)
      .set({ status: "running", leaseUntil: new Date(Date.now() + 60_000), dispatchCount: 1 })
      .where(eq(generationImages.id, shots[0].id));
    await runShot(shots[0].id);
    const [row] = await images(shots[0].generationId);
    expect(row.status).toBe("running");
    expect(row.dispatchCount).toBe(1);
  });

  it("restarts a shot whose worker died (expired lease)", async () => {
    const { user, gen, shots } = await planOnly(1);
    await db()
      .update(generationImages)
      .set({ status: "running", leaseUntil: new Date(Date.now() - 1000), dispatchCount: 1 })
      .where(eq(generationImages.id, shots[0].id));

    const started: string[][] = [];
    setShotDispatcher(async (ids) => {
      started.push(ids);
    });
    await recoverGeneration(gen.id);
    expect((await images(gen.id))[0].status).toBe("pending");

    // The next recovery pass (lost-dispatch rule) re-dispatches it once the job is old enough.
    await db().update(generations).set({ createdAt: new Date(Date.now() - LOST_DISPATCH_MS - 5000) }).where(eq(generations.id, gen.id));
    await recoverGeneration(gen.id);
    expect(started.flat()).toEqual([shots[0].id]);

    setShotDispatcher(null);
    await runShot(shots[0].id);
    expect((await getGeneration(user.id, gen.id))!.status).toBe("succeeded");
  });

  it("gives up on a shot that keeps dying: failed, refunded, never started again", async () => {
    const { user, gen, shots } = await planOnly(2);
    await db()
      .update(generationImages)
      .set({ status: "running", leaseUntil: new Date(Date.now() - 1000), dispatchCount: MAX_SHOT_DISPATCHES })
      .where(eq(generationImages.id, shots[0].id));
    await recoverGeneration(gen.id);

    const rows = await images(gen.id);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].error).toMatch(/stopped responding/);
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - 2 * PER_IMAGE + PER_IMAGE);
    await recoverGeneration(gen.id); // idempotent
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - 2 * PER_IMAGE + PER_IMAGE);
  });

  it("a poll repairs a lost job without any scheduler", async () => {
    const { user, gen, shots } = await planOnly(1);
    await db().update(generations).set({ createdAt: new Date(Date.now() - LOST_DISPATCH_MS - 5000) }).where(eq(generations.id, gen.id));
    // Inline mode: the poll's recovery re-dispatches the never-started shot and it completes.
    const dto = (await getGeneration(user.id, gen.id))!;
    expect(dto.status).toBe("succeeded");
    expect((await images(gen.id))[0].id).toBe(shots[0].id);
  });

  it("a late worker can't flip a shot that was already failed and refunded", async () => {
    const { user, gen, shots } = await planOnly(1);
    await db().update(generationImages).set({ status: "running", leaseUntil: new Date(Date.now() + 60_000) }).where(eq(generationImages.id, shots[0].id));
    await db().update(generations).set({ createdAt: new Date(Date.now() - STALE_AFTER_MS - 1000) }).where(eq(generations.id, gen.id));
    expect((await getGeneration(user.id, gen.id))!.status).toBe("failed");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);

    await runShot(shots[0].id); // the straggler finally arrives
    expect((await images(gen.id))[0].status).toBe("failed");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });
});

describe("sweep", () => {
  it("starts abandoned queued jobs, restarts lost shots and fails jobs past their deadline", async () => {
    // 1) queued job nobody started
    const a = await setup();
    const queued = await createGeneration(a.user.id, input(a.asset.id, { count: 1 }));
    await db().update(generations).set({ createdAt: new Date(Date.now() - LOST_DISPATCH_MS - 5000) }).where(eq(generations.id, queued.id));

    // 2) planned job whose shot dispatch was lost
    const b = await planOnly(1);
    await db().update(generations).set({ createdAt: new Date(Date.now() - LOST_DISPATCH_MS - 5000) }).where(eq(generations.id, b.gen.id));

    // 3) job that never settled
    const c = await planOnly(1);
    await db().update(generationImages).set({ status: "running", leaseUntil: new Date(Date.now() + 60_000) }).where(eq(generationImages.id, c.shots[0].id));
    await db().update(generations).set({ createdAt: new Date(Date.now() - STALE_AFTER_MS - 1000) }).where(eq(generations.id, c.gen.id));

    const result = await sweepJobs();
    expect(result.plannedQueued).toBe(1);
    expect(result.failedStale).toBe(1);
    expect(result.recoveredShots).toBeGreaterThanOrEqual(1);

    expect((await getGeneration(a.user.id, queued.id))!.status).toBe("succeeded");
    expect((await getGeneration(b.user.id, b.gen.id))!.status).toBe("succeeded");
    expect((await getGeneration(c.user.id, c.gen.id))!.status).toBe("failed");
    expect(await getBalance(c.user.id)).toBe(SIGNUP_BONUS_CREDITS);
  });

  it("is a no-op when everything is healthy", async () => {
    await planOnly(1); // fresh job, shots just dispatched
    expect(await sweepJobs()).toMatchObject({ plannedQueued: 0, failedStale: 0, recoveredShots: 0 });
  });

  it("the cron route needs the secret", async () => {
    const { GET } = await import("@/app/api/cron/sweep/route");
    const call = (auth?: string) => GET(new Request("http://localhost/api/cron/sweep", { headers: auth ? { authorization: auth } : {} }));

    expect((await call()).status).toBe(503); // disabled until CRON_SECRET exists
    process.env.CRON_SECRET = "cron-secret-cron-secret";
    resetEnvCache();
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-wrong-wrong-wrong")).status).toBe(401);
    const ok = await call("Bearer cron-secret-cron-secret");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, plannedQueued: 0 });
  });
});

describe("internal shot requests are signed", () => {
  it("accepts a fresh signature for that shot only", () => {
    const { ts, sig } = signShotRequest("11111111-1111-4111-8111-111111111111");
    expect(verifyShotRequest("11111111-1111-4111-8111-111111111111", ts, sig)).toBe(true);
    expect(verifyShotRequest("22222222-2222-4222-8222-222222222222", ts, sig)).toBe(false);
    expect(verifyShotRequest("11111111-1111-4111-8111-111111111111", ts, "x".repeat(sig.length))).toBe(false);
    expect(verifyShotRequest("11111111-1111-4111-8111-111111111111", null, null)).toBe(false);
  });

  it("rejects an expired signature", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    const { ts, sig } = signShotRequest("11111111-1111-4111-8111-111111111111", old);
    expect(verifyShotRequest("11111111-1111-4111-8111-111111111111", ts, sig)).toBe(false);
  });
});

describe("provider call cost recording", () => {
  it("records the plan, every generation call and every judge call, attributed to the shot", async () => {
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id));
    await runGeneration(gen.id);

    const calls = await db().select().from(providerCalls).where(eq(providerCalls.generationId, gen.id));
    const byStage = (s: string) => calls.filter((c) => c.stage === s);
    expect(byStage("plan")).toHaveLength(0); // the v1 shot planner is deterministic: no LLM call, no cost
    expect(byStage("generate")).toHaveLength(2);
    expect(byStage("judge")).toHaveLength(2);
    const shotIds = new Set((await images(gen.id)).map((i) => i.id));
    expect(byStage("generate").every((c) => c.ok && c.userId === user.id && c.imageId && shotIds.has(c.imageId) && c.attempt === 1)).toBe(true);
    expect(byStage("judge").every((c) => c.estCostMicros > 0)).toBe(true);
  });

  it("the legacy flow (SHOT_PLANNER=off) still records its plan call", async () => {
    process.env.SHOT_PLANNER = "off";
    resetEnvCache();
    try {
      const { user, asset } = await setup();
      const gen = await createGeneration(user.id, input(asset.id));
      await runGeneration(gen.id);
      const calls = await db().select().from(providerCalls).where(eq(providerCalls.generationId, gen.id));
      expect(calls.filter((c) => c.stage === "plan")).toHaveLength(1);
      const [row] = await db().select().from(generations).where(eq(generations.id, gen.id));
      expect(row.promptSource).toBe("template");
      expect(row.plan).toBeNull();
    } finally {
      delete process.env.SHOT_PLANNER;
      resetEnvCache();
    }
  });

  it("records failed provider calls too, since they can still be billed", async () => {
    process.env.MOCK_IMAGE_FAIL_PATTERN = "FAILME";
    const { shots } = await planOnly(1);
    await db().update(generationImages).set({ prompt: "FAILME" }).where(eq(generationImages.id, shots[0].id));
    await runShot(shots[0].id);
    const calls = await db().select().from(providerCalls).where(eq(providerCalls.imageId, shots[0].id));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ stage: "generate", ok: false, provider: "mock" });
    expect(calls[0].error).toMatch(/forced failure/);
  });
});
