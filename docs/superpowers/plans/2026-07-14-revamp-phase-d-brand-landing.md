# WaOS Revamp Phase D: Brand and Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the public landing page so it tells the product's now-dual story: an AI that answers, books, AND sells on WhatsApp, with a hero demo that alternates a booking scene and a selling scene.

**Architecture:** Targeted refresh of the single existing landing component `apps/web/src/app/[locale]/page.tsx`, reusing the C2 visual system and every animation. Task 1 adds a second scripted scene to the hero phone (`PhoneDemo`), alternating booking and selling by replay-cycle parity, with an inline-SVG product photo bubble and an "order recorded" chip. Task 2 reworks the positioning and copy across the hero, feature cards, how-it-works, marquee, final CTA, footer, and one floating card. All copy lives in the `landing.*` i18n namespace in `en` and `sw`. No data, API, auth, route, or query change.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4, next-intl. Inline SVG only (no external assets).

## Global Constraints

- **Presentation and marketing only.** No data, API, auth, route, or query change. The only files touched are `apps/web/src/app/[locale]/page.tsx`, `apps/web/messages/en.json`, and `apps/web/messages/sw.json`. (Spec section 5.)
- **Phase 1 MVP, no money language.** No pricing, paywalls, upgrade prompts, or plan language. Stating the product is free (the existing "Get started free" CTA, the "0 / Cost in this phase" stat, the free note) is allowed and kept. The demo may show a customer negotiating a product price (that is the product's selling feature), but the platform never advertises a price for itself. (Spec section 5.)
- **Brand naming.** Use "WaOS" or `NEXT_PUBLIC_APP_NAME` as the brand. "WhatsApp" appears only as the platform noun ("on WhatsApp", "inside WhatsApp"), never as a brand phrase like "the WhatsApp operating system". (Spec section 5; CLAUDE.md naming note.)
- **Both locales complete, parity by hand.** Every new or changed `landing.*` string ships in both `en` and `sw`. No tool enforces parity, so verify by hand: the `landing.*` leaf-key sets in the two files must match exactly. (Spec section 5.)
- **Self-contained.** No external images or network assets; the product photo in the selling scene is an inline SVG. (Spec section 5.)
- **Accessibility.** Decorative demo SVGs stay `aria-hidden`; the meaning is carried by the text bubbles. Interactive controls keep their labels and focus states. (Spec section 5.)
- **No em dashes anywhere. TypeScript strict, no `any`. Conventional commits.** (CLAUDE.md sections 6.1, 6.2, 6.3.)
- **Web gate (no web test runner):** `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build` all clean, then a live drive of the landing on desktop and mobile. Run `tsc` (typecheck) explicitly; the build's esbuild transform does not type-check.

---

## File Structure

- `apps/web/src/app/[locale]/page.tsx` — the landing component. Task 1 edits `PhoneDemo` and adds two small helper components (`PhotoMessage`, `OrderChip`). Task 2 edits the `features` and `verticals` arrays, the `HeroShowcase` floating card, and nothing else structural.
- `apps/web/messages/en.json` and `apps/web/messages/sw.json` — the `landing.*` namespace. Task 1 adds `landing.demo` selling keys. Task 2 changes hero/feature/how/final/footer/marquee/card copy.

**Current shape (for reference).** `PhoneDemo` keeps a `cycle` state that increments every 13s; the conversation `<div key={cycle}>` re-mounts each cycle so the animation replays. `Bubble` renders a chat bubble (`side: 'in' | 'out'`, `delay`, optional `ai`, `stacked`, children). `AiTurn` renders typing dots that dissolve into an AI reply (`typingDelay`, `replyDelay`, children). The booking scene is four bubbles (in, AI, in, AI) plus a booking chip.

---

### Task 1: Add the selling demo scene

**Files:**
- Modify: `apps/web/src/app/[locale]/page.tsx` (`PhoneDemo`, plus two new helper components above it)
- Modify: `apps/web/messages/en.json` and `apps/web/messages/sw.json` (`landing.demo` selling keys)

**Interfaces:**
- Consumes (existing, unchanged): `Bubble`, `AiTurn`, `TypingBubble` components; `useTranslations('landing.demo')`.
- Produces: `PhotoMessage({ caption: string })` and `OrderChip({ title: string, body: string })` helper components (used only within `page.tsx`).

- [ ] **Step 1: Add the selling-scene copy to the English locale**

In `apps/web/messages/en.json`, inside the existing `landing.demo` object (which has `businessName`, `online`, `msg1`..`msg4`, `inputPlaceholder`, `bookingChipTitle`, `bookingChipBody`), add these keys:
```json
      "sellMsg1": "Do you have this one?",
      "sellMsg2": "Yes! That is our Shea Hair Butter, TZS 20,000.",
      "sellMsg3": "Can you do 15,000?",
      "sellMsg4": "I can do 17,000, and that is my best price.",
      "photoLabel": "Customer photo of a product",
      "orderChipTitle": "Order recorded",
      "orderChipBody": "Shea Hair Butter, TZS 17,000"
```

- [ ] **Step 2: Add the matching Swahili copy**

In `apps/web/messages/sw.json`, inside `landing.demo`, add:
```json
      "sellMsg1": "Unayo hii?",
      "sellMsg2": "Ndiyo! Hiyo ni Shea Hair Butter yetu, TZS 20,000.",
      "sellMsg3": "Unaweza 15,000?",
      "sellMsg4": "Naweza 17,000, na hiyo ni bei yangu ya mwisho.",
      "photoLabel": "Picha ya bidhaa kutoka kwa mteja",
      "orderChipTitle": "Oda imehifadhiwa",
      "orderChipBody": "Shea Hair Butter, TZS 17,000"
```

- [ ] **Step 3: Add the `PhotoMessage` and `OrderChip` helper components**

In `apps/web/src/app/[locale]/page.tsx`, add these two components immediately above the `PhoneDemo` function (they use only Tailwind + inline SVG, no new imports):
```tsx
/** An inbound "photo" message: a stylized product thumbnail (inline SVG, no
 *  network asset) above a short caption, shown inside an inbound bubble. */
function PhotoMessage({ caption }: { caption: string }) {
  return (
    <div className="w-40">
      <div
        aria-hidden
        className="mb-1 flex aspect-square w-full items-center justify-center rounded-lg bg-gradient-to-br from-amber-100 to-brand-100"
      >
        <svg viewBox="0 0 64 64" className="h-3/4 w-3/4" aria-hidden>
          <rect x="16" y="7" width="32" height="8" rx="2" className="fill-amber-300" />
          <rect x="12" y="15" width="40" height="42" rx="7" className="fill-amber-200" />
          <rect x="21" y="29" width="22" height="16" rx="3" className="fill-white/80" />
        </svg>
      </div>
      <span>{caption}</span>
    </div>
  );
}

/** The selling scene's closing chip: mirrors the booking chip's treatment,
 *  in the amber accent, with an order/bag icon and a done badge. */
function OrderChip({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="animate-pop-in mx-auto mt-1.5 flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 shadow-sm"
      style={{ animationDelay: '7400ms' }}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0" />
        </svg>
      </span>
      <div className="leading-tight">
        <p className="text-[11px] font-bold text-brand-950">{title}</p>
        <p className="text-[10px] text-brand-600">{body}</p>
      </div>
      <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700" aria-hidden>
        {'✓'}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Alternate booking and selling scenes by cycle parity**

In `PhoneDemo`, the conversation container is `<div key={cycle} className="flex min-h-[350px] flex-col gap-2 px-3 py-4"> ... </div>` holding the four booking bubbles and the booking chip. Wrap its contents in a parity conditional: odd cycles play the new selling scene, even cycles play the existing booking scene unchanged. Replace the container's children with:
```tsx
        <div key={cycle} className="flex min-h-[350px] flex-col gap-2 px-3 py-4">
          {cycle % 2 === 1 ? (
            <>
              <Bubble side="in" delay={500}>
                <PhotoMessage caption={t('sellMsg1')} />
              </Bubble>
              <AiTurn typingDelay={1200} replyDelay={2550}>
                {t('sellMsg2')}
              </AiTurn>
              <Bubble side="in" delay={4000}>
                {t('sellMsg3')}
              </Bubble>
              <AiTurn typingDelay={4800} replyDelay={6150}>
                {t('sellMsg4')}
              </AiTurn>
              <OrderChip title={t('orderChipTitle')} body={t('orderChipBody')} />
            </>
          ) : (
            <>
              <Bubble side="in" delay={500}>
                {t('msg1')}
              </Bubble>
              <AiTurn typingDelay={1200} replyDelay={2550}>
                {t('msg2')}
              </AiTurn>
              <Bubble side="in" delay={4000}>
                {t('msg3')}
              </Bubble>
              <AiTurn typingDelay={4800} replyDelay={6150}>
                {t('msg4')}
              </AiTurn>
              <div
                className="animate-pop-in mx-auto mt-1.5 flex items-center gap-2 rounded-xl border border-brand-200 bg-white px-3 py-2 shadow-sm"
                style={{ animationDelay: '7400ms' }}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-brand-800">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v3m8-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
                  </svg>
                </span>
                <div className="leading-tight">
                  <p className="text-[11px] font-bold text-brand-950">{t('bookingChipTitle')}</p>
                  <p className="text-[10px] text-brand-600">{t('bookingChipBody')}</p>
                </div>
                <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700" aria-hidden>
                  {'✓'}
                </span>
              </div>
            </>
          )}
        </div>
```
The booking branch is the current markup verbatim (icons, classes, delays, keys), only moved into the `else` branch. Do not change the booking scene's content, the `key={cycle}` replay, the header, or the composer.

- [ ] **Step 5: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean. Live-drive note (controller does the drive): the hero phone alternates booking and selling every 13s; the selling scene shows the photo bubble, the quote, the haggle, the close, and the amber order chip.

- [ ] **Step 6: Verify locale parity for the new keys**

Run: `node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const e=f(require('./apps/web/messages/en.json').landing),s=f(require('./apps/web/messages/sw.json').landing);const eo=e.filter(k=>!s.includes(k)),so=s.filter(k=>!e.includes(k));console.log('en-only',eo,'sw-only',so)"`
Expected: `en-only [] sw-only []`.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/[locale]/page.tsx" apps/web/messages/en.json apps/web/messages/sw.json
git commit -m "feat(web): add the selling demo scene to the landing hero"
```

---

### Task 2: Positioning and copy

**Files:**
- Modify: `apps/web/src/app/[locale]/page.tsx` (the `features` array, the `verticals` array, the `HeroShowcase` amber floating card)
- Modify: `apps/web/messages/en.json` and `apps/web/messages/sw.json` (hero, features, how, final, footer, marquee, cards copy)

**Interfaces:**
- Consumes: the landing component and its `landing.*` namespace (Task 1 already added the selling demo keys; this task does not touch `landing.demo`).
- Produces: nothing.

- [ ] **Step 1: Rework the English hero, feature, how, final, footer, and marquee copy**

In `apps/web/messages/en.json`, apply these value changes inside `landing` (keys not listed stay as they are):
```json
  "kicker": "For salons, clinics, spas, tutors, garages, and shops",
  "heroTitleAccent": "answers, books, and sells",
  "heroTitle2": "on WhatsApp, even while you work.",
  "heroSubtitle": "An AI assistant that replies to your customers in Swahili or English, books their appointments, sells your products (bargaining down to the price you set), and calls you in when a human touch is needed.",
  "finalSubtitle": "Sign up, connect your WhatsApp, and let the assistant handle the routine questions and the sales while you do the real work.",
  "footerTagline": "The operating system for local service and retail businesses in Tanzania, right inside WhatsApp."
```
Add the new marquee vertical inside `landing.verticals`:
```json
    "v7": "Shops"
```
Inside `landing.features`, REPLACE the `handoff` object with a `sells` object (delete `handoff`, add `sells`):
```json
    "sells": {
      "title": "Sells and bargains",
      "body": "It recognizes a product from a photo, quotes your price, and haggles down to the floor you set, never below it."
    }
```
Inside `landing.how`, broaden two step bodies:
```json
    "step1": {
      "title": "Tell it about your business",
      "body": "Paste your services, prices, catalog, and opening hours, or upload a file. That becomes the AI's only source of truth."
    },
    "step3": {
      "title": "Watch it work",
      "body": "Customers get instant answers, appointments get reminders, products get sold, and tricky questions come to you."
    }
```
Inside `landing.cards`, REPLACE the `reminder` object with a `sale` object (delete `reminder`, add `sale`):
```json
    "sale": {
      "title": "Sale closed",
      "body": "Order recorded, you're notified"
    }
```

- [ ] **Step 2: Apply the matching Swahili copy**

In `apps/web/messages/sw.json`, apply the parallel changes inside `landing`:
```json
  "kicker": "Kwa saluni, kliniki, spa, wakufunzi, gereji, na maduka",
  "heroTitleAccent": "hujibu, huweka miadi, na huuza",
  "heroTitle2": "kwenye WhatsApp, hata ukiwa kazini.",
  "heroSubtitle": "Msaidizi wa AI anayewajibu wateja wako kwa Kiswahili au Kiingereza, anaweka miadi yao, anauza bidhaa zako (akipatana bei hadi kiwango unachoweka), na anakuita pale mguso wa binadamu unapohitajika.",
  "finalSubtitle": "Jisajili, unganisha WhatsApp yako, na mwache msaidizi ashughulikie maswali ya kawaida na mauzo huku wewe ukifanya kazi halisi.",
  "footerTagline": "Mfumo wa uendeshaji kwa biashara za huduma na za bidhaa nchini Tanzania, ndani ya WhatsApp."
```
Inside `landing.verticals`:
```json
    "v7": "Maduka"
```
Inside `landing.features`, REPLACE `handoff` with `sells`:
```json
    "sells": {
      "title": "Huuza na kupatana bei",
      "body": "Hutambua bidhaa kutoka kwenye picha, hutoa bei yako, na hupatana hadi kiwango cha chini unachoweka, kamwe si chini yake."
    }
```
Inside `landing.how`:
```json
    "step1": {
      "title": "Ieleze kuhusu biashara yako",
      "body": "Weka huduma, bei, katalogi, na saa za kufungua, au pakia faili. Hiyo inakuwa chanzo pekee cha ukweli cha AI."
    },
    "step3": {
      "title": "Iangalie ikifanya kazi",
      "body": "Wateja wanapata majibu papo hapo, miadi inapata vikumbusho, bidhaa zinauzwa, na maswali magumu yanakujia wewe."
    }
```
Inside `landing.cards`, REPLACE `reminder` with `sale`:
```json
    "sale": {
      "title": "Mauzo yamekamilika",
      "body": "Oda imehifadhiwa, umearifiwa"
    }
```

- [ ] **Step 3: Point the feature grid at the new `sells` card**

In `apps/web/src/app/[locale]/page.tsx`, the `features` array currently is:
```tsx
  const features = [
    { key: 'answers', icon: 'M8 10h8m-8 4h5m-8.7 6.3L3 21l1.3-3.9A8.96 8.96 0 0 1 3 12a9 9 0 1 1 9 9 8.96 8.96 0 0 1-4.7-1.3Z' },
    { key: 'bookings', icon: 'M8 3v3m8-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4' },
    { key: 'handoff', icon: 'M16 11a4 4 0 1 0-8 0m8 0a4 4 0 0 1-8 0m8 0h4m-12 0H4m8 4v6m-4-2.5L12 21l4-2.5' },
    { key: 'language', icon: 'M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0Zm1 -3h16M4 15h16M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18' },
  ] as const;
```
Replace the `handoff` entry with a `sells` entry using a price-tag icon (keep the other three entries exactly):
```tsx
    { key: 'sells', icon: 'm20.6 13.4-8.2 8.2a2 2 0 0 1-2.8 0l-7.4-7.4A2 2 0 0 1 1.6 12.6V4a2 2 0 0 1 2-2h8.6a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8ZM7.5 7.5h.01' },
```

- [ ] **Step 4: Add the new marquee vertical to the array**

In the same file, the `verticals` array is:
```tsx
  const verticals = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] as const;
