import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const WEBHOOK_SECRET = "whsec_e2e";

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByRole("link", { name: /Try free/ }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByPlaceholder("you@business.com").fill(email);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/studio/);
}

const credits = (page: Page) => page.getByTestId("credits-value");

test("signup → upload → generate → refund-safe errors → top up → webhook → library", async ({ page }) => {
  const email = `seller-${randomUUID().slice(0, 8)}@shop.test`;

  // 1. Signup grants the free credits.
  await signIn(page, email);
  await expect(credits(page)).toHaveText("10");

  // 2. Generate is disabled until a photo is uploaded.
  await expect(page.getByTestId("generate")).toBeDisabled();
  await page.getByTestId("file-input").setInputFiles("tests/fixtures/product.jpg");
  await expect(page.getByTestId("upload-preview")).toBeVisible();
  // The classifier recognises the dress and pre-selects it.
  await expect(page.getByTestId("detected-type")).toHaveText("Dress / gown");
  await expect(page.getByTestId("category-clothing")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("type-dress")).toHaveAttribute("data-active", "true");

  // 3. Configure: clothing → "Lifestyle street" preset, 2 variants, Studio tier, story ratio.
  await page.getByRole("button", { name: /Lifestyle street/ }).click();
  await page.getByRole("button", { name: /9:16/ }).click();
  await page.getByTestId("count-2").click();
  await page.getByTestId("tier-standard").click();
  await expect(page.getByTestId("generate")).toHaveText("Generate 2 images · 4 credits");

  await page.getByTestId("generate").click();
  await expect(credits(page)).toHaveText("6");

  // 4. Results stream in and settle.
  const card = page.getByTestId("generation-card").first();
  await expect(card).toHaveAttribute("data-status", /queued|running|succeeded/);
  await expect(card).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
  await expect(card.locator('[data-testid="generation-image"][data-status="succeeded"]')).toHaveCount(2);
  await expect(card.locator("img[alt='Variant 1']")).toBeVisible();

  // Lightbox opens with the full-size image.
  await card.getByRole("button", { name: "Open variant 1" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // 5. Jewellery batch with too few credits is rejected without charging.
  await page.getByTestId("category-jewellery").click();
  await expect(page.getByTestId("detection-mismatch")).toContainText("looks like Dress / gown");
  await page.getByTestId("count-4").click();
  await page.getByTestId("tier-premium").click();
  await page.getByTestId("generate").click();
  await expect(page.getByTestId("studio-error")).toContainText("Not enough credits");
  await expect(credits(page)).toHaveText("6");

  // 6. Top up through the (mock) Razorpay checkout.
  await page.getByRole("link", { name: /Buy credits/ }).click();
  await expect(page).toHaveURL(/\/credits/);
  await page.getByTestId("buy-starter").click();
  await expect(page.getByTestId("payment-message")).toContainText("40 credits added");
  await expect(page.getByTestId("balance")).toHaveText("46");
  await expect(page.getByTestId("ledger")).toContainText("Credit purchase");
  await expect(page.getByTestId("ledger")).toContainText("Welcome bonus");

  // 7. Webhook path: signed payment.captured credits once, replays are ignored, bad signatures rejected.
  const order = await page.request.post("/api/payments/order", { data: { packId: "growth" } });
  expect(order.status()).toBe(201);
  const { orderId, amount } = await order.json();
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: `pay_${randomUUID().slice(0, 10)}`, order_id: orderId, amount, status: "captured" } } },
  });
  const sig = createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex");
  const headers = { "content-type": "application/json", "x-razorpay-signature": sig };

  const bad = await page.request.post("/api/webhooks/razorpay", { data: body, headers: { ...headers, "x-razorpay-signature": "nope" } });
  expect(bad.status()).toBe(400);
  const first = await page.request.post("/api/webhooks/razorpay", { data: body, headers });
  expect(await first.json()).toMatchObject({ ok: true, fulfilled: true });
  const replay = await page.request.post("/api/webhooks/razorpay", { data: body, headers });
  expect(await replay.json()).toMatchObject({ ok: true, fulfilled: false });

  const me = await (await page.request.get("/api/me")).json();
  expect(me.profile.credits).toBe(46 + 110);

  // 8. Now the premium jewellery batch is affordable.
  await page.goto("/studio");
  await expect(credits(page)).toHaveText("156");
  await page.getByTestId("file-input").setInputFiles("tests/fixtures/ring.jpg");
  await expect(page.getByTestId("detected-type")).toHaveText("Ring");
  // Jewellery is selected automatically from the photo.
  await expect(page.getByTestId("category-jewellery")).toHaveAttribute("data-active", "true");
  await page.getByRole("button", { name: /Minimal marble/ }).click();
  await page.getByTestId("count-3").click();
  await page.getByTestId("tier-premium").click();
  await page.getByTestId("generate").click();
  await expect(credits(page)).toHaveText(String(156 - 24));
  const jewelCard = page.getByTestId("generation-card").first();
  await expect(jewelCard).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
  await expect(jewelCard.locator('[data-testid="generation-image"][data-status="succeeded"]')).toHaveCount(3);

  // 9. Library lists both batches; protected pages require auth.
  await page.getByRole("link", { name: "Library" }).first().click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByTestId("generation-card")).toHaveCount(2);

  // 10. Data isolation: another user can't see this user's generation.
  const genId = (await (await page.request.get("/api/generations")).json()).generations[0].id;
  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  await signIn(otherPage, `other-${randomUUID().slice(0, 8)}@shop.test`);
  const forbidden = await otherPage.request.get(`/api/generations/${genId}`);
  expect(forbidden.status()).toBe(404);
  await other.close();
});

