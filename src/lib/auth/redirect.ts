/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | null | undefined, fallback = "/workspace"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
