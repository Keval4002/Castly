import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Short-lived URLs for the browser. Order matches `keys`. */
  signedUrls(keys: string[], ttlSeconds?: number): Promise<string[]>;
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/;

export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

// ---------- local filesystem driver (dev / e2e) ----------

function sign(key: string, exp: number): string {
  return createHmac("sha256", env().SESSION_SECRET).update(`${key}:${exp}`).digest("base64url");
}

export function verifyLocalSignature(key: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(sign(key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

class LocalStorage implements Storage {
  private root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().LOCAL_STORAGE_DIR);

  private file(key: string) {
    assertSafeKey(key);
    const p = path.resolve(/*turbopackIgnore: true*/ this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("Path escapes storage root");
    return p;
  }

  async put(key: string, body: Buffer) {
    const p = this.file(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }

  async get(key: string) {
    return fs.readFile(this.file(key));
  }

  async signedUrls(keys: string[], ttlSeconds = 3600) {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    return keys.map((k) => {
      assertSafeKey(k);
      return `/api/files/${k}?exp=${exp}&sig=${sign(k, exp)}`;
    });
  }
}

// ---------- Supabase Storage driver (production) ----------

class SupabaseStorage implements Storage {
  private client: SupabaseClient;
  private bucket: string;

  constructor() {
    const e = env();
    this.client = createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = e.SUPABASE_STORAGE_BUCKET;
  }

  async put(key: string, body: Buffer, contentType: string) {
    assertSafeKey(key);
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, body, { contentType, upsert: false, cacheControl: "31536000" });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }

  async get(key: string) {
    assertSafeKey(key);
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? "no data"}`);
    return Buffer.from(await data.arrayBuffer());
  }

  async signedUrls(keys: string[], ttlSeconds = 3600) {
    if (keys.length === 0) return [];
    keys.forEach(assertSafeKey);
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrls(keys, ttlSeconds);
    if (error || !data) throw new Error(`Signing URLs failed: ${error?.message ?? "no data"}`);
    const byPath = new Map(data.map((d) => [d.path, d.signedUrl]));
    return keys.map((k) => byPath.get(k) ?? "");
  }
}

let instance: Storage | null = null;

export function storage(): Storage {
  if (!instance) instance = env().STORAGE_DRIVER === "local" ? new LocalStorage() : new SupabaseStorage();
  return instance;
}
