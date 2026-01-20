import { z } from "zod";

/**
 * Schema for creating a new activity
 */
export const createActivitySchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name must be less than 255 characters"),
  description: z.string().max(2000, "Description must be less than 2000 characters").optional().nullable(),
  imageUrl: z.url("Invalid image URL").optional().nullable(),
  location: z.string().min(1, "Location is required").max(255, "Location must be less than 255 characters"),
  durationMinutes: z.number().int("Duration must be an integer").positive("Duration must be positive"),
  price: z.number().nonnegative("Price must be non-negative"),
});

export type CreateActivityInput = z.infer<typeof createActivitySchema>;

/**
 * Schema for updating an existing activity
 * All fields are optional to allow partial updates
 */
export const updateActivitySchema = z.object({
  name: z.string().min(1, "Name cannot be empty").max(255, "Name must be less than 255 characters").optional(),
  description: z.string().max(2000, "Description must be less than 2000 characters").optional().nullable(),
  imageUrl: z.url("Invalid image URL").optional().nullable(),
  location: z.string().min(1, "Location cannot be empty").max(255, "Location must be less than 255 characters").optional(),
  durationMinutes: z.number().int("Duration must be an integer").positive("Duration must be positive").optional(),
  price: z.number().nonnegative("Price must be non-negative").optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided for update",
});

export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

/**
 * Schema for uploading activity media
 */
export const createActivityMediaSchema = z.object({
  media: z.array(
    z.object({
      mediaUrl: z.url("Invalid media URL"),
      mediaType: z.enum(["image", "video"], {
        message: "Media type must be either 'image' or 'video'",
      }),
      altText: z.string().max(500, "Alt text must be less than 500 characters").optional().nullable(),
      displayOrder: z.number().int("Display order must be an integer").nonnegative("Display order must be non-negative").optional(),
    })
  ).min(1, "At least one media item is required"),
});

export type CreateActivityMediaInput = z.infer<typeof createActivityMediaSchema>;
