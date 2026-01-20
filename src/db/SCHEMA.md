# Travel API Database Schema

## Overview

This database schema is designed for a travel booking platform that supports both predefined tour packages and bespoke (custom) travel experiences. The schema is built with PostgreSQL and uses Drizzle ORM.

---

## Architecture

The schema is organized into three main domains:

1. **Authentication & User Management** - User accounts, sessions, and authentication
2. **Catalog Management** - Activities and packages available for booking
3. **Order & Booking Management** - Customer bookings and itineraries

---

## 1. Authentication & User Management

### `user`
Stores user account information.

**Columns:**
- `id` (text, PK) - Unique user identifier
- `name` (text, NOT NULL) - User's full name
- `email` (text, NOT NULL, UNIQUE) - User's email address
- `email_verified` (boolean, DEFAULT false) - Email verification status
- `image` (text, nullable) - User profile image URL
- `created_at` (timestamp, DEFAULT NOW) - Account creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Relations:**
- One-to-Many with `session`
- One-to-Many with `account`
- One-to-Many with `bookings`
- One-to-Many with `review`

---

### `session`
Manages user authentication sessions.

**Columns:**
- `id` (text, PK) - Unique session identifier
- `expires_at` (timestamp, NOT NULL) - Session expiration time
- `token` (text, NOT NULL, UNIQUE) - Session token
- `created_at` (timestamp, DEFAULT NOW) - Session creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp
- `ip_address` (text, nullable) - Client IP address
- `user_agent` (text, nullable) - Client user agent string
- `user_id` (text, NOT NULL, FK → user.id, CASCADE DELETE) - Associated user

**Indexes:**
- `session_userId_idx` on `user_id`

**Relations:**
- Many-to-One with `user`

---

### `account`
Stores OAuth provider accounts linked to users.

**Columns:**
- `id` (text, PK) - Unique account identifier
- `account_id` (text, NOT NULL) - Provider-specific account ID
- `provider_id` (text, NOT NULL) - OAuth provider identifier
- `user_id` (text, NOT NULL, FK → user.id, CASCADE DELETE) - Associated user
- `access_token` (text, nullable) - OAuth access token
- `refresh_token` (text, nullable) - OAuth refresh token
- `id_token` (text, nullable) - OAuth ID token
- `access_token_expires_at` (timestamp, nullable) - Access token expiration
- `refresh_token_expires_at` (timestamp, nullable) - Refresh token expiration
- `scope` (text, nullable) - OAuth scopes
- `password` (text, nullable) - Hashed password for credential-based auth
- `created_at` (timestamp, DEFAULT NOW) - Account creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Indexes:**
- `account_userId_idx` on `user_id`

**Relations:**
- Many-to-One with `user`

---

### `verification`
Stores verification tokens for email verification and password resets.

**Columns:**
- `id` (text, PK) - Unique verification identifier
- `identifier` (text, NOT NULL) - User identifier (typically email)
- `value` (text, NOT NULL) - Verification token/code
- `expires_at` (timestamp, NOT NULL) - Token expiration time
- `created_at` (timestamp, DEFAULT NOW) - Creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Indexes:**
- `verification_identifier_idx` on `identifier`

---

### `admin_user`
Stores admin privileges and permissions for users who can perform administrative actions.

**Columns:**
- `id` (text, PK) - Unique admin record identifier
- `user_id` (text, NOT NULL, UNIQUE, FK → user.id, CASCADE DELETE) - Associated user
- `role` (text, DEFAULT "admin") - Admin role (e.g., "admin", "super_admin", "moderator")
- `permissions` (text, nullable) - JSON string for granular permissions
- `is_active` (boolean, DEFAULT true) - Whether admin privileges are currently active
- `created_at` (timestamp, DEFAULT NOW) - Admin record creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Indexes:**
- `admin_user_userId_idx` on `user_id`
- `admin_user_isActive_idx` on `is_active`

**Relations:**
- One-to-One with `user`

**Notes:**
- Only users with an active record in this table can perform admin actions
- The `permissions` field allows for fine-grained access control (stored as JSON)
- Cascade delete ensures admin privileges are removed when a user is deleted
- The `is_active` flag allows temporary suspension of admin privileges without deleting the record

---

## 2. Catalog Management

