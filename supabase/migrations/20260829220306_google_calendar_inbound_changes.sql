CREATE TABLE "google_calendar_inbound_changes" (
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
	CONSTRAINT "google_calendar_inbound_changes_type_check" CHECK ("google_calendar_inbound_changes"."change_type" in ('created_or_updated', 'deleted'))
);
--> statement-breakpoint
ALTER TABLE "google_calendar_inbound_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "google_calendar_inbound_changes" ADD CONSTRAINT "google_calendar_inbound_changes_connection_id_google_calendar_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_calendar_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_calendar_inbound_changes_dedupe_key_unique" ON "google_calendar_inbound_changes" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "google_calendar_inbound_changes_connection_id_idx" ON "google_calendar_inbound_changes" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "google_calendar_inbound_changes_pending_idx" ON "google_calendar_inbound_changes" USING btree ("received_at") WHERE "google_calendar_inbound_changes"."processed_at" is null;
--> statement-breakpoint
REVOKE ALL ON TABLE "google_calendar_inbound_changes" FROM anon, authenticated;
