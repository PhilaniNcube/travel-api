import { z } from "zod";

/**
 * Schema for creating a new review
 */
export const createReviewSchema = z.object({
  bookingActivityId: z.string().min(1, "Booking activity ID is required"),
  rating: z.number().int().min(1, "Rating must be at least 1").max(5, "Rating must be at most 5"),
  comment: z.string().optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

/**
 * Schema for updating a review
 */
export const updateReviewSchema = z.object({
  rating: z.number().int().min(1, "Rating must be at least 1").max(5, "Rating must be at most 5").optional(),
  comment: z.string().optional(),
}).refine(
  (data) => data.rating !== undefined || data.comment !== undefined,
  {
    message: "At least one field (rating or comment) must be provided",
  }
);

export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
