# Shop Tables, Create-with-Photo, and CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Products and Orders render as desktop tables (search, thumbnail, badges, kebab actions) with the existing cards kept on phones; the Add Product form takes an optional photo at creation; a CSV template/import flow bulk-creates products with per-row error reporting.

**Architecture:** A presentation-only `Table` kit plus `RowActions` (kebab) and `SearchInput` join the `@/components/ui` layer; the products and orders pages feed them rows while keeping their card lists inside `lg:hidden`. Create-with-photo is pure client composition (`createProduct` then `uploadProductImage`). Import adds one additive endpoint `POST /api/v1/products/import` (multer memory, .csv, 1MB): a small Vitest-tested CSV parser, per-row validation with the existing `createProductRequestSchema`, creation through the normal `productService.create` (so embeddings and side effects match manual creates), and a `{ created, failures }` response.

**Tech Stack:** API: Express, TypeScript strict, multer (existing), Zod, Vitest. Web: Next.js 15, React 19, Tailwind v4, next-intl, TanStack Query v5, lucide-react (existing dep), shadcn dropdown-menu (already in the barrel).

## Global Constraints

- **Presentation + one additive endpoint.** No Prisma model change; no existing endpoint or schema changed (the shared package only gains the import response schema). (Spec section 7.)
- **Responsive, phone-first.** Tables render only at `lg:` and up; each page keeps its existing compact cards inside `lg:hidden`. Never a horizontally scrolling table on phones. (Spec section 2.)
- **Import contract.** CSV template with header `name,description,price,minPrice,stockQty,lowStockThreshold,tags`; `tags` is `|`-separated inside one cell; 200 data rows max per file; partial import (valid rows created, failures reported as `{ row, reason }` with 1-based data-row numbers). (Spec sections 2, 6.)
- **Tenancy.** The import route sits behind `requireAuth` + `requireModule('shop')` like every product route; `productService.create` is already org-scoped. (Spec section 7.)
- **Both locales complete.** All new UI copy ships in `en` and `sw`; `pnpm lint` enforces key parity. (Spec section 7.)
- **No em dashes. TypeScript strict, no `any`. Conventional commits.** The CSV parser and import service get Vitest tests. (Spec section 7.)
- **API gate:** `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`. **Web gate:** `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`. Run `tsc` (typecheck) explicitly; the build's esbuild transform does not type-check.
- **Deliberate spec clarification:** the downloadable CSV file itself (headers + example row) is fixed English. The headers are a machine contract the parser matches exactly; localizing them would make uploads locale-dependent and break round-tripping. All on-screen copy (buttons, result panel, table headers) is localized as required.

---

## File Structure

- Create `apps/web/src/components/ui/table.tsx` (Table frame + header/body/row/cell + ThumbCell), `apps/web/src/components/ui/row-actions.tsx` (kebab), `apps/web/src/components/ui/search-input.tsx`; modify `apps/web/src/components/ui/index.ts` (Task 1).
- Modify `apps/web/src/app/[locale]/products/page.tsx` + `apps/web/messages/{en,sw}.json` (Tasks 2 and 3).
- Create `apps/api/src/lib/csv.ts` + `apps/api/src/lib/csv.test.ts`, `apps/api/src/services/product-import.ts` + `apps/api/src/services/product-import.test.ts`; modify `packages/shared/src/schemas/product.ts`, `apps/api/src/routes/products.ts`, `apps/api/src/controllers/product-controller.ts`, `apps/web/src/lib/shop-api.ts` (Task 3).
- Modify `apps/web/src/app/[locale]/orders/page.tsx` + `apps/web/messages/{en,sw}.json` (Task 4).

**Existing interfaces the tasks consume (verified):** `createProduct(input): Promise<ProductDto>` and `uploadProductImage(id, file): Promise<ProductDto>` and `apiUpload<T>(path, formData): Promise<T>` in the web lib; `productService.create(input: CreateProductRequest): Promise<ProductDto>`; multer memory-storage pattern in `apps/api/src/routes/products.ts`; `ValidationError` from `../lib/errors.js`; `ProductDto.images: { id, mediaUrl: string | null, description }[]`; shadcn `DropdownMenu/DropdownMenuTrigger/DropdownMenuContent/DropdownMenuItem` re-exported by the `@/components/ui` barrel; `lucide-react` installed.

---

### Task 1: Table, RowActions, and SearchInput components

