import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAlertThrottle } from "@/lib/alerts";
import { saveAsset } from "@/lib/assets";
import { getBalance } from "@/lib/credits";
import { db } from "@/lib/db";
import { generationImages, providerCalls } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { budgetsFor, runShot, setShotDispatcher, shotSpendMicros } from "@/lib/generation/jobs";
import { createGeneration, getGeneration, runGeneration } from "@/lib/generation/service";
import { SHOT_BUDGET_MICROS } from "@/lib/image/costs";
import { finalizeOutput, normalizeUpload } from "@/lib/image/process";
import { SIGNUP_BONUS_CREDITS, TIERS } from "@/lib/pricing";
import { makeUser, resetDb } from "./helpers";

const fixture = readFileSync("tests/fixtures/product.jpg");
const PER_IMAGE = TIERS.standard.creditsPerImage;

async function setup() {
  const user = await makeUser();
  const asset = await saveAsset(user.id, "upload", await normalizeUpload(fixture), "uploads");
  return { user, asset };
}

const input = (assetId: string, count = 1) => ({
  sourceAssetId: assetId,
  category: "clothing" as const,
  options: { presentation: "on_model_full" },
  aspectRatio: "4:5",
  tier: "standard",
  count,
  customNote: undefined as string | undefined,
});

async function planOnly(count = 1) {
  const { user, asset } = await setup();
  setShotDispatcher(async () => {});
  const gen = await createGeneration(user.id, input(asset.id, count));
  await runGeneration(gen.id);
  setShotDispatcher(null);
  const shots = await db().select().from(generationImages).where(eq(generationImages.generationId, gen.id)).orderBy(generationImages.idx);
  return { user, asset, gen, shots };
}

const generateCalls = (imageId: string) =>
  db().select().from(providerCalls).where(eq(providerCalls.imageId, imageId));

let alerts: Record<string, unknown>[] = [];

beforeEach(async () => {
  delete process.env.SHOT_DISPATCH;
  delete process.env.ALERT_WEBHOOK_URL;
  process.env.APP_URL = "http://localhost:3000";
  resetEnvCache();
  resetAlertThrottle();
  alerts = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    try {
      const j = JSON.parse(String(line));
      if (j?.level === "alert") alerts.push(j);
    } catch {
      /* not a structured line */
    }
  });
  await resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setShotDispatcher(null);
});
afterAll(async () => {
  delete process.env.SHOT_DISPATCH;
  delete process.env.ALERT_WEBHOOK_URL;
  resetEnvCache();
  await resetDb();
});

describe("a restarted shot never pays a provider twice for an image it already has", () => {
  it("resumes from the checkpoint the dead worker saved: judged, delivered, zero new provider calls", async () => {
    const { user, gen, shots } = await planOnly();
    const [shot] = shots;

    // The first worker generated + checkpointed the image, then died before judging (lease expired).
    const processed = await finalizeOutput(fixture, { id: "4:5", label: "4:5", width: 1024, height: 1280 } as never);
    const saved = await saveAsset(user.id, "output", processed, `out/${gen.id}`);
    await db()
      .update(generationImages)
      .set({
        status: "running",
        leaseUntil: new Date(Date.now() - 1000),
        dispatchCount: 1,
        attempts: 1,
        provider: "mock",
        model: "mock-compositor",
        assetId: saved.id,
      })
      .where(eq(generationImages.id, shot.id));

    await runShot(shot.id);

    const [row] = await db().select().from(generationImages).where(eq(generationImages.id, shot.id));
    expect(row.status).toBe("succeeded");
    expect(row.assetId).toBe(saved.id); // the same image, not a new one
    expect(row.attempts).toBe(1);
    expect((await generateCalls(shot.id)).filter((c) => c.stage === "generate")).toHaveLength(0); // nothing re-bought
    expect((await getGeneration(user.id, gen.id))!.status).toBe("succeeded");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS - PER_IMAGE);
  });

  it("every generated image is checkpointed before it is judged", async () => {
    const { shots } = await planOnly();
    await runShot(shots[0].id);
    const [row] = await db().select().from(generationImages).where(eq(generationImages.id, shots[0].id));
    expect(row.assetId).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.provider).toBe("mock");
  });

  it("a call in flight when the worker died still counts toward the budget", async () => {
    const { shots } = await planOnly();
    // What startProviderCall leaves behind when the process is killed mid-call.
    await db().insert(providerCalls).values({
      imageId: shots[0].id,
      generationId: shots[0].generationId,
      stage: "generate",
      provider: "gemini",
      ok: false,
      error: "in flight",
      estCostMicros: 39_000,
    });
    expect(await shotSpendMicros(shots[0].id)).toBe(39_000);
  });
});

