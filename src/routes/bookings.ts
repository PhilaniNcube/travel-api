import { Hono } from "hono";
import { db } from "../db/db";
import { bookings, packages, bookingActivities, activities, payments, guides, packagesToActivities } from "../db/schema";
import { and, eq, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin, isUserAdmin } from "../lib/auth";
import type { User } from "better-auth";
import { nanoid } from "nanoid";
import { 
  createBookingSchema, 
  updateBookingSchema, 
  addActivityToBookingSchema,
  updateBookingActivitySchema,
  assignGuideSchema,
  getBookingParamsSchema
} from "./bookings.validation";

type Variables = {
  user: User;
};

const app = new Hono<{ Variables: Variables }>();

/**
 * GET /api/bookings
 * List all bookings for the authenticated user
 * 
 * Query Parameters:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 10, max: 100)
 * - status: Filter by booking status (pending, confirmed, cancelled, completed)
 */
app.get("/", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Parse query parameters
    const page = Math.max(1, Number.parseInt(c.req.query("page") || "1"));
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(c.req.query("limit") || "10"))
    );
    const status = c.req.query("status");

    // Build filter conditions
    const conditions = [eq(bookings.userId, user.id)];

    // Status filter
    if (status) {
      const validStatuses = ["pending", "confirmed", "cancelled", "completed"] as const;
      if (validStatuses.includes(status as any)) {
        conditions.push(eq(bookings.status, status as "pending" | "confirmed" | "cancelled" | "completed"));
      } else {
        return c.json({
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        }, 400);
      }
    }

    // Build where clause
    const whereClause = and(...conditions);

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Fetch bookings with package information
    const bookingsData = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        packageId: bookings.packageId,
        packageName: packages.name,
        status: bookings.status,
        totalPrice: bookings.totalPrice,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        specialRequests: bookings.specialRequests,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .leftJoin(packages, eq(bookings.packageId, packages.id))
      .where(whereClause)
      .limit(limit)
      .offset(offset)
      .orderBy(bookings.createdAt);

    // Get total count for pagination metadata
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bookings)
      .where(whereClause);

    const totalPages = Math.ceil(count / limit);

    // For each booking, get the activity count
    const bookingsWithDetails = await Promise.all(
      bookingsData.map(async (booking) => {
        const [activityCountResult] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(bookingActivities)
          .where(eq(bookingActivities.bookingId, booking.id));

        return {
          ...booking,
          activityCount: activityCountResult.count,
        };
      })
    );

    return c.json({
      success: true,
      data: bookingsWithDetails,
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
    console.error("Error fetching bookings:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch bookings",
      },
      500
    );
  }
});

/**
 * GET /api/bookings/:id
 * Get detailed booking information by ID
 * 
 * Returns:
 * - Booking details
 * - All booking activities with activity information and guide assignments
 * - Payment status and total paid
 * 
 * Access Control:
 * - User must own the booking OR be an admin
 */
