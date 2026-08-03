# WaOS Sourcing Module (supplier directory)

Date: 2026-08-03
Status: Approved by Edward (direction and section-level design, 2026-08-03).
One implementation plan follows before code.

## 1. Summary

Importers (buying in China, Dubai, Turkey and selling in Tanzania) need to
remember where they source goods. Standing in a market in Guangzhou, they find
a shop selling handbags at 45 yuan; they need to capture that in seconds, and
six months later answer: "where did I get these, and what did they cost?"

The sourcing module is a private buying directory:

- **Suppliers**: the shops and dealers they buy from (name, country and city,
  market or building, address, contact, notes).
- **Sourced items**: what each supplier sells, with the price as quoted in
  that country's currency, the unit it applies to, minimum order quantity,
  and photos snapped in the market.
- **Global item search**: one search across every item from every supplier,
  so "handbag" answers with each shop that had it and what each quoted.

This is cost intelligence, not catalog data. It is never shown to customers
and never reaches the AI.

## 2. Decisions made (with Edward, 2026-08-03)

| Decision | Choice |
| --- | --- |
| Placement | A new `sourcing` business module alongside `appointments` and `shop`, enabled per organization. A pure importer gets it without the selling machinery; a shop owner who also imports enables both. |
| Prices | Amount plus the currency it was quoted in (CNY, USD, TZS, AED, EUR, TRY, KES, ZAR, GBP, INR). No conversion, no live rates: an honest record of what the supplier actually said. |
| CSV import | In v1, for both suppliers and items, reusing the existing parser and template flow. |
| Photos | Optional, attached at creation, reusing the product-image upload pattern (MinIO + presigned URLs). |

## 3. Data model

Two new Prisma models, both carrying `organizationId` and indexed on it
(CLAUDE.md section 7).

**Supplier**
- `name` (required), `country` (required, ISO-3166 alpha-2 stored uppercase,
  e.g. `CN`), `city`, `market` (market or building name), `address`,
  `contactName`, `contactPhone`, `contactNote` (WeChat/WhatsApp handles),
  `notes` (free text).
- `items SourcedItem[]`, timestamps.

**SourcedItem**
- `supplierId` (required, `onDelete: Cascade`: deleting a supplier removes its
  items), `name` (required), `description`.
