import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { saveAsset } from "@/lib/assets";
import { db } from "@/lib/db";
import { productPhotos, products } from "@/lib/db/schema";
import { normalizeUpload } from "@/lib/image/process";
import {
  addProductPhoto,
  availableAngles,
  listProductPhotos,
  missingAngleHint,
  removeProductPhoto,
} from "@/lib/product-photos";
import { ensureProductForAsset } from "@/lib/products";
import { makeUser, resetDb } from "./helpers";

const fixture = readFileSync("tests/fixtures/product.jpg");

async function upload(userId: string) {
  return saveAsset(userId, "upload", await normalizeUpload(fixture), "uploads");
}

async function setup() {
  const user = await makeUser();
  const main = await upload(user.id);
  const product = await ensureProductForAsset(user.id, main, "Kurta");
  return { user, main, product };
}

beforeEach(resetDb);
afterAll(resetDb);

describe("product photos", () => {
  it("ensureProductForAsset creates the front photo (idempotent)", async () => {
    const { user, main, product } = await setup();
    await ensureProductForAsset(user.id, main, "Kurta");
    const photos = await listProductPhotos(user.id, product.id);
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ angle: "front", assetId: main.id });
  });

  it("a product created before photos existed still reports front", async () => {
    const user = await makeUser();
    const main = await upload(user.id);
    const [p] = await db()
      .insert(products)
      .values({ userId: user.id, name: "Old", category: "clothing", sourceAssetId: main.id })
      .returning();
    expect(await db().select().from(productPhotos).where(eq(productPhotos.productId, p.id))).toHaveLength(0);
    expect([...(await availableAngles(p.id))]).toEqual(["front"]);
    // Re-running ensureProductForAsset heals the missing row.
    await ensureProductForAsset(user.id, main, "Old");
    expect(await listProductPhotos(user.id, p.id)).toHaveLength(1);
  });

  it("rejects another user's product or asset", async () => {
    const { user, product } = await setup();
    const other = await makeUser();
    const otherAsset = await upload(other.id);
    const mine = await upload(user.id);
    await expect(addProductPhoto(other.id, product.id, otherAsset.id, "back")).rejects.toMatchObject({ status: 404 });
    await expect(addProductPhoto(user.id, product.id, otherAsset.id, "back")).rejects.toMatchObject({ status: 404 });
    await addProductPhoto(user.id, product.id, mine.id, "back");
    expect(await listProductPhotos(other.id, product.id)).toHaveLength(0);
  });

  it("rejects an asset already attached to a product", async () => {
    const { user, main, product } = await setup();
    const second = await ensureProductForAsset(user.id, await upload(user.id), "Other");
    await expect(addProductPhoto(user.id, product.id, main.id, "back")).rejects.toMatchObject({ status: 409 });
    const extra = await upload(user.id);
    await addProductPhoto(user.id, product.id, extra.id, "side");
    await expect(addProductPhoto(user.id, second.id, extra.id, "side")).rejects.toMatchObject({ status: 409 });
  });

  it("back/side/detail replace; other and front accumulate", async () => {
    const { user, product } = await setup();
    const a = await upload(user.id);
    const b = await upload(user.id);
    await addProductPhoto(user.id, product.id, a.id, "back");
    await addProductPhoto(user.id, product.id, b.id, "back");
    let photos = await listProductPhotos(user.id, product.id);
    expect(photos.filter((p) => p.angle === "back").map((p) => p.assetId)).toEqual([b.id]);

    for (const angle of ["other", "other", "front"] as const) await addProductPhoto(user.id, product.id, (await upload(user.id)).id, angle);
    photos = await listProductPhotos(user.id, product.id);
    expect(photos.filter((p) => p.angle === "other")).toHaveLength(2);
    expect(photos.filter((p) => p.angle === "front")).toHaveLength(2);
    // Front first, then back, other last.
    expect(photos[0].angle).toBe("front");
    expect(photos[photos.length - 1].angle).toBe("other");
  });

  it("cannot remove the main photo; can remove others and 404s for strangers", async () => {
    const { user, main, product } = await setup();
    const [front] = await listProductPhotos(user.id, product.id);
    await expect(removeProductPhoto(user.id, product.id, front.id)).rejects.toMatchObject({ code: "main_photo" });
    const back = await addProductPhoto(user.id, product.id, (await upload(user.id)).id, "back");
    const other = await makeUser();
    await expect(removeProductPhoto(other.id, product.id, back.id)).rejects.toMatchObject({ status: 404 });
    await removeProductPhoto(user.id, product.id, back.id);
    expect(await listProductPhotos(user.id, product.id)).toHaveLength(1);
    expect((await listProductPhotos(user.id, product.id))[0].assetId).toBe(main.id);
  });

  it("availableAngles and hints", async () => {
    const { user, product } = await setup();
    expect([...(await availableAngles(product.id))]).toEqual(["front"]);
    await addProductPhoto(user.id, product.id, (await upload(user.id)).id, "detail");
    const angles = await availableAngles(product.id);
    expect(angles.has("detail")).toBe(true);
    expect(angles.has("back")).toBe(false);
    expect(missingAngleHint("back")).toMatch(/back photo/);
    expect(missingAngleHint("detail")).toMatch(/detail photo/);
    expect(missingAngleHint("front")).toBeNull();
  });
});