describe("cost budgets", () => {
  it("budgets scale with tier and set size", () => {
    expect(budgetsFor({ tier: "premium", count: 4 }).shot).toBe(SHOT_BUDGET_MICROS.premium);
    expect(budgetsFor({ tier: "standard", count: 4 }).set).toBeLessThan(4 * SHOT_BUDGET_MICROS.standard);
    expect(budgetsFor({ tier: "economy", count: 1 }).shot).toBeLessThan(budgetsFor({ tier: "premium", count: 1 }).shot);
  });

  it("a shot that already spent its budget (retries + restarts) makes no more paid calls: failed, refunded, alerted", async () => {
    const { user, gen, shots } = await planOnly();
    await db().insert(providerCalls).values({
      imageId: shots[0].id,
      generationId: gen.id,
      stage: "generate",
      provider: "openai",
      ok: true,
      estCostMicros: SHOT_BUDGET_MICROS.standard, // restarts and retries have used it all
    });
    await runShot(shots[0].id);

    const calls = await generateCalls(shots[0].id);
    expect(calls.filter((c) => c.stage === "generate")).toHaveLength(1); // only the pre-existing row
    const [row] = await db().select().from(generationImages).where(eq(generationImages.id, shots[0].id));
    expect(row.status).toBe("failed");
    expect(await getBalance(user.id)).toBe(SIGNUP_BONUS_CREDITS); // the customer is never charged for our overrun
    expect(alerts.map((a) => a.kind)).toContain("cost_budget_reached");
  });

  it("the set budget caps total spend across shots", async () => {
    const { gen, shots } = await planOnly(2);
    const { set } = budgetsFor(gen);
    await db().insert(providerCalls).values({
      imageId: shots[0].id, // spend attributed to the first shot, which is over nothing by itself
      generationId: gen.id,
      stage: "generate",
      provider: "gemini",
      ok: true,
      estCostMicros: set + 1, // just over the cap (mock calls cost 0, so exactly-at-cap is still allowed)
    });
    await runShot(shots[1].id);
    const [row] = await db().select().from(generationImages).where(eq(generationImages.id, shots[1].id));
    expect(row.status).toBe("failed");
    expect(alerts.some((a) => a.kind === "cost_budget_reached")).toBe(true);
  });

  it("normal shots stay far inside their budget", async () => {
    const { shots } = await planOnly();
    await runShot(shots[0].id);
    expect(await shotSpendMicros(shots[0].id)).toBeLessThan(SHOT_BUDGET_MICROS.standard);
    expect(alerts).toEqual([]);
  });
});

describe("inline-dispatch fallback is logged and alerted", () => {
  function stubFetch(webhook: string[]) {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/internal/shots/")) return new Response("down", { status: 502 });
      webhook.push(String(init?.body));
      return new Response("ok");
    });
  }

  it("when the HTTP dispatch fails the shot still runs inline, and every fallback is recorded and alerted", async () => {
    process.env.SHOT_DISPATCH = "http";
    resetEnvCache();
    const posted: string[] = [];
    stubFetch(posted);
    const { user, asset } = await setup();
    const gen = await createGeneration(user.id, input(asset.id, 2));
    await runGeneration(gen.id);

    expect((await getGeneration(user.id, gen.id))!.status).toBe("succeeded"); // nothing lost
    const rows = await db().select().from(providerCalls).where(eq(providerCalls.stage, "dispatch"));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.provider === "inline-fallback" && r.ok === false && /502/.test(r.error ?? ""))).toBe(true);
    expect(alerts.filter((a) => a.kind === "shot_dispatch_fallback")).toHaveLength(2);
    expect(alerts[0]).toMatchObject({ reason: "HTTP 502", action: "ran inline", appUrl: "http://localhost:3000" });
  });

  it("posts one webhook per kind per 5 minutes when ALERT_WEBHOOK_URL is set", async () => {
    process.env.SHOT_DISPATCH = "http";
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.test/alert";
    resetEnvCache();
    const posted: string[] = [];
    stubFetch(posted);
    const { user, asset } = await setup();
    await runGeneration((await createGeneration(user.id, input(asset.id, 2))).id);

    expect(alerts.filter((a) => a.kind === "shot_dispatch_fallback")).toHaveLength(2); // always logged
    expect(posted).toHaveLength(1); // one webhook, the second is throttled
    const body = JSON.parse(posted[0]);
    expect(body.text).toContain("shot_dispatch_fallback");
    expect(body.content).toBe(body.text);
  });

  it("a failed dispatch from the sweep (no inline fallback) is alerted as a different kind", async () => {
    process.env.SHOT_DISPATCH = "http";
    resetEnvCache();
    stubFetch([]);
    const { dispatchShots } = await import("@/lib/generation/jobs");
    const { shots } = await planOnly();
    await dispatchShots([shots[0].id]); // no fallbackInline: left pending for the sweep
    expect(alerts.map((a) => a.kind)).toEqual(["shot_dispatch_failed"]);
    const [row] = await db().select().from(generationImages).where(eq(generationImages.id, shots[0].id));
    expect(row.status).toBe("pending");
  });

  it("inline mode has no dispatch to fail, so no alert", async () => {
    const { user, asset } = await setup();
    await runGeneration((await createGeneration(user.id, input(asset.id, 1))).id);
    expect(alerts).toEqual([]);
  });
});
