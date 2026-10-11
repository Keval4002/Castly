import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const ledgerReason = pgEnum("ledger_reason", [
  "signup_bonus",
  "purchase",
  "generation",
  "refund",
  "admin_adjustment",
]);

export const generationStatus = pgEnum("generation_status", [
  "queued",
  "running",
  "succeeded",
  "partial",
  "failed",
]);

export const imageStatus = pgEnum("image_status", ["pending", "succeeded", "failed"]);

export const assetKind = pgEnum("asset_kind", ["upload", "output"]);

export const paymentStatus = pgEnum("payment_status", ["created", "paid", "failed"]);

/** One row per user. `id` is the Supabase auth user id. */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    credits: integer("credits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("credits_non_negative", sql`${t.credits} >= 0`), index("profiles_email_idx").on(t.email)],
);

/** Append-only record of every credit movement. */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    reason: ledgerReason("reason").notNull(),
    /** Guarantees a grant/charge/refund is applied at most once. */
    idempotencyKey: text("idempotency_key").notNull(),
    ref: text("ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("credit_ledger_idem_idx").on(t.idempotencyKey),
    index("credit_ledger_user_idx").on(t.userId, t.createdAt),
  ],
);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: assetKind("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key"),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_user_idx").on(t.userId, t.createdAt)],
);

export const generations = pgTable(
  "generations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    sourceAssetId: uuid("source_asset_id")
      .notNull()
      .references(() => assets.id),
    category: text("category").notNull(),
    tier: text("tier").notNull(),
    aspectRatio: text("aspect_ratio").notNull(),
    options: jsonb("options").$type<Record<string, string>>().notNull(),
    customNote: text("custom_note"),
    count: integer("count").notNull(),
    costCredits: integer("cost_credits").notNull(),
    refundedCredits: integer("refunded_credits").notNull().default(0),
    status: generationStatus("status").notNull().default("queued"),
    promptSource: text("prompt_source"),
    productSummary: text("product_summary"),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("generations_user_idx").on(t.userId, t.createdAt),
    index("generations_status_idx").on(t.status, t.createdAt),
  ],
);

export const generationImages = pgTable(
  "generation_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationId: uuid("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    status: imageStatus("status").notNull().default("pending"),
    prompt: text("prompt"),
    provider: text("provider"),
    model: text("model"),
    assetId: uuid("asset_id").references(() => assets.id),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("generation_images_gen_idx").on(t.generationId, t.idx)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    packId: text("pack_id").notNull(),
    credits: integer("credits").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    currency: text("currency").notNull().default("INR"),
    razorpayOrderId: text("razorpay_order_id").notNull(),
    razorpayPaymentId: text("razorpay_payment_id"),
    status: paymentStatus("status").notNull().default("created"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("payments_order_idx").on(t.razorpayOrderId),
    uniqueIndex("payments_payment_idx").on(t.razorpayPaymentId),
    index("payments_user_idx").on(t.userId, t.createdAt),
  ],
);

export type Profile = typeof profiles.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type GenerationImage = typeof generationImages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Payment = typeof payments.$inferSelect;