### `activity`
The atomic building blocks of travel experiences (e.g., "Shark Diving", "Wine Tasting").

**Columns:**
- `id` (text, PK) - Unique activity identifier
- `name` (text, NOT NULL) - Activity name
- `description` (text, nullable) - Detailed description
- `image_url` (text, nullable) - Activity image URL
- `location` (text, NOT NULL) - Activity location
- `duration_minutes` (integer, NOT NULL) - Duration in minutes
- `price` (decimal(10,2), NOT NULL) - Base catalog price
- `created_at` (timestamp, DEFAULT NOW) - Creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Relations:**
- Many-to-Many with `package` (via `package_to_activity`)
- One-to-Many with `booking_activity`
- One-to-Many with `activity_media`

---

### `activity_media`
Stores images and videos associated with activities for display on activity pages.

**Columns:**
- `id` (text, PK) - Unique media identifier
- `activity_id` (text, NOT NULL, FK → activity.id, CASCADE DELETE) - Associated activity
- `media_url` (text, NOT NULL) - URL to the media file (image or video)
- `media_type` (text, NOT NULL) - Media type ('image' or 'video')
- `alt_text` (text, nullable) - Alternative text for accessibility
- `display_order` (integer, DEFAULT 0) - Order for displaying media items
- `created_at` (timestamp, DEFAULT NOW) - Upload timestamp

**Indexes:**
- `activity_media_activityId_idx` on `activity_id`

**Relations:**
- Many-to-One with `activity`

---

### `package`
Predefined bundles of activities that can be booked together.

**Columns:**
- `id` (text, PK) - Unique package identifier
- `name` (text, NOT NULL) - Package name
- `description` (text, NOT NULL) - Package description
- `image_url` (text, nullable) - Package image URL
- `is_custom` (boolean, DEFAULT false) - Flag for bespoke package templates
- `base_price` (decimal(10,2), nullable) - Optional base fee (beyond activity prices)
- `created_at` (timestamp, DEFAULT NOW) - Creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Relations:**
- Many-to-Many with `activity` (via `package_to_activity`)
- One-to-Many with `booking`
- One-to-Many with `package_media`

---

### `package_media`
Stores images and videos associated with packages for display on package pages.

**Columns:**
- `id` (text, PK) - Unique media identifier
- `package_id` (text, NOT NULL, FK → package.id, CASCADE DELETE) - Associated package
- `media_url` (text, NOT NULL) - URL to the media file (image or video)
- `media_type` (text, NOT NULL) - Media type ('image' or 'video')
- `alt_text` (text, nullable) - Alternative text for accessibility
- `display_order` (integer, DEFAULT 0) - Order for displaying media items
- `created_at` (timestamp, DEFAULT NOW) - Upload timestamp

**Indexes:**
- `package_media_packageId_idx` on `package_id`

**Relations:**
- Many-to-One with `package`

---

### `package_to_activity`
Join table establishing Many-to-Many relationship between packages and activities.

**Columns:**
- `package_id` (text, FK → package.id, CASCADE DELETE) - Package reference
- `activity_id` (text, FK → activity.id, CASCADE DELETE) - Activity reference

**Primary Key:** Composite (`package_id`, `activity_id`)

**Relations:**
- Many-to-One with `package`
- Many-to-One with `activity`

---

## 3. Order & Booking Management

### Enum: `booking_status`
Possible booking states:
- `pending` - Booking awaiting confirmation
- `confirmed` - Booking confirmed
- `cancelled` - Booking cancelled
- `completed` - Booking completed

---

### Enum: `payment_status`
Possible payment states:
- `pending` - Payment awaiting processing
- `processing` - Payment currently being processed
- `completed` - Payment successfully completed
- `failed` - Payment failed
- `refunded` - Payment fully refunded
- `partially_refunded` - Payment partially refunded

---

### Enum: `payment_method`
Supported payment methods:
- `credit_card` - Credit card payment
- `debit_card` - Debit card payment
- `paypal` - PayPal payment
- `bank_transfer` - Bank transfer
- `cash` - Cash payment
- `other` - Other payment methods

---

### `booking`
The actual purchase record representing a customer's travel booking.