```
Add `'v7'`:
```tsx
  const verticals = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'] as const;
```

- [ ] **Step 5: Rework the amber floating card from "reminder" to "sale"**

In `HeroShowcase`, the second `FloatingCard` (tone amber, `popDelay={2000}`) currently renders a bell icon and `t('reminder.title')` / `t('reminder.body')`. Change its `CardIcon` path to the order/bag icon and its text keys to `sale.*`:
```tsx
      <FloatingCard
        popDelay={2000}
        floatDuration="9s"
        className="bottom-24 -left-6 hidden max-w-56 md:block xl:-left-24"
      >
        <CardIcon tone="amber" path="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z M3 6h18 M16 10a4 4 0 0 1-8 0" />
        <div className="leading-tight">
          <p className="text-[13px] font-bold text-brand-950">{t('sale.title')}</p>
          <p className="mt-0.5 text-[11px] text-brand-600">{t('sale.body')}</p>
        </div>
      </FloatingCard>
```
Leave the green `booking` card and the violet `ai` card (with its toggle) exactly as they are.

- [ ] **Step 6: Confirm no orphaned keys and en/sw parity**

Run: `node -e "const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?f(v,p+k+'.'):[p+k]);const e=f(require('./apps/web/messages/en.json').landing),s=f(require('./apps/web/messages/sw.json').landing);const eo=e.filter(k=>!s.includes(k)),so=s.filter(k=>!e.includes(k));console.log('en-only',eo,'sw-only',so,'| has old keys?',[...e,...s].filter(k=>/features\.handoff|cards\.reminder/.test(k)))"`
Expected: `en-only [] sw-only [] | has old keys? []` (parity holds; `features.handoff` and `cards.reminder` are gone from both files).

Also confirm the code no longer references the removed keys:
Run: `git grep -nE "handoff|reminder\.(title|body)|'reminder'" -- "apps/web/src/app/[locale]/page.tsx"`
Expected: no output.

- [ ] **Step 7: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/[locale]/page.tsx" apps/web/messages/en.json apps/web/messages/sw.json
git commit -m "feat(web): reposition the landing copy around answers, books, and sells"
```

