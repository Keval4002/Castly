import "server-only";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status?: number,
    /** Whether trying another provider/attempt might succeed. */
    public readonly retryable = true,
  ) {
    super(message);
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs: number }): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new Error(`Request timed out after ${timeoutMs}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Read an error body without throwing, trimmed for logs. */
export async function errorText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}
