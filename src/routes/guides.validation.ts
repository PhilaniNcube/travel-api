import { z } from "zod";

/**
 * Schema for query parameters when listing guides
 */
export const listGuidesQuerySchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  is_active: z.enum(["true", "false"]).optional(),
  specialties: z.string().optional(), // Comma-separated specialties to filter by
});

export type ListGuidesQuery = z.infer<typeof listGuidesQuerySchema>;

/**
 * Schema for creating a new guide
 */
export const createGuideSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name must be less than 255 characters"),
  email: z.string().email("Invalid email address").max(255, "Email must be less than 255 characters"),
  phone: z.string().max(50, "Phone number must be less than 50 characters").optional().nullable(),
  bio: z.string().max(2000, "Bio must be less than 2000 characters").optional().nullable(),
  specialties: z.string().max(500, "Specialties must be less than 500 characters").optional().nullable(),
  imageUrl: z.string().url("Invalid image URL").optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export type CreateGuideInput = z.infer<typeof createGuideSchema>;

/**
 * Schema for updating an existing guide
 * All fields are optional to allow partial updates
 */
export const updateGuideSchema = z.object({
  name: z.string().min(1, "Name cannot be empty").max(255, "Name must be less than 255 characters").optional(),
  email: z.string().email("Invalid email address").max(255, "Email must be less than 255 characters").optional(),
  phone: z.string().max(50, "Phone number must be less than 50 characters").optional().nullable(),
  bio: z.string().max(2000, "Bio must be less than 2000 characters").optional().nullable(),
  specialties: z.string().max(500, "Specialties must be less than 500 characters").optional().nullable(),
  imageUrl: z.string().url("Invalid image URL").optional().nullable(),
  isActive: z.boolean().optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: "At least one field must be provided for update",
});

export type UpdateGuideInput = z.infer<typeof updateGuideSchema>;
