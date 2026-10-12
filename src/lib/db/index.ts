import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

// Reuse one pool across hot reloads / lambda invocations.
const globalForDb = globalThis as unknown as { __dukaanshotDb?: DB; __dukaanshotSql?: postgres.Sql };

export function db(): DB {
  if (globalForDb.__dukaanshotDb) return globalForDb.__dukaanshotDb;
  const client = postgres(env().DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    // Supabase's transaction pooler (port 6543) does not support prepared statements.
    prepare: false,
  });
  globalForDb.__dukaanshotSql = client;
  globalForDb.__dukaanshotDb = drizzle(client, { schema });
  return globalForDb.__dukaanshotDb;
}

export { schema };