**Files:**
- Create: `apps/web/src/components/ui/table.tsx`
- Create: `apps/web/src/components/ui/row-actions.tsx`
- Create: `apps/web/src/components/ui/search-input.tsx`
- Modify: `apps/web/src/components/ui/index.ts`

**Interfaces:**
- Produces: `Table({ children, className? })`, `TableHeader({ children })`, `Th({ children?, className? })`, `TableBody({ children })`, `TableRow({ children })`, `Td({ children?, className? })`, `ThumbCell({ src: string | null, alt: string })`; `RowActions({ label: string, actions: RowAction[] })` with `RowAction { key, label, tone?: 'default' | 'danger', disabled?, onSelect: () => void }`; `SearchInput(props: InputHTMLAttributes<HTMLInputElement>)`. All exported from the `@/components/ui` barrel.

- [ ] **Step 1: Create the table kit**

`apps/web/src/components/ui/table.tsx`:
```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Desktop-only data table frame (spec: tables render at lg and up; pages keep
 * their compact cards inside lg:hidden). Presentation only: pages own data,
 * filtering, and actions.
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'hidden overflow-x-auto rounded-2xl border border-brand-100 bg-white shadow-sm lg:block',
        className,
      )}
    >
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function TableHeader({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-brand-100 bg-brand-50/60">{children}</tr>
    </thead>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-4 py-3 text-xs font-semibold tracking-wide text-brand-600 uppercase',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-brand-100">{children}</tbody>;
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="transition-colors hover:bg-brand-50/50">{children}</tr>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('px-4 py-3 align-middle text-brand-900', className)}>{children}</td>;
}

/** 40px product thumbnail tile, or a neutral placeholder when there is no image. */
export function ThumbCell({ src, alt }: { src: string | null; alt: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element -- presigned MinIO URL, not a static asset
    <img src={src} alt={alt} className="h-10 w-10 rounded-lg object-cover" />
  ) : (
    <div aria-hidden className="h-10 w-10 rounded-lg bg-brand-100" />
  );
}
```
Note: the existing pages already render `<img>` for presigned URLs; if the repo's eslint config does not use the Next plugin rule, drop the disable comment rather than carry a dead directive (check with `pnpm lint`).

- [ ] **Step 2: Create the kebab RowActions**

`apps/web/src/components/ui/row-actions.tsx`:
```tsx
'use client';

import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/dropdown-menu';
import { cn } from '@/lib/utils';

export interface RowAction {
  key: string;
  label: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onSelect: () => void;
}

/** The per-row kebab (...) menu used by the data tables. */
export function RowActions({ label, actions }: { label: string; actions: RowAction[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-brand-500 outline-none transition-colors hover:bg-brand-100 hover:text-brand-800 focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.key}
            disabled={action.disabled}
            className={cn(action.tone === 'danger' && 'text-red-700 focus:text-red-700')}
            onSelect={() => {
              action.onSelect();
            }}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Create SearchInput**

`apps/web/src/components/ui/search-input.tsx`:
```tsx
'use client';

import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/** A search box styled like Input, with a leading search icon. */
export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-brand-400"
      />
      <input
        type="search"
        className="min-h-11 w-full rounded-xl border border-brand-200 bg-white py-2.5 pr-4 pl-9 text-base text-brand-950 placeholder:text-brand-400 outline-none transition-colors focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
        {...props}
      />
    </div>
  );
}
```

- [ ] **Step 4: Export from the barrel**

In `apps/web/src/components/ui/index.ts`, add after the `StatCard` export:
```ts
export { Table, TableHeader, Th, TableBody, TableRow, Td, ThumbCell } from './table.js';
export { RowActions, type RowAction } from './row-actions.js';
export { SearchInput } from './search-input.js';
```

- [ ] **Step 5: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean (the components compile; nothing consumes them yet).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui/table.tsx apps/web/src/components/ui/row-actions.tsx apps/web/src/components/ui/search-input.tsx apps/web/src/components/ui/index.ts
git commit -m "feat(web): add Table, RowActions, and SearchInput to the component layer"
```

---

### Task 2: Products page: desktop table, search, and create-with-photo

**Files:**
- Modify: `apps/web/src/app/[locale]/products/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json`

**Interfaces:**
- Consumes: Task 1 components; existing `createProduct`, `uploadProductImage`, `updateProduct`, `deleteProduct`, `removeProductImage` from `@/lib/shop-api`; existing handlers in the page (`startEdit`, `toggleActive`, `remove`, `triggerUpload`, `removeImage`).
- Produces: nothing (page).

- [ ] **Step 1: Add the new copy to both locales**

