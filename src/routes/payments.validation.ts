import { z } from "zod";

/**
 * Schema for getting payment by ID parameter
 */
export const getPaymentParamsSchema = z.object({
  id: z.string().min(1, "Payment ID is required"),
});

export type GetPaymentParams = z.infer<typeof getPaymentParamsSchema>;

/**
 * Schema for creating a new payment
 */
export const createPaymentSchema = z.object({
  bookingId: z.string().min(1, "Booking ID is required"),
  amount: z.number().positive("Amount must be positive").optional(), // Optional: defaults to booking total
  currency: z.string().length(3, "Currency must be a 3-letter ISO code").default("USD"),
  paymentMethod: z.enum([
    "credit_card",
    "debit_card",
    "paypal",
    "bank_transfer",
    "cash",
    "other",
  ]).default("credit_card"),
  paymentProvider: z.enum(["stripe", "paypal", "square", "manual"]).default("stripe"),
  metadata: z.record(z.string(), z.any()).optional(), // Additional payment metadata
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

/**
 * Schema for updating payment status
 */
export const updatePaymentStatusSchema = z.object({
  paymentStatus: z.enum([
    "pending",
    "processing",
    "completed",
    "failed",
    "refunded",
    "partially_refunded",
  ]),
  transactionId: z.string().optional(), // Optional transaction ID from payment provider
  metadata: z.record(z.string(), z.any()).optional(), // Additional metadata to merge
});

export type UpdatePaymentStatusInput = z.infer<typeof updatePaymentStatusSchema>;

/**
 * Schema for processing a refund
 */
export const processRefundSchema = z.object({
  amount: z.number().positive("Refund amount must be positive").optional(), // Optional: full refund if not specified
  reason: z.string().min(3, "Refund reason must be at least 3 characters").optional(),
  metadata: z.record(z.string(), z.any()).optional(), // Additional refund metadata
});

export type ProcessRefundInput = z.infer<typeof processRefundSchema>;

/**
 * Schema for webhook event types
 */
export const webhookEventSchema = z.object({
  type: z.enum([
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "charge.refunded",
    "charge.refund.updated",
  ]),
  data: z.object({
    object: z.any(), // Stripe event object - will be validated based on type
  }),
  id: z.string(),
  created: z.number(),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;
