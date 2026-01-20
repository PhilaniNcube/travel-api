import { Hono } from "hono";
import { db } from "../db/db";
import { packages, packagesToActivities, packageMedia, activities } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/auth";
import { nanoid } from "nanoid";
import { zValidator } from "@hono/zod-validator";
import { createPackageSchema, updatePackageSchema, createPackageMediaSchema, addActivityToPackageSchema } from "./packages.validation";

const app = new Hono();

/**
 * GET /api/packages
 * Fetch paginated list of packages with activity count
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
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

    // Fetch packages with activity count
    const packagesData = await db
      .select({
        id: packages.id,
        name: packages.name,
        description: packages.description,
        imageUrl: packages.imageUrl,
        isCustom: packages.isCustom,
        basePrice: packages.basePrice,
        createdAt: packages.createdAt,
        updatedAt: packages.updatedAt,
        activityCount: sql<number>`count(DISTINCT ${packagesToActivities.activityId})::int`,
      })
      .from(packages)
      .leftJoin(packagesToActivities, eq(packages.id, packagesToActivities.packageId))
      .groupBy(packages.id)
      .limit(limit)
      .offset(offset)
      .orderBy(packages.createdAt);

    // Get total count for pagination metadata
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(packages);

    const totalPages = Math.ceil(count / limit);

    return c.json({
      success: true,
      data: packagesData,
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
    console.error("Error fetching packages:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch packages",
      },
      500
    );
  }
});

/**
 * GET /api/packages/:id
 * Fetch a single package by ID with all associated activities and media
 */
app.get("/:id", async (c) => {
  try {
    const packageId = c.req.param("id");

    // Fetch package details
    const [packageData] = await db
      .select()
      .from(packages)
      .where(eq(packages.id, packageId));

    if (!packageData) {
      return c.json(
        {
          success: false,
          error: "Package not found",
        },
        404
      );
    }

    // Fetch associated activities
    const packageActivities = await db
      .select({
        id: activities.id,
        name: activities.name,
        description: activities.description,
        imageUrl: activities.imageUrl,
        location: activities.location,
        durationMinutes: activities.durationMinutes,
        price: activities.price,
        createdAt: activities.createdAt,
        updatedAt: activities.updatedAt,
      })
      .from(packagesToActivities)
      .innerJoin(activities, eq(packagesToActivities.activityId, activities.id))
      .where(eq(packagesToActivities.packageId, packageId));

    // Fetch package media
    const media = await db
      .select()
      .from(packageMedia)
      .where(eq(packageMedia.packageId, packageId))
      .orderBy(packageMedia.displayOrder);

    return c.json({
      success: true,
      data: {
        ...packageData,
        activities: packageActivities,
        media,
      },
    });
  } catch (error) {
    console.error("Error fetching package:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch package",
      },
      500
    );
  }
});

/**
 * GET /api/packages/:id/activities
 * Fetch all activities for a package
 */
app.get("/:id/activities", async (c) => {
  try {
    const packageId = c.req.param("id");

    // Verify package exists
    const [packageExists] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.id, packageId));

    if (!packageExists) {
      return c.json(
        {
          success: false,
          error: "Package not found",
        },
        404
      );
    }

    // Fetch activities
    const packageActivities = await db
      .select({
        id: activities.id,
        name: activities.name,
        description: activities.description,
        imageUrl: activities.imageUrl,
        location: activities.location,
        durationMinutes: activities.durationMinutes,
        price: activities.price,
        createdAt: activities.createdAt,
        updatedAt: activities.updatedAt,
      })
      .from(packagesToActivities)
      .innerJoin(activities, eq(packagesToActivities.activityId, activities.id))
      .where(eq(packagesToActivities.packageId, packageId));

    return c.json({
      success: true,
      data: packageActivities,
    });
  } catch (error) {
    console.error("Error fetching package activities:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch package activities",
      },
      500
    );
  }
});

/**
 * GET /api/packages/:id/media
 * Fetch all media for a package
 */