In `apps/web/messages/en.json`, inside `products` (keep every existing key):
```json
      "searchPlaceholder": "Search products",
      "active": "Active",
      "colProduct": "Product",
      "colPrice": "Price",
      "colStock": "Stock",
      "colStatus": "Status",
      "colActions": "Actions",
      "photoLabel": "Photo (optional)",
      "photoHint": "Customers see this photo when the AI sells this product.",
      "photoUploadFailed": "Product saved, but the photo failed to upload. Add it from the list."
```
In `apps/web/messages/sw.json`, inside `products`:
```json
      "searchPlaceholder": "Tafuta bidhaa",
      "active": "Inatumika",
      "colProduct": "Bidhaa",
      "colPrice": "Bei",
      "colStock": "Akiba",
      "colStatus": "Hali",
      "colActions": "Vitendo",
      "photoLabel": "Picha (hiari)",
      "photoHint": "Wateja wataiona picha hii AI inapouza bidhaa hii.",
      "photoUploadFailed": "Bidhaa imehifadhiwa, lakini picha imeshindwa kupakiwa. Iongeze kutoka kwenye orodha."
```

- [ ] **Step 2: Add photo + search state to the page**

In `apps/web/src/app/[locale]/products/page.tsx`, extend the imports:
```tsx
import {
  Badge, Button, Card, EmptyState, ErrorBox, Field, Input, SearchInput, Skeleton,
  Table, TableHeader, Th, TableBody, TableRow, Td, ThumbCell, RowActions,
} from '@/components/ui';
```
Next to the existing form state (`editingId`, `name`, ...), add:
```tsx
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const [pendingPhotoUrl, setPendingPhotoUrl] = useState<string | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const formPhotoRef = useRef<HTMLInputElement | null>(null);
```
Add a selection helper and cleanup (object URLs must be revoked):
```tsx
  const selectPendingPhoto = (file: File | null): void => {
    setPendingPhoto(file);
    setPendingPhotoUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return file ? URL.createObjectURL(file) : null;
    });
  };
```
Clear the pending photo in `resetForm` (add `selectPendingPhoto(null); setPhotoWarning(null);`) and in `startEdit` (add `selectPendingPhoto(null);`; edit mode manages existing photos instead).

- [ ] **Step 3: Chain the photo upload into submit**

In `submit`, replace the create branch (`await createProduct({ ... });`) with:
```tsx
        const created = await createProduct({
          name,
          description: trimmedDescription === '' ? undefined : trimmedDescription,
          price: priceNum,
          minPrice: minPriceNum ?? undefined,
          stockQty: stockQtyNum,
          lowStockThreshold: lowStockThresholdNum,
        });
        if (pendingPhoto) {
          try {
            await uploadProductImage(created.id, pendingPhoto);
          } catch {
            // The product is saved; only the photo failed. Say so honestly
            // instead of reporting the whole save as failed.
            setPhotoWarning(t('photoUploadFailed'));
          }
        }
```
`resetForm()` (already called after) clears the pending photo; keep `setPhotoWarning` OUT of `resetForm`'s call site inside `submit` by moving the reset before the warning is set. Concretely, restructure the tail of the try block to:
```tsx
      const keepWarning = photoWarningRef.current;
```
Simpler and correct: since `resetForm()` clears `photoWarning`, set the warning AFTER `resetForm()` runs. Restructure the create branch to remember a flag:
```tsx
        let photoFailed = false;
        if (pendingPhoto) {
          try {
            await uploadProductImage(created.id, pendingPhoto);
          } catch {
            photoFailed = true;
          }
        }
        resetForm();
        if (photoFailed) {
          setPhotoWarning(t('photoUploadFailed'));
        }
        await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
        return;
```
(The edit branch keeps the existing `resetForm(); await queryClient.invalidateQueries(...)` tail.) Render the warning near the form error:
```tsx
          {photoWarning ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {photoWarning}
            </div>
          ) : null}
```

- [ ] **Step 4: Add the photo picker to the form**

