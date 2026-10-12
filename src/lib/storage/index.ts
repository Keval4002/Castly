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
  /** Idempotent: missing keys are not an error. */
  delete(keys: string[]): Promise<void>;
  /** Object size, or null when the key does not exist. */
  head(key: string): Promise<{ bytes: number } | null>;
  /**
   * Recursive listing of keys under `prefix` (a key prefix; may end with "/" or be a partial name),
   * in stable lexicographic order. `cursor` is the `next` of a previous page (exclusive).
   */
  list(prefix: string, opts?: { limit?: number; cursor?: string }): Promise<{ keys: string[]; next?: string }>;
  /** Presigned direct-upload URL for the browser. Optional (not supported by the local driver). */
  signedUploadUrl?(key: string, contentType: string, ttlSeconds?: number): Promise<{ url: string; token?: string }>;
}

const KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9/_\-.]*$/;

export function assertSafeKey(key: string) {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

/** Like assertSafeKey but for listing: "" or a key-shaped prefix, optionally ending in one "/". */
export function assertSafePrefix(prefix: string) {
  if (prefix === "") return;
  if (prefix.endsWith("//")) throw new Error(`Unsafe storage prefix: ${prefix}`);
  assertSafeKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
}

const DEFAULT_LIST_LIMIT = 1000;

/** Sort, apply exclusive cursor and limit to a full key set. `next` is set only if more remain. */
function paginate(all: string[], opts?: { limit?: number; cursor?: string }) {
  const limit = Math.max(1, Math.min(opts?.limit ?? DEFAULT_LIST_LIMIT, 10_000));
  const sorted = [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const after = opts?.cursor ? sorted.filter((k) => k > opts.cursor!) : sorted;
  const keys = after.slice(0, limit);
  return after.length > limit ? { keys, next: keys[keys.length - 1] } : { keys };
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

  async delete(keys: string[]) {
    for (const k of keys) {
      await fs.rm(this.file(k), { force: true });
    }
  }

  async head(key: string) {
    try {
      const st = await fs.stat(this.file(key));
      return st.isFile() ? { bytes: st.size } : null;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return null;
      throw e;
    }
  }

  async list(prefix: string, opts?: { limit?: number; cursor?: string }) {
    assertSafePrefix(prefix);
    const slash = prefix.lastIndexOf("/");
    const dirKey = slash >= 0 ? prefix.slice(0, slash) : "";
    const out: string[] = [];
    const walk = async (rel: string) => {
      let entries;
      try {
        entries = await fs.readdir(path.resolve(/*turbopackIgnore: true*/ this.root, rel), { withFileTypes: true });
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return;
        throw e;
      }
      for (const ent of entries) {
        const k = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) await walk(k);
        else if (ent.isFile() && k.startsWith(prefix)) out.push(k);
      }
    };
    await walk(dirKey);
    return paginate(out, opts);
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

  async delete(keys: string[]) {
    keys.forEach(assertSafeKey);
    // remove() does not error on missing objects; chunked to stay under API limits.
    for (let i = 0; i < keys.length; i += 500) {
      const { error } = await this.client.storage.from(this.bucket).remove(keys.slice(i, i + 500));
      if (error) throw new Error(`Storage delete failed: ${error.message}`);
    }
  }

  async head(key: string) {
    assertSafeKey(key);
    const slash = key.lastIndexOf("/");
    const dir = slash >= 0 ? key.slice(0, slash) : "";
    const name = key.slice(slash + 1);
    const { data, error } = await this.client.storage.from(this.bucket).list(dir, { limit: 100, search: name });
    if (error) throw new Error(`Storage head failed: ${error.message}`);
    const hit = (data ?? []).find((o) => o.name === name && o.id);
    if (!hit) return null;
    const size = (hit.metadata as { size?: number } | null)?.size;
    return { bytes: typeof size === "number" ? size : 0 };
  }

  /**
   * Supabase list() is one folder level per call, so we walk sub-folders recursively
   * (entries with a null id are folders), paginating each folder 100 at a time, then sort and
   * paginate in memory. Fine for per-user prefixes; avoid listing the whole bucket at scale.
   */
  async list(prefix: string, opts?: { limit?: number; cursor?: string }) {
    assertSafePrefix(prefix);
    const slash = prefix.lastIndexOf("/");
    const dirKey = slash >= 0 ? prefix.slice(0, slash) : "";
    const out: string[] = [];
    const PAGE = 100;
    const walk = async (folder: string) => {
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await this.client.storage
          .from(this.bucket)
          .list(folder, { limit: PAGE, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw new Error(`Storage list failed: ${error.message}`);
        for (const o of data ?? []) {
          const k = folder ? `${folder}/${o.name}` : o.name;
          if (!o.id) {
            // Folder: only descend if it can contain keys matching the prefix.
            if (k.startsWith(prefix) || prefix.startsWith(`${k}/`)) await walk(k);
          } else if (k.startsWith(prefix)) out.push(k);
        }
        if (!data || data.length < PAGE) break;
      }
    };
    await walk(dirKey);
    return paginate(out, opts);
  }

  async signedUploadUrl(key: string, _contentType: string, _ttlSeconds?: number) {
    assertSafeKey(key);
    // Supabase signed upload URLs have a fixed server-side expiry; the client sets contentType on upload.
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(key);
    if (error || !data) throw new Error(`Signed upload URL failed: ${error?.message ?? "no data"}`);
    return { url: data.signedUrl, token: data.token };
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
