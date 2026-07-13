# WaOS Revamp Phase C2: Visual Design

Date: 2026-07-13
Status: Approved by Edward (direction and section-level design). Each
sub-phase (C2a, C2b, C2c) gets its own implementation plan before code.

## 1. Summary

C2 is the visual revamp of the dashboard. C1 already rebuilt the data
plumbing (TanStack Query, socket-driven invalidation, runtime-validated
reads, central auth guard) and installed the tools this phase consumes:
the shadcn/ui primitive kit under `apps/web/src/components/shadcn`, the
brand CSS variables mapped in both `:root` and `.dark`, and self-hosted
Inter via `next/font/local`. All of that sits installed and unused. C2
turns it into the finished look.

Nothing about data or backend behavior changes in C2. Every API contract,
the C1 query layer, tenancy, and all business logic stay exactly as they
are. C2 is presentation only.

## 2. Decisions made (with Edward, 2026-07-13)

| Decision | Choice |
| --- | --- |
| Aesthetic intensity | Warm and branded: clean legible surfaces for data, unmistakably WaOS, deep-green sidebar anchor, amber rationed for key actions. |
| Dark mode | Light theme only this phase. The `.dark` tokens stay mapped and unused; a dark-mode toggle is a later fast-follow, not part of C2. |
| Mobile navigation | Bottom tab bar of 4 primary destinations plus a More sheet for the rest. Desktop gets a full sidebar. |

## 3. The visual system (warm and branded, light)

- **Base surface**: a faintly green-tinted near-white background (brand-50
  family), not cold grey. Content lives on white cards with soft borders
  (brand-100) and gentle shadows.
- **Brand anchor**: the desktop sidebar is deep green (brand-800/900) with
  light text. It is the single strong block of brand color; the rest of the
  chrome stays light so data reads cleanly.
- **Amber, rationed**: accent-500 is reserved for primary buttons, the
  inbox "take over" action, and attention highlights. Sparing use keeps it
  a signal, not decoration.
- **Semantic colors keep their meaning**: green (connected, success), amber
  (pending, needs attention), red (failed, danger), violet (AI). The AI
  violet identity from the thread bubbles is preserved.
- **Typography**: Inter throughout, with a clear scale expressed through
  size and weight (page title, section heading, body, caption). Headings
  reference `--font-heading` (currently Inter) at heavier weights.
- **Shape**: the established radius scale (cards rounded-xl/2xl, inputs
  rounded-lg) for the soft, friendly feel that matches the landing page.
- **Density**: comfortable but efficient. Mobile keeps generous tap targets
  (min-h-11/12 already the norm); desktop tightens.

## 4. The shell

### Desktop (lg and up)

- A fixed left **sidebar** in deep green: WaOS wordmark at the top, a
  vertical nav of icon-plus-label items (lucide icons), an active-state
  treatment (a lighter-green pill or an amber indicator), and the
  organization name plus a logout control pinned at the bottom. Nav items
  are filtered by enabled modules exactly as today.
- A white **top header** across the content area holding the current page
  title, the notification bell, and the language switcher.
- The main content column sits between them, max-width constrained per
  screen as today (the inbox stays wide).

### Mobile

- The same top **header** (wordmark, bell, language switcher).
- A thumb-reach **bottom tab bar** with 4 primary destinations: Home,
  Messages, the business's key module screen (Orders for a shop, else
  Appointments), and **More**. Active tab uses the brand green or amber
  indicator.
- **More** opens a sheet (shadcn Sheet or Dialog) listing every remaining
  destination: Settings, Contacts, and whichever module screens are not in
  the primary four. This adapts to enabled modules and never overflows.

The notification bell (built in B2) moves into the header on both layouts.

## 5. Screens

Every screen is restyled on the new WaOS component layer. Data and logic
are untouched (C1 owns those); only presentation changes. Each screen gets:

- A consistent page header (title, optional action).
- Cards, spacing, and typography from the system above.
- Shared loading, empty, and error states (skeletons, EmptyState,
  ErrorBox) so every screen behaves the same.

Screens in scope: home, inbox (two-pane) and the chat thread, appointments,
products, orders, contacts, settings, login, signup, and the five
onboarding steps. The inbox two-pane split and the thread structure are
preserved and restyled, not rebuilt.