app.get("/:id", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;
    const bookingId = c.req.param('id');

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Check if user is an admin
    const isAdmin = await isUserAdmin(user.id);

    // Fetch the booking with package information
    const [booking] = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        packageId: bookings.packageId,
        packageName: packages.name,
        packageDescription: packages.description,
        packageBasePrice: packages.basePrice,
        status: bookings.status,
        totalPrice: bookings.totalPrice,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        specialRequests: bookings.specialRequests,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .leftJoin(packages, eq(bookings.packageId, packages.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    // Check if booking exists
    if (!booking) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    // Verify user owns the booking or is admin
    if (booking.userId !== user.id && !isAdmin) {
      return c.json({
        success: false,
        error: "Forbidden - You do not have access to this booking",
      }, 403);
    }

    // Fetch all booking activities with details
    const bookingActivitiesData = await db
      .select({
        id: bookingActivities.id,
        bookingId: bookingActivities.bookingId,
        activityId: bookingActivities.activityId,
        activityName: activities.name,
        activityDescription: activities.description,
        activityLocation: activities.location,
        activityDuration: activities.durationMinutes,
        activityImageUrl: activities.imageUrl,
        priceAtBooking: bookingActivities.priceAtBooking,
        scheduledAt: bookingActivities.scheduledAt,
        guideId: bookingActivities.guideId,
        guideName: guides.name,
        guideEmail: guides.email,
        guidePhone: guides.phone,
        guideImageUrl: guides.imageUrl,
      })
      .from(bookingActivities)
      .leftJoin(activities, eq(bookingActivities.activityId, activities.id))
      .leftJoin(guides, eq(bookingActivities.guideId, guides.id))
      .where(eq(bookingActivities.bookingId, bookingId))
      .orderBy(bookingActivities.scheduledAt);

    // Fetch all payments for this booking
    const paymentsData = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        currency: payments.currency,
        paymentMethod: payments.paymentMethod,
        paymentStatus: payments.paymentStatus,
        transactionId: payments.transactionId,
        paymentProvider: payments.paymentProvider,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(payments.createdAt);

    // Calculate total paid from completed payments
    const totalPaid = paymentsData
      .filter((payment) => payment.paymentStatus === "completed")
      .reduce((sum, payment) => sum + Number(payment.amount), 0);

    // Determine overall payment status
    const hasFailedPayment = paymentsData.some((p) => p.paymentStatus === "failed");
    const hasPendingPayment = paymentsData.some((p) => p.paymentStatus === "pending" || p.paymentStatus === "processing");
    const hasRefundedPayment = paymentsData.some((p) => p.paymentStatus === "refunded" || p.paymentStatus === "partially_refunded");
    
    let paymentStatus: string;
    if (totalPaid >= Number(booking.totalPrice)) {
      paymentStatus = hasRefundedPayment ? "refunded" : "paid";
    } else if (totalPaid > 0) {
      paymentStatus = "partially_paid";
    } else if (hasPendingPayment) {
      paymentStatus = "pending";
    } else if (hasFailedPayment) {
      paymentStatus = "failed";
    } else {
      paymentStatus = "unpaid";
    }

    // Format the response
    const response = {
      success: true,
      data: {
        booking: {
          id: booking.id,
          userId: booking.userId,
          status: booking.status,
          totalPrice: booking.totalPrice,
          startDate: booking.startDate,
          endDate: booking.endDate,
          specialRequests: booking.specialRequests,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt,
          package: booking.packageId ? {
            id: booking.packageId,
            name: booking.packageName,
            description: booking.packageDescription,
            basePrice: booking.packageBasePrice,
          } : null,
        },
        activities: bookingActivitiesData.map((ba) => ({
          id: ba.id,
          activity: {
            id: ba.activityId,
            name: ba.activityName,
            description: ba.activityDescription,
            location: ba.activityLocation,
            durationMinutes: ba.activityDuration,
            imageUrl: ba.activityImageUrl,
          },
          priceAtBooking: ba.priceAtBooking,
          scheduledAt: ba.scheduledAt,
          guide: ba.guideId ? {
            id: ba.guideId,
            name: ba.guideName,
            email: ba.guideEmail,
            phone: ba.guidePhone,
            imageUrl: ba.guideImageUrl,
          } : null,
        })),
        payments: {
          status: paymentStatus,
          totalPrice: booking.totalPrice,
          totalPaid: totalPaid.toFixed(2),
          balance: (Number(booking.totalPrice) - totalPaid).toFixed(2),
          transactions: paymentsData,
        },
      },
    };

    return c.json(response);
  } catch (error) {
    console.error("Error fetching booking:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch booking",
      },
      500
    );
  }
});

/**
 * GET /api/bookings/:id/activities
 * Get all activities for a specific booking
 * 
 * Returns:
 * - All booking activities with details
 * - Guide assignments
 * - Scheduled times
 * - Price at booking (snapshot)
 * 
 * Access Control:
 * - User must own the booking OR be an admin
 */
