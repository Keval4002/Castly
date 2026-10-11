// Test environment: local Postgres test DB, mocks for every external service.
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://castly:castly@localhost:5432/castly_test",
  SESSION_SECRET: "test-secret-test-secret-test-secret-test",
  AUTH_PROVIDER: "dev",
  STORAGE_DRIVER: "local",
  LOCAL_STORAGE_DIR: ".data/test-storage",
  IMAGE_PROVIDER_MOCK: "true",
  PAYMENTS_MOCK: "true",
  PROMPT_LLM: "template",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec_test",
  MOCK_IMAGE_DELAY_MS: "0",
});