**Columns:**
- `id` (text, PK) - Unique booking identifier
- `user_id` (text, NOT NULL, FK → user.id, CASCADE DELETE) - Customer reference
- `package_id` (text, nullable, FK → package.id, SET NULL) - Package reference (NULL for pure bespoke bookings)
- `status` (booking_status, DEFAULT 'pending') - Current booking status
- `total_price` (decimal(10,2), NOT NULL) - Total booking cost
- `start_date` (timestamp, NOT NULL) - Trip start date/time
- `end_date` (timestamp, NOT NULL) - Trip end date/time
- `special_requests` (text, nullable) - Customer special requests
- `created_at` (timestamp, DEFAULT NOW) - Booking creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Indexes:**
- `booking_user_idx` on `user_id`

**Relations:**
- Many-to-One with `user`
- Many-to-One with `package` (nullable)
- One-to-Many with `booking_activity`
- One-to-Many with `payment`

---

### `booking_activity`
The specific itinerary for a booking - separates catalog definitions from actual customer trips.

**Columns:**
- `id` (text, PK) - Unique booking activity identifier
- `booking_id` (text, NOT NULL, FK → booking.id, CASCADE DELETE) - Booking reference
- `activity_id` (text, NOT NULL, FK → activity.id) - Activity reference
- `guide_id` (text, nullable, FK → guide.id, SET NULL) - Assigned guide (optional)
- `price_at_booking` (decimal(10,2), NOT NULL) - **Snapshot of price at booking time**
- `scheduled_at` (timestamp, nullable) - Specific scheduled time for this activity

**Indexes:**
- `booking_activity_guideId_idx` on `guide_id`

**Relations:**
- Many-to-One with `booking`
- Many-to-One with `activity`
- Many-to-One with `guide` (nullable)
- One-to-Many with `review`

---

### `review`
Customer reviews and ratings for activities they have booked and experienced.

**Columns:**
- `id` (text, PK) - Unique review identifier
- `booking_activity_id` (text, NOT NULL, FK → booking_activity.id, CASCADE DELETE) - Associated booking activity
- `user_id` (text, NOT NULL, FK → user.id, CASCADE DELETE) - Review author
- `rating` (integer, NOT NULL) - Rating from 1-5 stars
- `comment` (text, nullable) - Review text/comments
- `is_verified` (boolean, DEFAULT true) - Verified purchase flag
- `created_at` (timestamp, DEFAULT NOW) - Review creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Indexes:**
- `review_bookingActivityId_idx` on `booking_activity_id`
- `review_userId_idx` on `user_id`

**Relations:**
- Many-to-One with `booking_activity`
- Many-to-One with `user`

**Business Rules:**
- Reviews can only be created for `booking_activity` records
- This ensures only customers who have actually booked an activity can review it
- Rating must be between 1-5 (enforced at application level)
- `is_verified` flag indicates the review is from a verified booking

---

### `payment`
Tracks payment transactions for bookings, supporting multiple payment providers and methods.

**Columns:**
- `id` (text, PK) - Unique payment identifier
- `booking_id` (text, NOT NULL, FK → booking.id, CASCADE DELETE) - Associated booking
- `amount` (decimal(10,2), NOT NULL) - Payment amount
- `currency` (text, DEFAULT 'USD') - ISO 4217 currency code (e.g., USD, EUR, GBP)
- `payment_method` (payment_method, NOT NULL) - Payment method used
- `payment_status` (payment_status, DEFAULT 'pending') - Current payment status
- `transaction_id` (text, nullable) - External payment provider transaction ID
- `payment_provider` (text, nullable) - Payment provider name (e.g., 'stripe', 'paypal', 'square')
- `payment_intent_id` (text, nullable) - Payment intent ID (for providers like Stripe)
- `metadata` (text, nullable) - JSON string for additional payment data
- `created_at` (timestamp, DEFAULT NOW) - Payment creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Indexes:**
- `payment_bookingId_idx` on `booking_id`
- `payment_status_idx` on `payment_status`
- `payment_transactionId_idx` on `transaction_id`

**Relations:**
- Many-to-One with `booking`

**Business Rules:**
- Multiple payments can exist for a single booking (e.g., deposits, installments, or failed payments)
- The sum of all `completed` payments should equal the booking's `total_price`
- `transaction_id` should be unique per payment provider
- `metadata` can store provider-specific data as JSON (customer details, payment details, etc.)
- Payment status transitions should follow: pending → processing → completed/failed
- Refunds create a new payment record with negative amount or update status to `refunded`/`partially_refunded`

