/**
 * Tests truncate tables, so they must never run against a real database. The database NAME must contain
 * "test" (case-insensitive). Used by the unit-test setup, the resetDb helper and the e2e global setup.
 */
export function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "").split("/")[0] ?? "");
  } catch {
    return "";
  }
}

export function assertTestDatabase(url: string): void {
  const name = databaseName(url);
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run tests: the database name "${name || "(unparseable)"}" does not contain "test". ` +
        "Point TEST_DATABASE_URL (or E2E_DATABASE_URL) at a dedicated test database, e.g. .../dukaanshot_test.",
    );
  }
}
