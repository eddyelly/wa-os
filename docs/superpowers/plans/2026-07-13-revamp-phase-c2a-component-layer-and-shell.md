# Revamp Phase C2a: Component Layer and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the warm-branded WaOS component layer on the installed shadcn primitives and the new shell (desktop deep-green sidebar, white top header, mobile bottom-tabs plus a More sheet), without restyling any screen yet.

**Architecture:** A new component layer lives at `apps/web/src/components/ui/` (a directory with a barrel). The old single-file kit `apps/web/src/components/ui.tsx` is renamed to `ui-legacy.tsx` first so screens keep working unchanged; they migrate to the new layer in C2b/C2c. The new simple primitives (Button, Input, Textarea, Card, Badge, Skeleton, Separator) are authored fresh in the shadcn idiom (`cn`, `cva`, the brand-mapped CSS-variable tokens, comfortable mobile tap targets) with prop APIs drop-in compatible with `ui-legacy` so later migration is an import swap; the accessibility-heavy primitives (Dialog, DropdownMenu, Select, Switch) are re-exported from the shadcn kit for their Radix behavior. The shell is composed from four new pieces (Sidebar, TopHeader, BottomNav, MoreSheet) into a rewritten `AppShell` that keeps its exact `{ children, wide }` contract plus the C1 auth guard and socket bridge.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4 (CSS-variable tokens), shadcn/ui primitives, class-variance-authority, tailwind-merge/clsx (`cn`), lucide-react, next-intl.

**Spec:** `docs/superpowers/specs/2026-07-13-revamp-phase-c2-visual-design.md` (sections 3, 4, 8). This is C2a only; C2b/C2c restyle the screens.

## Global Constraints

- Presentation only: NO data, API, tenancy, query-key, invalidation, or business-logic change. The C1 query layer and every backend contract stay intact.
- Drop-in compatibility: every new component that shares a name with a `ui-legacy` export keeps the same prop names and semantics (superset allowed), so a screen migrates by changing its import path.
- Warm-branded, light theme. The deep-green sidebar is the one strong brand block; amber (accent) is rationed to primary actions and attention. The `.dark` tokens exist but no toggle ships in C2a.
- Comfortable mobile tap targets: interactive controls keep a minimum height around 44px (min-h-11) on touch, not shadcn's compact defaults.
- Every user-facing string exists in BOTH `apps/web/messages/en.json` and `sw.json` with identical key sets. New copy in this phase: `nav.more` only.
- TypeScript strict; `any` forbidden. No em dashes anywhere. No floating promises. Conventional commits.
- The web app has no test runner: web tasks gate on `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build` plus a live drive. All checks green at every commit: also `pnpm typecheck && pnpm lint && pnpm -F @waos/api test`.
- Accessibility: nav and controls keep accessible labels and visible focus states.
- Local env: Postgres 5433, Redis 6380, docker infra up. Fonts self-hosted (no network at build).

## Verified current facts

