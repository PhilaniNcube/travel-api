import { Hono } from "hono";
import { db } from "../db/db";
import { payments, bookings } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth, isUserAdmin } from "../lib/auth";
import type { User } from "better-auth";
import { getPaymentParamsSchema, createPaymentSchema, updatePaymentStatusSchema, processRefundSchema } from "./payments.validation";
import { zValidator } from "@hono/zod-validator";
import { nanoid } from "nanoid";
import Stripe from "stripe";

type Variables = {
  user: User;
};

const app = new Hono<{ Variables: Variables }>();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2025-12-15.clover",
});

/**
 * POST /api/payments
 * Create a new payment for a booking
 * 
 * Authorization:
 * - User must own the booking
 * 
 * Body:
 * - bookingId: string - The booking to create payment for
 * - amount: number (optional) - Payment amount (defaults to booking total)
 * - currency: string - ISO 4217 currency code (default: USD)
 * - paymentMethod: enum - Payment method type
 * - paymentProvider: enum - Payment provider (default: stripe)
 * - metadata: object (optional) - Additional payment metadata
 * 
 * Returns:
 * - Payment record with Stripe PaymentIntent details
 * - Client secret for completing payment on frontend
 */
app.post("/", requireAuth, zValidator("json", createPaymentSchema), async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Get validated request body
    const body = c.req.valid("json");
    const { bookingId, amount, currency, paymentMethod, paymentProvider, metadata } = body;

    // Fetch the booking to verify ownership and get details
    const bookingData = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        totalPrice: bookings.totalPrice,
        status: bookings.status,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!bookingData || bookingData.length === 0) {
      return c.json({
        success: false,
        error: "Booking not found",
      }, 404);
    }

    const booking = bookingData[0];

    // Verify user owns the booking
    if (booking.userId !== user.id) {
      return c.json({
        success: false,
        error: "Forbidden - You do not have permission to create a payment for this booking",
      }, 403);
    }

    // Check if booking is cancelled
    if (booking.status === "cancelled") {
      return c.json({
        success: false,
        error: "Cannot create payment for a cancelled booking",
      }, 400);
    }

    // Determine payment amount (use booking total if not specified)
    const paymentAmount = amount ?? Number(booking.totalPrice);

    // Validate payment amount
    if (paymentAmount <= 0) {
      return c.json({
        success: false,
        error: "Payment amount must be greater than zero",
      }, 400);
    }

    // Check if amount exceeds booking total
    if (paymentAmount > Number(booking.totalPrice)) {
      return c.json({
        success: false,
        error: `Payment amount ($${paymentAmount}) cannot exceed booking total ($${booking.totalPrice})`,
      }, 400);
    }

    // Create PaymentIntent with Stripe (only for stripe provider)
    let paymentIntentId: string | null = null;
    let clientSecret: string | null = null;
    let stripePaymentIntent: Stripe.PaymentIntent | null = null;

    if (paymentProvider === "stripe") {
      try {
        // Convert amount to cents for Stripe
        const amountInCents = Math.round(paymentAmount * 100);

        // Create PaymentIntent
        stripePaymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: currency.toLowerCase(),
          payment_method_types: ["card"], // Can be extended based on paymentMethod
          metadata: {
            bookingId: bookingId,
            userId: user.id,
            ...metadata,
          },
          description: `Payment for booking ${bookingId}`,
        });

        paymentIntentId = stripePaymentIntent.id;
        clientSecret = stripePaymentIntent.client_secret;
      } catch (stripeError: any) {
        console.error("Stripe error:", stripeError);
        return c.json({
          success: false,
          error: "Failed to create payment intent with Stripe",
          details: stripeError.message,
        }, 500);
      }
    }

    // Create payment record in database
    const paymentId = nanoid();
    const paymentMetadata = {
      ...metadata,
      bookingStartDate: booking.startDate,
      bookingEndDate: booking.endDate,
    };

    await db.insert(payments).values({
      id: paymentId,
      bookingId: bookingId,
      amount: paymentAmount.toString(),
      currency: currency,
      paymentMethod: paymentMethod,
      paymentStatus: "pending",
      paymentProvider: paymentProvider,
      paymentIntentId: paymentIntentId,
      transactionId: null, // Will be updated when payment is confirmed
      metadata: JSON.stringify(paymentMetadata),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Return payment record with client secret for frontend
    return c.json({
      success: true,
      data: {
        payment: {
          id: paymentId,
          bookingId: bookingId,
          amount: paymentAmount,
          currency: currency,
          paymentMethod: paymentMethod,
          paymentStatus: "pending",
          paymentProvider: paymentProvider,
          paymentIntentId: paymentIntentId,
          createdAt: new Date(),
        },
        // Include client secret for Stripe payments (needed by frontend to complete payment)
        clientSecret: clientSecret,
        // For non-Stripe providers, include relevant session/intent data
        providerData: paymentProvider === "stripe" && stripePaymentIntent ? {
          id: stripePaymentIntent.id,
          status: stripePaymentIntent.status,
        } : null,
      },
      message: paymentProvider === "stripe" 
        ? "Payment intent created. Use the client secret to complete payment on the frontend."
        : `Payment initiated with ${paymentProvider}. Please follow the provider's payment flow.`,
    }, 201);

  } catch (error) {
    console.error("Error creating payment:", error);
    return c.json({
      success: false,
      error: "Internal server error while creating payment",
    }, 500);
  }
});

