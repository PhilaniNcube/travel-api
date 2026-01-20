import { z } from "zod";

/**
 * Schema for listing bookings with optional status filter
 */
export const listBookingsQuerySchema = z.object({
  page: z.string().optional().transform((val) => val ? Math.max(1, parseInt(val, 10)) : 1),
  limit: z.string().optional().transform((val) => val ? Math.min(100, Math.max(1, parseInt(val, 10))) : 10),
  status: z.enum(["pending", "confirmed", "cancelled", "completed"]).optional(),
});

export type ListBookingsQuery = z.infer<typeof listBookingsQuerySchema>;
