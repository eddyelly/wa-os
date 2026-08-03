import { z } from 'zod';
import {
  createSourcedItemRequestSchema,
  createSupplierRequestSchema,
  type SourcingImportResponse,
} from '@waos/shared';
import { parseCsv } from '../lib/csv.js';
import { ValidationError } from '../lib/errors.js';
import { sourcedItemService } from './sourced-item-service.js';
import { supplierService } from './supplier-service.js';

export const SUPPLIER_IMPORT_HEADER = [
  'name',
  'country',
  'city',
  'market',
  'address',
  'contactName',
  'contactPhone',
  'contactNote',
  'notes',
] as const;

export const ITEM_IMPORT_HEADER = [
  'name',
  'description',
  'price',
  'priceCurrency',
  'unit',
  'moq',
  'notes',
] as const;

const MAX_DATA_ROWS = 200;

/** Empty cells become undefined so the schema's optionals apply. */
function text(cell: string | undefined): string | undefined {
  const trimmed = (cell ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

function count(cell: string | undefined): number | undefined {
  const trimmed = (cell ?? '').trim();
  return trimmed === '' ? undefined : Number(trimmed);
}

/**
 * The CSV `price` column is in MAJOR units, exactly as a supplier quotes it
 * and as the item form takes it (45.50), while the database stores minor
 * units. Converting here keeps the spreadsheet honest: a dealer typing 4550
 * would otherwise silently record 45.50 across every row of the file.
 */
function priceToMinorUnits(cell: string | undefined): number | undefined {
  const trimmed = (cell ?? '').trim();
  if (trimmed === '') {
    return undefined;
  }
  const major = Number(trimmed);
  return Number.isFinite(major) ? Math.round(major * 100) : Number.NaN;
}

interface ImportPlan {
  header: readonly string[];
  toPayload: (cells: string[]) => Record<string, unknown>;
  create: (payload: Record<string, unknown>) => Promise<unknown>;
  schema: z.ZodType<unknown>;
}

async function runImport(text_: string, plan: ImportPlan): Promise<SourcingImportResponse> {
  const rows = parseCsv(text_);
  if (rows.length === 0) {
    throw new ValidationError('The file is empty.');
  }
  const header = (rows[0] ?? []).map((cell) => cell.trim());
  if (header.join(',') !== plan.header.join(',')) {
    throw new ValidationError(
      `The header row must be exactly: ${plan.header.join(',')}. Download a fresh template.`,
    );
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > MAX_DATA_ROWS) {
    throw new ValidationError(
      `The file has ${dataRows.length} data rows. The limit is ${MAX_DATA_ROWS} per import.`,
    );
  }
  let created = 0;
  const failures: { row: number; reason: string }[] = [];
  for (const [index, cells] of dataRows.entries()) {
    const rowNumber = index + 1;
    if (cells.every((cell) => cell.trim() === '')) {
      continue;
    }
    if (cells.length !== plan.header.length) {
      failures.push({
        row: rowNumber,
        reason: `Expected ${plan.header.length} columns, got ${cells.length}.`,
      });
      continue;
    }
    const parsed = plan.schema.safeParse(plan.toPayload(cells));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join('.') ?? 'row';
      failures.push({ row: rowNumber, reason: `${path}: ${issue?.message ?? 'invalid'}` });
      continue;
    }
    try {
      await plan.create(parsed.data as Record<string, unknown>);
      created += 1;
    } catch (error) {
      failures.push({
        row: rowNumber,
        reason: error instanceof Error ? error.message : 'Could not create this row.',
      });
    }
  }
  return { created, failures };
}

export function importSuppliersCsv(csv: string): Promise<SourcingImportResponse> {
  return runImport(csv, {
    header: SUPPLIER_IMPORT_HEADER,
    schema: createSupplierRequestSchema,
    toPayload: (cells) => ({
      name: text(cells[0]),
      country: text(cells[1]),
      city: text(cells[2]),
      market: text(cells[3]),
      address: text(cells[4]),
      contactName: text(cells[5]),
      contactPhone: text(cells[6]),
      contactNote: text(cells[7]),
      notes: text(cells[8]),
    }),
    create: (payload) => supplierService.create(payload as never),
  });
}

export async function importSourcedItemsCsv(
  supplierId: string,
  csv: string,
): Promise<SourcingImportResponse> {
  // Fail the whole file once for a bad supplier instead of reporting the
  // same NotFoundError on all 200 rows.
  await supplierService.findById(supplierId);
  return runImport(csv, {
    header: ITEM_IMPORT_HEADER,
    schema: createSourcedItemRequestSchema,
    toPayload: (cells) => ({
      name: text(cells[0]),
      description: text(cells[1]),
      priceAmount: priceToMinorUnits(cells[2]),
      priceCurrency: text(cells[3]),
      unit: text(cells[4]),
      moq: count(cells[5]),
      notes: text(cells[6]),
    }),
    create: (payload) => sourcedItemService.create(supplierId, payload as never),
  });
}
