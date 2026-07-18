# WaOS Shop Tables, Create-with-Photo, and CSV Import

Date: 2026-07-18
Status: Approved by Edward (direction and section-level design, 2026-07-18).
One implementation plan follows before code.

## 1. Summary

Three owner-experience upgrades to the shop screens:

1. **Products and Orders render as tables on desktop** (search, thumbnail,
   badges, a per-row kebab menu), keeping the existing compact cards on
   phones. WaOS is phone-first; the table is a desktop enhancement, not a
   replacement.
2. **The Add Product form accepts an optional photo at creation time** with a
   preview, instead of photo-only-after-save. Editing shows current photos
   with add/remove.
3. **CSV import**: the owner downloads a template, fills it in Excel or
   Google Sheets, uploads it, and valid rows become products. Invalid rows
   are reported per-row (row number + reason) without blocking the valid
   ones.

Presentation plus one additive API endpoint. No data-model change, no
existing endpoint changed, no payments.

## 2. Decisions made (with Edward, 2026-07-18)

| Decision | Choice |
| --- | --- |
| Mobile behavior | Responsive: full table on `lg:` and up, existing compact cards below. Never a horizontally scrolling table on phones. |
| Import format | CSV template, generated client-side. Opens directly in Excel/Sheets. No spreadsheet library added. Photos cannot travel in a spreadsheet; they are added per product after import. |
| Import errors | Partial import: valid rows are created; failures come back as a per-row report (row number + reason) to fix and re-upload. |
| Reference look | Edward's screenshot: clean header row, thumbnail column, stock with low-stock badge, price, status chip, kebab (⋮) actions column, search above. |

## 3. The WaOS Table component

A reusable, presentation-only `Table` in `apps/web/src/components/ui/`:

- Header row (muted, small caps style per the design system), white rows with
  hover tint, rounded card frame consistent with the existing surfaces.
- Cell building blocks used by the pages: a 40px thumbnail tile (image or a
  neutral placeholder), text cells, `Badge` cells, and an actions cell hosting
  a kebab `DropdownMenu` (already exported by the `@/components/ui` barrel).
- The component is a styled composition (`table/thead/tbody` with slots), not
  a data grid: pages own their data, filtering, and actions and pass rows in.
  No sorting/pagination in this phase (catalogs are small; search covers
  finding things). Add later when a real catalog outgrows one page.
- Visibility: the table wrapper is `hidden lg:block`; each page renders its
  existing card list inside `lg:hidden`. One data source, two presentations.
- A `SearchInput` sits above the products table (client-side name filter);
  orders keep their status filter pills.

## 4. Products page

- **Table columns**: thumbnail (first image or placeholder), name (with
  description snippet), price (`{n.toLocaleString(locale)} TZS`), stock
  (number + `warning` badge at/below `lowStockThreshold`, `danger` badge at
  0), status (Active/Inactive `Badge`), kebab actions.
- **Kebab actions** (all existing behaviors, relocated): Edit, Add photo,
  Remove photo (per image, when present), Activate/Deactivate, Delete
  (keeps the confirm).
- **Create with photo**: the Add form gains an optional photo picker (same
  `image/*`, 5MB limit as the existing upload) with a thumbnail preview and a
  remove (×). Submit flow: `createProduct(...)` then, only if a photo was
  chosen, `uploadProductImage(newId, file)`. Both client calls exist today;
  no API change. If create succeeds but the photo upload fails, the product
  is kept and the form shows a clear "product saved, photo failed, add it
  from the list" notice (never a fake total failure). Edit mode shows the
  product's current photos with the same add/remove controls.
- Mobile cards keep all the same actions they have today.

## 5. Orders page

- **Table columns**: short id (mono), customer (name or phone), items summary
  ("2 x Shea Butter, 1 x ..." truncated), total (TZS), created date, status
  `Badge`, kebab actions.
- **Kebab actions**: the existing status transitions (Confirm, Mark paid,
  Fulfil, Cancel with confirm) plus "View chat" when `conversationId` is set.
- The status filter pills stay above the table. Mobile keeps the current
  cards with inline transition buttons.