app.get("/:id/media", async (c) => {
  try {
    const packageId = c.req.param("id");

    // Verify package exists
    const [packageExists] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.id, packageId));

    if (!packageExists) {
      return c.json(
        {
          success: false,
          error: "Package not found",
        },
        404
      );
    }

    // Fetch media
    const media = await db
      .select()
      .from(packageMedia)
      .where(eq(packageMedia.packageId, packageId))
      .orderBy(packageMedia.displayOrder);

    return c.json({
      success: true,
      data: media,
    });
  } catch (error) {
    console.error("Error fetching package media:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch package media",
      },
      500
    );
  }
});

/**
 * POST /api/packages
 * Create a new package (Admin only)
 */
app.post("/", requireAdmin, zValidator("json", createPackageSchema), async (c) => {
  try {
    const body = c.req.valid("json");

    const packageId = nanoid();

    const [newPackage] = await db
      .insert(packages)
      .values({
        id: packageId,
        name: body.name,
        description: body.description,
        imageUrl: body.imageUrl,
        isCustom: body.isCustom,
        basePrice: body.basePrice?.toString(),
      })
      .returning();

    return c.json(
      {
        success: true,
        data: newPackage,
      },
      201
    );
  } catch (error) {
    console.error("Error creating package:", error);
    return c.json(
      {
        success: false,
        error: "Failed to create package",
      },
      500
    );
  }
});

/**
 * PATCH /api/packages/:id
 * Update a package (Admin only)
 */
app.patch("/:id", requireAdmin, zValidator("json", updatePackageSchema), async (c) => {
  try {
    const packageId = c.req.param("id");
    const body = c.req.valid("json");

    // Check if package exists
    const [existingPackage] = await db
      .select()
      .from(packages)
      .where(eq(packages.id, packageId));

    if (!existingPackage) {
      return c.json(
        {
          success: false,
          error: "Package not found",
        },
        404
      );
    }

    // Build update object
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl;
    if (body.isCustom !== undefined) updateData.isCustom = body.isCustom;
    if (body.basePrice !== undefined) updateData.basePrice = body.basePrice?.toString();

    const [updatedPackage] = await db
      .update(packages)
      .set(updateData)
      .where(eq(packages.id, packageId))
      .returning();

    return c.json({
      success: true,
      data: updatedPackage,
    });
  } catch (error) {
    console.error("Error updating package:", error);
    return c.json(
      {
        success: false,
        error: "Failed to update package",
      },
      500
    );
  }
});

/**
 * DELETE /api/packages/:id
 * Delete a package (Admin only)
 * Note: This will set package_id to NULL in existing bookings due to CASCADE
 */
app.delete("/:id", requireAdmin, async (c) => {
  try {
    const packageId = c.req.param("id");

    // Check if package exists
    const [existingPackage] = await db
      .select()
      .from(packages)
      .where(eq(packages.id, packageId));

    if (!existingPackage) {
      return c.json(
        {
          success: false,
          error: "Package not found",
        },
        404
      );
    }

    // Delete the package (CASCADE will handle related records)
    await db.delete(packages).where(eq(packages.id, packageId));

    return c.json({
      success: true,
      message: "Package deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting package:", error);
    return c.json(
      {
        success: false,
        error: "Failed to delete package",
      },
      500
    );
  }
});

/**
 * POST /api/packages/:id/activities
 * Add an activity to a package (Admin only)
 */
app.post("/:id/activities", requireAdmin, zValidator("json", addActivityToPackageSchema), async (c) => {
  try {
    const packageId = c.req.param("id");
    const body = c.req.valid("json");

    // Verify package exists
    const [packageExists] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.id, packageId));

    if (!packageExists) {
      return c.json(
        {
          success: false,
          error: "Package not found",
        },
        404
      );
    }

    // Verify activity exists
    const [activityExists] = await db
      .select({ id: activities.id })
      .from(activities)
      .where(eq(activities.id, body.activityId));

    if (!activityExists) {
      return c.json(
        {
          success: false,
          error: "Activity not found",
        },
        404
      );
    }

    // Check if activity is already in package
    const [existingLink] = await db
      .select()
      .from(packagesToActivities)
      .where(
        sql`${packagesToActivities.packageId} = ${packageId} AND ${packagesToActivities.activityId} = ${body.activityId}`
      );

    if (existingLink) {
      return c.json(
        {
          success: false,
          error: "Activity is already in this package",
        },
        400
      );
    }

    // Add activity to package
    await db.insert(packagesToActivities).values({
      packageId,
      activityId: body.activityId,
    });

    return c.json(
      {
        success: true,
        message: "Activity added to package successfully",
      },
      201
    );
  } catch (error) {
    console.error("Error adding activity to package:", error);
    return c.json(
      {
        success: false,
        error: "Failed to add activity to package",
      },
      500
    );
  }
});

