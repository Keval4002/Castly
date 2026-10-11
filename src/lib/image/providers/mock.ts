import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { env } from "@/lib/env";
import type { ImageProvider, ImageRequest, ImageResult } from "../types";

/**
 * Deterministic offline provider for development and e2e tests: composites
 * the product onto a coloured backdrop derived from the prompt, so every
 * variant visibly differs. Set MOCK_IMAGE_FAIL_PATTERN to force failures.
 */
export const mockImage: ImageProvider = {
  id: "mock",
  model: "mock-compositor",
  available: () => env().IMAGE_PROVIDER_MOCK,

  async generate(req: ImageRequest): Promise<ImageResult> {
    const failPattern = process.env.MOCK_IMAGE_FAIL_PATTERN;
    if (failPattern && req.prompt.includes(failPattern)) throw new Error("Mock provider forced failure");

    const delay = Number(process.env.MOCK_IMAGE_DELAY_MS ?? 400);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay + req.variant * 150));

    const h = createHash("sha256").update(req.prompt).digest();
    const c1 = `rgb(${h[0]},${h[1]},${h[2]})`;
    const c2 = `rgb(${h[3]},${h[4]},${h[5]})`;
    const { width, height } = req.aspectRatio;

    const bg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <text x="32" y="${height - 40}" font-family="sans-serif" font-size="28" fill="white" opacity="0.85">
          Castly mock · variant ${req.variant + 1}</text>
      </svg>`,
    );
    const product = await sharp(req.image.data)
      .resize({ width: Math.round(width * 0.7), height: Math.round(height * 0.7), fit: "inside" })
      .toBuffer();
    const data = await sharp(bg).composite([{ input: product, gravity: "center" }]).jpeg({ quality: 85 }).toBuffer();
    return { data, model: this.model };
  },
};
