CREATE TYPE "public"."event_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"result" jsonb,
	"status" "event_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
