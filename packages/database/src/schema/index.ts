import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

export const appSchema = pgSchema("app");

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

/**
 * Application-owned data for a Supabase Auth identity.
 *
 * Authentication credentials and provider state remain in auth.users. The
 * shared UUID gives Timer tables a stable app-owned parent without duplicating
 * authentication data such as email addresses.
 */
export const profiles = appSchema.table(
  "profiles",
  {
    id: uuid("id").primaryKey().notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    timeZone: text("time_zone"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.id],
      foreignColumns: [authUsers.id],
      name: "profiles_id_auth_users_id_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

export const googleCalendarConnections = appSchema.table(
  "google_calendar_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    calendarId: text("calendar_id"),
    encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
    grantedScopes: text("granted_scopes").array().notNull(),
    status: text("status").default("connected").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("google_calendar_connections_user_id_unique").on(
      table.userId,
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [authUsers.id],
      name: "google_calendar_connections_user_id_auth_users_id_fk",
    }).onDelete("cascade"),
    check(
      "google_calendar_connections_status_check",
      sql`${table.status} in ('connected', 'reconnect_required', 'revoked')`,
    ),
  ],
).enableRLS();

export const googleCalendarOauthStates = appSchema.table(
  "google_calendar_oauth_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stateHash: text("state_hash").notNull(),
    userId: uuid("user_id").notNull(),
    encryptedCodeVerifier: text("encrypted_code_verifier").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("google_calendar_oauth_states_state_hash_unique").on(
      table.stateHash,
    ),
    index("google_calendar_oauth_states_user_id_idx").on(table.userId),
    index("google_calendar_oauth_states_expires_at_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [authUsers.id],
      name: "google_calendar_oauth_states_user_id_auth_users_id_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

export const googleCalendarSubscriptions = appSchema.table(
  "google_calendar_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    channelId: text("channel_id").notNull(),
    resourceId: text("resource_id").notNull(),
    channelTokenHash: text("channel_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    syncToken: text("sync_token"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("google_calendar_subscriptions_channel_id_unique").on(
      table.channelId,
    ),
    uniqueIndex(
      "google_calendar_subscriptions_connection_calendar_unique",
    ).on(table.connectionId, table.calendarId),
    index("google_calendar_subscriptions_connection_id_idx").on(
      table.connectionId,
    ),
    index("google_calendar_subscriptions_expires_at_idx").on(table.expiresAt),
    foreignKey({
      columns: [table.connectionId],
      foreignColumns: [googleCalendarConnections.id],
      name: "gcal_subscriptions_connection_id_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

export const googleCalendarEventLinks = appSchema.table(
  "google_calendar_event_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    googleEtag: text("google_etag"),
    lastSyncedRevision: integer("last_synced_revision").default(0).notNull(),
    syncStatus: text("sync_status").default("pending").notNull(),
    lastGoogleUpdatedAt: timestamp("last_google_updated_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("google_calendar_event_links_connection_session_unique").on(
      table.connectionId,
      table.sessionId,
    ),
    uniqueIndex("google_calendar_event_links_google_event_unique").on(
      table.connectionId,
      table.calendarId,
      table.googleEventId,
    ),
    index("google_calendar_event_links_connection_id_idx").on(
      table.connectionId,
    ),
    check(
      "google_calendar_event_links_sync_status_check",
      sql`${table.syncStatus} in ('pending', 'synced', 'conflict', 'deleted', 'failed')`,
    ),
    foreignKey({
      columns: [table.connectionId],
      foreignColumns: [googleCalendarConnections.id],
      name: "gcal_event_links_connection_id_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

export const googleCalendarInboundChanges = appSchema.table(
  "google_calendar_inbound_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id").notNull(),
    calendarId: text("calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    googleEtag: text("google_etag"),
    changeType: text("change_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("google_calendar_inbound_changes_dedupe_key_unique").on(
      table.dedupeKey,
    ),
    index("google_calendar_inbound_changes_connection_id_idx").on(
      table.connectionId,
    ),
    index("google_calendar_inbound_changes_pending_idx")
      .on(table.receivedAt)
      .where(sql`${table.processedAt} is null`),
    check(
      "google_calendar_inbound_changes_type_check",
      sql`${table.changeType} in ('created_or_updated', 'deleted')`,
    ),
    foreignKey({
      columns: [table.connectionId],
      foreignColumns: [googleCalendarConnections.id],
      name: "gcal_inbound_changes_connection_id_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();

export const googleCalendarJobs = appSchema.table(
  "google_calendar_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id"),
    jobType: text("job_type").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("google_calendar_jobs_dedupe_key_unique").on(table.dedupeKey),
    index("google_calendar_jobs_connection_id_idx").on(table.connectionId),
    index("google_calendar_jobs_pending_available_idx")
      .on(table.availableAt)
      .where(sql`${table.status} = 'pending'`),
    check(
      "google_calendar_jobs_status_check",
      sql`${table.status} in ('pending', 'processing', 'completed', 'dead')`,
    ),
    check(
      "google_calendar_jobs_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
    foreignKey({
      columns: [table.connectionId],
      foreignColumns: [googleCalendarConnections.id],
      name: "gcal_jobs_connection_id_fk",
    }).onDelete("cascade"),
  ],
).enableRLS();
