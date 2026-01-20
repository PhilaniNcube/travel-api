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

export const adminUser = pgTable(
  "admin_user",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .unique()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("admin").notNull(), // e.g., "admin", "super_admin", "moderator"
    permissions: text("permissions"), // JSON string for granular permissions
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("admin_user_userId_idx").on(table.userId),
    index("admin_user_isActive_idx").on(table.isActive),
  ],
);

export const userRelations = relations(user, ({ many, one }) => ({
  sessions: many(session),
  accounts: many(account),
  bookings: many(bookings),
  reviews: many(reviews),
  adminUser: one(adminUser),
}));

export const adminUserRelations = relations(adminUser, ({ one }) => ({
  user: one(user, {
    fields: [adminUser.userId],
    references: [user.id],
  }),
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

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "refunded",
  "partially_refunded",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "credit_card",
  "debit_card",
  "paypal",
  "bank_transfer",
  "cash",
  "other",
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

// 1a. Activity Media: Images and videos for activities
export const activityMedia = pgTable("activity_media", {
  id: text("id").primaryKey(),
  activityId: text("activity_id")
    .notNull()
    .references(() => activities.id, { onDelete: "cascade" }),
  mediaUrl: text("media_url").notNull(),
  mediaType: text("media_type").notNull(), // 'image' or 'video'
  altText: text("alt_text"),
  displayOrder: integer("display_order").default(0).notNull(), // For ordering media items
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("activity_media_activityId_idx").on(table.activityId)
]);

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

// 2a. Package Media: Images and videos for packages
export const packageMedia = pgTable("package_media", {
  id: text("id").primaryKey(),
  packageId: text("package_id")
    .notNull()
    .references(() => packages.id, { onDelete: "cascade" }),
  mediaUrl: text("media_url").notNull(),
  mediaType: text("media_type").notNull(), // 'image' or 'video'
  altText: text("alt_text"),
  displayOrder: integer("display_order").default(0).notNull(), // For ordering media items
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("package_media_packageId_idx").on(table.packageId)
]);

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
  guideId: text("guide_id")
    .references(() => guides.id, { onDelete: "set null" }), // Optional guide assignment
  // We snapshot the price here. If the catalog price changes later, 
  // this historic booking record remains accurate.
  priceAtBooking: decimal("price_at_booking", { precision: 10, scale: 2 }).notNull(),
  scheduledAt: timestamp("scheduled_at"), // Specific time for this activity
}, (table) => [
  index("booking_activity_guideId_idx").on(table.guideId),
]);

// 6. Reviews: Customer reviews and ratings for booked activities
export const reviews = pgTable("review", {
  id: text("id").primaryKey(),
  bookingActivityId: text("booking_activity_id")
    .notNull()
    .references(() => bookingActivities.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  rating: integer("rating").notNull(), // 1-5 stars
  comment: text("comment"),
  isVerified: boolean("is_verified").default(true).notNull(), // Verified purchase
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index("review_bookingActivityId_idx").on(table.bookingActivityId),
  index("review_userId_idx").on(table.userId),
]);

// 7. Payments: Track payment transactions for bookings
export const payments = pgTable("payment", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id")
    .notNull()
    .references(() => bookings.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("USD").notNull(), // ISO 4217 currency code
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").default("pending").notNull(),
  transactionId: text("transaction_id"), // External payment provider transaction ID
  paymentProvider: text("payment_provider"), // e.g., 'stripe', 'paypal', 'square'
  paymentIntentId: text("payment_intent_id"), // For providers like Stripe
  metadata: text("metadata"), // JSON string for additional payment data
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index("payment_bookingId_idx").on(table.bookingId),
  index("payment_status_idx").on(table.paymentStatus),
  index("payment_transactionId_idx").on(table.transactionId),
]);

// 8. Guides: Tour guides and staff who lead activities
export const guides = pgTable("guide", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  bio: text("bio"),
  specialties: text("specialties"), // Comma-separated or JSON array of specialty areas
  imageUrl: text("image_url"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
}, (table) => [
  index("guide_email_idx").on(table.email),
  index("guide_isActive_idx").on(table.isActive),
]);


// --- RELATIONS ---

export const activitiesRelations = relations(activities, ({ many }) => ({
  packages: many(packagesToActivities),
  bookingActivities: many(bookingActivities),
  media: many(activityMedia),
}));

export const activityMediaRelations = relations(activityMedia, ({ one }) => ({
  activity: one(activities, {
    fields: [activityMedia.activityId],
    references: [activities.id],
  }),
}));

export const packagesRelations = relations(packages, ({ many }) => ({
  activities: many(packagesToActivities),
  bookings: many(bookings),
  media: many(packageMedia),
}));

export const packageMediaRelations = relations(packageMedia, ({ one }) => ({
  package: one(packages, {
    fields: [packageMedia.packageId],
    references: [packages.id],
  }),
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
  payments: many(payments),
}));

export const bookingActivitiesRelations = relations(bookingActivities, ({ one, many }) => ({
  booking: one(bookings, {
    fields: [bookingActivities.bookingId],
    references: [bookings.id],
  }),
  activity: one(activities, {
    fields: [bookingActivities.activityId],
    references: [activities.id],
  }),
  guide: one(guides, {
    fields: [bookingActivities.guideId],
    references: [guides.id],
  }),
  reviews: many(reviews),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  bookingActivity: one(bookingActivities, {
    fields: [reviews.bookingActivityId],
    references: [bookingActivities.id],
  }),
  user: one(user, {
    fields: [reviews.userId],
    references: [user.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  booking: one(bookings, {
    fields: [payments.bookingId],
    references: [bookings.id],
  }),
}));

export const guidesRelations = relations(guides, ({ many }) => ({
  bookingActivities: many(bookingActivities),
}));