app.get("/:id/activities", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;
    const bookingId = c.req.param('id');

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Check if user is an admin
    const isAdmin = await isUserAdmin(user.id);

    // First, check if booking exists and verify ownership
    const [booking] = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    // Check if booking exists
    if (!booking) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    // Verify user owns the booking or is admin
    if (booking.userId !== user.id && !isAdmin) {
      return c.json({
        success: false,
        error: "Forbidden - You do not have access to this booking",
      }, 403);
    }

    // Fetch all booking activities with full details
    const bookingActivitiesData = await db
      .select({
        id: bookingActivities.id,
        bookingId: bookingActivities.bookingId,
        activityId: bookingActivities.activityId,
        activityName: activities.name,
        activityDescription: activities.description,
        activityLocation: activities.location,
        activityDuration: activities.durationMinutes,
        activityImageUrl: activities.imageUrl,
        activityCurrentPrice: activities.price, // Current catalog price for reference
        priceAtBooking: bookingActivities.priceAtBooking,
        scheduledAt: bookingActivities.scheduledAt,
        guideId: bookingActivities.guideId,
        guideName: guides.name,
        guideEmail: guides.email,
        guidePhone: guides.phone,
        guideBio: guides.bio,
        guideSpecialties: guides.specialties,
        guideImageUrl: guides.imageUrl,
        guideIsActive: guides.isActive,
      })
      .from(bookingActivities)
      .leftJoin(activities, eq(bookingActivities.activityId, activities.id))
      .leftJoin(guides, eq(bookingActivities.guideId, guides.id))
      .where(eq(bookingActivities.bookingId, bookingId))
      .orderBy(bookingActivities.scheduledAt);

    // Format the response
    const response = {
      success: true,
      data: {
        bookingId: bookingId,
        activityCount: bookingActivitiesData.length,
        activities: bookingActivitiesData.map((ba) => ({
          id: ba.id,
          activity: {
            id: ba.activityId,
            name: ba.activityName,
            description: ba.activityDescription,
            location: ba.activityLocation,
            durationMinutes: ba.activityDuration,
            imageUrl: ba.activityImageUrl,
            currentPrice: ba.activityCurrentPrice, // For reference/comparison
          },
          priceAtBooking: ba.priceAtBooking, // Historical snapshot
          scheduledAt: ba.scheduledAt,
          guide: ba.guideId ? {
            id: ba.guideId,
            name: ba.guideName,
            email: ba.guideEmail,
            phone: ba.guidePhone,
            bio: ba.guideBio,
            specialties: ba.guideSpecialties,
            imageUrl: ba.guideImageUrl,
            isActive: ba.guideIsActive,
          } : null,
        })),
      },
    };

    return c.json(response);
  } catch (error) {
    console.error("Error fetching booking activities:", error);
    return c.json(
      {
        success: false,
        error: "Failed to fetch booking activities",
      },
      500
    );
  }
});

/**
 * POST /api/bookings
 * Create a new booking (package or custom)
 * 
 * Body Parameters:
 * - packageId: Optional package ID for package-based bookings
 * - activityIds: Array of activity IDs to include in the booking
 * - startDate: Start date of the booking (ISO 8601)
 * - endDate: End date of the booking (ISO 8601)
 * - specialRequests: Optional special requests
 * - scheduledTimes: Optional map of activityId to scheduled time (ISO 8601)
 * 
 * Creates:
 * - Booking record with calculated total price
 * - booking_activity records with snapshotted prices
 * 
 * Requires user authentication
 */
