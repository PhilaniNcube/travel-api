CREATE TABLE "admin_user" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"permissions" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "admin_user" ADD CONSTRAINT "admin_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_user_userId_idx" ON "admin_user" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_user_isActive_idx" ON "admin_user" USING btree ("is_active");