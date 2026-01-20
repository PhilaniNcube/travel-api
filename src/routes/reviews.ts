import { Hono } from "hono";
import { db } from "../db/db";
import { reviews, user, bookingActivities, activities, bookings } from "../db/schema";
import { eq, sql, and } from "drizzle-orm";
import { requireAuth, isUserAdmin } from "../lib/auth";
import { createReviewSchema, updateReviewSchema } from "./reviews.validation";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";

type Env = {
  Variables: {
    user: typeof user.$inferSelect;
  };
};

const app = new Hono<Env>();

/**
 * GET /api/reviews
 * Get all reviews with pagination
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 * 
 * Returns:
 * - List of all reviews with user and activity information
 * - Pagination metadata
 */
app.get("/", async (c) => {
  try {
    // Parse query parameters
    const page = Math.max(1, Number.parseInt(c.req.query("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(c.req.query("limit") || "10"))
    );

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Fetch reviews with user and activity information
    const reviewsData = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        isVerified: reviews.isVerified,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        user: {
          id: user.id,
          name: user.name,
          image: user.image,
        },
        activity: {
          id: activities.id,
          name: activities.name,
          location: activities.location,
        },
      })
      .from(reviews)
      .innerJoin(user, eq(reviews.userId, user.id))
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .innerJoin(activities, eq(bookingActivities.activityId, activities.id))
      .orderBy(reviews.createdAt)
      .limit(limit)
      .offset(offset);

    // Get total count for pagination metadata
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews);

    const totalPages = Math.ceil(count / limit);

    return c.json({
      success: true,
      data: reviewsData,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching reviews:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch reviews",
      },
      500
    );
  }
});

/**
 * GET /api/reviews/me
 * Get all reviews by the authenticated user
 * Requires authentication
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 * 
 * Returns:
 * - List of user's reviews with activity information
 * - Pagination metadata
 */
app.get("/me", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const authUser = c.get('user');
    
    if (!authUser || !authUser.id) {
      return c.json(
        {
          success: false,
          error: "User not authenticated",
        },
        401
      );
    }

    // Parse query parameters
    const page = Math.max(1, Number.parseInt(c.req.query("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(c.req.query("limit") || "10"))
    );

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Fetch user's reviews with activity information
    const userReviews = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        isVerified: reviews.isVerified,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        activity: {
          id: activities.id,
          name: activities.name,
          description: activities.description,
          location: activities.location,
          durationMinutes: activities.durationMinutes,
          price: activities.price,
        },
        bookingActivity: {
          id: bookingActivities.id,
          bookingId: bookingActivities.bookingId,
          scheduledAt: bookingActivities.scheduledAt,
          priceAtBooking: bookingActivities.priceAtBooking,
        },
      })
      .from(reviews)
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .innerJoin(activities, eq(bookingActivities.activityId, activities.id))
      .where(eq(reviews.userId, authUser.id))
      .orderBy(reviews.createdAt)
      .limit(limit)
      .offset(offset);

    // Get total count for pagination metadata
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(eq(reviews.userId, authUser.id));

    const totalPages = Math.ceil(count / limit);

    return c.json({
      success: true,
      data: userReviews,
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching user reviews:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch user reviews",
      },
      500
    );
  }
});

/**
 * GET /api/reviews/:id
 * Get a single review by ID with full details
 * 
 * Returns:
 * - Review information
 * - User who wrote the review
 * - Activity being reviewed
 * - Booking activity details
 */
app.get("/:id", async (c) => {
  try {
    const reviewId = c.req.param("id");

    // Fetch review with all related information
    const reviewData = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        isVerified: reviews.isVerified,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        bookingActivityId: reviews.bookingActivityId,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
        activity: {
          id: activities.id,
          name: activities.name,
          description: activities.description,
          location: activities.location,
          durationMinutes: activities.durationMinutes,
        },
        bookingActivity: {
          id: bookingActivities.id,
          bookingId: bookingActivities.bookingId,
          scheduledAt: bookingActivities.scheduledAt,
          priceAtBooking: bookingActivities.priceAtBooking,
        },
      })
      .from(reviews)
      .innerJoin(user, eq(reviews.userId, user.id))
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .innerJoin(activities, eq(bookingActivities.activityId, activities.id))
      .where(eq(reviews.id, reviewId))
      .limit(1);

    if (!reviewData || reviewData.length === 0) {
      return c.json(
        {
          success: false,
          error: "Review not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: reviewData[0],
    });
  } catch (error) {
    console.error("Error fetching review:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch review",
      },
      500
    );
  }
});

