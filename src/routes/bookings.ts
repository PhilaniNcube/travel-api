import { Hono } from "hono";
import { db } from "../db/db";
import { bookings, packages, bookingActivities, activities, payments, guides, adminUser } from "../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import type { User } from "better-auth";

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
    const admin = await db.query.adminUser.findFirst({
      where: eq(adminUser.userId, user.id),
    });

    const isAdmin = admin && admin.isActive;

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

export default app;