test("classifier corrects a wrong category, and the seller can override it", async ({ page }) => {
  await signIn(page, `fix-${randomUUID().slice(0, 8)}@shop.test`);
  await page.getByTestId("file-input").setInputFiles("tests/fixtures/product.jpg");
  await expect(page.getByTestId("detected-type")).toHaveText("Dress / gown");

  // Seller wrongly says it's a ring.
  await page.getByTestId("category-jewellery").click();
  await page.getByTestId("type-ring").click();
  await expect(page.getByTestId("detection-mismatch")).toBeVisible();
  await page.getByTestId("count-1").click();
  await page.getByTestId("tier-economy").click();
  await page.getByTestId("generate").click();

  // Generated as the detected dress, and the seller is told why.
  await expect(page.getByTestId("correction-notice")).toContainText("Category changed from Jewellery to Clothing");
  const corrected = page.getByTestId("generation-card").first();
  await expect(corrected).toContainText("Clothing › Dress / gown");
  await expect(corrected.getByTestId("card-correction")).toBeVisible();
  // Controls now reflect the correction.
  await expect(page.getByTestId("category-clothing")).toHaveAttribute("data-active", "true");

  // Explicit override: the seller insists.
  await page.getByTestId("category-jewellery").click();
  await page.getByTestId("type-ring").click();
  await page.getByTestId("override-detection").check();
  await page.getByTestId("generate").click();
  const overridden = page.getByTestId("generation-card").first();
  await expect(overridden).toContainText("Jewellery › Ring");
  await expect(overridden.getByTestId("card-correction")).toHaveCount(0);
  await expect(credits(page)).toHaveText("8");
});

test("signed-out users are redirected to login and APIs return 401", async ({ page }) => {
  await page.goto("/studio");
  await expect(page).toHaveURL(/\/login\?next=%2Fstudio/);
  const res = await page.request.get("/api/me");
  expect(res.status()).toBe(401);
});

test("cross-origin POSTs are blocked", async ({ request }) => {
  const res = await request.post("/api/payments/order", {
    data: { packId: "starter" },
    headers: { origin: "https://evil.example" },
  });
  expect(res.status()).toBe(403);
});