- `AppShell` is `apps/web/src/components/app-shell.tsx`, signature `AppShell({ children, wide = false })`. It calls `useAuthGuard()` and `useSocketInvalidation()` (both must be preserved, called unconditionally before the `if (!checked) return null`), renders a sticky white header (wordmark, `<NotificationBell />`, org name, `<LanguageSwitcher />`, logout), a `<main>` (`max-w-7xl` when wide else `max-w-3xl`, `pb-24`), and a fixed bottom `<nav>` with all module-filtered items.
- Nav model today: `allNavItems = [home, inbox, appointments(req shop? no, appointments), products(shop), orders(shop), contacts, settings]` filtered by `modules = user?.organization.modules ?? ['appointments']`. Labels from the `nav` namespace (home, inbox, appointments, products, orders, contacts, settings, logout already exist).
- `StoredUser` (from `@/lib/api`) has `organization.name` and `organization.modules: BusinessModule[]`.
- `@/i18n/navigation` exports `Link`, `usePathname`, `useRouter` (locale-aware).
- `NotificationBell` (`@/components/notification-bell`) takes no props. `LanguageSwitcher` (`@/components/language-switcher`) takes an optional `tone?: 'light' | 'dark'`.
- shadcn primitives at `apps/web/src/components/shadcn/`: badge, button, card, dialog, dropdown-menu, input, select, separator, skeleton, switch, textarea. They use `cn` from `@/lib/utils`, `cva`, Radix, and the brand-mapped tokens (`--primary` = brand-700, `--background` = brand-50, etc.).
- `cn` is at `apps/web/src/lib/utils.ts`. `lucide-react`, `class-variance-authority`, `tailwind-merge`, `clsx` are installed.
- ui.tsx exports and their exact props (the migration target APIs): `Button({variant?: 'primary'|'secondary'|'ghost', className?, ...button})`, `Input({className?, ...input})`, `Field({label, children, hint?})`, `Card({children, className?})`, `Spinner({label})`, `Skeleton({className?})`, `EmptyState({title, hint?, action?})`, `ErrorBox({message, onRetry?, retryLabel?})`, `Badge({children, tone?: 'neutral'|'success'|'warning'|'danger'|'ai'})`.

---

### Task 1: Rename ui.tsx to ui-legacy.tsx and repoint imports

**Files:**
- Rename: `apps/web/src/components/ui.tsx` to `apps/web/src/components/ui-legacy.tsx`
- Modify: every file importing from `@/components/ui` (repoint to `@/components/ui-legacy`)

**Interfaces:**
- Consumes: nothing.
- Produces: the path `@/components/ui` is now free for the new layer; all current screens import their primitives from `@/components/ui-legacy` and render byte-identically.

- [ ] **Step 1: Rename the file**

```bash
git mv apps/web/src/components/ui.tsx apps/web/src/components/ui-legacy.tsx
```

- [ ] **Step 2: Repoint every importer**

Find them: `grep -rl "@/components/ui'" apps/web/src` and `grep -rl '@/components/ui"' apps/web/src` (the exact module specifier `@/components/ui`, not `@/components/ui-something`). In each, replace the import specifier `@/components/ui` with `@/components/ui-legacy`. Do NOT touch imports of `@/components/shadcn`, `@/components/app-shell`, `@/components/notification-bell`, etc. Verify the set with:

```bash
grep -rn "from '@/components/ui'" apps/web/src || echo "none remain"
```

Expected after: no file imports from the bare `@/components/ui` specifier.

- [ ] **Step 3: Gate (this is a pure rename, so the build is the test)**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all pass; every page compiles. There is zero visual or behavioral change (only an import path moved).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(web): rename ui.tsx to ui-legacy to free the ui path for the new layer"
```

---

### Task 2: WaOS core primitives at @/components/ui

**Files:**
- Create: `apps/web/src/components/ui/button.tsx`, `input.tsx`, `textarea.tsx`, `card.tsx`, `badge.tsx`, `skeleton.tsx`, `separator.tsx`
- Create: `apps/web/src/components/ui/index.ts` (barrel; also re-exports the shadcn a11y primitives)

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`; shadcn `Dialog*`, `DropdownMenu*`, `Select*`, `Switch` from `@/components/shadcn/*`.
- Produces (imported by later tasks and by C2b/C2c screens from `@/components/ui`):
  - `Button({ variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'destructive'; className?; ...ButtonHTMLAttributes })`. Green `primary` is the default; amber `accent` is the rationed high-emphasis variant (the inbox take-over action, key hero CTAs), consistent with the spec's "amber, rationed" rule.
  - `Input({ className?; ...InputHTMLAttributes })`, `Textarea({ className?; ...TextareaHTMLAttributes })`
  - `Card({ children; className? })`
  - `Badge({ children; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'ai' })`
  - `Skeleton({ className? })`, `Separator({ className? })`
  - re-exports: everything from shadcn `dialog`, `dropdown-menu`, `select`, `switch`.

