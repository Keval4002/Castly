import { execSync } from "node:child_process";
import postgres from "postgres";
import { assertTestDatabase } from "../unit/db-guard";

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://dukaanshot:dukaanshot@localhost:5432/dukaanshot_test";
  assertTestDatabase(url); // this setup truncates tables
  execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql`truncate table generation_images, generations, assets, payments, credit_ledger, profiles restart identity cascade`;
  await sql.end();
}
