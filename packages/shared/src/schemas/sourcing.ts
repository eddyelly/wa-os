import { z } from 'zod';

/** Currencies an importer is likely to be quoted in. Stored uppercase. */
export const SOURCING_CURRENCIES = [
  'CNY',
  'USD',
  'TZS',
  'AED',
  'EUR',
  'TRY',
  'KES',
  'ZAR',
  'GBP',
  'INR',
] as const;
export const sourcingCurrencySchema = z.enum(SOURCING_CURRENCIES);

export const supplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string(),
  city: z.string().nullable(),
  market: z.string().nullable(),
  address: z.string().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactNote: z.string().nullable(),
  notes: z.string().nullable(),
  itemCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SupplierDto = z.infer<typeof supplierSchema>;

export const createSupplierRequestSchema = z.object({
  name: z.string().trim().min(2).max(160),
  country: z.string().trim().length(2).toUpperCase(),
  city: z.string().trim().max(120).optional(),
  market: z.string().trim().max(160).optional(),
  address: z.string().trim().max(300).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  contactNote: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;

/**
 * Optional fields accept null so an edit can CLEAR a value that was set
 * before (a supplier drops their phone number). `undefined` still means
 * "leave unchanged", matching updateProductRequestSchema's convention.
 */
export const updateSupplierRequestSchema = createSupplierRequestSchema.partial().extend({
  city: z.string().trim().max(120).nullable().optional(),
  market: z.string().trim().max(160).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactNote: z.string().trim().max(200).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;

export const sourcedItemImageSchema = z.object({
  id: z.string(),
  mediaUrl: z.string().nullable(),
});

export const sourcedItemSchema = z.object({
  id: z.string(),
  supplierId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Minor units of priceCurrency. */
  priceAmount: z.number().int(),
  priceCurrency: z.string(),
  unit: z.string().nullable(),
  moq: z.number().int().nullable(),
  notes: z.string().nullable(),
  images: z.array(sourcedItemImageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SourcedItemDto = z.infer<typeof sourcedItemSchema>;

export const createSourcedItemRequestSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional(),
  priceAmount: z.number().int().min(1),
  priceCurrency: sourcingCurrencySchema,
  unit: z.string().trim().max(60).optional(),
  moq: z.number().int().min(1).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateSourcedItemRequest = z.infer<typeof createSourcedItemRequestSchema>;

export const updateSourcedItemRequestSchema = createSourcedItemRequestSchema.partial();
export type UpdateSourcedItemRequest = z.infer<typeof updateSourcedItemRequestSchema>;

/** A global-search hit: the item plus where it came from. */
export const sourcedItemSearchResultSchema = sourcedItemSchema.extend({
  supplierName: z.string(),
  supplierCity: z.string().nullable(),
  supplierCountry: z.string(),
});
export type SourcedItemSearchResult = z.infer<typeof sourcedItemSearchResultSchema>;
