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

/**
 * Schema for creating a new booking
 */
export const createBookingSchema = z.object({
  packageId: z.string().optional(), // Optional: for package-based bookings
  activityIds: z.array(z.string()).min(1, "At least one activity is required"), // For custom bookings or package bookings
  startDate: z.string().datetime({ message: "Invalid start date format. Use ISO 8601 format." }),
  endDate: z.string().datetime({ message: "Invalid end date format. Use ISO 8601 format." }),
  specialRequests: z.string().optional(),
  scheduledTimes: z.record(z.string(), z.string().datetime()).optional(), // Map of activityId to scheduled time
}).refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  {
    message: "End date must be after start date",
    path: ["endDate"],
  }
);

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

/**
 * Schema for updating a booking
 */
export const updateBookingSchema = z.object({
  startDate: z.string().datetime({ message: "Invalid start date format. Use ISO 8601 format." }).optional(),
  endDate: z.string().datetime({ message: "Invalid end date format. Use ISO 8601 format." }).optional(),
  specialRequests: z.string().optional(),
  status: z.enum(["pending", "confirmed", "cancelled", "completed"]).optional(),
}).refine(
  (data) => {
    if (data.startDate && data.endDate) {
      return new Date(data.endDate) > new Date(data.startDate);
    }
    return true;
  },
  {
    message: "End date must be after start date",
    path: ["endDate"],
  }
);

export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;

/**
 * Schema for adding an activity to an existing booking
 */
export const addActivityToBookingSchema = z.object({
  activityId: z.string().min(1, "Activity ID is required"),
  scheduledAt: z.string().datetime({ message: "Invalid scheduled time format. Use ISO 8601 format." }).optional(),
});

export type AddActivityToBookingInput = z.infer<typeof addActivityToBookingSchema>;

/**
 * Schema for updating a booking activity
 */
export const updateBookingActivitySchema = z.object({
  scheduledAt: z.string().datetime({ message: "Invalid scheduled time format. Use ISO 8601 format." }).optional(),
});

export type UpdateBookingActivityInput = z.infer<typeof updateBookingActivitySchema>;

/**
 * Schema for assigning a guide to a booking activity
 */
export const assignGuideSchema = z.object({
  guideId: z.string().min(1, "Guide ID is required"),
});

export type AssignGuideInput = z.infer<typeof assignGuideSchema>;

/**
 * Schema for validating booking ID parameter
 */
export const getBookingParamsSchema = z.object({
  id: z.string().min(1, "Booking ID is required"),
});

export type GetBookingParams = z.infer<typeof getBookingParamsSchema>;
