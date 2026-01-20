import { Hono } from "hono";
import { db } from "../db/db";
import { activities, activityMedia, bookingActivities, reviews, user } from "../db/schema";
import { and, eq, gte, lte, like, sql, avg } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { nanoid } from "nanoid";
import { zValidator } from "@hono/zod-validator";
import { createActivitySchema, updateActivitySchema, createActivityMediaSchema } from "./activities.validation";

const app = new Hono();

/**
 * GET /api/activities
 * Fetch paginated list of activities with optional filters
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 * - location: Filter by location (partial match)
 * - minPrice: Filter by minimum price
 * - maxPrice: Filter by maximum price
 */
app.get("/", async (c) => {
  try {
    // Parse query parameters
    const page = Math.max(1, Number.parseInt(c.req.query("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(c.req.query("limit") || "10"))
    );
    const location = c.req.query("location");
    const minPrice = c.req.query("minPrice");
    const maxPrice = c.req.query("maxPrice");

    // Build filter conditions
    const conditions = [];

    // Location filter (case-insensitive partial match)
    if (location) {
      conditions.push(like(activities.location, `%${location}%`));
    }

    // Price range filters
    if (minPrice) {
      const minPriceNum = Number.parseFloat(minPrice);
      if (!Number.isNaN(minPriceNum)) {
        conditions.push(gte(activities.price, minPrice));
      }
    }

    if (maxPrice) {
      const maxPriceNum = Number.parseFloat(maxPrice);
      if (!Number.isNaN(maxPriceNum)) {
        conditions.push(lte(activities.price, maxPrice));
      }
    }

    // Build where clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Fetch activities with filters and pagination
    const activitiesData = await db
      .select()
      .from(activities)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(activities.createdAt);

    // Get total count for pagination metadata
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(activities)
      .where(whereClause);

    const totalPages = Math.ceil(count / limit);

    return c.json({
      success: true,
      data: activitiesData,
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
    console.error("Error fetching activities:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch activities",
      },
      500
    );
  }
});

/**
 * POST /api/activities
 * Create a new activity (Admin only)
 * 
 * Request Body:
 * - name: Activity name (required)
 * - description: Activity description (optional)
 * - imageUrl: Main image URL (optional)
 * - location: Activity location (required)
 * - durationMinutes: Duration in minutes (required)
 * - price: Activity price (required)
 * 
 * Requires: Admin authentication
 */
app.post("/", requireAdmin, zValidator("json", createActivitySchema), async (c) => {
  try {
    // Get validated data from request
    const body = c.req.valid("json");

    // Generate unique ID for the activity
    const activityId = nanoid();

    // Create activity record
    const [newActivity] = await db
      .insert(activities)
      .values({
        id: activityId,
        name: body.name.trim(),
        description: body.description?.trim() || null,
        imageUrl: body.imageUrl?.trim() || null,
        location: body.location.trim(),
        durationMinutes: body.durationMinutes,
        price: body.price.toFixed(2),
      })
      .returning();

    return c.json(
      {
        success: true,
        message: "Activity created successfully",
        data: newActivity,
      },
      201
    );
  } catch (error) {
    console.error("Error creating activity:", error);
    return c.json(
      {
        success: false,
        error: "Failed to create activity",
      },
      500
    );
  }
});

/**
 * PATCH /api/activities/:id
 * Update an existing activity (Admin only)
 * 
 * Path Parameters:
 * - id: Activity ID
 * 
 * Request Body (all fields optional):
 * - name: Activity name
 * - description: Activity description
 * - imageUrl: Main image URL
 * - location: Activity location
 * - durationMinutes: Duration in minutes
 * - price: Activity price
 * 
 * Requires: Admin authentication
 */
app.patch("/:id", requireAdmin, zValidator("json", updateActivitySchema), async (c) => {
  try {
    const activityId = c.req.param("id");
    const body = c.req.valid("json");

    // Check if activity exists
    const [existingActivity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!existingActivity) {
      return c.json(
        {
          success: false,
          error: "Activity not found",
        },
        404
      );
    }

    // Build update object with only provided fields
    const updateData: Partial<typeof existingActivity> = {};

    if (body.name !== undefined) {
      updateData.name = body.name.trim();
    }
    if (body.description !== undefined) {
      updateData.description = body.description?.trim() || null;
    }
    if (body.imageUrl !== undefined) {
      updateData.imageUrl = body.imageUrl?.trim() || null;
    }
    if (body.location !== undefined) {
      updateData.location = body.location.trim();
    }
    if (body.durationMinutes !== undefined) {
      updateData.durationMinutes = body.durationMinutes;
    }
    if (body.price !== undefined) {
      updateData.price = body.price.toFixed(2);
    }

    // Update activity
    const [updatedActivity] = await db
      .update(activities)
      .set(updateData)
      .where(eq(activities.id, activityId))
      .returning();

    return c.json({
      success: true,
      message: "Activity updated successfully",
      data: updatedActivity,
    });
  } catch (error) {
    console.error("Error updating activity:", error);
    return c.json(
      {
        success: false,
        error: "Failed to update activity",
      },
      500
    );
  }
});

/**
 * DELETE /api/activities/:id
 * Delete an activity (Admin only)
 * 
 * Path Parameters:
 * - id: Activity ID
 * 
 * This is a hard delete that will:
 * - Check for existing bookings before deletion
 * - Prevent deletion if activity is part of any bookings
 * - Cascade delete associated media
 * 
 * Requires: Admin authentication
 */
app.delete("/:id", requireAdmin, async (c) => {
  try {
    const activityId = c.req.param("id");

    // Check if activity exists
    const [existingActivity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!existingActivity) {
      return c.json(
        {
          success: false,
          error: "Activity not found",
        },
        404
      );
    }

    // Check for existing bookings
    const existingBookings = await db
      .select({ id: bookingActivities.id })
      .from(bookingActivities)
      .where(eq(bookingActivities.activityId, activityId))
      .limit(1);

    if (existingBookings.length > 0) {
      return c.json(
        {
          success: false,
          error: "Cannot delete activity: it is associated with existing bookings",
          details: "This activity is part of one or more bookings and cannot be deleted to preserve booking history.",
        },
        409 // Conflict status code
      );
    }

    // Delete the activity (cascade will handle media deletion)
    await db
      .delete(activities)
      .where(eq(activities.id, activityId));

    return c.json({
      success: true,
      message: "Activity deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting activity:", error);
    return c.json(
      {
        success: false,
        error: "Failed to delete activity",
      },
      500
    );
  }
});

/**
 * GET /api/activities/:id
 * Fetch a single activity by ID with associated media
 * 
 * Path Parameters:
 * - id: Activity ID
 */
app.get("/:id", async (c) => {
  try {
    const activityId = c.req.param("id");

    // Fetch activity by ID
    const [activity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!activity) {
      return c.json(
        {
          success: false,
          error: "Activity not found",
        },
        404
      );
    }

    // Fetch associated media
    const media = await db
      .select()
      .from(activityMedia)
      .where(eq(activityMedia.activityId, activityId))
      .orderBy(activityMedia.displayOrder);

    return c.json({
      success: true,
      data: {
        ...activity,
        media,
      },
    });
  } catch (error) {
    console.error("Error fetching activity:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch activity",
      },
      500
    );
  }
});

/**
 * GET /api/activities/:id/media
 * Fetch all media (images/videos) for a specific activity
 * 
 * Path Parameters:
 * - id: Activity ID
 */
app.get("/:id/media", async (c) => {
  try {
    const activityId = c.req.param("id");

    // Verify activity exists
    const [activity] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!activity) {
      return c.json(
        {
          success: false,
          error: "Activity not found",
        },
        404
      );
    }

    // Fetch media ordered by display_order
    const media = await db
      .select()
      .from(activityMedia)
      .where(eq(activityMedia.activityId, activityId))
      .orderBy(activityMedia.displayOrder);

    return c.json({
      success: true,
      data: media,
    });
  } catch (error) {
    console.error("Error fetching activity media:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch activity media",
      },
      500
    );
  }
});

/**
 * POST /api/activities/:id/media
 * Upload media (images/videos) for an activity (Admin only)
 * 
 * Path Parameters:
 * - id: Activity ID
 * 
 * Request Body:
 * - media: Array of media items
 *   - mediaUrl: URL of the media file (required)
 *   - mediaType: Type of media - 'image' or 'video' (required)
 *   - altText: Alternative text for accessibility (optional)
 *   - displayOrder: Order for displaying media (optional, default: 0)
 * 
 * Requires: Admin authentication
 */
app.post("/:id/media", requireAdmin, zValidator("json", createActivityMediaSchema), async (c) => {
  try {
    const activityId = c.req.param("id");
    const body = c.req.valid("json");

    // Verify activity exists
    const [activity] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!activity) {
      return c.json(
        {
          success: false,
          error: "Activity not found",
        },
        404
      );
    }

    // Prepare media items for insertion
    const mediaItems = body.media.map((item) => ({
      id: nanoid(),
      activityId,
      mediaUrl: item.mediaUrl,
      mediaType: item.mediaType,
      altText: item.altText || null,
      displayOrder: item.displayOrder ?? 0,
    }));

    // Insert all media items
    const createdMedia = await db
      .insert(activityMedia)
      .values(mediaItems)
      .returning();

    return c.json(
      {
        success: true,
        message: `Successfully uploaded ${createdMedia.length} media item${createdMedia.length > 1 ? 's' : ''}`,
        data: createdMedia,
      },
      201
    );
  } catch (error) {
    console.error("Error uploading activity media:", error);
    return c.json(
      {
        success: false,
        error: "Failed to upload activity media",
      },
      500
    );
  }
});

