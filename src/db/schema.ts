import { relations } from "drizzle-orm";
import {
  boolean,
  decimal,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  bookings: many(bookings),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));


// --- ENUMS ---
export const bookingStatusEnum = pgEnum("booking_status", [
  "pending",
  "confirmed",
  "cancelled",
  "completed",
]);

// --- CATALOG TABLES ---

// 1. Activities: The atomic building blocks (e.g., "Shark Diving", "Wine Tasting")
export const activities = pgTable("activity", {
  id: text("id").primaryKey(), // Using text to match your Auth pattern (CUID/UUID)
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  location: text("location").notNull(),
  durationMinutes: integer("duration_minutes").notNull(), // e.g., 120 for 2 hours
  price: decimal("price", { precision: 10, scale: 2 }).notNull(), // Store generic catalog price
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// 2. Packages: The predefined bundles
export const packages = pgTable("package", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  imageUrl: text("image_url"),
  isCustom: boolean("is_custom").default(false).notNull(), // distinct bespoke templates
  basePrice: decimal("base_price", { precision: 10, scale: 2 }), // Optional base fee
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// 3. Package Activities: Join table for Predefined Packages (Many-to-Many)
export const packagesToActivities = pgTable(
  "package_to_activity",
  {
    packageId: text("package_id")
      .notNull()
      .references(() => packages.id, { onDelete: "cascade" }),
    activityId: text("activity_id")
      .notNull()
      .references(() => activities.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.packageId, t.activityId] }), // Composite PK
  ]
);

// --- ORDER/BOOKING TABLES ---

// 4. Bookings: The actual purchase record
export const bookings = pgTable("booking", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }), // Link to your existing User
  packageId: text("package_id")
    .references(() => packages.id, { onDelete: "set null" }), // Nullable for purely bespoke bookings
  status: bookingStatusEnum("status").default("pending").notNull(),
  totalPrice: decimal("total_price", { precision: 10, scale: 2 }).notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  specialRequests: text("special_requests"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index("booking_user_idx").on(table.userId)
]);

// 5. Booking Activities: The specific itinerary for this booking
// This separates the "Catalog" definition from the "Customer's actual trip"
export const bookingActivities = pgTable("booking_activity", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id),
  // We snapshot the price here. If the catalog price changes later, 
  // this historic booking record remains accurate.
  priceAtBooking: decimal("price_at_booking", { precision: 10, scale: 2 }).notNull(),
  scheduledAt: timestamp("scheduled_at"), // Specific time for this activity
});


// --- RELATIONS ---

export const activitiesRelations = relations(activities, ({ many }) => ({
  packages: many(packagesToActivities),
  bookingActivities: many(bookingActivities),
}));

export const packagesRelations = relations(packages, ({ many }) => ({
  activities: many(packagesToActivities),
  bookings: many(bookings),
}));

export const packagesToActivitiesRelations = relations(packagesToActivities, ({ one }) => ({
  package: one(packages, {
    fields: [packagesToActivities.packageId],
    references: [packages.id],
  }),
  activity: one(activities, {
    fields: [packagesToActivities.activityId],
    references: [activities.id],
  }),
}));

export const bookingsRelations = relations(bookings, ({ one, many }) => ({
  user: one(user, {
    fields: [bookings.userId],
    references: [user.id],
  }),
  package: one(packages, {
    fields: [bookings.packageId],
    references: [packages.id],
  }),
  activities: many(bookingActivities), // The itinerary
}));

export const bookingActivitiesRelations = relations(bookingActivities, ({ one }) => ({
  booking: one(bookings, {
    fields: [bookingActivities.bookingId],
    references: [bookings.id],
  }),
  activity: one(activities, {
    fields: [bookingActivities.activityId],
    references: [activities.id],
  }),
}));