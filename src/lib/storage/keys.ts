// Pure, server-side object key helpers. Keys are built from ids only, never from user filenames.
// Shape: u/<userId>/<productId|_>/<generationId|_>/<uuid>.<ext>
import { randomUUID } from "node:crypto";

export const KEY_KINDS = ["upload", "output", "clean", "thumb"] as const;
export type KeyKind = (typeof KEY_KINDS)[number];
export const KEY_EXTS = ["jpg", "jpeg", "png", "webp", "avif"] as const;
export type KeyExt = (typeof KEY_EXTS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function id(name: string, v: string | undefined | null): string {
  if (v == null) return "_";
  if (!isUuid(v)) throw new Error(`Invalid ${name}`);
  return v.toLowerCase();
}

export function objectKey(p: {
  userId: string;
  kind: KeyKind;
  productId?: string | null;
  generationId?: string | null;
  ext: string;
}): string {
  if (!isUuid(p.userId)) throw new Error("Invalid userId");
  if (!(KEY_KINDS as readonly string[]).includes(p.kind)) throw new Error("Invalid kind");
  if (!(KEY_EXTS as readonly string[]).includes(p.ext)) throw new Error("Invalid ext");
  // Outputs get a bare uuid; other kinds are prefixed so listings stay self-describing.
  const file = p.kind === "output" ? randomUUID() : `${p.kind}-${randomUUID()}`;
  return `u/${p.userId.toLowerCase()}/${id("productId", p.productId)}/${id("generationId", p.generationId)}/${file}.${p.ext}`;
}

/** True when `key` lives under the user's own prefix (and has no traversal tricks). */
export function isOwnedKey(userId: string, key: string): boolean {
  if (!isUuid(userId) || typeof key !== "string") return false;
  if (key.includes("..") || key.includes("//") || key.includes("\\")) return false;
  const prefix = `u/${userId.toLowerCase()}/`;
  return key.startsWith(prefix) && key.length > prefix.length;
}
