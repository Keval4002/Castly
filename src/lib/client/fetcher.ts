export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error ?? {};
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, err.code ?? "error", err.message ?? "Request failed", err as Record<string, unknown>);
  }
  return data as T;
}

/** Download a (possibly cross-origin) image as a file. */
export async function downloadImage(url: string, filename: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}

/** Downscale + re-encode in the browser so uploads are small and fast. */
export async function compressImage(file: File, maxSide = 2048, quality = 0.9): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file; // let the server try (e.g. formats the browser can't decode)
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not process image"))), "image/jpeg", quality),
  );
}