app.post("/", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Parse and validate request body
    const body = await c.req.json();
    const validation = createBookingSchema.safeParse(body);

    if (!validation.success) {
      return c.json({
        success: false,
        error: "Validation failed",
        details: validation.error.format(),
      }, 400);
    }

    const { packageId, activityIds, startDate, endDate, specialRequests, scheduledTimes } = validation.data;

    // If packageId is provided, verify it exists
    let packageData = null;
    if (packageId) {
      const [pkg] = await db
        .select()
        .from(packages)
        .where(eq(packages.id, packageId))
        .limit(1);

      if (!pkg) {
        return c.json({
          success: false,
          error: "Package not found",
        }, 404);
      }

      packageData = pkg;
    }

    // Fetch all activities with their current prices
    const activitiesData = await db
      .select()
      .from(activities)
      .where(inArray(activities.id, activityIds));

    // Verify all activities exist
    if (activitiesData.length !== activityIds.length) {
      return c.json({
        success: false,
        error: "One or more activities not found",
      }, 404);
    }

    // If package is specified, verify activities are part of the package
    if (packageId) {
      const packageActivities = await db
        .select({ activityId: packagesToActivities.activityId })
        .from(packagesToActivities)
        .where(eq(packagesToActivities.packageId, packageId));

      const packageActivityIds = packageActivities.map(pa => pa.activityId);
      
      // Check if all requested activities are in the package
      const invalidActivities = activityIds.filter(id => !packageActivityIds.includes(id));
      
      if (invalidActivities.length > 0) {
        return c.json({
          success: false,
          error: `Activities ${invalidActivities.join(", ")} are not part of this package`,
        }, 400);
      }
    }

    // Calculate total price from activity prices (snapshot)
    const totalPrice = activitiesData.reduce((sum, activity) => {
      return sum + Number(activity.price);
    }, 0);

    // Begin transaction - create booking and booking activities
    const bookingId = nanoid();

    // Create booking record
    await db.insert(bookings).values({
      id: bookingId,
      userId: user.id,
      packageId: packageId || null,
      status: "pending",
      totalPrice: totalPrice.toFixed(2),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      specialRequests: specialRequests || null,
    });

    // Create booking_activity records with price snapshots
    const bookingActivitiesData = activitiesData.map(activity => ({
      id: nanoid(),
      bookingId: bookingId,
      activityId: activity.id,
      priceAtBooking: activity.price, // Snapshot the current price
      scheduledAt: scheduledTimes?.[activity.id] ? new Date(scheduledTimes[activity.id]) : null,
      guideId: null,
    }));

    await db.insert(bookingActivities).values(bookingActivitiesData);

    // Fetch the created booking with details
    const [createdBooking] = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        packageId: bookings.packageId,
        packageName: packages.name,
        status: bookings.status,
        totalPrice: bookings.totalPrice,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        specialRequests: bookings.specialRequests,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .leftJoin(packages, eq(bookings.packageId, packages.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    return c.json({
      success: true,
      message: "Booking created successfully",
      data: {
        ...createdBooking,
        activityCount: bookingActivitiesData.length,
      },
    }, 201);
  } catch (error) {
    console.error("Error creating booking:", error);
    return c.json(
      {
        success: false,
        error: "Failed to create booking",
      },
      500
    );
  }
});

/**
 * PATCH /api/bookings/:id
 * Update booking details (dates, special requests, status)
 * 
 * Body Parameters:
 * - startDate: Optional new start date (ISO 8601)
 * - endDate: Optional new end date (ISO 8601)
 * - specialRequests: Optional updated special requests
 * - status: Optional booking status update
 * 
 * Note: Does not recalculate total_price (use add/remove activities for that)
 * Requires user authentication and ownership
 */