/**
 * POST /api/reviews
 * Create a new review for a booking activity
 * Requires user authentication
 * 
 * Request Body:
 * - bookingActivityId: string - The booking activity to review
 * - rating: number (1-5) - The rating for the activity
 * - comment: string (optional) - Review comment
 * 
 * Returns:
 * - Created review with all details
 * 
 * Validation:
 * - User must be authenticated
 * - User must have completed the activity (booking status = 'completed')
 * - User must own the booking
 * - Rating must be between 1-5
 * - User cannot review the same booking activity twice
 */
app.post("/", requireAuth, zValidator("json", createReviewSchema), async (c) => {
  try {
    // Get authenticated user from context
    const authUser = c.get('user');
    
    if (!authUser || !authUser.id) {
      return c.json(
        {
          success: false,
          error: "User not authenticated",
        },
        401
      );
    }

    // Get validated request body
    const body = c.req.valid("json");

    // 1. Verify the booking activity exists and get booking details
    const bookingActivityData = await db
      .select({
        bookingActivity: {
          id: bookingActivities.id,
          bookingId: bookingActivities.bookingId,
          activityId: bookingActivities.activityId,
        },
        booking: {
          id: bookings.id,
          userId: bookings.userId,
          status: bookings.status,
        },
      })
      .from(bookingActivities)
      .innerJoin(bookings, eq(bookingActivities.bookingId, bookings.id))
      .where(eq(bookingActivities.id, body.bookingActivityId))
      .limit(1);

    if (!bookingActivityData || bookingActivityData.length === 0) {
      return c.json(
        {
          success: false,
          error: "Booking activity not found",
        },
        404
      );
    }

    const { booking } = bookingActivityData[0];

    // 2. Verify user owns the booking
    if (booking.userId !== authUser.id) {
      return c.json(
        {
          success: false,
          error: "You can only review your own bookings",
        },
        403
      );
    }

    // 3. Verify booking is completed
    if (booking.status !== "completed") {
      return c.json(
        {
          success: false,
          error: "You can only review completed activities",
        },
        400
      );
    }

    // 4. Check if user has already reviewed this booking activity
    const existingReview = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(
        and(
          eq(reviews.bookingActivityId, body.bookingActivityId),
          eq(reviews.userId, authUser.id)
        )
      )
      .limit(1);

    if (existingReview && existingReview.length > 0) {
      return c.json(
        {
          success: false,
          error: "You have already reviewed this activity",
        },
        400
      );
    }

    // 5. Create the review
    const reviewId = nanoid();
    const [newReview] = await db
      .insert(reviews)
      .values({
        id: reviewId,
        bookingActivityId: body.bookingActivityId,
        userId: authUser.id,
        rating: body.rating,
        comment: body.comment || null,
        isVerified: true, // Set to true as per requirements
      })
      .returning();

    // 6. Fetch the created review with all related information
    const reviewData = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        isVerified: reviews.isVerified,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        bookingActivityId: reviews.bookingActivityId,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
        activity: {
          id: activities.id,
          name: activities.name,
          description: activities.description,
          location: activities.location,
          durationMinutes: activities.durationMinutes,
        },
        bookingActivity: {
          id: bookingActivities.id,
          bookingId: bookingActivities.bookingId,
          scheduledAt: bookingActivities.scheduledAt,
          priceAtBooking: bookingActivities.priceAtBooking,
        },
      })
      .from(reviews)
      .innerJoin(user, eq(reviews.userId, user.id))
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .innerJoin(activities, eq(bookingActivities.activityId, activities.id))
      .where(eq(reviews.id, reviewId))
      .limit(1);

    return c.json(
      {
        success: true,
        message: "Review created successfully",
        data: reviewData[0],
      },
      201
    );
  } catch (error) {
    console.error("Error creating review:", error);
    return c.json(
      {
        success: false,
        error: "Failed to create review",
      },
      500
    );
  }
});