/**
 * GET /api/payments/:id
 * Get payment details by ID
 * 
 * Authorization:
 * - User must own the payment (via booking) OR be an admin
 * 
 * Returns:
 * - Payment details including associated booking information
 * - Payment status, amount, method, and provider details
 */
app.get("/:id", requireAuth, async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Validate payment ID parameter
    const paramsValidation = getPaymentParamsSchema.safeParse({
      id: c.req.param("id"),
    });

    if (!paramsValidation.success) {
      return c.json({
        success: false,
        error: "Invalid payment ID",
        details: paramsValidation.error.message,
      }, 400);
    }

    const { id: paymentId } = paramsValidation.data;

    // Check if user is an admin
    const isAdmin = await isUserAdmin(user.id);

    // Fetch payment with booking information
    const paymentData = await db
      .select({
        // Payment fields
        id: payments.id,
        bookingId: payments.bookingId,
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
        // Booking fields (for ownership verification)
        userId: bookings.userId,
        bookingStatus: bookings.status,
        bookingTotalPrice: bookings.totalPrice,
        bookingStartDate: bookings.startDate,
        bookingEndDate: bookings.endDate,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(eq(payments.id, paymentId))
      .limit(1);

    // Check if payment exists
    if (!paymentData || paymentData.length === 0) {
      return c.json({
        success: false,
        error: "Payment not found",
      }, 404);
    }

    const payment = paymentData[0];

    // Authorization check: Verify user owns the payment OR is an admin
    if (payment.userId !== user.id && !isAdmin) {
      return c.json({
        success: false,
        error: "Forbidden - You do not have permission to access this payment",
      }, 403);
    }

    // Return payment details
    return c.json({
      success: true,
      data: {
        id: payment.id,
        bookingId: payment.bookingId,
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
        booking: {
          id: payment.bookingId,
          status: payment.bookingStatus,
          totalPrice: payment.bookingTotalPrice,
          startDate: payment.bookingStartDate,
          endDate: payment.bookingEndDate,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching payment:", error);
    return c.json({
      success: false,
      error: "Internal server error while fetching payment",
    }, 500);
  }
});

/**
 * PATCH /api/payments/:id
 * Update payment status (Admin only)
 * 
 * Authorization:
 * - Admin only
 * 
 * Body:
 * - paymentStatus: enum - New payment status
 * - transactionId: string (optional) - Transaction ID from payment provider
 * - metadata: object (optional) - Additional metadata to merge
 * 
 * Business Logic:
 * - When payment status is set to "completed":
 *   - Update booking status to "confirmed" if it's "pending"
 * - When payment status is set to "failed":
 *   - Booking status remains unchanged (can retry payment)
 * - When payment status is set to "refunded":
 *   - Update booking status to "cancelled" if not already
 * 
 * Returns:
 * - Updated payment record
 * - Updated booking status if applicable
 */
app.patch("/:id", requireAuth, zValidator("json", updatePaymentStatusSchema), async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Check if user is an admin
    const isAdmin = await isUserAdmin(user.id);

    if (!isAdmin) {
      return c.json({
        success: false,
        error: "Forbidden - Only administrators can update payment status",
      }, 403);
    }

    // Validate payment ID parameter
    const paramsValidation = getPaymentParamsSchema.safeParse({
      id: c.req.param("id"),
    });

    if (!paramsValidation.success) {
      return c.json({
        success: false,
        error: "Invalid payment ID",
        details: paramsValidation.error.message,
      }, 400);
    }

    const { id: paymentId } = paramsValidation.data;
    const body = c.req.valid("json");
    const { paymentStatus, transactionId, metadata } = body;

    // Fetch current payment with booking information
    const paymentData = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
        currentStatus: payments.paymentStatus,
        currentMetadata: payments.metadata,
        bookingStatus: bookings.status,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!paymentData || paymentData.length === 0) {
      return c.json({
        success: false,
        error: "Payment not found",
      }, 404);
    }

    const payment = paymentData[0];

    // Prepare updated metadata (merge with existing)
    let updatedMetadata = payment.currentMetadata;
    if (metadata) {
      const existingMetadata = payment.currentMetadata 
        ? (typeof payment.currentMetadata === 'string' 
            ? JSON.parse(payment.currentMetadata) 
            : payment.currentMetadata)
        : {};
      updatedMetadata = JSON.stringify({
        ...existingMetadata,
        ...metadata,
        lastUpdatedBy: user.id,
        lastUpdatedAt: new Date().toISOString(),
      });
    }

    // Update payment status
    const updateData: any = {
      paymentStatus: paymentStatus,
      updatedAt: new Date(),
    };

    if (transactionId) {
      updateData.transactionId = transactionId;
    }

    if (updatedMetadata) {
      updateData.metadata = updatedMetadata;
    }

    await db
      .update(payments)
      .set(updateData)
      .where(eq(payments.id, paymentId));

    // Determine if booking status needs to be updated
    let newBookingStatus: string | null = null;
    let bookingUpdateMessage = "";

    if (paymentStatus === "completed" && payment.bookingStatus === "pending") {
      // Payment completed - confirm the booking
      newBookingStatus = "confirmed";
      await db
        .update(bookings)
        .set({
          status: "confirmed" as const,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, payment.bookingId));
      
      bookingUpdateMessage = "Booking status updated to confirmed.";
    } else if (paymentStatus === "refunded" && payment.bookingStatus !== "cancelled") {
      // Payment refunded - cancel the booking
      newBookingStatus = "cancelled";
      await db
        .update(bookings)
        .set({
          status: "cancelled" as const,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, payment.bookingId));
      
      bookingUpdateMessage = "Booking status updated to cancelled due to refund.";
    }

    // Fetch updated payment for response
    const updatedPaymentData = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
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
        bookingStatus: bookings.status,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(eq(payments.id, paymentId))
      .limit(1);

    const updatedPayment = updatedPaymentData[0];

    return c.json({
      success: true,
      data: {
        id: updatedPayment.id,
        bookingId: updatedPayment.bookingId,
        amount: updatedPayment.amount,
        currency: updatedPayment.currency,
        paymentMethod: updatedPayment.paymentMethod,
        paymentStatus: updatedPayment.paymentStatus,
        transactionId: updatedPayment.transactionId,
        paymentProvider: updatedPayment.paymentProvider,
        paymentIntentId: updatedPayment.paymentIntentId,
        metadata: updatedPayment.metadata ? JSON.parse(updatedPayment.metadata) : null,
        createdAt: updatedPayment.createdAt,
        updatedAt: updatedPayment.updatedAt,
        booking: {
          id: updatedPayment.bookingId,
          status: updatedPayment.bookingStatus,
          statusChanged: newBookingStatus !== null,
        },
      },
      message: bookingUpdateMessage 
        ? `Payment status updated to ${paymentStatus}. ${bookingUpdateMessage}`
        : `Payment status updated to ${paymentStatus}.`,
    });

  } catch (error) {
    console.error("Error updating payment status:", error);
    return c.json({
      success: false,
      error: "Internal server error while updating payment status",
    }, 500);
  }
});

/**
 * POST /api/payments/:id/refund
 * Process a full or partial refund for a payment
 * 
 * Authorization:
 * - Admin only
 * 
 * Body:
 * - amount: number (optional) - Refund amount (defaults to full payment amount)
 * - reason: string (optional) - Reason for refund
 * - metadata: object (optional) - Additional refund metadata
 * 
 * Returns:
 * - Updated payment record with refund details
 * - Refund transaction information from payment provider
 */
app.post("/:id/refund", requireAuth, zValidator("json", processRefundSchema), async (c) => {
  try {
    // Get authenticated user from context
    const user = c.get('user') as User;

    if (!user || !user.id) {
      return c.json({ 
        success: false, 
        error: "User not found in session" 
      }, 401);
    }

    // Check if user is an admin
    const isAdmin = await isUserAdmin(user.id);
    if (!isAdmin) {
      return c.json({
        success: false,
        error: "Forbidden - Admin access required to process refunds",
      }, 403);
    }

    // Validate payment ID parameter
    const paramsValidation = getPaymentParamsSchema.safeParse({
      id: c.req.param("id"),
    });

    if (!paramsValidation.success) {
      return c.json({
        success: false,
        error: "Invalid payment ID",
        details: paramsValidation.error.message,
      }, 400);
    }

    const { id: paymentId } = paramsValidation.data;

    // Get validated request body
    const body = c.req.valid("json");
    const { amount: refundAmount, reason, metadata } = body;

    // Fetch the payment details
    const paymentData = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
        amount: payments.amount,
        currency: payments.currency,
        paymentStatus: payments.paymentStatus,
        paymentProvider: payments.paymentProvider,
        paymentIntentId: payments.paymentIntentId,
        transactionId: payments.transactionId,
        metadata: payments.metadata,
        bookingStatus: bookings.status,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(eq(payments.id, paymentId))
      .limit(1);

    if (!paymentData || paymentData.length === 0) {
      return c.json({
        success: false,
        error: "Payment not found",
      }, 404);
    }

    const payment = paymentData[0];

    // Validate payment status - can only refund completed payments
    if (payment.paymentStatus !== "completed" && payment.paymentStatus !== "partially_refunded") {
      return c.json({
        success: false,
        error: `Cannot refund payment with status: ${payment.paymentStatus}. Only completed or partially refunded payments can be refunded.`,
      }, 400);
    }

    // Determine refund amount (use full payment amount if not specified)
    const paymentAmountNum = Number(payment.amount);
    const refundAmountNum = refundAmount ?? paymentAmountNum;

    // Validate refund amount
    if (refundAmountNum <= 0) {
      return c.json({
        success: false,
        error: "Refund amount must be greater than zero",
      }, 400);
    }

    if (refundAmountNum > paymentAmountNum) {
      return c.json({
        success: false,
        error: `Refund amount ($${refundAmountNum}) cannot exceed payment amount ($${paymentAmountNum})`,
      }, 400);
    }

    // Process refund with payment provider
    let refundId: string | null = null;
    let refundStatus: string = "succeeded";
    let providerRefundData: any = null;

    if (payment.paymentProvider === "stripe" && payment.paymentIntentId) {
      try {
        // Convert refund amount to cents for Stripe
        const refundAmountInCents = Math.round(refundAmountNum * 100);

        // Create refund with Stripe
        const refund = await stripe.refunds.create({
          payment_intent: payment.paymentIntentId,
          amount: refundAmountInCents,
          reason: reason ? "requested_by_customer" : undefined,
          metadata: {
            paymentId: payment.id,
            bookingId: payment.bookingId,
            refundReason: reason || "No reason provided",
            processedBy: user.id,
            ...metadata,
          },
        });

        refundId = refund.id;
        refundStatus = refund.status ?? "pending";
        providerRefundData = {
          id: refund.id,
          status: refund.status,
          amount: refund.amount / 100,
          currency: refund.currency,
          created: refund.created,
        };
      } catch (stripeError: any) {
        console.error("Stripe refund error:", stripeError);
        return c.json({
          success: false,
          error: "Failed to process refund with Stripe",
          details: stripeError.message,
        }, 500);
      }
    } else if (payment.paymentProvider !== "stripe") {
      // For non-Stripe providers, generate a refund ID
      // In production, you would integrate with the specific provider's API
      refundId = `refund_${nanoid()}`;
      console.log(`Manual refund required for ${payment.paymentProvider} provider: ${refundId}`);
    } else {
      return c.json({
        success: false,
        error: "Cannot process refund - payment intent ID not found",
      }, 400);
    }

    // Determine new payment status
    const isFullRefund = refundAmountNum >= paymentAmountNum;
    const newPaymentStatus = isFullRefund ? "refunded" : "partially_refunded";

    // Update payment metadata with refund information
    const existingMetadata = payment.metadata 
      ? (typeof payment.metadata === 'string' ? JSON.parse(payment.metadata) : payment.metadata)
      : {};

    const refunds = existingMetadata.refunds || [];
    refunds.push({
      refundId: refundId,
      amount: refundAmountNum,
      reason: reason || "No reason provided",
      processedBy: user.id,
      processedAt: new Date().toISOString(),
      status: refundStatus,
      ...metadata,
    });

    const updatedMetadata = JSON.stringify({
      ...existingMetadata,
      refunds: refunds,
      totalRefunded: refunds.reduce((sum: number, r: any) => sum + r.amount, 0),
      lastRefundDate: new Date().toISOString(),
    });

    // Update payment record
    await db
      .update(payments)
      .set({
        paymentStatus: newPaymentStatus,
        metadata: updatedMetadata,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, paymentId));

    // Update booking status to cancelled if full refund
    let bookingUpdateMessage = "";
    if (isFullRefund && payment.bookingStatus !== "cancelled") {
      await db
        .update(bookings)
        .set({
          status: "cancelled" as const,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, payment.bookingId));
      
      bookingUpdateMessage = " Booking has been cancelled due to full refund.";
    }

    // Fetch updated payment for response
    const updatedPaymentData = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
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
        bookingStatus: bookings.status,
      })
      .from(payments)
      .innerJoin(bookings, eq(payments.bookingId, bookings.id))
      .where(eq(payments.id, paymentId))
      .limit(1);

    const updatedPayment = updatedPaymentData[0];
    const parsedMetadata = updatedPayment.metadata ? JSON.parse(updatedPayment.metadata) : null;

    return c.json({
      success: true,
      data: {
        payment: {
          id: updatedPayment.id,
          bookingId: updatedPayment.bookingId,
          amount: updatedPayment.amount,
          currency: updatedPayment.currency,
          paymentMethod: updatedPayment.paymentMethod,
          paymentStatus: updatedPayment.paymentStatus,
          transactionId: updatedPayment.transactionId,
          paymentProvider: updatedPayment.paymentProvider,
          paymentIntentId: updatedPayment.paymentIntentId,
          metadata: parsedMetadata,
          createdAt: updatedPayment.createdAt,
          updatedAt: updatedPayment.updatedAt,
        },
        refund: {
          refundId: refundId,
          amount: refundAmountNum,
          currency: payment.currency,
          status: refundStatus,
          isFullRefund: isFullRefund,
          reason: reason || "No reason provided",
          providerData: providerRefundData,
        },
        booking: {
          id: updatedPayment.bookingId,
          status: updatedPayment.bookingStatus,
        },
      },
      message: `${isFullRefund ? "Full" : "Partial"} refund of $${refundAmountNum} processed successfully.${bookingUpdateMessage}`,
    }, 200);

  } catch (error) {
    console.error("Error processing refund:", error);
    return c.json({
      success: false,
      error: "Internal server error while processing refund",
    }, 500);
  }
});