---

### `guide`
Tour guides and staff members who lead activities and provide services to customers.

**Columns:**
- `id` (text, PK) - Unique guide identifier
- `name` (text, NOT NULL) - Guide's full name
- `email` (text, NOT NULL, UNIQUE) - Guide's email address
- `phone` (text, nullable) - Contact phone number
- `bio` (text, nullable) - Guide biography/description
- `specialties` (text, nullable) - Specialty areas or expertise (comma-separated or JSON)
- `image_url` (text, nullable) - Profile photo URL
- `is_active` (boolean, DEFAULT true) - Whether the guide is currently active
- `created_at` (timestamp, DEFAULT NOW) - Record creation timestamp
- `updated_at` (timestamp, AUTO-UPDATE) - Last modification timestamp

**Indexes:**
- `guide_email_idx` on `email`
- `guide_isActive_idx` on `is_active`

**Relations:**
- One-to-Many with `booking_activity`

**Business Rules:**
- Email must be unique across all guides
- `is_active` flag allows soft deactivation without deleting records
- `specialties` can store JSON array for structured data or comma-separated string
- Inactive guides can still be linked to past bookings for historical reference

---

## Usage Patterns

### 1. Predefined Tour Packages
When a customer selects a predefined package (e.g., "Summer Safari"):

**Read Operations:**
- Fetch the package and its associated activities via `package_to_activity`
- Display package details, included activities, duration, and total price

**Write Operations:**
1. Create a `booking` record linked to the selected `package_id`
2. Copy all activities from `package_to_activity` into `booking_activity`
3. Use the current `price` from `activity` table to populate `price_at_booking`
4. Calculate `total_price` based on activity prices and optional `base_price`

---

### 2. Bespoke (Custom) Bookings
When a customer picks and chooses individual activities:

**Read Operations:**
- Fetch the list of available `activity` records for browsing
- Allow filtering by location, duration, price, etc.

**Write Operations:**
1. Create a `booking` record with `package_id` as NULL (or link to a generic "Custom Package" placeholder)
2. Insert the specific activities selected by the customer into `booking_activity`
3. Snapshot each activity's current price into `price_at_booking`
4. Calculate and store `total_price`

---

### 3. Price Snapshotting Rationale

The `price_at_booking` column in `booking_activity` is **critical** for maintaining accurate financial records:

- **Historical Accuracy**: If the catalog price of "Sky Diving" changes from $200 to $250 next year, bookings made in 2025 should still reflect the $200 price that was charged at the time
- **Financial Integrity**: Revenue reports and refund calculations must use the actual price charged, not current catalog prices
- **Legal Compliance**: Customer receipts and invoices must match what was actually charged
- **Audit Trail**: Provides a complete audit trail of pricing history for each booking

**Example:**
```
2025-06-01: Customer books "Sky Diving" at $200 (stored in price_at_booking)
2025-12-01: Catalog price updated to $250 (activities.price)
2026-01-01: Historical report shows booking cost $200 (uses price_at_booking)
```

This pattern ensures that changing catalog prices never retroactively affect completed transactions.

---

### 4. Payment Processing Workflow

The `payment` table supports various payment workflows:

**Full Payment at Booking:**
1. Create a `booking` record with `status='pending'`
2. Create a `payment` record with `payment_status='pending'`
3. Process payment through provider (Stripe, PayPal, etc.)
4. Update `payment` status to `completed` and store `transaction_id`
5. Update `booking` status to `confirmed`

**Deposit + Balance Workflow:**
1. Create booking with initial deposit payment
2. Create first `payment` record for deposit amount
3. Before trip, create second `payment` record for remaining balance
4. Both payments link to the same `booking_id`

**Failed Payment Handling:**
1. If payment fails, update `payment_status` to `failed`
2. Create a new `payment` record for retry attempt
3. Keep failed payment for audit trail

**Refund Processing:**
1. Update existing `payment` status to `refunded` or `partially_refunded`
2. Optionally create a negative payment record for the refund transaction
3. Update `booking` status to `cancelled` if fully refunded