/**
 * DELETE /api/activities/:id/media/:mediaId
 * Delete a specific media item from an activity (Admin only)
 * 
 * Path Parameters:
 * - id: Activity ID
 * - mediaId: Media ID to delete
 * 
 * Requires: Admin authentication
 */
app.delete("/:id/media/:mediaId", requireAdmin, async (c) => {
  try {
    const activityId = c.req.param("id");
    const mediaId = c.req.param("mediaId");

    // Verify activity exists
    const [activity] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!activity) {
      return c.json(
        {
          success: false,
          error: "Activity not found",
        },
        404
      );
    }

    // Verify media exists and belongs to the activity
    const [media] = await db
      .select()
      .from(activityMedia)
      .where(
        and(
          eq(activityMedia.id, mediaId),
          eq(activityMedia.activityId, activityId)
        )
      )
      .limit(1);

    if (!media) {
      return c.json(
        {
          success: false,
          error: "Media not found or does not belong to this activity",
        },
        404
      );
    }

    // Delete the media item
    await db
      .delete(activityMedia)
      .where(eq(activityMedia.id, mediaId));

    return c.json({
      success: true,
      message: "Media deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting activity media:", error);
    return c.json(
      {
        success: false,
        error: "Failed to delete activity media",
      },
      500
    );
  }
});

