import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureProfile } from "@/lib/credits";

export async function resetDb() {
  // Last line of defence: never truncate a database whose name isn't a test database.
  const [{ name }] = (await db().execute(sql`select current_database() as name`)) as unknown as { name: string }[];
  if (!/test/i.test(name)) throw new Error(`Refusing to truncate "${name}": not a test database`);
  await db().execute(
    sql`truncate table generation_images, generations, assets, payments, credit_ledger, profiles restart identity cascade`,
  );
}

export async function makeUser(email = `u-${randomUUID().slice(0, 8)}@test.dev`) {
  return ensureProfile({ id: randomUUID(), email });
}
