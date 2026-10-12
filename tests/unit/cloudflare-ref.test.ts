import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";

afterEach(() => {
  vi.unstubAllGlobals();
  resetEnvCache();
});

async function run(image: { data: Buffer; mime: string; small?: Buffer }) {
  Object.assign(process.env, { CLOUDFLARE_ACCOUNT_ID: "acc", CLOUDFLARE_API_TOKEN: "tok" });
  resetEnvCache();
  let form!: FormData;
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).png().toBuffer();
  vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
    form = init.body as FormData;
    return new Response(JSON.stringify({ result: { image: png.toString("base64") } }), { headers: { "content-type": "application/json" } });
  });
  const { cloudflareFlux } = await import("@/lib/image/providers/cloudflare");
  await cloudflareFlux.generate({ prompt: "p", image, aspectRatio: { width: 4, height: 5 } as never, variant: 0 });
  return Buffer.from(await (form.get("input_image_0") as Blob).arrayBuffer());
}

const jpeg = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#cc2222" } }).jpeg().toBuffer();

describe("cloudflare reference image", () => {
  it("uses the provided small view as-is", async () => {
    const small = await jpeg(400, 500);
    const sent = await run({ data: await jpeg(1024, 1280), mime: "image/jpeg", small });
    expect(sent.equals(small)).toBe(true);
    const meta = await sharp(sent).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThan(512);
  });

  it("still downsizes below 512px without a small view, or if it is too big", async () => {
    const a = await sharp(await run({ data: await jpeg(1024, 1280), mime: "image/jpeg" })).metadata();
    expect(Math.max(a.width!, a.height!)).toBeLessThan(512);
    const b = await sharp(await run({ data: await jpeg(1024, 1280), mime: "image/jpeg", small: await jpeg(800, 1000) })).metadata();
    expect(Math.max(b.width!, b.height!)).toBeLessThan(512);
  });
});