app.patch("/:id", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;
    const bookingId = c.req.param('id');

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Parse and validate request body
    const body = await c.req.json();
    const validation = updateBookingSchema.safeParse(body);

    if (!validation.success) {
      return c.json({
        success: false,
        error: "Validation failed",
        details: validation.error.format(),
      }, 400);
    }

    // Check if booking exists and verify ownership
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    // Verify user owns the booking
    if (booking.userId !== user.id) {
      return c.json({
        success: false,
        error: "Forbidden - You do not have access to this booking",
      }, 403);
    }

    // Don't allow updating cancelled bookings
    if (booking.status === "cancelled") {
      return c.json({
        success: false,
        error: "Cannot update a cancelled booking",
      }, 400);
    }

    // Build update object
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (validation.data.startDate) {
      updateData.startDate = new Date(validation.data.startDate);
    }
    if (validation.data.endDate) {
      updateData.endDate = new Date(validation.data.endDate);
    }
    if (validation.data.specialRequests !== undefined) {
      updateData.specialRequests = validation.data.specialRequests;
    }
    if (validation.data.status) {
      updateData.status = validation.data.status;
    }

    // Update the booking
    await db
      .update(bookings)
      .set(updateData)
      .where(eq(bookings.id, bookingId));

    // Fetch updated booking
    const [updatedBooking] = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        packageId: bookings.packageId,
        packageName: packages.name,
        status: bookings.status,
        totalPrice: bookings.totalPrice,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        specialRequests: bookings.specialRequests,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .leftJoin(packages, eq(bookings.packageId, packages.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    return c.json({
      success: true,
      message: "Booking updated successfully",
      data: updatedBooking,
    });
  } catch (error) {
    console.error("Error updating booking:", error);
    return c.json(
      {
        success: false,
        error: "Failed to update booking",
      },
      500
    );
  }
});

/**
 * PATCH /api/bookings/:id/cancel
 * Cancel a booking
 * 
 * Updates booking status to 'cancelled'
 * Note: Refund processing should be handled separately via payments API
 * 
 * Requires user authentication and ownership
 */
app.patch("/:id/cancel", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;
    const bookingId = c.req.param('id');

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Check if booking exists and verify ownership
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    // Verify user owns the booking
    if (booking.userId !== user.id) {
      return c.json({
        success: false,
        error: "Forbidden - You do not have access to this booking",
      }, 403);
    }

    // Check if already cancelled
    if (booking.status === "cancelled") {
      return c.json({
        success: false,
        error: "Booking is already cancelled",
      }, 400);
    }

    // Update status to cancelled
    await db
      .update(bookings)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));

    // Fetch updated booking
    const [cancelledBooking] = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        packageId: bookings.packageId,
        packageName: packages.name,
        status: bookings.status,
        totalPrice: bookings.totalPrice,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        specialRequests: bookings.specialRequests,
        createdAt: bookings.createdAt,
        updatedAt: bookings.updatedAt,
      })
      .from(bookings)
      .leftJoin(packages, eq(bookings.packageId, packages.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    return c.json({
      success: true,
      message: "Booking cancelled successfully. Refund processing may be initiated separately.",
      data: cancelledBooking,
    });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    return c.json(
      {
        success: false,
        error: "Failed to cancel booking",
      },
      500
    );
  }
});

/**
 * POST /api/bookings/:id/activities
 * Add a new activity to an existing booking
 * 
 * Body Parameters:
 * - activityId: ID of the activity to add
 * - scheduledAt: Optional scheduled time for the activity (ISO 8601)
 * 
 * Snapshots current activity price and updates booking total_price
 * Requires user authentication and ownership
 */
