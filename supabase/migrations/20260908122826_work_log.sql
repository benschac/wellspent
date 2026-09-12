CREATE TABLE "app"."work_log_entries" (
	"row_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"source_session_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"project" text,
	"session_id" uuid,
	"fingerprint" text NOT NULL,
	CONSTRAINT "work_log_entries_source_check" CHECK ("app"."work_log_entries"."source" in ('codex', 'cli', 'mcp')),
	CONSTRAINT "work_log_entries_kind_check" CHECK ("app"."work_log_entries"."kind" in ('tool_completed', 'turn_completed', 'note'))
);
--> statement-breakpoint
ALTER TABLE "app"."work_log_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."work_log_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."work_log_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."work_log_entries" ADD CONSTRAINT "work_log_entries_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_log_entries" ADD CONSTRAINT "work_log_entries_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."focus_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."work_log_tokens" ADD CONSTRAINT "work_log_tokens_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_log_entries_user_event_unique" ON "app"."work_log_entries" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "work_log_entries_user_time_idx" ON "app"."work_log_entries" USING btree ("user_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_log_tokens_hash_unique" ON "app"."work_log_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "work_log_tokens_user_idx" ON "app"."work_log_tokens" USING btree ("user_id");