**Querying Payment Status:**
```sql
-- Get total paid amount for a booking
SELECT SUM(amount) 
FROM payment 
WHERE booking_id = ? AND payment_status = 'completed';

-- Check if booking is fully paid
SELECT b.total_price, COALESCE(SUM(p.amount), 0) as paid_amount
FROM booking b
LEFT JOIN payment p ON p.booking_id = b.id AND p.payment_status = 'completed'
WHERE b.id = ?
GROUP BY b.id;
```

---

### 5. Guide Assignment Workflow

The `guide` table enables staff management and assignment to activities:

**Creating a Guide:**
```sql
INSERT INTO guide (id, name, email, phone, bio, specialties, is_active)
VALUES ('guide_123', 'John Smith', 'john@example.com', '+1234567890', 
        'Experienced safari guide with 10 years of expertise',
        '["Wildlife Safari", "Photography Tours", "Adventure Activities"]', true);
```

**Assigning a Guide to an Activity:**
1. When creating a `booking_activity`, optionally include `guide_id`
2. Guides can be assigned at booking time or later
3. Update `booking_activity.guide_id` to assign or reassign a guide

**Guide Availability Checking:**
```sql
-- Find guides not assigned during a specific time
SELECT g.* FROM guide g
WHERE g.is_active = true
AND g.id NOT IN (
  SELECT DISTINCT ba.guide_id 
  FROM booking_activity ba
  WHERE ba.scheduled_at BETWEEN ? AND ?
  AND ba.guide_id IS NOT NULL
);
```

**Guide Performance Tracking:**
```sql
-- Get average ratings for a guide's activities
SELECT g.name, AVG(r.rating) as avg_rating, COUNT(r.id) as total_reviews
FROM guide g
JOIN booking_activity ba ON ba.guide_id = g.id
JOIN review r ON r.booking_activity_id = ba.id
WHERE g.id = ?
GROUP BY g.id, g.name;
```

**Business Scenarios:**
- **Optional Assignment**: Not all activities require a guide (e.g., self-guided tours)
- **Reassignment**: If a guide becomes unavailable, update `guide_id` to reassign
- **Historical Preservation**: Setting guide to NULL on delete preserves booking records
- **Capacity Planning**: Query guide assignments to manage schedules and prevent overbooking

---

## Data Integrity Features

### Cascade Deletes
- Deleting a `user` cascades to `session`, `account`, `booking`, and `review`
- Deleting a `booking` cascades to `booking_activity` and `payment`
- Deleting a `booking_activity` cascades to `review`
- Deleting a `package` or `activity` from `package_to_activity` cascades the junction record
- Deleting an `activity` cascades to `activity_media`
- Deleting a `package` cascades to `package_media`

### Set Null on Delete
- Deleting a `package` sets `booking.package_id` to NULL (preserves booking history)
- Deleting a `guide` sets `booking_activity.guide_id` to NULL (preserves booking history)

### Indexes
- Foreign key columns are indexed for query performance
- Unique constraints on `email`, session `token`, and verification `identifier`

### Auto-timestamps
- `created_at` fields default to current timestamp
- `updated_at` fields automatically update on record modification

---

## Security Considerations

1. **Password Storage**: The `account.password` field should store hashed passwords only (e.g., bcrypt, argon2)
2. **Token Security**: Session tokens and OAuth tokens should be generated cryptographically
3. **Email Verification**: Use the `verification` table to validate email addresses before setting `email_verified`
4. **User Data**: Implement soft deletes or anonymization for GDPR compliance
5. **Price Validation**: Always validate `price` and `total_price` on the server to prevent tampering
6. **Payment Security**: 
   - Never store full credit card numbers - use tokenization via payment providers
   - Store only the last 4 digits for display purposes if needed
   - Use HTTPS for all payment-related API endpoints
   - Implement webhook signature verification for payment provider callbacks
   - Log all payment state changes for audit trails
   - Use idempotency keys to prevent duplicate charges

---

## Future Enhancements

Potential schema extensions to consider:

- **Availability Management**: Add `activity_availability` table for scheduling
- **Location Hierarchy**: Normalize `location` into separate table with coordinates
- **Promotions**: Add `discount_code` and `promotion` tables
- **Refunds**: Add `refund` table linked to `booking`