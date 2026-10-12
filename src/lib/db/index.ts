import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

// Reuse one pool across hot reloads / lambda invocations.
const globalForDb = globalThis as unknown as { __castlyDb?: DB; __castlySql?: postgres.Sql };

export function db(): DB {
  if (globalForDb.__castlyDb) return globalForDb.__castlyDb;
  const client = postgres(env().DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
  });
  globalForDb.__castlySql = client;
  globalForDb.__castlyDb = drizzle(client, { schema });
  return globalForDb.__castlyDb;
}

export { schema };