- [ ] **Step 1: button.tsx** (warm-branded, cva, min-h-11 touch target, drop-in variant names plus `destructive`)

```tsx
import type { ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-brand-700 text-white hover:bg-brand-800',
        accent: 'bg-accent-500 text-white hover:bg-accent-600',
        secondary: 'bg-brand-100 text-brand-900 hover:bg-brand-200',
        ghost: 'bg-transparent text-brand-800 hover:bg-brand-100',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
);

export function Button({
  variant,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
```

- [ ] **Step 2: input.tsx and textarea.tsx**

`input.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'min-h-12 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base text-brand-950 placeholder:text-brand-400 outline-none transition-colors focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
```

`textarea.tsx`:

```tsx
import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-base text-brand-950 placeholder:text-brand-400 outline-none transition-colors focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 3: card.tsx, skeleton.tsx, separator.tsx**

`card.tsx`:

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-brand-100 bg-white p-6 shadow-sm', className)}>
      {children}
    </div>
  );
}
```

`skeleton.tsx`:

```tsx
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-brand-100', className)} />;
}
```

`separator.tsx`:

```tsx
import { cn } from '@/lib/utils';

export function Separator({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-brand-100', className)} />;
}
```

- [ ] **Step 4: badge.tsx** (same `tone` API as ui-legacy)

