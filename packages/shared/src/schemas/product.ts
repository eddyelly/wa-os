import { z } from 'zod';

const price = z.number().int().positive();

export const createProductRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000).optional(),
    price,
    minPrice: price.optional(),
    stockQty: z.number().int().min(0).default(0),
    lowStockThreshold: z.number().int().min(0).default(5),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .refine((p) => p.minPrice === undefined || p.minPrice <= p.price, {
    message: 'minPrice cannot exceed price',
    path: ['minPrice'],
  });
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    price: price.optional(),
    minPrice: price.nullable().optional(),
    stockQty: z.number().int().min(0).optional(),
    lowStockThreshold: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  })
  .refine((p) => p.minPrice == null || p.price === undefined || p.minPrice <= p.price, {
    message: 'minPrice cannot exceed price',
    path: ['minPrice'],
  });
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const productImageSchema = z.object({
  id: z.string(),
  mediaUrl: z.string().nullable(),
  description: z.string(),
});

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number().int(),
  minPrice: z.number().int().nullable(),
  stockQty: z.number().int(),
  lowStockThreshold: z.number().int(),
  isActive: z.boolean(),
  tags: z.array(z.string()),
  images: z.array(productImageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProductDto = z.infer<typeof productSchema>;
