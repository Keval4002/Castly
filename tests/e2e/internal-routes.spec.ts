import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

/**
 * The internal shot route and the cron sweep, exercised over real HTTP against the production server
 * (see playwright.config.ts): bad and expired signatures, replays, wrong methods, auth on the sweep.
 * No browser is used.
 */

const SESSION_SECRET = "e2e-secret-e2e-secret-e2e-secret-e2e-secret";
const CRON_SECRET = "e2e-cron-secret-e2e-cron-secret";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://dukaanshot:dukaanshot@localhost:5432/dukaanshot_test";

/** Same scheme as src/lib/generation/jobs.ts signShotRequest. */
function sign(imageId: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", SESSION_SECRET).update(`shot:${imageId}:${ts}`).digest("base64url");
  return { "x-shot-ts": String(ts), "x-shot-sig": sig };
}

const sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
test.afterAll(async () => {
  await sql.end();
});

const GHOST = "11111111-1111-4111-8111-111111111111";

async function seller(request: APIRequestContext) {
  const email = `http-${randomUUID().slice(0, 8)}@shop.test`;
  expect((await request.post("/api/auth/dev-login", { data: { email } })).ok()).toBeTruthy();
  const up = await request.post("/api/uploads", {
    multipart: { file: { name: "p.jpg", mimeType: "image/jpeg", buffer: readFileSync("tests/fixtures/product.jpg") } },
  });
  expect(up.status()).toBe(201);
  const { asset } = await up.json();
  return { email, assetId: asset.id as string };
}

async function generate(request: APIRequestContext, assetId: string) {
  const res = await request.post("/api/generations", {
    data: { sourceAssetId: assetId, category: "clothing", look: "marketplace", aspectRatio: "4:5" },
  });
  expect(res.status()).toBe(202);
  return (await res.json()).generation.id as string;
}

async function waitSettled(request: APIRequestContext, id: string) {
  await expect
    .poll(async () => (await (await request.get(`/api/generations/${id}`)).json()).generation.status, { timeout: 60_000 })
    .toMatch(/succeeded|partial|failed/);
}

