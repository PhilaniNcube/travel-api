import { z } from "zod";

/**
 * Schema for creating a new package
 */
export const createPackageSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name must be less than 255 characters"),
  description: z.string().min(1, "Description is required").max(2000, "Description must be less than 2000 characters"),
  imageUrl: z.url("Invalid image URL").optional().nullable(),
  isCustom: z.boolean().default(false),
  basePrice: z.number().nonnegative("Base price must be non-negative").optional().nullable(),
});

export type CreatePackageInput = z.infer<typeof createPackageSchema>;

/**
 * Schema for updating an existing package
 * All fields are optional to allow partial updates
 */
export const updatePackageSchema = z.object({
  name: z.string().min(1, "Name cannot be empty").max(255, "Name must be less than 255 characters").optional(),
  description: z.string().min(1, "Description cannot be empty").max(2000, "Description must be less than 2000 characters").optional(),
  imageUrl: z.url("Invalid image URL").optional().nullable(),
  isCustom: z.boolean().optional(),
  basePrice: z.number().nonnegative("Base price must be non-negative").optional().nullable(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided for update",
});

export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;

/**
 * Schema for uploading package media
 */
export const createPackageMediaSchema = z.object({
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

export type CreatePackageMediaInput = z.infer<typeof createPackageMediaSchema>;

/**
 * Schema for adding an activity to a package
 */
export const addActivityToPackageSchema = z.object({
  activityId: z.string().min(1, "Activity ID is required"),
});

export type AddActivityToPackageInput = z.infer<typeof addActivityToPackageSchema>;
