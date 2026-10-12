import "server-only";
import { env } from "@/lib/env";

const THROTTLE_MS = 5 * 60 * 1000;
const lastSent = new Map<string, { at: number; suppressed: number }>();

/** Tests only. */
export function resetAlertThrottle() {
  lastSent.clear();
}

/**
 * Raise an operational alert. Always writes one structured JSON log line (`"level":"alert"`), so a log-based
 * alert rule works with no configuration: match `"level":"alert"` or a specific `"kind"`. If ALERT_WEBHOOK_URL
 * is set (Slack, Discord or any relay that accepts a JSON POST with `text`/`content`), it is also posted there,
 * at most once per kind every 5 minutes per server instance (the count of suppressed repeats is included).
 * Never throws.
 */
export async function raiseAlert(kind: string, detail: Record<string, unknown> = {}): Promise<void> {
  const at = new Date().toISOString();
  console.error(JSON.stringify({ level: "alert", kind, at, ...detail }));

  const url = env().ALERT_WEBHOOK_URL;
  if (!url) return;
  const prev = lastSent.get(kind);
  if (prev && Date.now() - prev.at < THROTTLE_MS) {
    prev.suppressed++;
    return;
  }
  const suppressed = prev?.suppressed ?? 0;
  lastSent.set(kind, { at: Date.now(), suppressed: 0 });
  const text =
    `[dukaanshot] ${kind}${suppressed ? ` (+${suppressed} more in the last 5 min)` : ""}: ` +
    JSON.stringify(detail).slice(0, 900);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", kind: "alert_delivery_failed", message: (err as Error).message }));
  }
}