test.describe("POST /api/internal/shots/:id", () => {
  test("rejects anything that isn't a fresh signature for that exact shot", async ({ request }) => {
    const url = `/api/internal/shots/${GHOST}`;
    const bad = [
      { name: "no headers", headers: {} },
      { name: "garbage signature", headers: { ...sign(GHOST), "x-shot-sig": "nope" } },
      { name: "signature for a different shot", headers: sign("22222222-2222-4222-8222-222222222222") },
      { name: "expired timestamp (1 hour old)", headers: sign(GHOST, Math.floor(Date.now() / 1000) - 3600) },
      { name: "timestamp from the future", headers: sign(GHOST, Math.floor(Date.now() / 1000) + 3600) },
      { name: "valid signature, tampered timestamp", headers: { ...sign(GHOST), "x-shot-ts": String(Math.floor(Date.now() / 1000) + 1) } },
      {
        name: "signed with the wrong secret",
        headers: { "x-shot-ts": "1", "x-shot-sig": createHmac("sha256", "wrong").update(`shot:${GHOST}:1`).digest("base64url") },
      },
    ];
    for (const c of bad) {
      const res = await request.post(url, { headers: c.headers });
      expect(res.status(), c.name).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
  });

  test("rejects a malformed shot id even with a matching signature", async ({ request }) => {
    const res = await request.post("/api/internal/shots/not-a-uuid", { headers: sign("not-a-uuid") });
    expect(res.status()).toBe(401);
  });

  test("only POST is allowed", async ({ request }) => {
    for (const method of ["get", "put", "delete"] as const) {
      const res = await request[method](`/api/internal/shots/${GHOST}`, { headers: sign(GHOST) });
      expect(res.status(), method).toBe(405);
    }
  });

  test("a valid signature for a shot that doesn't exist is accepted and does nothing", async ({ request }) => {
    const res = await request.post(`/api/internal/shots/${GHOST}`, { headers: sign(GHOST) });
    expect(res.status()).toBe(202);
    expect(await res.json()).toEqual({ accepted: true });
  });

  test("real dispatch runs shots over HTTP, and replaying a valid signed request never pays or charges twice", async ({ request }) => {
    const { email, assetId } = await seller(request);
    const genId = await generate(request, assetId);
    await waitSettled(request, genId);

    const shots = await sql<{ id: string }[]>`select id from generation_images where generation_id = ${genId} order by idx`;
    expect(shots.length).toBeGreaterThan(0);
    const [{ credits }] = await sql<{ credits: number }[]>`select credits from profiles where email = ${email}`;
    const countCalls = async () =>
      (await sql<{ n: number }[]>`select count(*)::int n from provider_calls where generation_id = ${genId} and stage = 'generate'`)[0].n;
    const generateCalls = await countCalls();
    expect(generateCalls).toBe(shots.length); // one paid call per shot: the dispatch ran each shot exactly once
    const fallbacks = await sql`select 1 from provider_calls where stage = 'dispatch' and created_at > now() - interval '5 minutes'`;
    expect(fallbacks.length).toBe(0); // HTTP dispatch worked: no inline fallback

    // Replay every shot's signed request several times, concurrently. The signature is still valid, so the
    // route answers 202, but the shots are finished: nothing runs again.
    const replays = shots.flatMap((s) => Array.from({ length: 3 }, () => request.post(`/api/internal/shots/${s.id}`, { headers: sign(s.id) })));
    for (const r of await Promise.all(replays)) expect(r.status()).toBe(202);
    await new Promise((r) => setTimeout(r, 1500)); // after() work would be done by now
    expect(await countCalls()).toBe(generateCalls);
    const [{ credits: after }] = await sql<{ credits: number }[]>`select credits from profiles where email = ${email}`;
    expect(after).toBe(credits);
    const rows = await sql<{ dispatch_count: number; status: string }[]>`select dispatch_count, status from generation_images where generation_id = ${genId}`;
    expect(rows.every((r) => r.status === "succeeded" && r.dispatch_count === 1)).toBe(true);
  });

  test("a replay racing a pending shot starts it only once", async ({ request }) => {
    const { assetId } = await seller(request);
    const genId = await generate(request, assetId);
    const shots = await sql<{ id: string }[]>`select id from generation_images where generation_id = ${genId} order by idx`;
    // Fire replays while the real dispatch is still running these shots.
    await Promise.all(shots.flatMap((s) => Array.from({ length: 4 }, () => request.post(`/api/internal/shots/${s.id}`, { headers: sign(s.id) }))));
    await waitSettled(request, genId);
    const rows = await sql<{ dispatch_count: number }[]>`select dispatch_count from generation_images where generation_id = ${genId}`;
    expect(rows.every((r) => r.dispatch_count === 1)).toBe(true);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from provider_calls where generation_id = ${genId} and stage = 'generate'`;
    expect(n).toBe(shots.length);
  });
});

test.describe("/api/cron/sweep", () => {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  test("needs the exact bearer token", async ({ request }) => {
    for (const headers of [{}, auth("wrong"), auth(CRON_SECRET + "x"), { authorization: CRON_SECRET }, { authorization: `Basic ${CRON_SECRET}` }]) {
      const res = await request.get("/api/cron/sweep", { headers });
      expect(res.status(), JSON.stringify(headers)).toBe(401);
    }
  });

  test("runs with the right token (GET and POST), and a replay is harmless", async ({ request }) => {
    for (const method of ["get", "post"] as const) {
      const res = await request[method]("/api/cron/sweep", { headers: auth(CRON_SECRET) });
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toContain("no-store");
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, plannedQueued: 0, failedStale: 0 });
    }
  });

  test("restarts a shot whose worker died, over real HTTP", async ({ request }) => {
    const { assetId } = await seller(request);
    const genId = await generate(request, assetId);
    await waitSettled(request, genId);
    // Simulate a lost shot (never claimed, dispatch lost) on an old, still-running generation.
    const [shot] = await sql<{ id: string }[]>`select id from generation_images where generation_id = ${genId} order by idx limit 1`;
    await sql`update generation_images set status = 'pending', dispatch_count = 0, lease_until = null, asset_id = null, attempts = 0 where id = ${shot.id}`;
    await sql`update generations set status = 'running', completed_at = null, created_at = now() - interval '5 minutes' where id = ${genId}`;

    const res = await request.get("/api/cron/sweep", { headers: auth(CRON_SECRET) });
    expect(res.status()).toBe(200);
    expect((await res.json()).recoveredShots).toBeGreaterThanOrEqual(1);
    await waitSettled(request, genId);
    const [row] = await sql<{ status: string }[]>`select status from generation_images where id = ${shot.id}`;
    expect(row.status).toBe("succeeded");
  });
});
