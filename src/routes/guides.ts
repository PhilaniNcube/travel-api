import { Hono } from "hono";
import { db } from "../db/db";
import { guides, bookingActivities, reviews, user, activities } from "../db/schema";
import { and, eq, like, sql, avg, gte, lte, between } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { listGuidesQuerySchema, createGuideSchema, updateGuideSchema } from "./guides.validation";
import { requireAdmin } from "../lib/auth";
import { nanoid } from "nanoid";

const app = new Hono();

/**
 * GET /api/guides
 * Fetch paginated list of guides with optional filters
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 * - is_active: Filter by active status (true/false)
 * - specialties: Filter by specialties (partial match, comma-separated)
 */
app.get("/", async (c) => {
  try {
    // Parse query parameters
    const page = Math.max(1, Number.parseInt(c.req.query("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(c.req.query("limit") || "10"))
    );
    const isActiveParam = c.req.query("is_active");
    const specialtiesParam = c.req.query("specialties");

    // Build filter conditions
    const conditions = [];

    // Filter by is_active status
    if (isActiveParam !== undefined) {
      const isActive = isActiveParam === "true";
      conditions.push(eq(guides.isActive, isActive));
    }

    // Filter by specialties (partial match)
    if (specialtiesParam) {
      // Support filtering by one or multiple specialties
      const specialtyList = specialtiesParam.split(",").map(s => s.trim());
      
      // Create OR conditions for each specialty
      const specialtyConditions = specialtyList.map(specialty =>
        like(guides.specialties, `%${specialty}%`)
      );
      
      // If multiple specialties, combine with OR
      if (specialtyConditions.length > 0) {
        conditions.push(
          specialtyConditions.length === 1
            ? specialtyConditions[0]
            : sql`${guides.specialties} ILIKE ANY(ARRAY[${sql.join(
                specialtyList.map(s => sql`${'%' + s + '%'}`),
                sql`, `
              )}])`
        );
      }
    }

    // Calculate offset
    const offset = (page - 1) * limit;

    // Build WHERE clause
    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch guides with filters
    const guidesList = await db
      .select()
      .from(guides)
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(guides.name);

    // Get total count for pagination
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(guides)
      .where(whereClause);

    // Calculate pagination metadata
    const totalPages = Math.ceil(count / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    return c.json({
      data: guidesList,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: count,
        itemsPerPage: limit,
        hasNextPage,
        hasPreviousPage,
      },
    });
  } catch (error) {
    console.error("Error fetching guides:", error);
    return c.json(
      {
        error: "Failed to fetch guides",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * GET /api/guides/:id
 * Get a specific guide by ID with details
 * 
 * Path Parameters:
 * - id: Guide ID
 * 
 * Returns:
 * - Guide details including specialties and bio
 */
app.get("/:id", async (c) => {
  try {
    const guideId = c.req.param("id");

    // Fetch guide by ID
    const [guide] = await db
      .select()
      .from(guides)
      .where(eq(guides.id, guideId))
      .limit(1);

    if (!guide) {
      return c.json(
        {
          success: false,
          error: "Guide not found",
        },
        404
      );
    }

    return c.json({
      success: true,
      data: guide,
    });
  } catch (error) {
    console.error("Error fetching guide:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch guide",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * GET /api/guides/:id/availability
 * Check guide's availability for a date range
 * 
 * Path Parameters:
 * - id: Guide ID
 * 
 * Query Parameters:
 * - startDate: Start date (ISO format, required)
 * - endDate: End date (ISO format, required)
 * 
 * Returns:
 * - List of scheduled activities within the date range
 * - Available/unavailable status for requested period
 */
app.get("/:id/availability", async (c) => {
  try {
    const guideId = c.req.param("id");
    const startDate = c.req.query("startDate");
    const endDate = c.req.query("endDate");

    // Validate query parameters
    if (!startDate || !endDate) {
      return c.json(
        {
          success: false,
          error: "Both startDate and endDate are required",
        },
        400
      );
    }

    // Verify guide exists
    const [guide] = await db
      .select()
      .from(guides)
      .where(eq(guides.id, guideId))
      .limit(1);

    if (!guide) {
      return c.json(
        {
          success: false,
          error: "Guide not found",
        },
        404
      );
    }

    // Parse dates
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return c.json(
        {
          success: false,
          error: "Invalid date format. Use ISO format (YYYY-MM-DD)",
        },
        400
      );
    }

    if (start > end) {
      return c.json(
        {
          success: false,
          error: "startDate must be before endDate",
        },
        400
      );
    }

    // Fetch all scheduled activities for the guide within the date range
    const scheduledActivities = await db
      .select({
        bookingActivityId: bookingActivities.id,
        scheduledAt: bookingActivities.scheduledAt,
        activity: {
          id: activities.id,
          name: activities.name,
          durationMinutes: activities.durationMinutes,
        },
      })
      .from(bookingActivities)
      .innerJoin(activities, eq(bookingActivities.activityId, activities.id))
      .where(
        and(
          eq(bookingActivities.guideId, guideId),
          gte(bookingActivities.scheduledAt, start),
          lte(bookingActivities.scheduledAt, end)
        )
      )
      .orderBy(bookingActivities.scheduledAt);

    // Calculate time slots
    const timeSlots = scheduledActivities.map(slot => {
      const scheduledTime = slot.scheduledAt;
      if (!scheduledTime) return null;
      
      const endTime = new Date(scheduledTime);
      endTime.setMinutes(endTime.getMinutes() + slot.activity.durationMinutes);
      
      return {
        bookingActivityId: slot.bookingActivityId,
        activityName: slot.activity.name,
        startTime: scheduledTime,
        endTime: endTime,
        durationMinutes: slot.activity.durationMinutes,
        status: "unavailable" as const,
      };
    }).filter(Boolean);

    return c.json({
      success: true,
      data: {
        guide: {
          id: guide.id,
          name: guide.name,
          isActive: guide.isActive,
        },
        dateRange: {
          startDate: start,
          endDate: end,
        },
        scheduledActivities: timeSlots,
        totalScheduled: timeSlots.length,
        isAvailable: timeSlots.length === 0, // Simple availability check
      },
    });
  } catch (error) {
    console.error("Error fetching guide availability:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch guide availability",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * GET /api/guides/:id/reviews
 * Get all reviews for activities led by this guide
 * 
 * Path Parameters:
 * - id: Guide ID
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 * 
 * Returns:
 * - List of reviews for activities led by the guide
 * - Average rating
 * - Activity information for each review
 */
app.get("/:id/reviews", async (c) => {
  try {
    const guideId = c.req.param("id");
    
    // Parse pagination parameters
    const page = Math.max(1, Number.parseInt(c.req.query("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(c.req.query("limit") || "10"))
    );

    // Verify guide exists
    const [guide] = await db
      .select({ id: guides.id, name: guides.name })
      .from(guides)
      .where(eq(guides.id, guideId))
      .limit(1);

    if (!guide) {
      return c.json(
        {
          success: false,
          error: "Guide not found",
        },
        404
      );
    }

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Fetch reviews for activities led by this guide
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
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .innerJoin(user, eq(reviews.userId, user.id))
      .innerJoin(activities, eq(bookingActivities.activityId, activities.id))
      .where(eq(bookingActivities.guideId, guideId))
      .orderBy(reviews.createdAt)
      .limit(limit)
      .offset(offset);

    // Get total count of reviews for pagination
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .where(eq(bookingActivities.guideId, guideId));

    // Calculate average rating
    const [{ avgRating }] = await db
      .select({ avgRating: avg(reviews.rating) })
      .from(reviews)
      .innerJoin(bookingActivities, eq(reviews.bookingActivityId, bookingActivities.id))
      .where(eq(bookingActivities.guideId, guideId));

    const totalPages = Math.ceil(count / limit);
    const averageRating = avgRating ? Number.parseFloat(avgRating) : 0;

    return c.json({
      success: true,
      data: {
        guide: {
          id: guide.id,
          name: guide.name,
        },
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
    console.error("Error fetching guide reviews:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch guide reviews",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * POST /api/guides
 * Create a new guide profile (Admin only)
 * 
 * Request Body:
 * - name: Guide name (required)
 * - email: Guide email (required, must be unique)
 * - phone: Guide phone number (optional)
 * - bio: Guide biography (optional)
 * - specialties: Guide specialties/expertise (optional, comma-separated)
 * - imageUrl: Profile image URL (optional)
 * - isActive: Active status (optional, defaults to true)
 * 
 * Requires: Admin authentication
 * 
 * Returns: Newly created guide object
 */
app.post("/", requireAdmin, zValidator("json", createGuideSchema), async (c) => {
  try {
    // Get validated data from request
    const body = c.req.valid("json");

    // Generate unique ID for the guide
    const guideId = nanoid();

    // Check if email already exists
    const existingGuide = await db
      .select({ id: guides.id })
      .from(guides)
      .where(eq(guides.email, body.email.toLowerCase()))
      .limit(1);

    if (existingGuide.length > 0) {
      return c.json(
        {
          success: false,
          error: "A guide with this email already exists",
        },
        409
      );
    }

    // Create guide record
    const [newGuide] = await db
      .insert(guides)
      .values({
        id: guideId,
        name: body.name.trim(),
        email: body.email.toLowerCase().trim(),
        phone: body.phone?.trim() || null,
        bio: body.bio?.trim() || null,
        specialties: body.specialties?.trim() || null,
        imageUrl: body.imageUrl?.trim() || null,
        isActive: body.isActive ?? true,
      })
      .returning();

    return c.json(
      {
        success: true,
        message: "Guide created successfully",
        data: newGuide,
      },
      201
    );
  } catch (error) {
    console.error("Error creating guide:", error);
    return c.json(
      {
        success: false,
        error: "Failed to create guide",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * PATCH /api/guides/:id
 * Update an existing guide (Admin only)
 * 
 * Path Parameters:
 * - id: Guide ID
 * 
 * Request Body (all fields optional):
 * - name: Guide name
 * - email: Guide email (must be unique)
 * - phone: Guide phone number
 * - bio: Guide biography
 * - specialties: Guide specialties/expertise (comma-separated)
 * - imageUrl: Profile image URL
 * - isActive: Active status
 * 
 * Requires: Admin authentication
 * 
 * Returns: Updated guide object
 */
app.patch("/:id", requireAdmin, zValidator("json", updateGuideSchema), async (c) => {
  try {
    const guideId = c.req.param("id");
    const body = c.req.valid("json");

    // Check if guide exists
    const [existingGuide] = await db
      .select()
      .from(guides)
      .where(eq(guides.id, guideId))
      .limit(1);

    if (!existingGuide) {
      return c.json(
        {
          success: false,
          error: "Guide not found",
        },
        404
      );
    }

    // If email is being updated, check if new email is already taken
    if (body.email && body.email.toLowerCase() !== existingGuide.email) {
      const emailExists = await db
        .select({ id: guides.id })
        .from(guides)
        .where(eq(guides.email, body.email.toLowerCase()))
        .limit(1);

      if (emailExists.length > 0) {
        return c.json(
          {
            success: false,
            error: "A guide with this email already exists",
          },
          409
        );
      }
    }

    // Build update object with only provided fields
    const updateData: Partial<typeof existingGuide> = {};

    if (body.name !== undefined) {
      updateData.name = body.name.trim();
    }
    if (body.email !== undefined) {
      updateData.email = body.email.toLowerCase().trim();
    }
    if (body.phone !== undefined) {
      updateData.phone = body.phone?.trim() || null;
    }
    if (body.bio !== undefined) {
      updateData.bio = body.bio?.trim() || null;
    }
    if (body.specialties !== undefined) {
      updateData.specialties = body.specialties?.trim() || null;
    }
    if (body.imageUrl !== undefined) {
      updateData.imageUrl = body.imageUrl?.trim() || null;
    }
    if (body.isActive !== undefined) {
      updateData.isActive = body.isActive;
    }

    // Update guide
    const [updatedGuide] = await db
      .update(guides)
      .set(updateData)
      .where(eq(guides.id, guideId))
      .returning();

    return c.json({
      success: true,
      message: "Guide updated successfully",
      data: updatedGuide,
    });
  } catch (error) {
    console.error("Error updating guide:", error);
    return c.json(
      {
        success: false,
        error: "Failed to update guide",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * PATCH /api/guides/:id/deactivate
 * Deactivate a guide (Admin only)
 * 
 * Path Parameters:
 * - id: Guide ID
 * 
 * This sets the guide's is_active flag to false while preserving:
 * - Historical booking assignments
 * - Guide profile information
 * - Review history
 * 
 * Deactivated guides:
 * - Will not appear in active guide listings (when filtered by is_active=true)
 * - Cannot be assigned to new bookings
 * - Maintain all historical data for reporting and auditing
 * 
 * Requires: Admin authentication
 * 
 * Returns: Updated guide object with is_active set to false
 */
app.patch("/:id/deactivate", requireAdmin, async (c) => {
  try {
    const guideId = c.req.param("id");

    // Check if guide exists
    const [existingGuide] = await db
      .select()
      .from(guides)
      .where(eq(guides.id, guideId))
      .limit(1);

    if (!existingGuide) {
      return c.json(
        {
          success: false,
          error: "Guide not found",
        },
        404
      );
    }

    // Check if guide is already inactive
    if (!existingGuide.isActive) {
      return c.json(
        {
          success: true,
          message: "Guide is already deactivated",
          data: existingGuide,
        },
        200
      );
    }

    // Deactivate the guide
    const [deactivatedGuide] = await db
      .update(guides)
      .set({ isActive: false })
      .where(eq(guides.id, guideId))
      .returning();

    return c.json({
      success: true,
      message: "Guide deactivated successfully",
      data: deactivatedGuide,
    });
  } catch (error) {
    console.error("Error deactivating guide:", error);
    return c.json(
      {
        success: false,
        error: "Failed to deactivate guide",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default app;
