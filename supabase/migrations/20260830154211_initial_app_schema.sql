CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."google_calendar_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"calendar_id" text,
	"encrypted_refresh_token" text NOT NULL,
	"granted_scopes" text[] NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_connections_status_check" CHECK ("app"."google_calendar_connections"."status" in ('connected', 'reconnect_required', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "app"."google_calendar_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."google_calendar_event_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"google_event_id" text NOT NULL,
	"google_etag" text,
	"last_synced_revision" integer DEFAULT 0 NOT NULL,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"last_google_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_event_links_sync_status_check" CHECK ("app"."google_calendar_event_links"."sync_status" in ('pending', 'synced', 'conflict', 'deleted', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "app"."google_calendar_event_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."google_calendar_inbound_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"google_event_id" text NOT NULL,
	"google_etag" text,
	"change_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "google_calendar_inbound_changes_type_check" CHECK ("app"."google_calendar_inbound_changes"."change_type" in ('created_or_updated', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "app"."google_calendar_inbound_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."google_calendar_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid,
	"job_type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "google_calendar_jobs_status_check" CHECK ("app"."google_calendar_jobs"."status" in ('pending', 'processing', 'completed', 'dead')),
	CONSTRAINT "google_calendar_jobs_attempts_check" CHECK ("app"."google_calendar_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."google_calendar_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."google_calendar_oauth_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"encrypted_code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."google_calendar_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."google_calendar_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"calendar_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"channel_token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sync_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."google_calendar_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"time_zone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."google_calendar_event_links" ADD CONSTRAINT "gcal_event_links_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "app"."google_calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."google_calendar_inbound_changes" ADD CONSTRAINT "gcal_inbound_changes_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "app"."google_calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."google_calendar_jobs" ADD CONSTRAINT "gcal_jobs_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "app"."google_calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."google_calendar_oauth_states" ADD CONSTRAINT "google_calendar_oauth_states_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."google_calendar_subscriptions" ADD CONSTRAINT "gcal_subscriptions_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "app"."google_calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."profiles" ADD CONSTRAINT "profiles_id_auth_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_connections_user_id_unique" ON "app"."google_calendar_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_event_links_connection_session_unique" ON "app"."google_calendar_event_links" USING btree ("connection_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_event_links_google_event_unique" ON "app"."google_calendar_event_links" USING btree ("connection_id","calendar_id","google_event_id");--> statement-breakpoint
CREATE INDEX "google_calendar_event_links_connection_id_idx" ON "app"."google_calendar_event_links" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_inbound_changes_dedupe_key_unique" ON "app"."google_calendar_inbound_changes" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "google_calendar_inbound_changes_connection_id_idx" ON "app"."google_calendar_inbound_changes" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "google_calendar_inbound_changes_pending_idx" ON "app"."google_calendar_inbound_changes" USING btree ("received_at") WHERE "app"."google_calendar_inbound_changes"."processed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_jobs_dedupe_key_unique" ON "app"."google_calendar_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "google_calendar_jobs_connection_id_idx" ON "app"."google_calendar_jobs" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "google_calendar_jobs_pending_available_idx" ON "app"."google_calendar_jobs" USING btree ("available_at") WHERE "app"."google_calendar_jobs"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_oauth_states_state_hash_unique" ON "app"."google_calendar_oauth_states" USING btree ("state_hash");--> statement-breakpoint
CREATE INDEX "google_calendar_oauth_states_user_id_idx" ON "app"."google_calendar_oauth_states" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "google_calendar_oauth_states_expires_at_idx" ON "app"."google_calendar_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_subscriptions_channel_id_unique" ON "app"."google_calendar_subscriptions" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_subscriptions_connection_calendar_unique" ON "app"."google_calendar_subscriptions" USING btree ("connection_id","calendar_id");--> statement-breakpoint
CREATE INDEX "google_calendar_subscriptions_connection_id_idx" ON "app"."google_calendar_subscriptions" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "google_calendar_subscriptions_expires_at_idx" ON "app"."google_calendar_subscriptions" USING btree ("expires_at");