```tsx
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'bg-brand-100 text-brand-800',
  success: 'bg-emerald-100 text-emerald-800',
  warning: 'bg-amber-100 text-amber-900',
  danger: 'bg-red-100 text-red-800',
  ai: 'bg-violet-100 text-violet-800',
} as const;

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 5: index.ts barrel** (only the seven primitives created in this task plus the four shadcn a11y re-exports; Task 3 appends its six app components so every commit compiles)

```ts
export { Button } from './button.js';
export { Input } from './input.js';
export { Textarea } from './textarea.js';
export { Card } from './card.js';
export { Badge } from './badge.js';
export { Skeleton } from './skeleton.js';
export { Separator } from './separator.js';
export * from '@/components/shadcn/dialog';
export * from '@/components/shadcn/dropdown-menu';
export * from '@/components/shadcn/select';
export * from '@/components/shadcn/switch';
```

- [ ] **Step 6: Gate and commit**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: pass. (No screen consumes these yet; the barrel and files compile.)

```bash
git add apps/web/src/components/ui/ && git commit -m "feat(web): warm-branded core primitives on the shadcn design system"
```

---

### Task 3: WaOS app components at @/components/ui

**Files:**
- Create: `apps/web/src/components/ui/field.tsx`, `empty-state.tsx`, `error-box.tsx`, `spinner.tsx`, `page-header.tsx`, `stat-card.tsx`
- Modify: `apps/web/src/components/ui/index.ts` (append the six exports)

**Interfaces:**
- Consumes: `cn`; Task 2 primitives are not required (these are standalone).
- Produces:
  - `Field({ label; children; hint? })` (drop-in with ui-legacy)
  - `EmptyState({ title; hint?; action? })` (drop-in)
  - `ErrorBox({ message; onRetry?; retryLabel? })` (drop-in)
  - `Spinner({ label })` (drop-in)
  - `PageHeader({ title; action? })` (new: a screen title row)
  - `StatCard({ label; value; hint?; tone?: 'neutral' | 'brand' | 'accent' })` (new: a KPI tile for the home grid in C2b)

- [ ] **Step 1: field.tsx, empty-state.tsx, error-box.tsx, spinner.tsx** (same APIs as ui-legacy, restyled)

`field.tsx`:

```tsx
import type { ReactNode } from 'react';

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-brand-900">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-brand-600">{hint}</span> : null}
    </label>
  );
}
```

`empty-state.tsx`:

```tsx
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-brand-100 bg-white px-6 py-12 text-center shadow-sm">
      <p className="text-base font-semibold text-brand-900">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-brand-600">{hint}</p> : null}
      {action}
    </div>
  );
}
```

`error-box.tsx`:

```tsx
export function ErrorBox({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{message}</p>
      {onRetry && retryLabel ? (
        <button
          onClick={onRetry}
          className="mt-2 font-semibold text-red-900 underline underline-offset-2"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
```

`spinner.tsx`:

```tsx
export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-brand-700" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-300 border-t-brand-700" />
      <span className="text-sm">{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: page-header.tsx and stat-card.tsx** (new components)

`page-header.tsx`:

```tsx
import type { ReactNode } from 'react';

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-brand-900">{title}</h1>
      {action}
    </div>
  );
}
```

`stat-card.tsx`:

```tsx
import { cn } from '@/lib/utils';

const tones = {
  neutral: 'border-brand-100 bg-white',
  brand: 'border-brand-200 bg-brand-50',
  accent: 'border-accent-200 bg-amber-50',
} as const;

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof tones;
}) {
  return (
    <div className={cn('rounded-2xl border p-4 shadow-sm', tones[tone])}>
      <p className="text-xs font-medium text-brand-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-brand-500">{hint}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: append to the barrel**

Add these six lines to `apps/web/src/components/ui/index.ts` (order does not matter):

```ts
export { Field } from './field.js';
export { EmptyState } from './empty-state.js';
export { ErrorBox } from './error-box.js';
export { Spinner } from './spinner.js';
export { PageHeader } from './page-header.js';
export { StatCard } from './stat-card.js';
```

- [ ] **Step 4: Gate and commit**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`

```bash
git add apps/web/src/components/ui/ && git commit -m "feat(web): shared field, state, header, and stat-card components"
```

---

### Task 4: Shell pieces (sidebar, header, bottom nav, more sheet)

**Files:**
- Create: `apps/web/src/components/shell/nav-model.ts`, `sidebar.tsx`, `top-header.tsx`, `bottom-nav.tsx`, `more-sheet.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (`nav.more`)

**Interfaces:**
- Consumes: `Link`, `usePathname` from `@/i18n/navigation`; `useTranslations` from `next-intl`; lucide icons; `NotificationBell`, `LanguageSwitcher`; shadcn `Dialog*` (for the More sheet); `BusinessModule` from `@waos/shared`.
- Produces (consumed by Task 5's AppShell):
  - `nav-model.ts`: `type NavKey`; `interface NavEntry { key: NavKey; href: string; icon: LucideIcon; requiredModule?: BusinessModule }`; `NAV_ENTRIES: NavEntry[]` (the full ordered list); `visibleEntries(modules): NavEntry[]` (module filter); `primaryEntries(modules): NavEntry[]` (Home, Inbox, key module screen: Orders if shop else Appointments else Contacts, capped at 3 so the bar is 3 links plus the More button); `overflowEntries(modules): NavEntry[]` (visible minus primary).
  - `Sidebar({ modules, orgName, onLogout })`, `TopHeader({ title })`, `BottomNav({ modules, onOpenMore })`, `MoreSheet({ open, onOpenChange, modules, orgName, onLogout })`.

- [ ] **Step 1: nav-model.ts**

```ts
import type { LucideIcon } from 'lucide-react';
import { CalendarDays, ClipboardList, Home, MessageCircle, Package, Settings, Users } from 'lucide-react';
import type { BusinessModule } from '@waos/shared';

export type NavKey =
  | 'home'
  | 'inbox'
  | 'appointments'
  | 'products'
  | 'orders'
  | 'contacts'
  | 'settings';

export interface NavEntry {
  key: NavKey;
  href: string;
  icon: LucideIcon;
  requiredModule?: BusinessModule;
}

export const NAV_ENTRIES: NavEntry[] = [
  { key: 'home', href: '/home', icon: Home },
  { key: 'inbox', href: '/inbox', icon: MessageCircle },
  { key: 'appointments', href: '/appointments', icon: CalendarDays, requiredModule: 'appointments' },
  { key: 'products', href: '/products', icon: Package, requiredModule: 'shop' },
  { key: 'orders', href: '/orders', icon: ClipboardList, requiredModule: 'shop' },
  { key: 'contacts', href: '/contacts', icon: Users },
  { key: 'settings', href: '/settings', icon: Settings },
];

export function visibleEntries(modules: readonly BusinessModule[]): NavEntry[] {
  return NAV_ENTRIES.filter((e) => !e.requiredModule || modules.includes(e.requiredModule));
}

// The mobile bottom bar shows Home, Inbox, and one key module screen, then a
// More button. Key screen: Orders for a shop, else Appointments, else Contacts.
export function primaryEntries(modules: readonly BusinessModule[]): NavEntry[] {
  const byKey = (k: NavKey): NavEntry | undefined => NAV_ENTRIES.find((e) => e.key === k);
  const keyScreen = modules.includes('shop')
    ? byKey('orders')
    : modules.includes('appointments')
      ? byKey('appointments')
      : byKey('contacts');
  return [byKey('home'), byKey('inbox'), keyScreen].filter((e): e is NavEntry => e !== undefined);
}

export function overflowEntries(modules: readonly BusinessModule[]): NavEntry[] {
  const primary = new Set(primaryEntries(modules).map((e) => e.key));
  return visibleEntries(modules).filter((e) => !primary.has(e.key));
}
```

- [ ] **Step 2: sidebar.tsx** (desktop deep-green, full visible nav, active state, org + logout at the bottom)

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { BusinessModule } from '@waos/shared';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { visibleEntries } from './nav-model';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

export function Sidebar({
  modules,
  orgName,
  onLogout,
}: {
  modules: readonly BusinessModule[];
  orgName: string;
  onLogout: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const entries = visibleEntries(modules);
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-brand-900 text-brand-50 lg:flex">
      <div className="px-5 py-5 text-lg font-bold">
        {appName}
        <span className="text-accent-400">.</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {entries.map((e) => {
          const active = pathname.startsWith(e.href);
          const Icon = e.icon;
          return (
            <Link
              key={e.key}
              href={e.href}
              className={cn(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-brand-700 text-white' : 'text-brand-100 hover:bg-brand-800',
              )}
            >
              <Icon className="size-5 shrink-0" />
              {t(e.key)}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-brand-800 px-4 py-4">
        <p className="truncate text-sm font-medium text-brand-100">{orgName}</p>
        <button
          onClick={onLogout}
          className="mt-1 text-xs text-brand-300 underline underline-offset-2 hover:text-brand-100"
        >
          {t('logout')}
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: top-header.tsx** (white, page title + bell + language)

```tsx
'use client';

import { NotificationBell } from '@/components/notification-bell';
import { LanguageSwitcher } from '@/components/language-switcher';

export function TopHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-brand-100 bg-white px-4 py-3">
      <h1 className="truncate text-lg font-bold text-brand-900">{title}</h1>
      <div className="flex items-center gap-2 sm:gap-3">
        <NotificationBell />
        <LanguageSwitcher tone="light" />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: bottom-nav.tsx** (mobile only, 3 primary links + More button)

```tsx
'use client';

import { useTranslations } from 'next-intl';
import { Menu } from 'lucide-react';
import type { BusinessModule } from '@waos/shared';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { primaryEntries } from './nav-model';

export function BottomNav({
  modules,
  onOpenMore,
}: {
  modules: readonly BusinessModule[];
  onOpenMore: () => void;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const primary = primaryEntries(modules);
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-brand-100 bg-white lg:hidden">
      {primary.map((e) => {
        const active = pathname.startsWith(e.href);
        const Icon = e.icon;
        return (
          <Link
            key={e.key}
            href={e.href}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium',
              active ? 'text-brand-800' : 'text-brand-500',
            )}
          >
            <Icon className="size-5" />
            {t(e.key)}
          </Link>
        );
      })}
      <button
        onClick={onOpenMore}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium text-brand-500"
      >
        <Menu className="size-5" />
        {t('more')}
      </button>
    </nav>
  );
}
```

- [ ] **Step 5: more-sheet.tsx** (Dialog-based bottom sheet with the overflow entries + org + logout)

```tsx
'use client';

import { useTranslations } from 'next-intl';
import type { BusinessModule } from '@waos/shared';
import { Link } from '@/i18n/navigation';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/shadcn/dialog';
import { overflowEntries } from './nav-model';

export function MoreSheet({
  open,
  onOpenChange,
  modules,
  orgName,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modules: readonly BusinessModule[];
  orgName: string;
  onLogout: () => void;
}) {
  const t = useTranslations('nav');
  const entries = overflowEntries(modules);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-2">
        <DialogHeader>
          <DialogTitle>{orgName}</DialogTitle>
        </DialogHeader>
        <nav className="flex flex-col">
          {entries.map((e) => {
            const Icon = e.icon;
            return (
              <Link
                key={e.key}
                href={e.href}
                onClick={() => {
                  onOpenChange(false);
                }}
                className="flex items-center gap-3 rounded-xl px-2 py-3 text-sm font-medium text-brand-800 hover:bg-brand-50"
              >
                <Icon className="size-5" />
                {t(e.key)}
              </Link>
            );
          })}
          <button
            onClick={onLogout}
            className="mt-1 flex items-center gap-3 rounded-xl px-2 py-3 text-left text-sm font-medium text-red-700 hover:bg-red-50"
          >
            {t('logout')}
          </button>
        </nav>
      </DialogContent>
    </Dialog>
  );
}
```

Check the shadcn `dialog.tsx` exports the names used (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`). If the generated file names them differently, adjust the import to the actual exports and note it. If `DialogContent` centers by default, that is acceptable for C2a (a centered sheet is fine); a bottom-anchored variant can come in C2c polish.

- [ ] **Step 6: i18n `nav.more` in both locales**

`en.json` `nav`: add `"more": "More"`. `sw.json` `nav`: add `"more": "Zaidi"`. Confirm parity with the locale-parity node one-liner.

- [ ] **Step 7: Gate and commit**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: pass. These pieces are not wired into AppShell yet (Task 5), so nothing renders differently.

```bash
git add -A && git commit -m "feat(web): sidebar, top header, bottom nav, and more-sheet shell pieces"
```

---

### Task 5: Rewrite AppShell to the new shell and go live

**Files:**
- Modify: `apps/web/src/components/app-shell.tsx`

**Interfaces:**
- Consumes: Task 4 shell pieces; `useAuthGuard`, `useSocketInvalidation`, `getStoredUser`, `clearSession`, `resetSocket`; `useTranslations`; `useRouter`.
- Produces: `AppShell({ children, wide = false, title? })` where `title` is an optional page title for the header (defaults to the app name when omitted). The `{ children, wide }` contract is unchanged so no screen needs editing; `title` is additive and optional.

- [ ] **Step 1: Rewrite AppShell to compose the shell**

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { getStoredUser, clearSession, type StoredUser } from '@/lib/api';
import { useAuthGuard } from '@/lib/use-auth-guard';
import { useSocketInvalidation } from '@/lib/use-socket-invalidation';
import { resetSocket } from '@/lib/socket';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { Sidebar } from './shell/sidebar';
import { TopHeader } from './shell/top-header';
import { BottomNav } from './shell/bottom-nav';
import { MoreSheet } from './shell/more-sheet';

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? 'WaOS';

export function AppShell({
  children,
  wide = false,
  title,
}: {
  children: ReactNode;
  wide?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [user] = useState<StoredUser | null>(() => getStoredUser());
  const [moreOpen, setMoreOpen] = useState(false);
  const checked = useAuthGuard();
  useSocketInvalidation();

  if (!checked) {
    return null;
  }

  const modules = user?.organization.modules ?? ['appointments'];
  const orgName = user?.organization.name ?? appName;
  const logout = (): void => {
    clearSession();
    resetSocket();
    router.replace('/login');
  };

  return (
    <div className="flex min-h-dvh bg-brand-50">
      <Sidebar modules={modules} orgName={orgName} onLogout={logout} />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <TopHeader title={title ?? appName} />
        <main
          className={cn(
            'mx-auto w-full flex-1 px-4 pt-4 pb-24 lg:pb-8',
            wide ? 'max-w-7xl' : 'max-w-3xl',
          )}
        >
          {children}
        </main>
        <BottomNav modules={modules} onOpenMore={() => setMoreOpen(true)} />
        <MoreSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          modules={modules}
          orgName={orgName}
          onLogout={logout}
        />
      </div>
    </div>
  );
}
```

Notes: the `pb-24` keeps content clear of the mobile bottom nav; `lg:pb-8` reclaims it on desktop where the bottom nav is hidden. The old header wordmark link to `/home` is replaced by the sidebar wordmark on desktop; on mobile the header shows the page title. `useAuthGuard` and `useSocketInvalidation` are called unconditionally before the early return, exactly as before.

- [ ] **Step 2: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: pass. Every screen still renders its old-styled content, now inside the new shell.

- [ ] **Step 3: Live drive**

Start dev (`pnpm dev`), log in as the demo owner (`demo@waos.dev` / `DemoOwner123!`). With an authed browser session (headless Chrome with the session in localStorage, or a manual pass), capture:
- Desktop (width 1280): the deep-green sidebar with Home/Messages/Appointments/Products/Orders/Contacts/Settings (demo org has both modules), active state on the current item, org name plus logout at the bottom, and the white header with the bell and language switcher. Screenshot `/en/home`.
- Mobile (width 390): the bottom bar showing Home, Messages, Orders (shop key screen), and More; tapping More opens the sheet listing Appointments, Products, Contacts, Settings, plus logout. Screenshot the bottom bar and the open sheet.

Record which was verified in the report. If an authed browser pass is not reachable, verify the shell renders by asserting the compiled output and documenting the module-to-nav mapping from `nav-model.ts` against the demo org's modules.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/app-shell.tsx && git commit -m "feat(web): compose the new sidebar and mobile shell in AppShell"
```

---

## Final verification (whole phase)

- [ ] `pnpm typecheck && pnpm lint && pnpm -F @waos/api test` green; `pnpm -F @waos/web build` green.
- [ ] Locale parity holds (only `nav.more` added, both locales):

```bash
node -e "const en=require('./apps/web/messages/en.json'),sw=require('./apps/web/messages/sw.json');const k=o=>{const r=[];const w=(x,p)=>{for(const[key,v]of Object.entries(x)){if(typeof v==='object')w(v,p+key+'.');else r.push(p+key)}};w(o,'');return new Set(r)};const a=k(en),b=k(sw);const d=[...a].filter(x=>!b.has(x)).concat([...b].filter(x=>!a.has(x)));console.log(d.length===0?'locale parity OK':'DRIFT: '+d.join(', '))"
```

- [ ] `@/components/ui` resolves to the new layer; `@/components/ui-legacy` still holds the old kit that screens import until C2b/C2c.
- [ ] The shell renders on desktop (sidebar) and mobile (bottom-tabs plus More) with module-correct nav; no screen content was restyled.
- [ ] Data and behavior unchanged: no query key, invalidation, endpoint, or logic touched (grep the diff for `queryKey`, `invalidate`, `apiFetch` changes: there should be none).
- [ ] One conventional commit per task.

## Ledger note for C2b/C2c

- C2b restyles home (with the sales KPIs and the additive dashboard-summary API extension), login, signup, and onboarding, migrating each screen's imports from `@/components/ui-legacy` to `@/components/ui`.
- C2c restyles inbox/thread, appointments, products, orders, contacts, settings; adds the forms polish; deletes `ui-legacy.tsx` once no importer remains; and folds in the small C1 leftovers (the bell `.then().catch()` chain, the shadcn dependency placement).
