import { Hono } from "hono";
import { db } from "../db/db";
import { activities, activityMedia } from "../db/schema";
import { and, eq, gte, lte, like, sql } from "drizzle-orm";

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

export default app;