---

## Self-Review

**1. Spec coverage (spec sections mapped to tasks):**
- Section 3 (dual demo: booking scene kept, selling scene photo/quote/haggle/close-at-floor/order chip, alternation by cycle parity, floating card echoes selling): Task 1 (scenes + alternation + `PhotoMessage`/`OrderChip`) and Task 2 Step 5 (amber floating card becomes "sale"). Covered.
- Section 4 (positioning and copy: hero headline/subtitle, four feature cards with "Sells and bargains", how-it-works, stats, marquee vertical, final CTA/footer): Task 2. Stats keys are already capability-neutral and true, so they are intentionally left unchanged (noted below). Covered.
- Section 5 (constraints: no money language, WaOS-not-WhatsApp, both locales, self-contained inline SVG, a11y): Global Constraints plus the footer reword (removes the "WhatsApp operating system" brand phrase, uses "inside WhatsApp" as the platform noun) and the inline-SVG `PhotoMessage`. Covered.
- Section 8 (success criteria): the alternating demo (Task 1), the three-capability copy (Task 2), no money/upgrade language (kept), en/sw parity (verified in Task 1 Step 6 and Task 2 Step 6), and the web gate (both tasks). Covered.
- Deliberate scope note: the stats band copy is left unchanged because all four stats (24/7, two languages, five-minute setup, free) remain accurate for the broader product; changing them would be churn without benefit. This is a conscious call, not a gap.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code or an exact before/after edit; every command shows its expected output. All copy (en and sw) is concrete. The SVG paths are real lucide-style paths.

**3. Type consistency:**
- `PhotoMessage({ caption })` and `OrderChip({ title, body })` (Task 1 Step 3) are called with exactly those props in Task 1 Step 4 (`caption={t('sellMsg1')}`, `title={t('orderChipTitle')}`, `body={t('orderChipBody')}`).
- The `landing.demo` selling keys added in Task 1 Steps 1-2 (`sellMsg1`..`sellMsg4`, `orderChipTitle`, `orderChipBody`, `photoLabel`) match the `t(...)` calls in Step 4. (`photoLabel` is added for parity/future use; if lint flags it as unused it can be dropped from both locales, but next-intl does not fail on unreferenced keys.)
- Task 2 renames `features.handoff` to `features.sells` and `cards.reminder` to `cards.sale` in both the i18n (Steps 1-2) and the code that reads them (Steps 3 and 5), and Step 6 verifies no reference to the old keys remains. The `features` array `key: 'sells'` matches `t(\`features.sells.title\`)` used by the existing grid map. The `verticals` array `'v7'` matches `landing.verticals.v7`.
- No `landing.demo` key is touched by Task 2, so Task 1's additions are not disturbed.

No issues found; the plan is internally consistent.