## 6. CSV import

- **Template**: a client-generated `.csv` download (a Blob; no endpoint) with
  header `name,description,price,minPrice,stockQty,lowStockThreshold,tags`
  and one example row. `tags` is a `|`-separated list inside one CSV cell
  (e.g. `hair|butter`), documented in the example row.
- **Upload**: `POST /api/v1/products/import` (new, additive). Multipart
  single file via multer (memory storage, `text/csv` or `.csv`, 1MB limit),
  same route pattern as the knowledge upload; behind `requireAuth` +
  `requireModule('shop')` like every product route.
- **Server flow**: parse the CSV with a small, Vitest-tested parser that
  handles quoted fields (commas and newlines inside quotes, doubled quotes);
  map each data row to a create payload; validate each row with the existing
  `createProductRequestSchema` (so minPrice-above-price and every other rule
  fails exactly like the form); create valid rows through the normal
  `productService.create` so embeddings and any side effects behave
  identically to a manual create. Row cap: 200 rows per file (a clear error
  beyond that), keeping the request small and the embedding burst bounded.
- **Response**: `{ created: number, failures: [{ row: number, reason: string }] }`
  (row numbers are 1-based data rows, excluding the header). Zod response
  schema in `packages/shared`.
- **UI**: "Download template" and "Import CSV" buttons in the products
  header area. After upload, a result panel: "N products imported" plus a
  list of failed rows with reasons; failures can be fixed in the file and
  re-uploaded (re-importing a fixed file may duplicate already-created rows;
  the report tells the owner to re-upload only the fixed rows, and duplicate
  names are allowed by the model so nothing breaks).

## 7. Boundaries and constraints

- Presentation + one additive endpoint. No Prisma model change, no existing
  endpoint or schema changed (the shared package only gains the import
  response schema).
- Tenancy: the import endpoint runs under the tenant context like every
  product route; `productService.create` is already org-scoped.
- Both locales complete: all new copy (table headers, kebab labels, import
  buttons, result panel, template example strings) ships in `en` and `sw`;
  `pnpm lint` enforces key parity.
- No em dashes; strict TS, no `any`; conventional commits. The CSV parser
  and the import service get Vitest tests (parser edge cases; a mixed
  valid/invalid file returns the right created count and per-row reasons).
- Gates: API `pnpm -F @waos/api typecheck && test && pnpm lint`; web
  `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build` plus
  a live drive of both screens, desktop and mobile.

## 8. Out of scope (explicitly)

- Sorting, pagination, column pickers, bulk row selection (the screenshot's
  checkboxes), and date-range filters: later, when catalog size demands.
- Import de-duplication/upsert-by-name and photo import: later.
- Categories (the screenshot's Category column): WaOS products have `tags`,
  which the import fills; a category UI is not in this phase.
- Any change to orders beyond presentation (transitions stay as they are).

## 9. Sequencing (decomposition)

One implementation plan, subagent-driven, roughly four tasks:

1. **Table primitives**: the `Table` component (+ thumbnail/actions cell
   helpers, `SearchInput`) in the ui layer, exported from the barrel.
2. **Products page**: desktop table + search, kebab actions, create-with-photo
   (picker, preview, chained upload, partial-failure notice), edit-mode
   photos; mobile cards preserved; en+sw copy.
3. **CSV import**: shared response schema; API parser + import service +
   route + tests; template download + upload UI + result panel; en+sw copy.
4. **Orders page**: desktop table + kebab transitions; mobile cards
   preserved; en+sw copy.

## 10. Success criteria

- Desktop products and orders render as tables matching the reference look;
  phones keep the compact cards; every existing action still works from the
  kebab (and from the cards on mobile).
- A product can be created with a photo in one submit; a failed photo upload
  never loses the created product.
- The template downloads, fills in Excel/Sheets, uploads; valid rows import
  and failures come back with row numbers and reasons; a mixed file creates
  exactly its valid rows.
- en/sw parity holds (`pnpm lint`); API suite (parser + import tests) green;
  web gate green; live drive confirms both screens on both widths.
