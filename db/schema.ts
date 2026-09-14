import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  nickname: text("nickname").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [uniqueIndex("idx_users_email").on(t.email)]);

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

export const cashLedger = sqliteTable("cash_ledger", {
  id: text("id").primaryKey(),
  participantId: text("participant_id").notNull().references(() => participants.id),
  type: text("type", { enum: ["initial", "buy", "sell", "fee", "adjustment"] }).notNull(),
  amountKrw: integer("amount_krw").notNull(),
  referenceId: text("reference_id"),
  balanceAfterKrw: integer("balance_after_krw").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
}, (t) => [index("idx_cash_ledger_participant_created").on(t.participantId, t.createdAt)]);
