# WaOS Revamp Phase C2c: Restyle Wave 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every remaining dashboard screen to the new `@/components/ui` component layer, move each page title into the top header, apply the forms polish (owner-alert E.164 check, numeric money inputs, a consistent Field with an error slot), then delete the legacy kit and prune the orphaned scaffolds.

**Architecture:** Presentation only. Each screen swaps its `@/components/ui-legacy` import for `@/components/ui` (drop-in compatible, proven in C2b) and moves its in-content `<h1>{t('title')}</h1>` into `AppShell`'s `title` prop so the white top header carries the page title on every screen (spec section 4), matching what home already does. Two screens gain real forms polish: settings validates the owner-alert phone client-side against the shared E.164 schema and surfaces the error through a new `Field` error slot; products gives its money and stock inputs numeric input modes. A final cleanup task deletes `ui-legacy.tsx`, prunes the six orphaned shadcn scaffolds, and moves the `shadcn` CLI to devDependencies. No data, API, tenancy, or query-layer change anywhere.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4, next-intl, TanStack Query v5, the `@/components/ui` layer on shadcn/ui, Zod (shared schemas).

## Global Constraints

- **Presentation only.** No data, API, tenancy, business-logic, query-key, or invalidation change. Every screen keeps its existing hooks, queries, handlers, and JSX structure; only imports, the title element, and the two named polish items change. (Spec section 10.)
- **Drop-in component swap.** Every name each screen imports (`Badge`, `Button`, `Card`, `EmptyState`, `ErrorBox`, `Field`, `Input`, `Skeleton`, `Spinner`) exists in the `@/components/ui` barrel and is API-compatible. Do not change a screen's imported symbol list; change only the module path.
- **Title in the top header.** Each page passes `title={t('title')}` to `AppShell` (whose `TopHeader` renders it as the page `<h1>`) and removes its in-content `<h1>{t('title')}</h1>`. Do not render the title in two places. (Spec section 4.)
- **Forms polish, exactly two items.** (1) The owner-alert phone gets an inline client-side E.164 check using the shared schema, with a localized error. (2) Money and stock inputs get clean numeric handling. One consistent `Field` (label, hint, error) is used for the error. (Spec section 7.)
- **Both locales stay complete.** Any new copy ships in `en` and `sw` with key parity. English-only strings are a lint failure. Money renders as `{value.toLocaleString(locale)} TZS` (unchanged from today). (Spec section 10.)
- **No em dashes anywhere. TypeScript strict, no `any`. Conventional commits.** (CLAUDE.md sections 6.1, 6.2, 6.3.)
- **Web gate (no web test runner):** `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build` all clean, then a live drive of the changed screens. Run all three; a green `tsc --noEmit` is required because the build's esbuild transform does not type-check. (Spec section 10; C2b lesson.)

## Deferred (explicitly not in C2c)

- The backend `startOfToday()` helper dedup (dashboard-service + conversation-repository): behavior-preserving backend refactor, off-theme for a presentation phase. Rides.
- The home client/server shop-signal cosmetic (stale-localStorage skeleton-count flicker): cosmetic, self-heals, and re-touching the just-shipped home for near-zero benefit is not worth the risk. Rides.
- Dark-mode toggle, landing/brand page (Phase D). Out of scope per spec section 11.

---

## File Structure

- `apps/web/src/components/ui/field.tsx` — gains an optional `error` prop (Task 4).
- `apps/web/src/app/[locale]/inbox/page.tsx` + `apps/web/src/components/conversation-thread.tsx` — migrate (Task 1).
- `apps/web/src/app/[locale]/appointments/page.tsx`, `.../contacts/page.tsx`, `.../orders/page.tsx` — migrate (Task 2).
- `apps/web/src/app/[locale]/products/page.tsx` — migrate + numeric inputs (Task 3).
- `apps/web/src/app/[locale]/settings/page.tsx` + `apps/web/messages/{en,sw}.json` — migrate + E.164 polish (Task 4).
- `apps/web/src/components/notification-bell.tsx` — migrate + async/await (Task 5).
- `apps/web/src/components/ui-legacy.tsx` (delete), `apps/web/src/components/shadcn/{badge,card,input,separator,skeleton,textarea}.tsx` (delete), `apps/web/package.json` (dep move) — cleanup (Task 6).