/**
 * POST /api/webhooks/payment
 * Handle payment provider webhooks (Stripe, PayPal, etc.)
 * 
 * Authorization:
 * - No authentication required (webhook endpoint)
 * - Validates webhook signature for security
 * 
 * Body:
 * - Raw webhook event from payment provider
 * 
 * Handles:
 * - payment_intent.succeeded: Update payment and booking to completed
 * - payment_intent.payment_failed: Update payment to failed
 * - payment_intent.canceled: Update payment to cancelled
 * - charge.refunded: Update payment to refunded/partially_refunded
 * 
 * Returns:
 * - Success/error status
 */
app.post("/webhooks/payment", async (c) => {
  try {
    const signature = c.req.header("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!signature) {
      console.error("No Stripe signature found in webhook request");
      return c.json({
        success: false,
        error: "No signature provided",
      }, 400);
    }

    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET not configured");
      return c.json({
        success: false,
        error: "Webhook secret not configured",
      }, 500);
    }

    // Get raw body for signature verification
    const rawBody = await c.req.text();

    let event: Stripe.Event;

    try {
      // Verify webhook signature
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret
      );
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return c.json({
        success: false,
        error: "Invalid signature",
      }, 400);
    }

    console.log(`Received webhook event: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSuccess(paymentIntent);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentFailed(paymentIntent);
        break;
      }

      case "payment_intent.canceled": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentCanceled(paymentIntent);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        await handleRefund(charge);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // Return 200 to acknowledge receipt
    return c.json({
      success: true,
      message: "Webhook processed successfully",
    }, 200);

  } catch (error) {
    console.error("Error processing webhook:", error);
    return c.json({
      success: false,
      error: "Internal server error while processing webhook",
    }, 500);
  }
});

// Helper function to handle successful payment
async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  try {
    const paymentIntentId = paymentIntent.id;
    const transactionId = paymentIntent.latest_charge as string;

    console.log(`Processing successful payment: ${paymentIntentId}`);

    // Find the payment record by paymentIntentId
    const paymentData = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
        amount: payments.amount,
      })
      .from(payments)
      .where(eq(payments.paymentIntentId, paymentIntentId))
      .limit(1);

    if (!paymentData || paymentData.length === 0) {
      console.error(`Payment not found for PaymentIntent: ${paymentIntentId}`);
      return;
    }

    const payment = paymentData[0];

    // Update payment status to completed
    await db
      .update(payments)
      .set({
        paymentStatus: "completed",
        transactionId: transactionId,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    console.log(`Payment ${payment.id} marked as completed`);

    // Check if booking should be marked as confirmed
    // Get all payments for the booking
    const bookingPayments = await db
      .select({
        amount: payments.amount,
        paymentStatus: payments.paymentStatus,
      })
      .from(payments)
      .where(eq(payments.bookingId, payment.bookingId));

    // Calculate total paid amount
    const totalPaid = bookingPayments
      .filter(p => p.paymentStatus === "completed")
      .reduce((sum, p) => sum + Number(p.amount), 0);

    // Get booking total
    const bookingData = await db
      .select({
        totalPrice: bookings.totalPrice,
        status: bookings.status,
      })
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .limit(1);

    if (bookingData && bookingData.length > 0) {
      const booking = bookingData[0];
      const bookingTotal = Number(booking.totalPrice);

      // If total paid equals or exceeds booking total, mark booking as confirmed
      if (totalPaid >= bookingTotal && booking.status === "pending") {
        await db
          .update(bookings)
          .set({
            status: "confirmed",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, payment.bookingId));

        console.log(`Booking ${payment.bookingId} confirmed - fully paid`);
      }
    }

  } catch (error) {
    console.error("Error handling payment success:", error);
    throw error;
  }
}

// Helper function to handle failed payment
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  try {
    const paymentIntentId = paymentIntent.id;

    console.log(`Processing failed payment: ${paymentIntentId}`);

    // Find the payment record by paymentIntentId
    const paymentData = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
      })
      .from(payments)
      .where(eq(payments.paymentIntentId, paymentIntentId))
      .limit(1);

    if (!paymentData || paymentData.length === 0) {
      console.error(`Payment not found for PaymentIntent: ${paymentIntentId}`);
      return;
    }

    const payment = paymentData[0];

    // Update payment status to failed
    await db
      .update(payments)
      .set({
        paymentStatus: "failed",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    console.log(`Payment ${payment.id} marked as failed`);

    // Optionally: Send notification to user about failed payment

  } catch (error) {
    console.error("Error handling payment failure:", error);
    throw error;
  }
}

// Helper function to handle canceled payment
async function handlePaymentCanceled(paymentIntent: Stripe.PaymentIntent) {
  try {
    const paymentIntentId = paymentIntent.id;

    console.log(`Processing canceled payment: ${paymentIntentId}`);

    // Find the payment record by paymentIntentId
    const paymentData = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
      })
      .from(payments)
      .where(eq(payments.paymentIntentId, paymentIntentId))
      .limit(1);

    if (!paymentData || paymentData.length === 0) {
      console.error(`Payment not found for PaymentIntent: ${paymentIntentId}`);
      return;
    }

    const payment = paymentData[0];

    // Update payment status to failed (treating canceled as failed)
    await db
      .update(payments)
      .set({
        paymentStatus: "failed",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    console.log(`Payment ${payment.id} marked as failed (canceled)`);

  } catch (error) {
    console.error("Error handling payment cancellation:", error);
    throw error;
  }
}

// Helper function to handle refund
async function handleRefund(charge: Stripe.Charge) {
  try {
    const chargeId = charge.id;

    console.log(`Processing refund for charge: ${chargeId}`);

    // Find the payment record by transactionId (which is the charge ID)
    const paymentData = await db
      .select({
        id: payments.id,
        bookingId: payments.bookingId,
        amount: payments.amount,
      })
      .from(payments)
      .where(eq(payments.transactionId, chargeId))
      .limit(1);

    if (!paymentData || paymentData.length === 0) {
      console.error(`Payment not found for charge: ${chargeId}`);
      return;
    }

    const payment = paymentData[0];
    const paymentAmount = Number(payment.amount);
    const refundedAmount = charge.amount_refunded / 100; // Convert from cents

    // Determine if full or partial refund
    const isFullRefund = refundedAmount >= paymentAmount;

    // Update payment status
    await db
      .update(payments)
      .set({
        paymentStatus: isFullRefund ? "refunded" : "partially_refunded",
        updatedAt: new Date(),
      })
      .where(eq(payments.id, payment.id));

    console.log(`Payment ${payment.id} marked as ${isFullRefund ? "refunded" : "partially_refunded"}`);

    // If full refund and booking exists, optionally update booking status
    if (isFullRefund) {
      // Check if this is the only payment or if all payments are refunded
      const bookingPayments = await db
        .select({
          paymentStatus: payments.paymentStatus,
        })
        .from(payments)
        .where(eq(payments.bookingId, payment.bookingId));

      const allRefunded = bookingPayments.every(
        p => p.paymentStatus === "refunded" || p.paymentStatus === "failed"
      );

      if (allRefunded) {
        // Optionally cancel the booking if all payments are refunded
        await db
          .update(bookings)
          .set({
            status: "cancelled",
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, payment.bookingId));

        console.log(`Booking ${payment.bookingId} cancelled - all payments refunded`);
      }
    }

  } catch (error) {
    console.error("Error handling refund:", error);
    throw error;
  }
}

export default app;