- `priceAmount Int` (required, **minor units** of the quoted currency, so
  45.50 CNY is stored as `4550`; CLAUDE.md's money rule), `priceCurrency`
  (ISO-4217, uppercase, e.g. `CNY`), `unit` (free text: "per piece", "per
  carton of 50"), `moq Int?` (minimum order quantity).
- `notes`, `images SourcedItemImage[]`, timestamps.

**SourcedItemImage**: `mediaKey` (MinIO), mirroring `ProductImage` minus the
AI-written description (no vision pass here; these are the owner's reference
photos, not sales material).

No `embedding` column on either model. That is deliberate, see section 6.

## 4. Screens and UX

Phone-first, reusing the component layer built for products and orders (the
desktop `Table` kit, `RowActions` kebab, `SearchInput`, cards under `lg`).

- **Suppliers list** (`/suppliers`): search across name, city, and market;
  table columns name, country and city, market, item count, kebab (edit,
  view items, delete with confirm). Empty state teaches the workflow: "Add
  the shops you buy from, then record what they sell."
- **Supplier detail** (`/suppliers/[id]`): the shop's contact card (with a
  tap-to-call phone link on mobile), then its items as a table (thumbnail,
  name, price with currency, unit, MOQ, kebab) with search within. **"Add
  item" is the primary action**, prominent, because capturing in the market
  is the core loop.
- **Add or edit item form**: name, price plus a currency picker that defaults
  to the supplier's country currency (in China it is already CNY), unit, MOQ,
  optional photo at creation with preview, notes. Only name and price are
  required; big tap targets throughout.
- **Global item search** (`/sourcing`): one box across every item of every
  supplier, each result showing the item, its price and currency, and which
  supplier and city it came from, linking to that supplier. This answers the
  six-months-later question and is the module's payoff.
- **CSV import**: on the suppliers list (suppliers template) and on the
  supplier detail (items template for that supplier), reusing the existing
  download-template, upload, and per-row failure report flow.

Prices render as the amount formatted from minor units with a currency code
suffix (for example `45.50 CNY`), consistent with how the app already shows
`{value} TZS`.

## 5. API

New routes under `/api/v1/suppliers`, all behind `requireAuth` and
`requireModule('sourcing')`, mirroring the products router:

- `GET|POST /suppliers`, `PATCH|DELETE /suppliers/:id`
- `GET|POST /suppliers/:id/items`, `PATCH|DELETE /suppliers/:supplierId/items/:itemId`
- `POST /suppliers/:supplierId/items/:itemId/images` (multer, image, 5MB),
  `DELETE /.../images/:imageId`
- `POST /suppliers/import` and `POST /suppliers/:id/items/import` (multer,
  csv, 1MB), returning the existing `{ created, failures }` shape
- `GET /sourced-items?q=` for the global search (name and description match,
  org-scoped, returning each item with its supplier's name and city)

Zod schemas for every boundary live in `packages/shared`.

## 6. The safety invariant (non-negotiable)

Supplier prices are the owner's buying costs: the most commercially sensitive
data in the system. Stricter than `Product.minPrice`, which at least the
negotiation code reads.

- **No AI access at all.** No sourcing tool is added to the agent loop, no
  sourcing text enters any prompt, and no sourcing data appears in any tool
  result. The AI physically has no way to read it.
- **No embeddings.** Neither model gets an embedding column, so nothing can
  surface through `search_knowledge` or `search_products`, which query the
  same vector store.
- **Owner and staff only**, tenant-scoped through the existing Prisma tenant
  extension like every other domain table.
- **Never logged**: ids and metadata only, per CLAUDE.md section 6.8.

A test asserts the module registers no agent tools, so a future change cannot
quietly expose costs to customers.

## 7. Boundaries and constraints

- Additive: new models, new routes, new module value. No existing model,
  endpoint, or AI behavior changes. Adding `sourcing` to the `BusinessModule`
  enum is additive; existing organizations keep their modules untouched.
- Money as integers in minor units; no payment processing anywhere (Phase 1
  ban stands, and nothing here moves money).
- Both locales complete (`en` and `sw`), enforced by `pnpm check:i18n`.
- No em dashes, TypeScript strict, no `any`, conventional commits.
- Services with logic get Vitest tests: supplier and item CRUD scoping, the
  CSV import row validation, the global search, and the no-AI-tools assertion.
- Gates: API `typecheck && test && lint`; web `typecheck && lint && build`
  plus a live drive.

## 8. Out of scope (explicitly)

- Currency conversion, exchange rates, and landed-cost calculators.
- Linking a sourced item to a catalog `Product` (the obvious next step once
  the directory is in daily use, but it needs its own thinking about how
  cost and selling price relate).
- Purchase orders, shipment tracking, supplier ratings and reviews.
- Sharing supplier lists between organizations.

## 9. Sequencing (decomposition)

One implementation plan, subagent-driven, roughly five tasks:

1. **Model and module**: Prisma models plus migration, tenant-extension
   registration, `sourcing` added to `BusinessModule`, shared Zod schemas,
   nav entry and route gating.
2. **Suppliers**: repository, service, controller, routes, and the suppliers
   list screen with search and kebab actions.
3. **Sourced items**: repository, service, routes including images, and the
   supplier detail screen with the add or edit item form and photo at
   creation.
4. **Global item search**: the `GET /sourced-items?q=` endpoint and the
   `/sourcing` screen.
5. **CSV import**: both templates, both endpoints reusing the existing
   parser, and the import UI on both screens.

## 10. Success criteria

- An importer can add a supplier and record items with prices in the currency
  quoted, with a photo, from a phone in under a minute.
- Searching "handbag" across all suppliers returns every shop that had it,
  each with its own quoted price and city.
- A CSV of suppliers or items imports with per-row failure reporting.
- The sourcing module is invisible to organizations that have not enabled it.
- No sourcing data can reach the AI: the no-tools test passes and no
  embedding column exists on either model.
- en and sw parity holds; API and web gates pass.