app.post("/:id/activities", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;
    const bookingId = c.req.param('id');

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Parse and validate request body
    const body = await c.req.json();
    const validation = addActivityToBookingSchema.safeParse(body);

    if (!validation.success) {
      return c.json({
        success: false,
        error: "Validation failed",
        details: validation.error.format(),
      }, 400);
    }

    const { activityId, scheduledAt } = validation.data;

    // Check if booking exists and verify ownership
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    // Verify user owns the booking
    if (booking.userId !== user.id) {
      return c.json({
        success: false,
        error: "Forbidden - You do not have access to this booking",
      }, 403);
    }

    // Don't allow adding activities to cancelled bookings
    if (booking.status === "cancelled") {
      return c.json({
        success: false,
        error: "Cannot add activities to a cancelled booking",
      }, 400);
    }

    // Fetch activity and verify it exists
    const [activity] = await db
      .select()
      .from(activities)
      .where(eq(activities.id, activityId))
      .limit(1);

    if (!activity) {
      return c.json({
        success: false,
        error: "Activity not found",
      }, 404);
    }

    // Check if activity is already in the booking
    const [existingActivity] = await db
      .select()
      .from(bookingActivities)
      .where(
        and(
          eq(bookingActivities.bookingId, bookingId),
          eq(bookingActivities.activityId, activityId)
        )
      )
      .limit(1);

    if (existingActivity) {
      return c.json({
        success: false,
        error: "Activity is already part of this booking",
      }, 400);
    }

    // Create new booking activity with price snapshot
    const bookingActivityId = nanoid();
    await db.insert(bookingActivities).values({
      id: bookingActivityId,
      bookingId: bookingId,
      activityId: activityId,
      priceAtBooking: activity.price, // Snapshot current price
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      guideId: null,
    });

    // Update booking total price
    const newTotalPrice = Number(booking.totalPrice) + Number(activity.price);
    await db
      .update(bookings)
      .set({
        totalPrice: newTotalPrice.toFixed(2),
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, bookingId));

    // Fetch the created booking activity with details
    const [createdActivity] = await db
      .select({
        id: bookingActivities.id,
        bookingId: bookingActivities.bookingId,
        activityId: bookingActivities.activityId,
        activityName: activities.name,
        activityDescription: activities.description,
        activityLocation: activities.location,
        activityDuration: activities.durationMinutes,
        activityImageUrl: activities.imageUrl,
        priceAtBooking: bookingActivities.priceAtBooking,
        scheduledAt: bookingActivities.scheduledAt,
      })
      .from(bookingActivities)
      .leftJoin(activities, eq(bookingActivities.activityId, activities.id))
      .where(eq(bookingActivities.id, bookingActivityId))
      .limit(1);

    return c.json({
      success: true,
      message: "Activity added to booking successfully",
      data: {
        bookingActivity: createdActivity,
        updatedTotalPrice: newTotalPrice.toFixed(2),
      },
    }, 201);
  } catch (error) {
    console.error("Error adding activity to booking:", error);
    return c.json(
      {
        success: false,
        error: "Failed to add activity to booking",
      },
      500
    );
  }
});

/**
 * PATCH /api/bookings/:id/activities/:activityId
 * Update a booking activity (scheduled time, etc.)
 * 
 * Body Parameters:
 * - scheduledAt: Optional new scheduled time (ISO 8601)
 * 
 * Requires user authentication and ownership
 */
