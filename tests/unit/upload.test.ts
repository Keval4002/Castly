import { readFileSync } from "node:fs";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A real HEVC fixture can't be produced here (sharp's prebuilt libheif only encodes AV1), so the
// converter is stubbed: these tests cover detection and routing, not libheif's decoding itself.
const calls: unknown[][] = [];
let decoder: () => Promise<Buffer> = async () => Buffer.alloc(0);
vi.mock("heic-convert", () => ({
  default: (...a: unknown[]) => {
    calls.push(a);
    return decoder();
  },
}));

import { normalizeUpload, sniffImage, UnsupportedImageError } from "@/lib/image/process";

const fixture = readFileSync("tests/fixtures/product.jpg");

/** ISO-BMFF header with the given major brand, padded like a real file. */
const ftyp = (brand: string, compat = "") =>
  Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`), Buffer.alloc(4), Buffer.from(compat.padEnd(8, " ")), Buffer.alloc(64)]);

async function rejection(input: Buffer): Promise<UnsupportedImageError> {
  const err = await normalizeUpload(input).then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(UnsupportedImageError);
  return err as UnsupportedImageError;
}

beforeEach(() => {
  calls.length = 0;
});

describe("upload validation", () => {
  it("accepts a normal photo", async () => {
    const out = await normalizeUpload(fixture);
    expect(out.mime).toBe("image/jpeg");
  });

  it("rejects an empty file with a clear message", async () => {
    const err = await rejection(Buffer.alloc(0));
    expect(err.code).toBe("empty_file");
    expect(err.message).toMatch(/empty/i);
  });

  it("detects the real type by magic bytes, not the extension", async () => {
    expect(sniffImage(Buffer.from("%PDF-1.7\n..."))).toBe("pdf");
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBe("svg");
    expect(sniffImage(Buffer.from('<?xml version="1.0"?><svg></svg>'))).toBe("svg");
    expect(sniffImage(Buffer.from("MZ\x90\x00 an executable"))).toBe("unknown");
    expect(sniffImage(fixture)).toBe("jpeg");
    expect(sniffImage(ftyp("heic"))).toBe("heic");
    expect(sniffImage(ftyp("mif1", "heic"))).toBe("heic");
    expect(sniffImage(ftyp("mif1", "avif"))).toBe("avif");
    expect(sniffImage(ftyp("avif"))).toBe("avif");
  });

  it("rejects a PDF, an SVG with a script, and an executable with a helpful message", async () => {
    for (const bytes of [
      Buffer.from("%PDF-1.7 not a photo"),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from("MZ\x90\x00\x03\x00\x00\x00"),
    ]) {
      const err = await rejection(bytes);
      expect(err.code).toBe("unsupported_format");
      expect(err.message).toMatch(/JPG, PNG, WebP/);
    }
  });

  it("reports truncated and corrupt images as unreadable, not as a server error", async () => {
    const truncated = fixture.subarray(0, Math.floor(fixture.length / 3));
    expect((await rejection(truncated)).code).toBe("corrupt_image");

    const garbage = Buffer.concat([fixture.subarray(0, 4), Buffer.alloc(2000, 0xab)]);
    const err = await rejection(garbage);
    expect(err.code).toBe("corrupt_image");
    expect(err.message).toMatch(/re-save or re-take/);
  });

  it("rejects decompression bombs before decoding them", async () => {
    const bomb = await sharp({ create: { width: 11_000, height: 11_000, channels: 3, background: "#fff" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(8 * 1024 * 1024);
    expect((await rejection(bomb)).code).toBe("too_many_pixels");
  }, 60_000);

  it("rejects images that are too small", async () => {
    const tiny = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    expect((await rejection(tiny)).code).toBe("too_small");
  });
});

describe("HEIC (iPhone) photos", () => {
  it("converts HEIC to JPEG first and then normalises it like any other photo", async () => {
    decoder = async () => fixture; // stand-in for the decoder's JPEG output
    const out = await normalizeUpload(ftyp("heic"));
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ format: "JPEG" });
    expect(out.mime).toBe("image/jpeg");
    expect(out.width).toBeGreaterThan(0);
  });

  it("does not run the HEIC decoder for ordinary files", async () => {
    await normalizeUpload(fixture);
    expect(calls).toHaveLength(0);
  });

  it("tells the user how to fix a HEIC file that can't be decoded", async () => {
    decoder = () => Promise.reject(new Error("libheif: unsupported"));
    const err = await rejection(ftyp("heic"));
    expect(err.code).toBe("heic_unreadable");
    expect(err.message).toMatch(/JPEG/);
  });
});