**The migration recipe (applies to every screen task below).** For a page whose components import is `import { <names> } from '@/components/ui-legacy';`:
1. Change only the module path to `'@/components/ui'`. Keep `<names>` identical.
2. Change the shell open tag from `<AppShell>` to `<AppShell title={t('title')}>` (or `<AppShell wide>` to `<AppShell wide title={t('title')}>`).
3. Delete the in-content title line `<h1 className="mb-… text-xl font-bold text-brand-900">{t('title')}</h1>`.
4. If that `<h1>` shared a flex row with an action control, keep the action and adjust the row so it still aligns sensibly (for a lone action, `justify-end`).
5. Touch nothing else: no hooks, queries, handlers, other JSX, or the imported symbol list.

---

### Task 1: Migrate the inbox and conversation thread

**Files:**
- Modify: `apps/web/src/app/[locale]/inbox/page.tsx:12` (import), `:94` (`<AppShell wide>`), `:97` (in-content `<h1>`)
- Modify: `apps/web/src/components/conversation-thread.tsx:12` (import)

**Interfaces:**
- Consumes: `@/components/ui` barrel (`Badge`, `EmptyState`, `ErrorBox`, `Input`, `Skeleton` for inbox; `Badge`, `Button`, `ErrorBox`, `Spinner` for thread). `AppShell({ children, wide?, title? })`.
- Produces: nothing.

- [ ] **Step 1: Swap the inbox import**

In `apps/web/src/app/[locale]/inbox/page.tsx`, change line 12:
```tsx
import { Badge, EmptyState, ErrorBox, Input, Skeleton } from '@/components/ui-legacy';
```
to:
```tsx
import { Badge, EmptyState, ErrorBox, Input, Skeleton } from '@/components/ui';
```

- [ ] **Step 2: Move the inbox title into AppShell**

In the same file, change `<AppShell wide>` (line 94) to `<AppShell wide title={t('title')}>`, and delete the in-content title line (line 97):
```tsx
          <h1 className="mb-3 text-xl font-bold text-brand-900">{t('title')}</h1>
```
The inbox is a two-pane layout; preserve it exactly. The `<h1>` sat at the top of the left (conversation-list) pane; removing it lets the search field and list sit under the top header. Do not add a replacement heading.

- [ ] **Step 3: Swap the conversation-thread import**

In `apps/web/src/components/conversation-thread.tsx`, change line 12:
```tsx
import { Badge, Button, ErrorBox, Spinner } from '@/components/ui-legacy';
```
to:
```tsx
import { Badge, Button, ErrorBox, Spinner } from '@/components/ui';
```
The thread is the right pane; it has no page title of its own (its header shows the contact name). Change only the import.

- [ ] **Step 4: Verify no legacy import remains in these two files**

Run: `git grep -nE "ui-legacy" -- "apps/web/src/app/[locale]/inbox/page.tsx" "apps/web/src/components/conversation-thread.tsx"`
Expected: no output.

- [ ] **Step 5: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/[locale]/inbox/page.tsx" apps/web/src/components/conversation-thread.tsx
git commit -m "refactor(web): migrate inbox and thread to the WaOS component layer"
```

---

### Task 2: Migrate appointments, contacts, and orders

**Files:**
- Modify: `apps/web/src/app/[locale]/appointments/page.tsx:12` (import), `:137` (`<AppShell>`), `:139` (`<h1>`)
- Modify: `apps/web/src/app/[locale]/contacts/page.tsx:11` (import), `:80` (`<AppShell>`), `:81` (`<h1>`)
- Modify: `apps/web/src/app/[locale]/orders/page.tsx:12` (import), `:106` (`<AppShell>`), `:107` (`<h1>`)

**Interfaces:**
- Consumes: `@/components/ui` barrel. `AppShell({ children, title? })`.
- Produces: nothing.

Apply the migration recipe (import path, title into AppShell, delete in-content `<h1>`) to each of the three pages. Exact edits:

- [ ] **Step 1: Appointments**

Import (line 12): `'@/components/ui-legacy'` to `'@/components/ui'` (symbols `Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Skeleton` unchanged). Change `<AppShell>` (line 137) to `<AppShell title={t('title')}>`. Delete line 139:
```tsx
        <h1 className="text-xl font-bold text-brand-900">{t('title')}</h1>
