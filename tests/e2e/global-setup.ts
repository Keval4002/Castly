import { execSync } from "node:child_process";
import postgres from "postgres";

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://castly:castly@localhost:5432/castly_test";
  execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`truncate table generation_images, generations, assets, payments, credit_ledger, profiles restart identity cascade`;
  await sql.end();
}
