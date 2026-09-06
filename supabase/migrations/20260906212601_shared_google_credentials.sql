CREATE TABLE "app"."google_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"google_subject" text,
	"encrypted_refresh_token" text NOT NULL,
	"granted_scopes" text[] NOT NULL,
	"reconnect_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."google_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."google_oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"integration" text NOT NULL,
	"encrypted_code_verifier" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."google_oauth_states" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app"."google_sheets_connections" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."google_sheets_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app"."google_connections" ADD CONSTRAINT "google_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."google_oauth_states" ADD CONSTRAINT "google_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."google_sheets_connections" ADD CONSTRAINT "google_sheets_connections_user_id_google_connections_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."google_connections"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "google_oauth_states_expiry_idx" ON "app"."google_oauth_states" USING btree ("expires_at");