```
Appointments has a "new booking" toggle button (`showForm`). If it shared the title's row, keep it and align it with `justify-end`; if it stands alone below, leave it as is.

- [ ] **Step 2: Contacts**

Import (line 11): `'@/components/ui-legacy'` to `'@/components/ui'` (symbols `Badge, Button, EmptyState, ErrorBox, Field, Input, Skeleton` unchanged). Change `<AppShell>` (line 80) to `<AppShell title={t('title')}>`. Delete line 81:
```tsx
      <h1 className="mb-3 text-xl font-bold text-brand-900">{t('title')}</h1>
```

- [ ] **Step 3: Orders**

Import (line 12): `'@/components/ui-legacy'` to `'@/components/ui'` (symbols `Badge, EmptyState, ErrorBox, Skeleton` unchanged). Change `<AppShell>` (line 106) to `<AppShell title={t('title')}>`. Delete line 107:
```tsx
      <h1 className="mb-3 text-xl font-bold text-brand-900">{t('title')}</h1>
```

- [ ] **Step 4: Verify no legacy imports remain in these three files**

Run: `git grep -nE "ui-legacy" -- "apps/web/src/app/[locale]/appointments/page.tsx" "apps/web/src/app/[locale]/contacts/page.tsx" "apps/web/src/app/[locale]/orders/page.tsx"`
Expected: no output.

- [ ] **Step 5: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/[locale]/appointments/page.tsx" "apps/web/src/app/[locale]/contacts/page.tsx" "apps/web/src/app/[locale]/orders/page.tsx"
git commit -m "refactor(web): migrate appointments, contacts, and orders to the WaOS component layer"
```

---

### Task 3: Migrate products and give money inputs numeric modes

**Files:**
- Modify: `apps/web/src/app/[locale]/products/page.tsx:19` (import), `:203` (`<AppShell>`), `:204` (`<h1>`), and the money/stock `<Input>` elements (the four `type="number"` inputs around lines 231-266).

**Interfaces:**
- Consumes: `@/components/ui` barrel (`Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Skeleton`). `AppShell({ children, title? })`.
- Produces: nothing.

- [ ] **Step 1: Apply the migration recipe**

Import (line 19): `'@/components/ui-legacy'` to `'@/components/ui'` (symbols unchanged). Change `<AppShell>` (line 203) to `<AppShell title={t('title')}>`. Delete line 204:
```tsx
      <h1 className="mb-3 text-xl font-bold text-brand-900">{t('title')}</h1>
```
Products has an "add product" affordance; keep it exactly where it is.

- [ ] **Step 2: Add numeric input modes to the money and stock fields**

In the product form, the price, minPrice, stockQty, and lowStockThreshold inputs are `<Input type="number" min={…} …>`. Add `inputMode="numeric"` to each so mobile shows a digit keypad and the field discourages non-integer entry (money and stock are whole integers). Example, the price input:
```tsx
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                required
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                }}
              />
```
Apply the same `inputMode="numeric"` addition to the minPrice, stockQty, and lowStockThreshold inputs. Do not change the existing `type`, `min`, `required`, `value`, `onChange`, or the `Number.parseInt` submit validation; this is a keyboard/affordance hint only.

- [ ] **Step 3: Verify no legacy import remains**

Run: `git grep -nE "ui-legacy" -- "apps/web/src/app/[locale]/products/page.tsx"`
Expected: no output.

