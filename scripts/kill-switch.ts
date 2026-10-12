/**
 * Generation kill switch. Takes effect within ~5 seconds, no deploy needed.
 *
 *   npm run kill-switch -- status
 *   npm run kill-switch -- on  ["Optional message shown to users"]
 *   npm run kill-switch -- off
 *
 * Uses DATABASE_URL from .env.local / .env (so check which database you are pointing at).
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: [".env.local", ".env"], quiet: true });

const KEY = "generation_paused";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!["on", "off", "status"].includes(cmd ?? "")) {
    console.error('Usage: kill-switch <on|off|status> ["message"]');
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    if (cmd === "status") {
      const [row] = await sql`select value, updated_at from app_settings where key = ${KEY}`;
      console.log(row?.value?.paused ? `PAUSED since ${row.updated_at.toISOString()}: ${row.value.message ?? ""}` : "generation is running");
    } else {
      const value = cmd === "on" ? { paused: true, message: rest.join(" ").trim() || undefined } : { paused: false };
      await sql`
        insert into app_settings (key, value) values (${KEY}, ${sql.json(value)})
        on conflict (key) do update set value = excluded.value, updated_at = now()`;
      console.log(cmd === "on" ? "Generation PAUSED." : "Generation resumed.");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
