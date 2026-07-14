# WaOS Revamp Phase D: Brand and Landing

Date: 2026-07-14
Status: Approved by Edward (direction and section-level design, 2026-07-14). One
implementation plan follows before code.

## 1. Summary

Phase D is the final phase of the master revamp (see
docs/superpowers/specs/2026-07-11-waos-revamp-master-design.md, section 9). Its
job is to make the public landing page tell the story the product now actually
delivers. C1 and C2 rebuilt the dashboard and its data layer; the shop module
added AI selling (catalog, bargaining within owner-set floors, photo analysis,
orders). The landing, however, still tells an appointments-only story: the hero
phone plays a booking conversation that ends in a "booking confirmed" chip, and
the feature cards are answers / bookings / handoff / language. A shop owner
visiting the page does not see themselves.

Phase D is a targeted refresh of the existing landing
(`apps/web/src/app/[locale]/page.tsx`), not a rebuild. It keeps the proven
structure, the C2 visual system (deep-green brand ramp, warm amber accent, Inter
via next/font), and every animation. It changes the demo and the copy so the
page sells both halves of the product: an AI that answers, books, and sells on
WhatsApp.

The brand's visual identity is already done (C2). Phase D is positioning and
copy plus one new demo scene. It is presentation and marketing only: no data,
API, auth, or route change.

## 2. Decisions made (with Edward, 2026-07-14)

| Decision | Choice |
| --- | --- |
| Positioning | Answers, books, AND sells. Appointment services stay the lead beachhead; selling is elevated to a co-equal capability, not a footnote. Headline becomes "one AI that answers, books, and sells on WhatsApp." |
| Selling demo scene | Photo, then bargain: the customer sends a photo, the AI recognizes the product and quotes a price, the customer haggles, the AI closes at the owner's hidden floor, and an order is recorded. Shows both signature features (vision and bargaining) and matches the master plan's "photo to order" sketch. |
| Scope | Targeted refresh of the existing landing. Keep the structure, visual system, and animations; change the demo and the copy. |
| Feature cards | Keep the clean four-card grid: Answers 24/7, Books and reminds, Sells and bargains (new), Speaks Swahili and English. Book and remind merge into one card so selling can join without a fifth card. |
| Demo product | A care product a salon, clinic, or shop would sell (for example a hair or skincare product), so the selling scene fits the appointment-services beachhead rather than implying a separate retail app. |

## 3. The dual demo (the centerpiece)

The hero phone (`PhoneDemo`) currently plays a single booking conversation on a
13 second replay cycle. Phase D makes it alternate between two scenes by cycle
parity: even cycles play the existing booking scene (kept exactly as is), odd
cycles play the new selling scene. One phone, two stories, no added clutter. The
replay mechanism and the header, composer, typing-dot, and pop-in animations are
reused unchanged.

### Booking scene (kept)
Unchanged: customer asks about an appointment, the AI answers and books, ending
in the existing "booking confirmed" calendar chip.

### Selling scene (new)
Roughly five beats, symmetric in length with the booking scene:

1. The customer sends a **photo** of a product (rendered as an inline image
   bubble: a small SVG product thumbnail, no external image), with a short "Do
   you have this?"
2. The AI (typing dots, then reply) recognizes it from the catalog: "Yes, that
   is our [product]. It is 20,000 TZS." This conveys photo analysis.
3. The customer haggles: "Can you do 15,000?"
4. The AI closes at the owner's hidden floor: "I can do 17,000, and that is my
   best." The floor is never revealed; the AI simply meets the customer above
   it. This conveys bargaining within a floor.
5. The customer accepts, and an **"Order recorded, owner notified"** chip pops
   in, mirroring the booking chip's treatment (icon tile, title, body, a small
   status badge).

Money is shown as whole TZS integers, consistent with the app. The photo bubble
and the order chip are self-contained (inline SVG and brand tokens); no network
assets are introduced, consistent with the self-hosted-font posture.

### Floating cards
The three floating feature cards orbiting the phone (booking, reminder, ai) stay.
One is reworked or added to reflect selling (for example a "sale closed" or
"order" card in the amber accent), so the orbiting cards echo the dual story.

## 4. Positioning and copy