/**
 * DELETE /api/packages/:id/activities/:activityId
 * Remove an activity from a package (Admin only)
 */
app.delete("/:id/activities/:activityId", requireAdmin, async (c) => {
  try {
    const packageId = c.req.param("id");
    const activityId = c.req.param("activityId");

    // Check if link exists
    const [existingLink] = await db
      .select()
      .from(packagesToActivities)
      .where(
        sql`${packagesToActivities.packageId} = ${packageId} AND ${packagesToActivities.activityId} = ${activityId}`
      );

    if (!existingLink) {
      return c.json(
        {
          success: false,
          error: "Activity is not in this package",
        },
        404
      );
    }

    // Remove activity from package
    await db
      .delete(packagesToActivities)
      .where(
        sql`${packagesToActivities.packageId} = ${packageId} AND ${packagesToActivities.activityId} = ${activityId}`
      );

    return c.json({
      success: true,
      message: "Activity removed from package successfully",
    });
  } catch (error) {
    console.error("Error removing activity from package:", error);
    return c.json(
      {
        success: false,
        error: "Failed to remove activity from package",
      },
      500
    );
  }
});

/**
 * POST /api/packages/:id/media
 * Upload media for a package (Admin only)
 */
app.post("/:id/media", requireAdmin, zValidator("json", createPackageMediaSchema), async (c) => {
  try {
    const packageId = c.req.param("id");
    const body = c.req.valid("json");

    // Verify package exists
    const [packageExists] = await db
      .select({ id: packages.id })
      .from(packages)
      .where(eq(packages.id, packageId));

    if (!packageExists) {
      return c.json(
        {
          success: false,
          error: "Package not found",
        },
        404
      );
    }

    // Insert media records
    const mediaRecords = body.media.map((item, index) => ({
      id: nanoid(),
      packageId,
      mediaUrl: item.mediaUrl,
      mediaType: item.mediaType,
      altText: item.altText,
      displayOrder: item.displayOrder ?? index,
    }));

    const insertedMedia = await db
      .insert(packageMedia)
      .values(mediaRecords)
      .returning();

    return c.json(
      {
        success: true,
        data: insertedMedia,
      },
      201
    );
  } catch (error) {
    console.error("Error uploading package media:", error);
    return c.json(
      {
        success: false,
        error: "Failed to upload package media",
      },
      500
    );
  }
});

/**
 * DELETE /api/packages/:id/media/:mediaId
 * Delete a media item from a package (Admin only)
 */
app.delete("/:id/media/:mediaId", requireAdmin, async (c) => {
  try {
    const packageId = c.req.param("id");
    const mediaId = c.req.param("mediaId");

    // Check if media exists and belongs to this package
    const [existingMedia] = await db
      .select()
      .from(packageMedia)
      .where(
        sql`${packageMedia.id} = ${mediaId} AND ${packageMedia.packageId} = ${packageId}`
      );

    if (!existingMedia) {
      return c.json(
        {
          success: false,
          error: "Media not found or does not belong to this package",
        },
        404
      );
    }

    // Delete media
    await db.delete(packageMedia).where(eq(packageMedia.id, mediaId));

    return c.json({
      success: true,
      message: "Media deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting package media:", error);
    return c.json(
      {
        success: false,
        error: "Failed to delete package media",
      },
      500
    );
  }
});

export default app;