app.patch("/:id/activities/:activityId", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;
    const bookingId = c.req.param('id');
    const activityId = c.req.param('activityId');

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Parse and validate request body
    const body = await c.req.json();
    const validation = updateBookingActivitySchema.safeParse(body);

    if (!validation.success) {
      return c.json({
        success: false,
        error: "Validation failed",
        details: validation.error.format(),
      }, 400);
    }

    // Check if booking exists and verify ownership
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    // Verify user owns the booking
    if (booking.userId !== user.id) {
      return c.json({
        success: false,
        error: "Forbidden - You do not have access to this booking",
      }, 403);
    }

    // Find the booking activity
    const [bookingActivity] = await db
      .select()
      .from(bookingActivities)
      .where(
        and(
          eq(bookingActivities.bookingId, bookingId),
          eq(bookingActivities.activityId, activityId)
        )
      )
      .limit(1);

    if (!bookingActivity) {
      return c.json({
        success: false,
        error: "Activity not found in this booking",
      }, 404);
    }

    // Build update object
    const updateData: any = {};

    if (validation.data.scheduledAt) {
      updateData.scheduledAt = new Date(validation.data.scheduledAt);
    }

    // Update the booking activity
    await db
      .update(bookingActivities)
      .set(updateData)
      .where(eq(bookingActivities.id, bookingActivity.id));

    // Fetch updated booking activity with details
    const [updatedActivity] = await db
      .select({
        id: bookingActivities.id,
        bookingId: bookingActivities.bookingId,
        activityId: bookingActivities.activityId,
        activityName: activities.name,
        activityDescription: activities.description,
        activityLocation: activities.location,
        activityDuration: activities.durationMinutes,
        activityImageUrl: activities.imageUrl,
        priceAtBooking: bookingActivities.priceAtBooking,
        scheduledAt: bookingActivities.scheduledAt,
        guideId: bookingActivities.guideId,
        guideName: guides.name,
      })
      .from(bookingActivities)
      .leftJoin(activities, eq(bookingActivities.activityId, activities.id))
      .leftJoin(guides, eq(bookingActivities.guideId, guides.id))
      .where(eq(bookingActivities.id, bookingActivity.id))
      .limit(1);

    return c.json({
      success: true,
      message: "Booking activity updated successfully",
      data: updatedActivity,
    });
  } catch (error) {
    console.error("Error updating booking activity:", error);
    return c.json(
      {
        success: false,
        error: "Failed to update booking activity",
      },
      500
    );
  }
});

/**
 * PATCH /api/bookings/:id/activities/:activityId/guide
 * Assign or reassign a guide to a booking activity
 * 
 * Body Parameters:
 * - guideId: ID of the guide to assign
 * 
 * Verifies guide exists and is active
 * Requires admin authentication
 */
app.patch("/:id/activities/:activityId/guide", requireAdmin, async (c) => {
  try {
    const bookingId = c.req.param('id');
    const activityId = c.req.param('activityId');

    // Parse and validate request body
    const body = await c.req.json();
    const validation = assignGuideSchema.safeParse(body);

    if (!validation.success) {
      return c.json({
        success: false,
        error: "Validation failed",
        details: validation.error.format(),
      }, 400);
    }

    const { guideId } = validation.data;

    // Check if booking exists
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    // Find the booking activity
    const [bookingActivity] = await db
      .select()
      .from(bookingActivities)
      .where(
        and(
          eq(bookingActivities.bookingId, bookingId),
          eq(bookingActivities.activityId, activityId)
        )
      )
      .limit(1);

    if (!bookingActivity) {
      return c.json({
        success: false,
        error: "Activity not found in this booking",
      }, 404);
    }

    // Verify guide exists and is active
    const [guide] = await db
      .select()
      .from(guides)
      .where(eq(guides.id, guideId))
      .limit(1);

    if (!guide) {
      return c.json({
        success: false,
        error: "Guide not found",
      }, 404);
    }

    if (!guide.isActive) {
      return c.json({
        success: false,
        error: "Guide is not active and cannot be assigned",
      }, 400);
    }

    // TODO: Check guide availability for the scheduled time
    // This would require implementing a guide availability check
    // For now, we'll just assign the guide

    // Assign the guide
    await db
      .update(bookingActivities)
      .set({
        guideId: guideId,
      })
      .where(eq(bookingActivities.id, bookingActivity.id));

    // Fetch updated booking activity with guide details
    const [updatedActivity] = await db
      .select({
        id: bookingActivities.id,
        bookingId: bookingActivities.bookingId,
        activityId: bookingActivities.activityId,
        activityName: activities.name,
        activityDescription: activities.description,
        activityLocation: activities.location,
        activityDuration: activities.durationMinutes,
        activityImageUrl: activities.imageUrl,
        priceAtBooking: bookingActivities.priceAtBooking,
        scheduledAt: bookingActivities.scheduledAt,
        guideId: bookingActivities.guideId,
        guideName: guides.name,
        guideEmail: guides.email,
        guidePhone: guides.phone,
        guideBio: guides.bio,
        guideImageUrl: guides.imageUrl,
      })
      .from(bookingActivities)
      .leftJoin(activities, eq(bookingActivities.activityId, activities.id))
      .leftJoin(guides, eq(bookingActivities.guideId, guides.id))
      .where(eq(bookingActivities.id, bookingActivity.id))
      .limit(1);

    return c.json({
      success: true,
      message: "Guide assigned successfully",
      data: updatedActivity,
    });
  } catch (error) {
    console.error("Error assigning guide:", error);
    return c.json(
      {
        success: false,
        error: "Failed to assign guide",
      },
      500
    );
  }
});