- [ ] **Step 4: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/[locale]/products/page.tsx"
git commit -m "refactor(web): migrate products and add numeric input modes to money and stock fields"
```

---

### Task 4: Migrate settings, add a Field error slot, and validate the owner-alert phone

**Files:**
- Modify: `apps/web/src/components/ui/field.tsx` (add `error` prop)
- Modify: `apps/web/src/app/[locale]/settings/page.tsx:12` (import), `:188` (`<AppShell>`), `:189` (`<h1>`), plus owner-alert phone validation
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (one new key)

**Interfaces:**
- Consumes: `@/components/ui` barrel; `updateShopSettingsRequestSchema` from `@waos/shared` (already exported; its `.shape.ownerAlertPhone` is `z.string().regex(/^\+[1-9]\d{6,14}$/).nullable().optional()`). `AppShell({ children, title? })`.
- Produces: `Field({ label, children, hint?, error? })` (the `error` prop is consumed only here in C2c, but is a shared component addition).

- [ ] **Step 1: Add an optional error slot to Field**

Replace the full contents of `apps/web/src/components/ui/field.tsx` with:
```tsx
import type { ReactNode } from 'react';

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-brand-900">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-700">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-brand-600">{hint}</span>
      ) : null}
    </label>
  );
}
```
The `error` prop is optional and, when set, replaces the hint with red error text. Every existing `Field` usage is unaffected (no `error` passed).

- [ ] **Step 2: Apply the migration recipe to settings**

Import (line 12): `'@/components/ui-legacy'` to `'@/components/ui'` (symbols `Badge, Button, Card, ErrorBox, Field, Input, Skeleton` unchanged). Change `<AppShell>` (line 188) to `<AppShell title={t('title')}>`. Delete line 189:
```tsx
      <h1 className="mb-4 text-xl font-bold text-brand-900">{t('title')}</h1>
```

- [ ] **Step 3: Add the localized invalid-phone copy (both locales)**

In `apps/web/messages/en.json`, inside the `settings` object, add:
```json
      "ownerAlertPhoneInvalid": "Enter a valid WhatsApp number in international format, e.g. +255712345678."
```
In `apps/web/messages/sw.json`, inside the `settings` object, add:
```json
      "ownerAlertPhoneInvalid": "Weka namba sahihi ya WhatsApp katika muundo wa kimataifa, mfano +255712345678."
```
(Match the surrounding comma style; do not leave a trailing comma after the last key of the object.)

- [ ] **Step 4: Add the client-side E.164 check**

In `apps/web/src/app/[locale]/settings/page.tsx`:

First, ensure `updateShopSettingsRequestSchema` is imported from `@waos/shared` (add it to the existing `@waos/shared` import if not already present):
```tsx
import { updateShopSettingsRequestSchema } from '@waos/shared';
```

Add a phone-error state alongside the existing owner-alert state (near line 39, next to `ownerAlertPhone`):
```tsx
  const [ownerAlertPhoneError, setOwnerAlertPhoneError] = useState<string | null>(null);
```

In the submit handler, at the point where the owner-alert phone is prepared (around line 169, where `const trimmedPhone = ownerAlertPhone.trim();` is computed), validate a non-empty phone with the shared schema and block the save on failure:
```tsx
      const trimmedPhone = ownerAlertPhone.trim();
      if (trimmedPhone !== '' && !updateShopSettingsRequestSchema.shape.ownerAlertPhone.safeParse(trimmedPhone).success) {
        setOwnerAlertPhoneError(t('ownerAlertPhoneInvalid'));
        return;
      }
      setOwnerAlertPhoneError(null);
```
Place this before the shop-settings request is sent, and ensure the early `return` sits before any busy-state is left hanging (if the handler set a busy flag, clear it before returning, matching the file's existing error-path pattern).

Finally, pass the error into the owner-alert phone `Field` (around line 299):
```tsx
                <Field label={t('ownerAlertPhone')} hint={t('ownerAlertPhoneHint')} error={ownerAlertPhoneError ?? undefined}>
```

- [ ] **Step 5: Verify no legacy import remains**

Run: `git grep -nE "ui-legacy" -- "apps/web/src/app/[locale]/settings/page.tsx"`
Expected: no output.

- [ ] **Step 6: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean. Lint also enforces en/sw key parity for the new key.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui/field.tsx "apps/web/src/app/[locale]/settings/page.tsx" apps/web/messages/en.json apps/web/messages/sw.json
git commit -m "feat(web): migrate settings and validate the owner-alert phone client-side"
```