/**
 * GET /api/activities/:id/reviews
 * Fetch all reviews for a specific activity with user information and average rating
 * 
 * Path Parameters:
 * - id: Activity ID
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 */
app.get("/:id/reviews", async (c) => {
  try {
    const activityId = c.req.param("id");
    
    // Parse pagination parameters
    const page = Math.max(1, Number.parseInt(c.req.query("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(c.req.query("limit") || "10"))
    );

    // Verify activity exists
    const [activity] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!activity) {
      return c.json(
        {
          success: false,
          error: "Activity not found",
        },
        404
      );
    }

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Fetch reviews with user information
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
      })
      .from(reviews)
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .innerJoin(user, eq(reviews.userId, user.id))
      .where(eq(bookingActivities.activityId, activityId))
      .orderBy(reviews.createdAt)
      .limit(limit)
      .offset(offset);

    // Get total count of reviews for pagination
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .where(eq(bookingActivities.activityId, activityId));

    // Calculate average rating
    const [{ avgRating }] = await db
      .select({ avgRating: avg(reviews.rating) })
      .from(reviews)
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .where(eq(bookingActivities.activityId, activityId));

    const totalPages = Math.ceil(count / limit);
    const averageRating = avgRating ? Number.parseFloat(avgRating) : 0;

    return c.json({
      success: true,
      data: {
        reviews: reviewsData,
        averageRating: Math.round(averageRating * 10) / 10, // Round to 1 decimal place
        totalReviews: count,
      },
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
    console.error("Error fetching activity reviews:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch activity reviews",
      },
      500
    );
  }
});

export default app;
