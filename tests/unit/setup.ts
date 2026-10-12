// Test environment: local Postgres test DB, mocks for every external service.
import { assertTestDatabase } from "./db-guard";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://dukaanshot:dukaanshot@localhost:5432/dukaanshot_test";
// The suite truncates tables. Refuse to even start unless the database is clearly a test database.
assertTestDatabase(TEST_DATABASE_URL);

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  SESSION_SECRET: "test-secret-test-secret-test-secret-test",
  AUTH_PROVIDER: "dev",
  STORAGE_DRIVER: "local",
  LOCAL_STORAGE_DIR: ".data/test-storage",
  IMAGE_PROVIDER_MODE: "mock",
  CLASSIFIER_MODE: "mock",
  PAYMENTS_MOCK: "true",
  PROMPT_LLM: "template",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec_test",
  MOCK_IMAGE_DELAY_MS: "0",
  BACKGROUND_REMOVAL: "off",
  FIDELITY_MODE: "enforce",
  // Every image is judged by default; tests that need other judge behaviour override MOCK_FIDELITY.
  MOCK_FIDELITY: JSON.stringify({
    reference_features: ["body", "print"],
    checks: [
      { feature: "body", status: "match" },
      { feature: "print", status: "match" },
    ],
    product_prominence: "hero",
    same_product: true,
    score: 0.95,
    differences: [],
  }),
  FIDELITY_JUDGE_RETRY_DELAY_MS: "0",
});
