CREATE TABLE "app"."realtime_timer_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"elapsed_ms" bigint DEFAULT 0 NOT NULL,
	"is_running" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_timer_state_singleton" CHECK ("app"."realtime_timer_state"."id" = 1),
	CONSTRAINT "realtime_timer_state_counters" CHECK ("app"."realtime_timer_state"."elapsed_ms" >= 0 and "app"."realtime_timer_state"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app"."realtime_timer_state" ENABLE ROW LEVEL SECURITY;