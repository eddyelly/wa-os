import { createProductRequestSchema, type ImportProductsResponse } from '@waos/shared';
import { parseCsv } from '../lib/csv.js';
import { ValidationError } from '../lib/errors.js';
import { productService } from './product-service.js';

export const IMPORT_HEADER = [
  'name',
  'description',
  'price',
  'minPrice',
  'stockQty',
  'lowStockThreshold',
  'tags',
] as const;

const MAX_DATA_ROWS = 200;

/** Empty cells become undefined so schema defaults/optionals apply; non-numeric
 *  text becomes NaN and fails the schema with a clear message. */
function toNumber(cell: string): number | undefined {
  const trimmed = cell.trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

function toRowPayload(cells: string[]): Record<string, unknown> {
  const [name = '', description = '', price = '', minPrice = '', stockQty = '', lowStockThreshold = '', tags = ''] =
    cells;
  const payload: Record<string, unknown> = {
    name: name.trim(),
    price: toNumber(price),
    tags: tags
      .split('|')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
  };
  if (description.trim() !== '') {
    payload.description = description.trim();
  }
  const minPriceNum = toNumber(minPrice);
  if (minPriceNum !== undefined) {
    payload.minPrice = minPriceNum;
  }
  const stockQtyNum = toNumber(stockQty);
  if (stockQtyNum !== undefined) {
    payload.stockQty = stockQtyNum;
  }
  const thresholdNum = toNumber(lowStockThreshold);
  if (thresholdNum !== undefined) {
    payload.lowStockThreshold = thresholdNum;
  }
  return payload;
}

/**
 * Partial import (spec section 6): every valid row is created through the
 * normal productService.create (embeddings and side effects behave exactly
 * like a manual create); invalid rows come back as { row, reason } with
 * 1-based data row numbers. File-level problems (bad header, too many rows)
 * throw a ValidationError instead.
 */
export async function importProductsCsv(text: string): Promise<ImportProductsResponse> {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new ValidationError('The file is empty.');
  }
  const header = (rows[0] ?? []).map((cell) => cell.trim());
  if (header.join(',') !== IMPORT_HEADER.join(',')) {
    throw new ValidationError(
      `The header row must be exactly: ${IMPORT_HEADER.join(',')}. Download a fresh template.`,
    );
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_DATA_ROWS) {
    throw new ValidationError(`The file has ${dataRows.length} data rows. The limit is ${MAX_DATA_ROWS} per import.`);
  }
  let created = 0;
  const failures: { row: number; reason: string }[] = [];
  for (const [index, cells] of dataRows.entries()) {
    const rowNumber = index + 1;
    if (cells.length !== IMPORT_HEADER.length) {
      failures.push({
        row: rowNumber,
        reason: `Expected ${IMPORT_HEADER.length} columns, got ${cells.length}.`,
      });
      continue;
    }
    const parsed = createProductRequestSchema.safeParse(toRowPayload(cells));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join('.') ?? 'row';
      failures.push({ row: rowNumber, reason: `${path}: ${issue?.message ?? 'invalid'}` });
      continue;
    }
    try {
      await productService.create(parsed.data);
      created += 1;
    } catch (error) {
      failures.push({
        row: rowNumber,
        reason: error instanceof Error ? error.message : 'Could not create this product.',
      });
    }
  }
  return { created, failures };
}
