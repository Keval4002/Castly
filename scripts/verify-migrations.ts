/**
 * Read-only post-migration checks. Safe to run against any database; changes nothing.
 *
 *   npm run db:verify                       # uses DATABASE_URL from .env.local / .env
 *   DATABASE_URL=... npm run db:verify
 *
 * Exits non-zero if any check fails. Run it right after `npm run db:migrate` (see docs/OPERATIONS.md).
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {}, connect_timeout: 15 });
  const results: { name: string; ok: boolean; detail: string }[] = [];
  const check = (name: string, ok: boolean, detail: string) => results.push({ name, ok, detail });

  try {
    const [{ db }] = await sql<{ db: string }[]>`select current_database() as db`;
    console.log(`Database: ${db}\n`);

    // 1. Every product has a "front" photo row, and the counts match exactly.
    const [{ products }] = await sql<{ products: number }[]>`select count(*)::int as products from products`;
    const [{ fronts }] = await sql<{ fronts: number }[]>`
      select count(distinct product_id)::int as fronts from product_photos where angle = 'front'`;
    check("product_photos 'front' count equals products count", fronts === products, `${fronts} products with a front photo / ${products} products`);

    const missing = await sql`
      select p.id from products p
      where not exists (select 1 from product_photos f where f.product_id = p.id and f.asset_id = p.source_asset_id)`;
    check("every product's main photo is attached as a photo", missing.length === 0, `${missing.length} products without their main photo row`);

    const dup = await sql`select asset_id from product_photos group by asset_id having count(*) > 1`;
    check("no photo attached to two products", dup.length === 0, `${dup.length} duplicated assets`);

    // 2. Schema pieces added by 0005 / 0006.
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables where table_schema = 'public'
        and table_name in ('app_settings', 'provider_calls', 'product_photos')`;
    check("tables app_settings, provider_calls, product_photos exist", tables.length === 3, tables.map((t) => t.table_name).join(", "));

    const enumVals = await sql<{ enumlabel: string }[]>`
      select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'image_status'`;
    const labels = enumVals.map((e) => e.enumlabel);
    check("image_status has held + running", ["held", "running"].every((l) => labels.includes(l)), labels.join(", "));

    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_schema = 'public'
        and ((table_name = 'generation_images' and column_name in ('lease_until', 'dispatch_count', 'seed', 'next_check_at', 'check_count'))
          or (table_name = 'generations' and column_name = 'idempotency_key'))`;
    check("new generation / shot columns exist", cols.length === 6, `${cols.length}/6 columns`);

    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class
      where relname in ('app_settings', 'provider_calls', 'product_photos') and relkind = 'r'`;
    check("row-level security is on for the new tables", rls.length === 3 && rls.every((r) => r.relrowsecurity), rls.map((r) => `${r.relname}:${r.relrowsecurity}`).join(", "));

    // 3. Nothing left in a state the new code can't handle.
    const orphans = await sql`select 1 from generation_images where status in ('running', 'held') and generation_id in (select id from generations where status in ('succeeded', 'partial', 'failed'))`;
    check("no in-flight shots on settled generations", orphans.length === 0, `${orphans.length} shots`);

    const [{ ledger_ok }] = await sql<{ ledger_ok: boolean }[]>`
      select coalesce(bool_and(p.credits = coalesce(l.total, 0)), true) as ledger_ok
      from profiles p left join (select user_id, sum(delta)::int as total from credit_ledger group by user_id) l on l.user_id = p.id`;
    check("every balance equals the sum of its ledger", ledger_ok, ledger_ok ? "ok" : "MISMATCH — investigate before deploying");
  } finally {
    await sql.end();
  }

  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.detail})`);
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
