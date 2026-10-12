import { sql } from "drizzle-orm";
import type { Classification, Correction } from "@/lib/classify/reconcile";
import type { Fidelity, Preparation } from "@/lib/image/quality";
import type { PlanResult, ProductProfile, ShotSpec } from "@/lib/shots/types";
import {
  boolean,
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

export const imageStatus = pgEnum("image_status", ["pending", "running", "succeeded", "failed", "held"]);

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
    /** Onboarding answers; `onboardedAt` null = the user still has to go through /onboarding. */
    shopName: text("shop_name"),
    sells: text("sells"),
    defaultPurpose: text("default_purpose"),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
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
    /** Vision classifier result for uploads (null = unknown / not run). */
    classification: jsonb("classification").$type<Classification>(),
    /** Cleaned product photo (background removed, centred on white) for uploads. */
    cleanKey: text("clean_key"),
    cleanThumbKey: text("clean_thumb_key"),
    /** Transparent PNG of the product alone (tight crop): every shot's own reference view is made from it. */
    cutoutKey: text("cutout_key"),
    /** Measured colours, metal tone, size: identical for every shot of a set. */
    profile: jsonb("profile").$type<ProductProfile>(),
    preparation: jsonb("preparation").$type<Preparation>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_user_idx").on(t.userId, t.createdAt)],
);

/** A catalogue entry: one product photo plus everything generated from it. */
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku"),
    category: text("category").notNull(),
    productType: text("product_type"),
    sourceAssetId: uuid("source_asset_id")
      .notNull()
      .references(() => assets.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("products_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("products_source_asset_idx").on(t.sourceAssetId),
  ],
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
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    /** Simple look the user picked (marketplace | lifestyle | festive); null for older rows. */
    look: text("look"),
    category: text("category").notNull(),
    productType: text("product_type"),
    /** Category/type fixes applied from the classifier, shown to the user. */
    corrections: jsonb("corrections").$type<Correction[]>().notNull().default([]),
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
    /** Client-supplied (Idempotency-Key) or derived key: a repeat request returns this job instead of creating another. */
    idempotencyKey: text("idempotency_key"),
    /** How the shots were planned (planner, preset + version, skipped shots with reasons, variety achieved). */
    plan: jsonb("plan").$type<Omit<PlanResult, "specs"> & { planner: string }>(),
  },
  (t) => [
    index("generations_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("generations_idem_idx").on(t.userId, t.idempotencyKey),
    index("generations_product_idx").on(t.productId),
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
    /** Product-fidelity check of the delivered image. */
    fidelity: jsonb("fidelity").$type<Fidelity>(),
    attempts: integer("attempts").notNull().default(0),
    /** Held images wait here for the quality re-check (status "held"); never delivered until verified. */
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    checkCount: integer("check_count").notNull().default(0),
    /** A worker owns this shot until then; an expired lease means it crashed and the sweeper re-queues it. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    /** How many times a worker has claimed this shot (caps crash loops). */
    dispatchCount: integer("dispatch_count").notNull().default(0),
    /** Seed sent to providers that accept one (recorded so "redo" and "more like this" are possible). */
    seed: integer("seed"),
    /** The structured shot description this image was generated from. */
    spec: jsonb("spec").$type<ShotSpec>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("generation_images_gen_idx").on(t.generationId, t.idx),
    index("generation_images_held_idx").on(t.status, t.nextCheckAt),
  ],
);

/**
 * One row per paid or metered call (image generation, judge, classifier, ...), successful or not.
 * Costs are USD micro-dollars (1 = $0.000001): estimated from price tables, actual when a provider reports it.
 */
export const providerCalls = pgTable(
  "provider_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    generationId: uuid("generation_id").references(() => generations.id, { onDelete: "set null" }),
    imageId: uuid("image_id"),
    stage: text("stage").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    attempt: integer("attempt").notNull().default(1),
    ok: boolean("ok").notNull(),
    error: text("error"),
    latencyMs: integer("latency_ms"),
    estCostMicros: integer("est_cost_micros").notNull().default(0),
    actualCostMicros: integer("actual_cost_micros"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_calls_gen_idx").on(t.generationId), index("provider_calls_created_idx").on(t.createdAt)],
);

/** Extra photos of one product, each labelled with the angle it shows (the main photo is products.sourceAssetId). */
export const productPhotos = pgTable(
  "product_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    angle: text("angle").notNull().default("front"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("product_photos_asset_idx").on(t.assetId), index("product_photos_product_idx").on(t.productId)],
);

/** Runtime switches that can change without a deploy (e.g. the generation kill switch). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
export type Product = typeof products.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type GenerationImage = typeof generationImages.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type ProviderCall = typeof providerCalls.$inferSelect;
export type ProductPhoto = typeof productPhotos.$inferSelect;