After the stock/threshold grid inside the form, add:
```tsx
          <Field label={t('photoLabel')} hint={t('photoHint')}>
            {editingId ? (
              <div className="flex flex-wrap items-center gap-3">
                {(products?.find((p) => p.id === editingId)?.images ?? []).map((image) => (
                  <div key={image.id} className="flex flex-col items-center gap-1">
                    <ThumbCell src={image.mediaUrl} alt={image.description} />
                    <button
                      type="button"
                      onClick={() => void removeImage(editingId, image.id)}
                      className="text-[11px] font-medium text-red-700 hover:underline"
                    >
                      {t('removeImage')}
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={uploadingId !== null}
                  onClick={() => {
                    triggerUpload(editingId);
                  }}
                >
                  {uploadingId !== null ? t('uploading') : t('addImage')}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {pendingPhotoUrl ? (
                  <div className="flex flex-col items-center gap-1">
                    <ThumbCell src={pendingPhotoUrl} alt={t('photoLabel')} />
                    <button
                      type="button"
                      onClick={() => {
                        selectPendingPhoto(null);
                      }}
                      className="text-[11px] font-medium text-red-700 hover:underline"
                    >
                      {t('removeImage')}
                    </button>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    formPhotoRef.current?.click();
                  }}
                >
                  {t('addImage')}
                </Button>
                <input
                  ref={formPhotoRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    selectPendingPhoto(e.target.files?.[0] ?? null);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </Field>
```

- [ ] **Step 5: Render the desktop table and keep the cards on mobile**

Above the list section, compute the filtered rows once (used by BOTH the table and the cards):
```tsx
  const query = search.trim().toLowerCase();
  const filtered = (products ?? []).filter(
    (p) =>
      query === '' ||
      p.name.toLowerCase().includes(query) ||
      p.tags.some((tag) => tag.toLowerCase().includes(query)),
  );
```
Render `SearchInput` above the list area (all widths):
```tsx
      <div className="mb-3">
        <SearchInput
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
      </div>
```
In the non-empty branch, add the table BEFORE the existing `<ul>` and wrap that `<ul>` in `<div className="lg:hidden">...</div>` (the card markup itself is unchanged, but map over `filtered` instead of `products`):
```tsx
          <Table>
            <TableHeader>
              <Th>{t('colProduct')}</Th>
              <Th>{t('colPrice')}</Th>
              <Th>{t('colStock')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th className="text-right">{t('colActions')}</Th>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => (
                <TableRow key={product.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <ThumbCell src={product.images[0]?.mediaUrl ?? null} alt={product.name} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-brand-950">{product.name}</p>
                        {product.description ? (
                          <p className="max-w-[28rem] truncate text-xs text-brand-500">
                            {product.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{product.price.toLocaleString(locale)} TZS</Td>
                  <Td>
                    <span className="mr-2">{product.stockQty}</span>
                    {product.stockQty === 0 ? (
                      <Badge tone="danger">{t('stockBadge', { count: product.stockQty })}</Badge>
                    ) : product.stockQty <= product.lowStockThreshold ? (
                      <Badge tone="warning">{t('stockBadge', { count: product.stockQty })}</Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <Badge tone={product.isActive ? 'success' : 'neutral'}>
                      {product.isActive ? t('active') : t('inactive')}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end">
                      <RowActions
                        label={t('colActions')}
                        actions={[
                          { key: 'edit', label: t('edit'), onSelect: () => { startEdit(product); } },
                          {
                            key: 'photo',
                            label: uploadingId !== null ? t('uploading') : t('addImage'),
                            disabled: uploadingId !== null,
                            onSelect: () => { triggerUpload(product.id); },
                          },
                          ...product.images.map((image, index) => ({
                            key: `rm-${image.id}`,
                            label:
                              product.images.length > 1
                                ? `${t('removeImage')} ${index + 1}`
                                : t('removeImage'),
                            onSelect: () => void removeImage(product.id, image.id),
                          })),
                          {
                            key: 'toggle',
                            label: product.isActive ? t('deactivate') : t('activate'),
                            onSelect: () => void toggleActive(product),
                          },
                          {
                            key: 'delete',
                            label: t('delete'),
                            tone: 'danger' as const,
                            onSelect: () => void remove(product.id),
                          },
                        ]}
                      />
                    </div>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="lg:hidden">
            {/* existing <ul> card list, mapping over `filtered` */}
          </div>
```
When `filtered.length === 0` but `products.length > 0` (search with no hits), show the existing `EmptyState` with `noResultsTitle`-style copy: reuse `emptyTitle`/`emptyHint`? No: keep it simple and correct: render the table/cards only when `filtered.length > 0`, otherwise `<EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />` only when `products.length === 0`; for a no-hit search render nothing but the (empty) table frame is ugly, so render the same EmptyState with the existing keys. Concretely: change the `products.length === 0` branch condition to `filtered.length === 0` (covers both no products and no search hits; the copy reads fine for both).

