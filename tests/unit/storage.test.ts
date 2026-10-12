import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { storage, assertSafeKey } from "@/lib/storage";
import { objectKey, isOwnedKey, isUuid } from "@/lib/storage/keys";

const run = `t${randomUUID().slice(0, 8)}`;
const base = `storagetest/${run}`;
const buf = (s: string) => Buffer.from(s);

afterAll(async () => {
  await fs.rm(path.resolve(process.cwd(), ".data/test-storage/storagetest", run), { recursive: true, force: true });
});

describe("local storage driver", () => {
  it("put/get/head/delete", async () => {
    const s = storage();
    const k = `${base}/a/one.txt`;
    expect(await s.head(k)).toBeNull();
    await s.put(k, buf("hello"), "text/plain");
    expect((await s.get(k)).toString()).toBe("hello");
    expect(await s.head(k)).toEqual({ bytes: 5 });
    await s.delete([k]);
    expect(await s.head(k)).toBeNull();
  });

  it("delete is idempotent for missing keys", async () => {
    const s = storage();
    await expect(s.delete([`${base}/nope/x.txt`, `${base}/nope/y.txt`])).resolves.toBeUndefined();
    await expect(s.delete([])).resolves.toBeUndefined();
  });

  it("list paginates in stable order and isolates prefixes", async () => {
    const s = storage();
    const keys = ["b/3.txt", "a/1.txt", "a/2.txt", "a/sub/4.txt", "ab/5.txt"].map((k) => `${base}/${k}`);
    for (const k of keys) await s.put(k, buf("x"), "text/plain");

    const all = await s.list(`${base}/a/`);
    expect(all.keys).toEqual([`${base}/a/1.txt`, `${base}/a/2.txt`, `${base}/a/sub/4.txt`]);
    expect(all.next).toBeUndefined();

    const p1 = await s.list(`${base}/a/`, { limit: 2 });
    expect(p1.keys).toEqual([`${base}/a/1.txt`, `${base}/a/2.txt`]);
    expect(p1.next).toBeDefined();
    const p2 = await s.list(`${base}/a/`, { limit: 2, cursor: p1.next });
    expect(p2.keys).toEqual([`${base}/a/sub/4.txt`]);
    expect(p2.next).toBeUndefined();

    // partial-name prefix (no trailing slash) matches both a/ and ab/
    const partial = await s.list(`${base}/a`);
    expect(partial.keys).toHaveLength(4);
    // missing prefix
    expect((await s.list(`${base}/zzz/`)).keys).toEqual([]);
  });

  it("rejects unsafe keys and prefixes", async () => {
    const s = storage();
    for (const bad of ["../x", "a/../b", "a//b", "/abs", "a/é.jpg", "a/b c.jpg", "", "a\\b"]) {
      expect(() => assertSafeKey(bad), bad).toThrow();
      await expect(s.put(bad, buf("x"), "text/plain"), bad).rejects.toThrow();
      await expect(s.head(bad), bad).rejects.toThrow();
      await expect(s.delete([bad]), bad).rejects.toThrow();
    }
    await expect(s.list("../")).rejects.toThrow();
    await expect(s.list("a//")).rejects.toThrow();
    await expect(s.list("/a/")).rejects.toThrow();
  });
});

describe("storage keys", () => {
  const user = randomUUID();
  const product = randomUUID();
  const gen = randomUUID();

  it("builds safe keys from ids", () => {
    const k = objectKey({ userId: user, kind: "output", productId: product, generationId: gen, ext: "webp" });
    expect(k.startsWith(`u/${user}/${product}/${gen}/`)).toBe(true);
    expect(k.endsWith(".webp")).toBe(true);
    expect(() => assertSafeKey(k)).not.toThrow();
    expect(objectKey({ userId: user, kind: "upload", ext: "jpg" })).toMatch(
      new RegExp(`^u/${user}/_/_/upload-[0-9a-f-]{36}\\.jpg$`),
    );
    expect(objectKey({ userId: user, kind: "thumb", ext: "png" })).not.toBe(objectKey({ userId: user, kind: "thumb", ext: "png" }));
  });

  it("validates ids, kind and ext", () => {
    expect(isUuid(user)).toBe(true);
    expect(isUuid("../x")).toBe(false);
    expect(() => objectKey({ userId: "nope", kind: "upload", ext: "jpg" })).toThrow();
    expect(() => objectKey({ userId: user, kind: "upload", productId: "../x", ext: "jpg" })).toThrow();
    expect(() => objectKey({ userId: user, kind: "upload", generationId: "a/b", ext: "jpg" })).toThrow();
    expect(() => objectKey({ userId: user, kind: "upload", ext: "exe" })).toThrow();
    expect(() => objectKey({ userId: user, kind: "upload", ext: "jpg/../x" })).toThrow();
    // @ts-expect-error invalid kind
    expect(() => objectKey({ userId: user, kind: "evil", ext: "jpg" })).toThrow();
  });

  it("isOwnedKey rejects other users and tricks", () => {
    const k = objectKey({ userId: user, kind: "output", ext: "jpg" });
    expect(isOwnedKey(user, k)).toBe(true);
    expect(isOwnedKey(randomUUID(), k)).toBe(false);
    expect(isOwnedKey(user, `u/${user}/`)).toBe(false);
    expect(isOwnedKey(user, `u/${user}/../${randomUUID()}/x.jpg`)).toBe(false);
    expect(isOwnedKey(user, `u/${user}//x.jpg`)).toBe(false);
    expect(isOwnedKey("not-a-uuid", k)).toBe(false);
  });
});