/**
 * PATCH /api/reviews/:id
 * Update a review's rating and/or comment
 * Requires user authentication
 * 
 * Request Body:
 * - rating: number (1-5) (optional) - The updated rating
 * - comment: string (optional) - The updated comment
 * 
 * Returns:
 * - Updated review with all details
 * 
 * Validation:
 * - User must be authenticated
 * - User must own the review
 * - At least one field (rating or comment) must be provided
 * - Rating must be between 1-5 if provided
 */
app.patch("/:id", requireAuth, zValidator("json", updateReviewSchema), async (c) => {
  try {
    // Get authenticated user from context
    const authUser = c.get('user');
    
    if (!authUser || !authUser.id) {
      return c.json(
        {
          success: false,
          error: "User not authenticated",
        },
        401
      );
    }

    const reviewId = c.req.param("id");
    const body = c.req.valid("json");

    // 1. Check if review exists and verify ownership
    const existingReview = await db
      .select({
        id: reviews.id,
        userId: reviews.userId,
      })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1);

    if (!existingReview || existingReview.length === 0) {
      return c.json(
        {
          success: false,
          error: "Review not found",
        },
        404
      );
    }

    // 2. Verify user owns the review
    if (existingReview[0].userId !== authUser.id) {
      return c.json(
        {
          success: false,
          error: "You can only update your own reviews",
        },
        403
      );
    }

    // 3. Update the review
    await db
      .update(reviews)
      .set({
        ...(body.rating !== undefined && { rating: body.rating }),
        ...(body.comment !== undefined && { comment: body.comment }),
        updatedAt: new Date(),
      })
      .where(eq(reviews.id, reviewId));

    // 4. Fetch the updated review with all related information
    const reviewData = await db
      .select({
        id: reviews.id,
        rating: reviews.rating,
        comment: reviews.comment,
        isVerified: reviews.isVerified,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        bookingActivityId: reviews.bookingActivityId,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
        activity: {
          id: activities.id,
          name: activities.name,
          description: activities.description,
          location: activities.location,
          durationMinutes: activities.durationMinutes,
        },
        bookingActivity: {
          id: bookingActivities.id,
          bookingId: bookingActivities.bookingId,
          scheduledAt: bookingActivities.scheduledAt,
          priceAtBooking: bookingActivities.priceAtBooking,
        },
      })
      .from(reviews)
      .innerJoin(user, eq(reviews.userId, user.id))
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .innerJoin(activities, eq(bookingActivities.activityId, activities.id))
      .where(eq(reviews.id, reviewId))
      .limit(1);

    return c.json({
      success: true,
      message: "Review updated successfully",
      data: reviewData[0],
    });
  } catch (error) {
    console.error("Error updating review:", error);
    return c.json(
      {
        success: false,
        error: "Failed to update review",
      },
      500
    );
  }
});

/**
 * DELETE /api/reviews/:id
 * Delete a review
 * Requires user authentication
 * 
 * Returns:
 * - Success message
 * 
 * Validation:
 * - User must be authenticated
 * - User must own the review or be an admin
 */
app.delete("/:id", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const authUser = c.get('user');
    
    if (!authUser || !authUser.id) {
      return c.json(
        {
          success: false,
          error: "User not authenticated",
        },
        401
      );
    }

    const reviewId = c.req.param("id");

    // 1. Check if review exists
    const existingReview = await db
      .select({
        id: reviews.id,
        userId: reviews.userId,
      })
      .from(reviews)
      .where(eq(reviews.id, reviewId))
      .limit(1);

    if (!existingReview || existingReview.length === 0) {
      return c.json(
        {
          success: false,
          error: "Review not found",
        },
        404
      );
    }

    // 2. Check if user owns the review or is an admin
    const isAdmin = await isUserAdmin(authUser.id);
    const isOwner = existingReview[0].userId === authUser.id;

    if (!isOwner && !isAdmin) {
      return c.json(
        {
          success: false,
          error: "You can only delete your own reviews",
        },
        403
      );
    }

    // 3. Delete the review
    await db
      .delete(reviews)
      .where(eq(reviews.id, reviewId));

    return c.json({
      success: true,
      message: "Review deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting review:", error);
    return c.json(
      {
        success: false,
        error: "Failed to delete review",
      },
      500
    );
  }
});

export default app;