/**
 * GET /api/bookings/:id/payments
 * List all payments for a specific booking
 * 
 * Authorization:
 * - Only admins can access this endpoint
 * 
 * Returns:
 * - All payments for the booking
 * - Payment status and amounts
 * - Total paid vs booking total
 */
app.get("/:id/payments", requireAdmin, async (c) => {
  try {
    // Validate booking ID parameter
    const paramsValidation = getBookingParamsSchema.safeParse({
      id: c.req.param("id"),
    });

    if (!paramsValidation.success) {
      return c.json({
        success: false,
        error: "Invalid booking ID",
        details: paramsValidation.error.message,
      }, 400);
    }

    const { id: bookingId } = paramsValidation.data;

    // Fetch the booking to ensure it exists
    const bookingData = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        totalPrice: bookings.totalPrice,
        status: bookings.status,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    // Check if booking exists
    if (!bookingData || bookingData.length === 0) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    const booking = bookingData[0];

    // Fetch all payments for this booking
    const paymentsData = await db
      .select({
        id: payments.id,
        amount: payments.amount,
        currency: payments.currency,
        paymentMethod: payments.paymentMethod,
        paymentStatus: payments.paymentStatus,
        transactionId: payments.transactionId,
        paymentProvider: payments.paymentProvider,
        paymentIntentId: payments.paymentIntentId,
        metadata: payments.metadata,
        createdAt: payments.createdAt,
        updatedAt: payments.updatedAt,
      })
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(payments.createdAt);

    // Calculate total paid amount
    const totalPaid = paymentsData.reduce((sum, payment) => {
      // Only count successful payments
      if (payment.paymentStatus === "completed") {
        return sum + parseFloat(payment.amount);
      }
      return sum;
    }, 0);

    // Calculate remaining amount
    const bookingTotal = parseFloat(booking.totalPrice);
    const remainingAmount = bookingTotal - totalPaid;

    // Return payment details with summary
    return c.json({
      success: true,
      data: {
        booking: {
          id: booking.id,
          totalPrice: booking.totalPrice,
          status: booking.status,
          startDate: booking.startDate,
          endDate: booking.endDate,
        },
        payments: paymentsData.map(payment => ({
          id: payment.id,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.paymentMethod,
          paymentStatus: payment.paymentStatus,
          transactionId: payment.transactionId,
          paymentProvider: payment.paymentProvider,
          paymentIntentId: payment.paymentIntentId,
          metadata: payment.metadata ? JSON.parse(payment.metadata) : null,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        })),
        summary: {
          totalPaid: totalPaid.toFixed(2),
          bookingTotal: bookingTotal.toFixed(2),
          remainingAmount: remainingAmount.toFixed(2),
          currency: paymentsData[0]?.currency || "USD",
          paymentCount: paymentsData.length,
          completedPayments: paymentsData.filter(p => p.paymentStatus === "completed").length,
          pendingPayments: paymentsData.filter(p => p.paymentStatus === "pending").length,
          failedPayments: paymentsData.filter(p => p.paymentStatus === "failed").length,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching booking payments:", error);
    return c.json({
      success: false,
      error: "Internal server error while fetching booking payments",
    }, 500);
  }
});

export default app;
