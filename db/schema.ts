import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  nickname: text("nickname").notNull(),
  nicknameNormalized: text("nickname_normalized").notNull().default(""),
  pinHash: text("pin_hash").notNull().default(""),
  pinSalt: text("pin_salt").notNull().default(""),
  role: text("role", { enum: ["member", "admin"] }).notNull().default("member"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }).notNull().default(sql`0`),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  uniqueIndex("idx_users_email").on(t.email),
  uniqueIndex("idx_users_nickname_normalized").on(t.nicknameNormalized),
]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  index("idx_sessions_user_id").on(t.userId),
  index("idx_sessions_expires_at").on(t.expiresAt),
]);

export const competitions = sqliteTable("competitions", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  inviteCode: text("invite_code").notNull(),
  status: text("status", { enum: ["draft", "active", "ended"] }).notNull().default("draft"),
  initialCashKrw: integer("initial_cash_krw").notNull(),
  startsAt: integer("starts_at", { mode: "timestamp_ms" }).notNull(),
  endsAt: integer("ends_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  uniqueIndex("idx_competitions_invite_code").on(t.inviteCode),
  index("idx_competitions_owner_status").on(t.ownerUserId, t.status),
]);

export const participants = sqliteTable("participants", {
  id: text("id").primaryKey(),
  competitionId: text("competition_id").notNull().references(() => competitions.id),
  userId: text("user_id").notNull().references(() => users.id),
  cashKrw: integer("cash_krw").notNull(),
  realizedPnlKrw: integer("realized_pnl_krw").notNull().default(0),
  joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  uniqueIndex("idx_participants_competition_user").on(t.competitionId, t.userId),
  index("idx_participants_competition").on(t.competitionId),
]);

export const instruments = sqliteTable("instruments", {
  id: text("id").primaryKey(),
  market: text("market", { enum: ["KR", "US", "CRYPTO"] }).notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  currency: text("currency", { enum: ["KRW", "USD"] }).notNull(),
  exchange: text("exchange").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
}, (t) => [uniqueIndex("idx_instruments_market_symbol").on(t.market, t.symbol)]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  clientOrderId: text("client_order_id").notNull(),
  participantId: text("participant_id").notNull().references(() => participants.id),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  orderType: text("order_type", { enum: ["market", "limit"] }).notNull(),
  quantityMicros: integer("quantity_micros").notNull(),
  limitPriceMicros: integer("limit_price_micros"),
  filledQuantityMicros: integer("filled_quantity_micros").notNull().default(0),
  status: text("status", { enum: ["pending", "filled", "partial", "cancelled", "rejected"] }).notNull(),
  rejectionReason: text("rejection_reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  uniqueIndex("idx_orders_participant_client_order").on(t.participantId, t.clientOrderId),
  index("idx_orders_participant_created").on(t.participantId, t.createdAt),
  index("idx_orders_instrument_status").on(t.instrumentId, t.status),
]);

export const fills = sqliteTable("fills", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull().references(() => orders.id),
  participantId: text("participant_id").notNull().references(() => participants.id),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  side: text("side", { enum: ["buy", "sell"] }).notNull(),
  quantityMicros: integer("quantity_micros").notNull(),
  priceMicros: integer("price_micros").notNull(),
  fxRateMicros: integer("fx_rate_micros").notNull().default(1_000_000),
  feeKrw: integer("fee_krw").notNull().default(0),
  executedAt: integer("executed_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_fills_participant_executed").on(t.participantId, t.executedAt)]);

export const positions = sqliteTable("positions", {
  id: text("id").primaryKey(),
  participantId: text("participant_id").notNull().references(() => participants.id),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  quantityMicros: integer("quantity_micros").notNull(),
  averagePriceMicros: integer("average_price_micros").notNull(),
  realizedPnlKrw: integer("realized_pnl_krw").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [uniqueIndex("idx_positions_participant_instrument").on(t.participantId, t.instrumentId)]);

export const watchlistItems = sqliteTable("watchlist_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [uniqueIndex("idx_watchlist_user_instrument").on(t.userId, t.instrumentId)]);

export const quoteSnapshots = sqliteTable("quote_snapshots", {
  instrumentId: text("instrument_id").primaryKey().references(() => instruments.id),
  priceMicros: integer("price_micros").notNull(),
  changeMicros: integer("change_micros").notNull(),
  changeRatePpm: integer("change_rate_ppm").notNull(),
  fxRateMicros: integer("fx_rate_micros").notNull().default(1_000_000),
  source: text("source").notNull(),
  sourceTimestamp: integer("source_timestamp", { mode: "timestamp_ms" }).notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

export const priceHistory = sqliteTable("price_history", {
  id: text("id").primaryKey(),
  instrumentId: text("instrument_id").notNull().references(() => instruments.id),
  priceMicros: integer("price_micros").notNull(),
  changeRatePpm: integer("change_rate_ppm").notNull(),
  fxRateMicros: integer("fx_rate_micros").notNull().default(1_000_000),
  recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  uniqueIndex("idx_price_history_instrument_time").on(t.instrumentId, t.recordedAt),
  index("idx_price_history_recorded_at").on(t.recordedAt),
]);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStartedAt: integer("window_started_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_rate_limits_expires_at").on(t.expiresAt)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  details: text("details").notNull().default("{}"),
  ipHash: text("ip_hash"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [
  index("idx_audit_logs_created_at").on(t.createdAt),
  index("idx_audit_logs_actor_created").on(t.actorUserId, t.createdAt),
]);

export const newsCache = sqliteTable("news_cache", {
  key: text("key").primaryKey(),
  items: text("items").notNull().default("[]"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_news_cache_updated_at").on(t.updatedAt)]);

export const marketCalendar = sqliteTable("market_calendar", {
  id: text("id").primaryKey(),
  market: text("market", { enum: ["KR", "US"] }).notNull(),
  date: text("date").notNull(),
  isOpen: integer("is_open", { mode: "boolean" }).notNull(),
  source: text("source").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [uniqueIndex("idx_market_calendar_market_date").on(t.market, t.date)]);

export const providerTokens = sqliteTable("provider_tokens", {
  provider: text("provider").primaryKey(),
  ciphertext: text("ciphertext").notNull().default(""),
  iv: text("iv").notNull().default(""),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull().default(sql`0`),
  refreshStartedAt: integer("refresh_started_at", { mode: "timestamp_ms" }).notNull().default(sql`0`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`0`),
});

export const cashLedger = sqliteTable("cash_ledger", {
  id: text("id").primaryKey(),
  participantId: text("participant_id").notNull().references(() => participants.id),
  type: text("type", { enum: ["initial", "buy", "sell", "fee", "adjustment"] }).notNull(),
  amountKrw: integer("amount_krw").notNull(),
  referenceId: text("reference_id"),
  balanceAfterKrw: integer("balance_after_krw").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_cash_ledger_participant_created").on(t.participantId, t.createdAt)]);