---

### Task 5: Migrate the notification bell and convert its promise chain

**Files:**
- Modify: `apps/web/src/components/notification-bell.tsx:10` (import), `:79-80` (promise chain)

**Interfaces:**
- Consumes: `@/components/ui` barrel (`Skeleton`).
- Produces: nothing.

- [ ] **Step 1: Swap the import (relative to barrel)**

In `apps/web/src/components/notification-bell.tsx`, change line 10:
```tsx
import { Skeleton } from './ui-legacy';
```
to:
```tsx
import { Skeleton } from '@/components/ui';
```

- [ ] **Step 2: Convert the `.then().catch()` chain to async/await**

Around lines 78-80 the mark-read handler ends with a floating promise chain:
```tsx
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot }))
      .catch(() => {});
```
Read the enclosing handler (the function that owns this chain, starting a few lines above line 78). Convert it to `async`/`await` with a `try`/`catch`, matching the codebase's async style (CLAUDE.md section 6.6: no `.then()` chains, no floating promises). The behavior must be identical: after the mark-read call resolves, invalidate `queryKeys.notificationsRoot`; swallow errors (the bell badge staying stale on a failed mark-read is acceptable and matches today). For example, if the handler is `const handleX = () => { someCall().then(() => queryClient.invalidateQueries(...)).catch(() => {}); }`, rewrite as:
```tsx
  const handleX = async (): Promise<void> => {
    try {
      await someCall();
      await queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot });
    } catch {
      // A failed mark-read leaves the badge stale until the next refresh; acceptable.
    }
  };
```
Preserve the exact call being awaited and its arguments, and keep the invocation site working (if the handler is passed to `onClick`, an `async` handler returning `void` is fine; if the site expects a sync call, wrap with `void handleX()`). Do not change what the handler does.

- [ ] **Step 3: Verify no legacy import remains**

Run: `git grep -nE "ui-legacy|\\.then\\(" -- apps/web/src/components/notification-bell.tsx`
Expected: no output (no legacy import, no `.then(` chain).

- [ ] **Step 4: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean (the `no-floating-promises` rule is satisfied).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notification-bell.tsx
git commit -m "refactor(web): migrate the notification bell and await its invalidation"
```

---

### Task 6: Delete the legacy kit, prune orphaned scaffolds, fix the dependency

**Files:**
- Delete: `apps/web/src/components/ui-legacy.tsx`
- Delete: `apps/web/src/components/shadcn/badge.tsx`, `card.tsx`, `input.tsx`, `separator.tsx`, `skeleton.tsx`, `textarea.tsx`
- Modify: `apps/web/package.json` (move `shadcn` to devDependencies)

**Interfaces:**
- Consumes: the fact that Tasks 1-5 removed every `ui-legacy` import.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing imports the legacy kit anymore**

Run: `git grep -nE "ui-legacy" -- apps/web/src`
Expected: no output. If anything prints, a screen was missed in Tasks 1-5; stop and report it (do not delete the file with live importers).

- [ ] **Step 2: Delete the legacy kit**

```bash
git rm apps/web/src/components/ui-legacy.tsx
```

- [ ] **Step 3: Confirm the six shadcn scaffolds are orphaned, then delete them**

The `@/components/ui` layer has its own `badge`, `card`, `input`, `separator`, `skeleton`, and `textarea`; the shadcn scaffolds of those names are unused duplicates. Keep `button.tsx` (imported by `shadcn/dialog.tsx`), `dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, and `switch.tsx` (re-exported by the barrel).

First verify the six are imported nowhere:
```bash
git grep -nE "shadcn/(badge|card|input|separator|skeleton|textarea)" -- apps/web/src
```
Expected: no output. Then delete them:
```bash
git rm apps/web/src/components/shadcn/badge.tsx apps/web/src/components/shadcn/card.tsx apps/web/src/components/shadcn/input.tsx apps/web/src/components/shadcn/separator.tsx apps/web/src/components/shadcn/skeleton.tsx apps/web/src/components/shadcn/textarea.tsx
```