- [ ] **Step 6: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean; parity check passes (10 new keys in both locales).

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/[locale]/products/page.tsx" apps/web/messages/en.json apps/web/messages/sw.json
git commit -m "feat(web): products table with search, kebab actions, and photo at creation"
```

---

### Task 3: CSV import (API + UI)

**Files:**
- Modify: `packages/shared/src/schemas/product.ts`
- Create: `apps/api/src/lib/csv.ts`; Test: `apps/api/src/lib/csv.test.ts`
- Create: `apps/api/src/services/product-import.ts`; Test: `apps/api/src/services/product-import.test.ts`
- Modify: `apps/api/src/routes/products.ts`, `apps/api/src/controllers/product-controller.ts`
- Modify: `apps/web/src/lib/shop-api.ts`, `apps/web/src/app/[locale]/products/page.tsx`, `apps/web/messages/{en,sw}.json`

**Interfaces:**
- Consumes: `createProductRequestSchema`, `productService.create`, `ValidationError`, multer pattern, `apiUpload`.
- Produces: `importProductsResponseSchema` / `ImportProductsResponse` from `@waos/shared`; `parseCsv(text: string): string[][]`; `importProductsCsv(text: string): Promise<ImportProductsResponse>`; web `importProductsCsv(file: File): Promise<ImportProductsResponse>`; endpoint `POST /api/v1/products/import`.

- [ ] **Step 1: Add the shared response schema**

In `packages/shared/src/schemas/product.ts`, append:
```ts
export const importProductsResponseSchema = z.object({
  created: z.number().int().min(0),
  failures: z.array(
    z.object({
      row: z.number().int().min(1),
      reason: z.string(),
    }),
  ),
});
export type ImportProductsResponse = z.infer<typeof importProductsResponseSchema>;
```

- [ ] **Step 2: Write the failing CSV parser tests**

Create `apps/api/src/lib/csv.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('name,desc\n"Shea, pure","x"')).toEqual([
      ['name', 'desc'],
      ['Shea, pure', 'x'],
    ]);
  });

  it('handles doubled quotes inside quoted fields', () => {
    expect(parseCsv('a\n"say ""hi"""')).toEqual([['a'], ['say "hi"']]);
  });

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('skips fully empty lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm -F @waos/api test -- csv`
Expected: FAIL (`./csv.js` does not exist).

- [ ] **Step 4: Implement the parser**

Create `apps/api/src/lib/csv.ts`:
```ts
/**
 * Minimal RFC 4180 style CSV parser for the product import: quoted fields may
 * contain commas, newlines, and doubled quotes. Rows that are entirely empty
 * are skipped. No streaming: import files are capped at 1MB / 200 rows.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const pushField = (): void => {
    row.push(field);
    field = '';
  };
  const pushRow = (): void => {
    pushField();
    const isEmpty = row.length === 1 && row[0] === '';
    if (!isEmpty) {
      rows.push(row);
    }
    row = [];
  };
  while (i < text.length) {
    const char = text[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (char === '\r' && text[i + 1] === '\n') {
      pushRow();
      i += 2;
      continue;
    }
    if (char === '\n' || char === '\r') {
      pushRow();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (field !== '' || row.length > 0) {
    pushRow();
  }
  return rows;
}
```

- [ ] **Step 5: Run to verify the parser passes**

Run: `pnpm -F @waos/api test -- csv`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the failing import-service tests**

Create `apps/api/src/services/product-import.test.ts` (mock `productService` with the repo's `vi.hoisted` pattern; see `notification-service.test.ts`):
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { productServiceMock } = vi.hoisted(() => ({
  productServiceMock: { create: vi.fn() },
}));
vi.mock('./product-service.js', () => ({ productService: productServiceMock }));

import { importProductsCsv } from './product-import.js';

const HEADER = 'name,description,price,minPrice,stockQty,lowStockThreshold,tags';

beforeEach(() => {
  vi.clearAllMocks();
  productServiceMock.create.mockResolvedValue({ id: 'p1' });
});

describe('importProductsCsv', () => {
  it('creates every valid row and splits tags on |', async () => {
    const csv = `${HEADER}\n"Shea Butter","Pure shea",20000,17000,10,5,"hair|butter"\nComb,,3000,,25,5,`;
    const result = await importProductsCsv(csv);
    expect(result).toEqual({ created: 2, failures: [] });
    expect(productServiceMock.create).toHaveBeenNthCalledWith(1, {
      name: 'Shea Butter',
      description: 'Pure shea',
      price: 20000,
      minPrice: 17000,
      stockQty: 10,
      lowStockThreshold: 5,
      tags: ['hair', 'butter'],
    });
    expect(productServiceMock.create).toHaveBeenNthCalledWith(2, {
      name: 'Comb',
      price: 3000,
      stockQty: 25,
      lowStockThreshold: 5,
      tags: [],
    });
  });

  it('reports invalid rows with 1-based data row numbers and keeps creating valid ones', async () => {
    const csv = `${HEADER}\nGood,,1000,,1,5,\nBad,,abc,,1,5,\nAlso Bad,,1000,2000,1,5,`;
    const result = await importProductsCsv(csv);
    expect(result.created).toBe(1);
    expect(result.failures).toHaveLength(2);
    expect(result.failures[0]?.row).toBe(2);
    expect(result.failures[1]?.row).toBe(3);
    expect(productServiceMock.create).toHaveBeenCalledTimes(1);
  });

  it('reports a wrong column count as a row failure', async () => {
    const csv = `${HEADER}\nOnlyName,1000`;
    const result = await importProductsCsv(csv);
    expect(result.created).toBe(0);
    expect(result.failures[0]?.row).toBe(1);
    expect(result.failures[0]?.reason).toContain('7');
  });

  it('counts a service failure as a row failure', async () => {
    productServiceMock.create.mockRejectedValueOnce(new Error('db down'));
    const csv = `${HEADER}\nGood,,1000,,1,5,\nAlso Good,,1000,,1,5,`;
    const result = await importProductsCsv(csv);
    expect(result.created).toBe(1);
    expect(result.failures).toEqual([{ row: 1, reason: 'db down' }]);
  });

  it('rejects a wrong header', async () => {
    await expect(importProductsCsv('nope,price\nx,1')).rejects.toThrow(/header/i);
  });

  it('rejects an empty file', async () => {
    await expect(importProductsCsv('')).rejects.toThrow();
  });

  it('rejects more than 200 data rows', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => `P${i},,100,,1,5,`).join('\n');
    await expect(importProductsCsv(`${HEADER}\n${rows}`)).rejects.toThrow(/200/);
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `pnpm -F @waos/api test -- product-import`
Expected: FAIL (`./product-import.js` does not exist).

- [ ] **Step 8: Implement the import service**

Create `apps/api/src/services/product-import.ts`:
```ts
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
```

- [ ] **Step 9: Run to verify the service passes**

Run: `pnpm -F @waos/api test -- product-import`
Expected: PASS (7 tests). If a schema-refine message differs from the test's expectation, adjust only assertions on message TEXT, never the row numbers/counts.

- [ ] **Step 10: Wire the route and controller**

In `apps/api/src/controllers/product-controller.ts`, add (import `importProductsCsv` from `../services/product-import.js`):
```ts
export const importCsv = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach a .csv file.');
  }
  const result = await importProductsCsv(file.buffer.toString('utf8'));
  res.json(result);
};
```
In `apps/api/src/routes/products.ts`, add below the existing `upload` multer instance:
```ts
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (_req: Request, file, callback: FileFilterCallback) => {
    const isCsv =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv');
    if (!isCsv) {
      callback(new ValidationError('Attach a .csv file.'));
      return;
    }
    callback(null, true);
  },
});
```
and register the route next to the other POSTs:
```ts
productRoutes.post('/import', csvUpload.single('file'), productController.importCsv);
```

- [ ] **Step 11: Add the web client function**

In `apps/web/src/lib/shop-api.ts` (import `importProductsResponseSchema, type ImportProductsResponse` from `@waos/shared`):
```ts
export async function importProductsCsv(file: File): Promise<ImportProductsResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const raw = await apiUpload<unknown>('/api/v1/products/import', formData);
  return importProductsResponseSchema.parse(raw);
}
```

- [ ] **Step 12: Add the import UI to the products page**

Copy, in `apps/web/messages/en.json` `products`:
```json
      "downloadTemplate": "Download template",
      "importCsv": "Import CSV",
      "importing": "Importing...",
      "importedCount": "{count} products imported.",
      "importFailuresTitle": "Rows that failed (fix these in the file and re-upload only them):",
      "importRow": "Row {row}",
      "importError": "Import failed. Check the file and try again.",
      "importDismiss": "Dismiss"
```
and in `sw.json` `products`:
```json
      "downloadTemplate": "Pakua kiolezo",
      "importCsv": "Ingiza CSV",
      "importing": "Inaingiza...",
      "importedCount": "Bidhaa {count} zimeingizwa.",
      "importFailuresTitle": "Safu zilizoshindwa (zirekebishe kwenye faili kisha upakie hizo tu):",
      "importRow": "Safu {row}",
      "importError": "Uingizaji umeshindwa. Angalia faili kisha ujaribu tena.",
      "importDismiss": "Funga"
```
In the page: state + handlers (import `importProductsCsv` from `@/lib/shop-api`, `type ImportProductsResponse` from `@waos/shared`):
```tsx
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportProductsResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const TEMPLATE_CSV =
    'name,description,price,minPrice,stockQty,lowStockThreshold,tags\r\n' +
    '"Shea Hair Butter","Natural shea butter for dry hair",20000,17000,10,5,"hair|butter"\r\n';

  const downloadTemplate = (): void => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'waos-products-template.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async (file: File): Promise<void> => {
    setImportBusy(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await importProductsCsv(file);
      setImportResult(result);
      await queryClient.invalidateQueries({ queryKey: queryKeys.productsRoot });
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : t('importError'));
    } finally {
      setImportBusy(false);
      if (importFileRef.current) {
        importFileRef.current.value = '';
      }
    }
  };
```
Buttons above the Add card (top of the page content):
```tsx
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={downloadTemplate}>
          {t('downloadTemplate')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={importBusy}
          onClick={() => {
            importFileRef.current?.click();
          }}
        >
          {importBusy ? t('importing') : t('importCsv')}
        </Button>
        <input
          ref={importFileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void runImport(file);
            }
          }}
        />
      </div>
```
Result panel (below the buttons):
```tsx
      {importError ? (
        <div className="mb-4">
          <ErrorBox message={importError} />
        </div>
      ) : null}
      {importResult ? (
        <div className="mb-4 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-brand-950">
              {t('importedCount', { count: importResult.created })}
            </p>
            <button
              type="button"
              onClick={() => {
                setImportResult(null);
              }}
              className="text-xs font-medium text-brand-500 hover:text-brand-800"
            >
              {t('importDismiss')}
            </button>
          </div>
          {importResult.failures.length > 0 ? (
            <>
              <p className="mt-2 text-sm text-brand-700">{t('importFailuresTitle')}</p>
              <ul className="mt-1 space-y-1">
                {importResult.failures.map((failure) => (
                  <li key={failure.row} className="text-sm text-red-800">
                    <span className="font-semibold">{t('importRow', { row: failure.row })}:</span>{' '}
                    {failure.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
```

- [ ] **Step 13: Run both gates**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Run: `pnpm -F @waos/web typecheck && pnpm -F @waos/web build`
Expected: all clean; API suite includes the 13 new csv/import tests; parity passes (8 more keys in both locales).

- [ ] **Step 14: Commit**

```bash
git add packages/shared/src/schemas/product.ts apps/api/src/lib/csv.ts apps/api/src/lib/csv.test.ts apps/api/src/services/product-import.ts apps/api/src/services/product-import.test.ts apps/api/src/routes/products.ts apps/api/src/controllers/product-controller.ts apps/web/src/lib/shop-api.ts "apps/web/src/app/[locale]/products/page.tsx" apps/web/messages/en.json apps/web/messages/sw.json
git commit -m "feat(shop): CSV product import with template download and per-row error report"
```

---

### Task 4: Orders page: desktop table with kebab transitions

**Files:**
- Modify: `apps/web/src/app/[locale]/orders/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json`

**Interfaces:**
- Consumes: Task 1 components; existing `TRANSITIONS`, `ACTION_LABEL_KEY`, `statusTone`, `shortId`, `transition(order, status)` in the page; `useRouter` from `@/i18n/navigation` (already imported).

- [ ] **Step 1: Add the new copy to both locales**

In `apps/web/messages/en.json`, inside `orders`:
```json
      "colOrder": "Order",
      "colCustomer": "Customer",
      "colItems": "Items",
      "colTotal": "Total",
      "colDate": "Date",
      "colStatus": "Status",
      "colActions": "Actions"
```
In `apps/web/messages/sw.json`, inside `orders`:
```json
      "colOrder": "Oda",
      "colCustomer": "Mteja",
      "colItems": "Bidhaa",
      "colTotal": "Jumla",
      "colDate": "Tarehe",
      "colStatus": "Hali",
      "colActions": "Vitendo"
```

- [ ] **Step 2: Render the desktop table, keep cards on mobile**

Extend the page's `@/components/ui` import with `Table, TableHeader, Th, TableBody, TableRow, Td, RowActions`. In the non-empty branch, add the table BEFORE the existing `<ul>` and wrap that `<ul>` in `<div className="lg:hidden">` (card markup unchanged):
```tsx
          <Table>
            <TableHeader>
              <Th>{t('colOrder')}</Th>
              <Th>{t('colCustomer')}</Th>
              <Th>{t('colItems')}</Th>
              <Th>{t('colTotal')}</Th>
              <Th>{t('colDate')}</Th>
              <Th>{t('colStatus')}</Th>
              <Th className="text-right">{t('colActions')}</Th>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <Td className="font-mono text-xs text-brand-500">{shortId(order.id)}</Td>
                  <Td className="max-w-[12rem] truncate font-semibold text-brand-950">
                    {order.contact.name ?? order.contact.phone}
                  </Td>
                  <Td className="max-w-[18rem]">
                    <span className="block truncate text-brand-800">
                      {order.items.map((item) => `${item.quantity} x ${item.productName}`).join(', ')}
                    </span>
                  </Td>
                  <Td className="font-semibold whitespace-nowrap">
                    {order.totalAgreed.toLocaleString(locale)} TZS
                  </Td>
                  <Td className="whitespace-nowrap text-brand-600">
                    {new Date(order.createdAt).toLocaleDateString(locale)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(order.status)}>{t(`status${order.status}`)}</Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end">
                      <RowActions
                        label={t('colActions')}
                        actions={[
                          ...TRANSITIONS[order.status].map((target) => ({
                            key: target,
                            label: t(ACTION_LABEL_KEY[target]),
                            tone: target === 'CANCELLED' ? ('danger' as const) : undefined,
                            disabled: busyId === order.id,
                            onSelect: () => void transition(order, target),
                          })),
                          ...(order.conversationId
                            ? [
                                {
                                  key: 'chat',
                                  label: t('viewChat'),
                                  onSelect: () => {
                                    router.push(`/inbox/${order.conversationId ?? ''}`);
                                  },
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                  </Td>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="lg:hidden">
            {/* existing <ul> card list, unchanged */}
          </div>
```
Note: an order whose status has no transitions and no conversation gets an empty kebab; guard by rendering `RowActions` only when the composed `actions` array is non-empty (compute it in a `const actions = [...]` above the JSX and conditionally render, else a muted dash `<span className="text-brand-300">-</span>`).

- [ ] **Step 3: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean; parity passes (7 more keys in both locales).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/[locale]/orders/page.tsx" apps/web/messages/en.json apps/web/messages/sw.json
git commit -m "feat(web): orders table with kebab status transitions"
```

---

## Self-Review

**1. Spec coverage:** Section 3 (Table kit, kebab via existing dropdown-menu, `hidden lg:block`, SearchInput): Task 1. Section 4 (products columns, kebab actions incl. per-image remove, create-with-photo with honest partial-failure notice, edit-mode photos, mobile cards): Task 2. Section 5 (orders columns, kebab transitions + View chat, pills stay, mobile cards): Task 4. Section 6 (template client-side, `POST /products/import`, multer 1MB csv, tested parser, per-row schema validation via `createProductRequestSchema`, `productService.create` per row, 200-row cap, `{created, failures}` response + shared schema, result panel UI): Task 3. Section 7 constraints are in Global Constraints; the template-language clarification is stated there deliberately. Out-of-scope items (sorting, pagination, checkboxes, categories, dedup) appear in no task. Covered.

**2. Placeholder scan:** No TBD/TODO. Step 3 of Task 2 originally sketched two alternatives; it now resolves to the concrete `photoFailed` flag flow. The two `{/* existing <ul> card list */}` comments are instructions to keep already-existing code in place (with the stated `filtered` mapping change in Task 2), not omitted content. All copy is concrete in both locales.

**3. Type consistency:** `RowAction { key, label, tone?, disabled?, onSelect }` (Task 1) matches every actions array built in Tasks 2 and 4 (danger tones cast `as const`). `ThumbCell({ src: string | null, alt })` matches `product.images[0]?.mediaUrl ?? null` and `image.mediaUrl` (nullable in the DTO) and the object-URL string in the form. `importProductsCsv(text)` (API) returns the same `{ created, failures: {row, reason}[] }` the shared schema and the web `importProductsCsv(file)` parse. `parseCsv(text): string[][]` is consumed only by the import service. The controller parses nothing extra (multer file + service). Task 3's page code uses `ApiError`, `queryClient`, `queryKeys.productsRoot`, `useRef`, `useState`, all already imported/present in the page. Consistent.