## 6. Home dashboard: sales KPIs

The home screen gains a module-aware stat grid at the top:

- **Booking businesses** (appointments module): conversations today,
  handoffs pending, AI deflection percent, upcoming appointments (as
  today).
- **Shop businesses** (shop module): additionally orders today, revenue
  agreed this week (sum of the week's confirmed order totals), pending
  confirmations, and low-stock product count.
- A business with both modules sees both sets.

Below the grid, a recent-activity strip surfaces upcoming appointments
and/or orders awaiting confirmation, linking into the relevant screen.

The shop KPIs need a small read-only dashboard extension on the API (a
sales-summary that the existing dashboard endpoint returns for shop orgs).
This is additive and read-only; it does not change any existing behavior.

## 7. Forms polish

- Inline client-side validation before submit: the owner-alert phone gets
  an E.164 check with a localized error (the shared schema is importable
  client-side), money inputs get clean numeric handling.
- One consistent Field style (label, hint, error) built on the shadcn
  Input, applied everywhere.

## 8. Component strategy

Build a thin WaOS component layer on top of the shadcn primitives rather
than scattering shadcn imports across screens:

- Wrappers over shadcn: Button, Card, Input, Textarea, Select, Badge,
  Skeleton, Dialog/Sheet, Separator, Switch, DropdownMenu.
- App-specific components: Field, EmptyState, ErrorBox, Spinner,
  PageHeader, StatCard, and the shell pieces (Sidebar, TopHeader,
  BottomNav, MoreSheet).
- Icons via lucide-react.

Screens migrate from the old hand-rolled `apps/web/src/components/ui.tsx`
to this layer. Once every screen has migrated, `ui.tsx` is deleted. The
migration is screen-by-screen so each step is reviewable and the app stays
runnable throughout.

## 9. Sequencing (decomposition)

C2 decomposes into three sub-phases, each its own spec-free implementation
plan and subagent-driven execution (the design in this document is the
shared spec):

- **C2a: component layer and shell.** Build the WaOS component layer on the
  shadcn primitives, then the new shell (desktop sidebar, top header,
  mobile bottom-tabs plus More sheet). Ships the new frame around
  still-old-styled screens; the screens keep working via the old `ui.tsx`
  until their turn.
- **C2b: restyle wave 1.** Home (with the new sales KPIs and the additive
  dashboard API extension), login, signup, and the onboarding steps.
- **C2c: restyle wave 2.** Inbox and thread, appointments, products,
  orders, contacts, settings; the forms polish; delete `ui.tsx`; and fold
  in the small C1 leftover minors (the bell's `.then().catch()` chain, the
  shadcn dependency placement, and similar).

The dark-mode toggle is a separate later fast-follow, per the decision
above, not part of C2.

## 10. Binding constraints

- Presentation only: no data, API, tenancy, or business-logic change. C1's
  query layer and every backend contract stay intact. A restyle that alters
  a query key, an invalidation, or an endpoint is out of scope.
- Both locales stay complete: any new copy (KPI labels, the More menu,
  validation messages) ships in English and Swahili, with parity enforced.
- No em dashes anywhere. TypeScript strict, no `any`. Conventional commits.
- The web app has no test runner; web work gates on
  `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
  plus a live drive. The additive dashboard API extension in C2b gets a
  Vitest unit test like every other service change.
- Accessibility: nav and interactive controls keep accessible labels and
  focus states; the shadcn primitives carry Radix a11y, and custom shell
  pieces match.

## 11. Out of scope (explicitly)

- Dark-mode toggle (deferred fast-follow; tokens already exist).
- The landing and marketing page (that is Phase D, the brand refresh).
- Any new product feature or screen: C2 restyles what exists, it does not
  add capabilities beyond the home KPI grid.
- Payment processing, broadcasts, Cloud API (unchanged platform-wide bans).

## 12. Success criteria

- Every dashboard screen and both shell layouts render in the warm-branded
  system, consistent and legible, on mobile and desktop.
- The mobile bottom-tabs plus More sheet never overflows for any module
  combination.
- Home shows the right KPIs for the org's modules.
- `ui.tsx` is gone; all screens use the WaOS component layer.
- en and sw parity holds; typecheck, lint, and the web build pass; the API
  suite (including the new dashboard-summary test) stays green.