- [ ] **Step 4: Move the shadcn CLI to devDependencies**

In `apps/web/package.json`, `shadcn` is the scaffolding CLI and is never imported by app code, so it belongs in `devDependencies`. Move the `"shadcn": "^4.13.0"` entry from `"dependencies"` to `"devDependencies"` (create the `devDependencies` block if the file has none, keeping keys alphabetically sorted to match the file's convention). Leave `class-variance-authority`, `lucide-react`, `radix-ui`, and `tw-animate-css` in `dependencies`: the first three are imported by shipped components and `tw-animate-css` is imported by `globals.css` at build time.

Then reinstall so the lockfile reflects the move:
```bash
pnpm install
```
Expected: lockfile updates with no dependency resolution errors.

- [ ] **Step 5: Confirm the shadcn CLI import is truly absent from app code**

Run: `git grep -nE "from 'shadcn'|from \"shadcn\"|require\('shadcn'\)" -- apps/web/src`
Expected: no output (confirming the move to devDependencies is safe).

- [ ] **Step 6: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean. This proves the deletions broke nothing and the build does not need the pruned files or the relocated CLI.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ui-legacy.tsx apps/web/src/components/shadcn/ apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): delete the legacy ui kit, prune orphaned shadcn scaffolds, move shadcn to devDependencies"
```

---

## Self-Review

**1. Spec coverage (C2 spec sections mapped to tasks):**
- Section 5 (every screen restyled on the new layer; consistent header; data untouched): Tasks 1-5 migrate inbox+thread, appointments, contacts, orders, products, settings, and the bell. Home and auth/onboarding were C2b. All authed screens now carry their title in the top header (section 4). Covered.
- Section 7 (forms polish: inline E.164 owner-alert check via the importable shared schema; clean numeric money inputs; one consistent Field with label/hint/error): Task 4 (E.164 + Field error slot) and Task 3 (numeric money/stock inputs). Covered.
- Section 8 / 9 (migrate off `ui.tsx`; once every screen migrated, delete it): Task 6 deletes `ui-legacy.tsx` (the renamed `ui.tsx`) after Tasks 1-5, and prunes the orphaned shadcn scaffolds. Covered.
- Section 12 success criteria (`ui.tsx` gone; all screens on the WaOS layer; en/sw parity; typecheck+lint+build pass): Task 6 removes the legacy kit; the per-task web gates and the new-key parity in Task 4 hold the rest. Covered.
- Riders folded: notification-bell `.then().catch()` to async/await (Task 5); shadcn dependency placement (Task 6). The two off-theme riders (startOfToday, home cosmetic) are explicitly deferred in the Deferred section, with reasons.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". The migration recipe is stated once and then applied with exact per-file line numbers and exact edits in each task (self-contained, not cross-referenced for the actual code). Every code step shows complete code or an exact, unambiguous edit; every command step shows the command and expected output. The Swahili string is a concrete value.

**3. Type consistency:**
- `Field`'s new signature `({ label, children, hint?, error? })` (Task 4 Step 1) matches its single new usage `error={ownerAlertPhoneError ?? undefined}` (Task 4 Step 4). `ownerAlertPhoneError` is `string | null`, coerced to `string | undefined` for the optional prop.
- `updateShopSettingsRequestSchema.shape.ownerAlertPhone.safeParse(trimmedPhone).success` (Task 4) uses the real exported shared schema; `.shape` is available on a `z.object`.
- `AppShell({ children, wide?, title? })` is the real signature; every screen passes `title={t('title')}` and inbox additionally keeps `wide`.
- Every screen's imported symbol list is preserved exactly (verified against the recon import lines); only the module path changes, so no name resolves to a missing export.
- Task 6's deletions are gated on Tasks 1-5 having removed all `ui-legacy` importers (Step 1 verifies), and on the six shadcn scaffolds being importer-free (Step 3 verifies), so no dangling import survives.

No issues found; the plan is internally consistent.