All copy lives in the `landing.*` i18n namespace and is updated in both `en` and
`sw`. Changes by section:

- **Hero headline and subtitle**: broaden from booking-only to "answers, books,
  and sells." Keep the existing punchy shape (a title, an accent-highlighted
  word, a title tail) and the kicker, primary CTA, secondary CTA, and free note.
  The subtitle names all three capabilities in one sentence.
- **Feature cards (four)**: Answers 24/7, Books and reminds, Sells and bargains
  (new), Speaks Swahili and English. The selling card names the distinctive
  behavior (recognizes products from a photo, negotiates to your price). Icons
  reuse the existing lucide-style SVG path pattern.
- **How it works (three steps)**: make the steps capability-neutral: connect
  your WhatsApp, add your info and catalog, and the AI answers, books, and sells.
- **Stats band (four)** and **final CTA and footer**: light copy updates so the
  numbers and closing line reflect the broader story; structure unchanged.
- **Verticals marquee**: add a retail or shop vertical alongside the existing
  service verticals so selling is represented; structure unchanged.

The demo scene copy (business name, the five selling bubbles, the order chip)
lives under `landing.demo.*` alongside the existing booking-scene keys.

## 5. Binding constraints

- **Phase 1 MVP, no money.** No pricing, paywalls, upgrade prompts, or plan
  language anywhere on the page. The primary CTA is "sign up," free. The existing
  authed-aware CTA (open inbox when logged in, else sign up) is preserved.
- **Brand naming.** Use "WaOS" or `NEXT_PUBLIC_APP_NAME` for the brand;
  "WhatsApp" appears only as the platform noun ("on WhatsApp"), never as a brand
  string. (CLAUDE.md naming note.)
- **Both locales complete.** Every new or changed string ships in `en` and `sw`.
  Parity is currently manual (no tool enforces it), so it is verified by hand:
  the `landing.*` key sets in the two files must match exactly.
- **Presentation and marketing only.** No data, API, auth, route, or query
  change. The only files touched are the landing page component and the two
  locale files.
- **Self-contained.** No external images or network assets: the product photo in
  the selling scene is an inline SVG.
- **Accessibility.** Decorative demo elements stay `aria-hidden` as today;
  interactive controls (CTAs, language switcher, nav links) keep their labels and
  focus states.

## 6. Out of scope (explicitly)

- No change to the app itself (dashboard, onboarding, auth): those are C1 and C2,
  merged. Phase D touches only the public landing.
- No new brand colors, logo, or type system: the visual identity is C2's and is
  reused as is.
- No pricing page, no second marketing route, no blog: one landing page.
- No dark-mode work, no en/sw parity tooling (a tracked fast-follow, not Phase D),
  no backend changes.

## 7. Sequencing (decomposition)

One implementation plan, subagent-driven, roughly:

- **Task 1: the selling demo scene.** Add the second scripted scene to
  `PhoneDemo`, alternate scenes by cycle parity, add the inline-SVG photo bubble
  and the "order recorded" chip, and the `landing.demo.*` selling keys in both
  locales. The booking scene stays byte-for-byte.
- **Task 2: positioning and copy.** Rework the hero headline and subtitle, the
  four feature cards (introducing "sells and bargains"), how-it-works, the stats
  band, the marquee vertical, and the final CTA and footer copy, all in `en` and
  `sw`. Rework or add the selling floating card.

Optional small polish (an extra floating card variant, marquee tuning) folds into
these two tasks rather than a third.

The web app has no test runner; the phase gates on
`pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build` plus a live
drive of the landing on desktop and mobile, and a manual en/sw `landing.*` key
parity check.

## 8. Success criteria

- The landing hero phone alternates between a booking scene and a selling scene;
  the selling scene shows a photo, a bargain, and a recorded order.
- The page copy names all three capabilities (answers, books, sells); a shop
  owner and a salon owner both see themselves.
- No pricing, paywall, or upgrade language anywhere; "WhatsApp" appears only as
  the platform noun.
- `en` and `sw` `landing.*` key sets match exactly.
- `pnpm -F @waos/web typecheck`, `pnpm lint`, and `pnpm -F @waos/web build` pass;
  the landing renders cleanly on desktop and mobile.
