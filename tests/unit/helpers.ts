import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureProfile } from "@/lib/credits";

export async function resetDb() {
  await db().execute(
    sql`truncate table generation_images, generations, assets, payments, credit_ledger, profiles restart identity cascade`,
  );
}

export async function makeUser(email = `u-${randomUUID().slice(0, 8)}@test.dev`) {
  return ensureProfile({ id: randomUUID(), email });
}
