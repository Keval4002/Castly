import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const WEBHOOK_SECRET = "whsec_e2e";

async function signIn(page: Page, email: string, shop = "Test Shop") {
  await page.goto("/");
  await page.getByRole("link", { name: /Try free/ }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByPlaceholder("you@business.com").fill(email);
  await page.getByTestId("login-submit").click();
  // First sign-in goes through the 3-tap onboarding before landing in the workspace.
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByTestId("shop-name").fill(shop);
  await page.getByTestId("onboarding-next").click();
  await page.getByTestId("sells-clothing").click();
  await page.getByTestId("purpose-marketplace").click();
  await expect(page).toHaveURL(/\/workspace/);
}

const credits = (page: Page) => page.getByTestId("credits-value");

test("onboarding → workspace → studio → top up → bulk generate → export → library", async ({ page }) => {
  const email = `seller-${randomUUID().slice(0, 8)}@shop.test`;

  // 1. Signup grants the free credits and lands in the workspace with the shop name.
  await signIn(page, email, "Meera Ethnic");
  await expect(page.getByTestId("workspace-title")).toHaveText("Meera Ethnic");
  await expect(credits(page)).toHaveText("10");
  // Returning users skip onboarding.
  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/workspace/);

  // 2. Studio: generate is disabled until a photo is uploaded; the product type is auto-detected.
  await page.getByRole("link", { name: "Studio" }).first().click();
  await expect(page).toHaveURL(/\/studio/);
  await expect(page.getByTestId("generate")).toBeDisabled();
  await page.getByTestId("file-input").setInputFiles("tests/fixtures/product.jpg");
  await expect(page.getByTestId("upload-preview")).toBeVisible();
  await expect(page.getByTestId("detected-type")).toHaveText("Dress / gown");

  // 3. One look, one size, one click — no prompt, tier or variant controls.
  await expect(page.locator("textarea")).toHaveCount(0);
  await page.getByTestId("look-lifestyle").click();
  await page.getByRole("radio", { name: "Story" }).click();
  await expect(page.getByTestId("generate")).toHaveText("Generate · 4 credits");
  await page.getByTestId("generate").click();
  await expect(credits(page)).toHaveText("6");

  const card = page.getByTestId("generation-card").first();
  await expect(card).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
  await expect(card.locator('[data-testid="generation-image"][data-status="succeeded"]')).toHaveCount(2);
  await card.getByRole("button", { name: "Open variant 1" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // 4. Run out of credits: rejected without charging.
  await page.getByTestId("look-festive").click();
  await page.getByTestId("generate").click();
  await expect(credits(page)).toHaveText("2");
  await expect(page.getByTestId("generation-card").first()).toHaveAttribute("data-status", "succeeded", { timeout: 30_000 });
  await page.getByTestId("generate").click();
  await expect(page.getByTestId("studio-error")).toContainText("Not enough credits");
  await expect(credits(page)).toHaveText("2");

  // 5. Top up through the (mock) Razorpay checkout.
  await page.getByRole("link", { name: /Buy credits/ }).click();
  await expect(page).toHaveURL(/\/credits/);
  await page.getByTestId("buy-starter").click();
  await expect(page.getByTestId("payment-message")).toContainText("40 credits added");
  await expect(page.getByTestId("balance")).toHaveText("42");
  await expect(page.getByTestId("ledger")).toContainText("Credit purchase");
  await expect(page.getByTestId("ledger")).toContainText("Welcome bonus");

  // 6. Webhook path: signed payment.captured credits once, replays are ignored, bad signatures rejected.
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
  expect(me.profile.credits).toBe(42 + 110);

  // 7. Workspace: the studio upload is already a product; bulk-add another and generate both.
  await page.goto("/workspace");
  await expect(page.getByTestId("product-card")).toHaveCount(1);
  await page.getByTestId("workspace-file-input").setInputFiles("tests/fixtures/ring.jpg");
  await expect(page.getByTestId("product-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByTestId("bulk-bar")).toContainText("2 selected");
  await page.getByTestId("bulk-look-lifestyle").click();
  await page.getByTestId("generate-selected").click();
  await expect(page.getByTestId("workspace-message")).toContainText("Started 2 products");
  await expect(credits(page)).toHaveText(String(152 - 8));
  await expect(page.getByTestId("product-card").filter({ hasText: "Generating" })).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId("product-card").filter({ hasText: "2 photos" })).toHaveCount(2);

  // 8. Catalogue export is a ZIP.
  const exported = await page.request.get("/api/products/export");
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toBe("application/zip");

  // 9. Library lists every batch.
  await page.getByRole("link", { name: "Library" }).first().click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByTestId("generation-card")).toHaveCount(4);

  // 10. Data isolation: another user cannot see this user's generation.
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
  await page.goto("/studio");
  await page.getByTestId("file-input").setInputFiles("tests/fixtures/product.jpg");
  await expect(page.getByTestId("detected-type")).toHaveText("Dress / gown");

  // Seller wrongly says it is a ring.
  await page.getByRole("button", { name: "Not right?" }).click();
  await page.getByTestId("category-jewellery").click();
  await page.getByTestId("type-ring").click();
  await expect(page.getByTestId("detection-mismatch")).toBeVisible();
  await page.getByTestId("generate").click();

  // Generated as the detected dress, and the seller is told why.
  await expect(page.getByTestId("correction-notice")).toContainText("Category changed from Jewellery to Clothing");
  const corrected = page.getByTestId("generation-card").first();
  await expect(corrected).toContainText("Clothing › Dress / gown");
  await expect(corrected.getByTestId("card-correction")).toBeVisible();
  await expect(page.getByTestId("category-clothing")).toHaveAttribute("data-active", "true");

  // Explicit override: the seller insists.
  await page.getByTestId("category-jewellery").click();
  await page.getByTestId("type-ring").click();
  await page.getByTestId("override-detection").check();
  await page.getByTestId("generate").click();
  const overridden = page.getByTestId("generation-card").first();
  await expect(overridden).toContainText("Jewellery › Ring");
  await expect(overridden.getByTestId("card-correction")).toHaveCount(0);
  await expect(credits(page)).toHaveText("2");
});

test("signed-out users are redirected to login and APIs return 401", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkspace/);
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
