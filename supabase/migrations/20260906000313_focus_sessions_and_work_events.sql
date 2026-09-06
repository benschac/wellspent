CREATE TABLE "app"."focus_capture_tokens" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."focus_capture_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."focus_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"intention" text NOT NULL,
	"status" text NOT NULL,
	"elapsed_ms" bigint DEFAULT 0 NOT NULL,
	"running_since" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"recap_text" text,
	"recap_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "focus_sessions_state_check" CHECK (("app"."focus_sessions"."status" = 'running' and "app"."focus_sessions"."running_since" is not null and "app"."focus_sessions"."completed_at" is null) or ("app"."focus_sessions"."status" = 'paused' and "app"."focus_sessions"."running_since" is null and "app"."focus_sessions"."completed_at" is null) or ("app"."focus_sessions"."status" = 'completed' and "app"."focus_sessions"."running_since" is null and "app"."focus_sessions"."completed_at" is not null)),
	CONSTRAINT "focus_sessions_counters_check" CHECK ("app"."focus_sessions"."elapsed_ms" >= 0 and "app"."focus_sessions"."revision" >= 1 and "app"."focus_sessions"."recap_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."focus_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."focus_transitions" (
	"session_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"action" text NOT NULL,
	"revision" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "focus_transitions_session_id_command_id_pk" PRIMARY KEY("session_id","command_id"),
	CONSTRAINT "focus_transitions_action_check" CHECK ("app"."focus_transitions"."action" in ('start', 'pause', 'resume', 'finish'))
);
--> statement-breakpoint
ALTER TABLE "app"."focus_transitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."focus_work_events" (
	"session_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_session_id" text NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"evidence_url" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "focus_work_events_session_id_id_pk" PRIMARY KEY("session_id","id"),
	CONSTRAINT "focus_work_events_source_check" CHECK (("app"."focus_work_events"."source" = 'codex' and "app"."focus_work_events"."kind" in ('tool_completed', 'turn_completed')) or ("app"."focus_work_events"."source" = 'manual' and "app"."focus_work_events"."kind" = 'note'))
);
--> statement-breakpoint
ALTER TABLE "app"."focus_work_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."focus_capture_tokens" ADD CONSTRAINT "focus_capture_tokens_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."focus_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."focus_transitions" ADD CONSTRAINT "focus_transitions_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."focus_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."focus_work_events" ADD CONSTRAINT "focus_work_events_session_id_focus_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "app"."focus_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "focus_sessions_user_created_idx" ON "app"."focus_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "focus_transitions_revision_unique" ON "app"."focus_transitions" USING btree ("session_id","revision");--> statement-breakpoint
CREATE INDEX "focus_work_events_time_idx" ON "app"."focus_work_events" USING btree ("session_id","occurred_at");