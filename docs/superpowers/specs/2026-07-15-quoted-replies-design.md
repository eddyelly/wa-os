# WaOS Quoted Replies (reply to a specific message)

Date: 2026-07-15
Status: Approved by Edward (direction and section-level design, 2026-07-15).
One implementation plan follows before code.

## 1. Summary

Bring WhatsApp-style quoted replies to WaOS: a message can reply to a specific
earlier message, and the reply shows a snippet of what it answered. This works
in all three directions the owner cares about:

1. A **customer's** quoted message is shown in the dashboard inbox thread (when
   a customer replies-to one of your messages, the thread renders the quote).
2. A **human agent** can reply to a specific message from the dashboard thread.
3. The **AI** can reply to a specific message, so a burst of customer texts gets
   an answer that clearly points at the one it addressed.

A feasibility spike (2026-07-15) confirmed this is buildable: Evolution API
v2.3.7 `/message/sendText` and `/message/sendMedia` accept a `quoted` param;
inbound webhooks already carry the quoted-message id (`contextInfo.stanzaId`)
via the adapter's `.passthrough()` parsing; and every `Message` row already
stores `providerMessageId`, which is the anchor a quote points at. Nothing is
wired yet, so this feature adds the wiring across the stack.

This is a messaging + presentation feature. No payments, no billing, no new
provider, no change to the AI's grounding or confidence logic beyond choosing a
reply target.

## 2. Decisions made (with Edward, 2026-07-15)

| Decision | Choice |
| --- | --- |
| Scope | All three directions: show customers' quotes, human agent quote-reply, AI quote-reply. |
| AI quoting behavior | Quote only when it helps: the AI attaches a quote to its reply only when 2+ customer messages are unanswered since the last outbound message (ambiguity about which text it answered). In a normal one-to-one back-and-forth it replies without a quote. |
| "Answered" marker | Keep it clean: the quoted reply itself shows which message was answered; no separate "replied" marker on the original incoming message. |
| Message types | Quoting works for both text and media replies. A customer may quote any message type; we render a snippet from its text/caption or a type label. |

## 3. Data model

Add one nullable self-reference to `Message`:

- `replyToMessageId String?` with a self-relation (`replyTo Message?`,
  `replies Message[]`), `onDelete: SetNull`. It records the local message this
  one quotes. Nullable because most messages are not replies.

No other model changes. `providerMessageId` (existing) remains the cross-message
anchor used to resolve an inbound quote to a local row. Migration via
`prisma migrate`; the field is indexed only as needed for the self-relation.

## 4. Port contract changes (packages/ports)

The `MessagingPort` is a sacred interface; all changes are additive and
optional, so existing callers and the Cloud API stub are unaffected.

- `IncomingMessage` gains an optional `quotedProviderMessageId?: string` (the
  provider id of the message a customer quoted, when present).
- `sendText` and `sendMedia` gain an optional trailing `quoted?: QuotedRef`
  argument, where `QuotedRef` carries what the adapter needs to reconstruct the
  provider quote (the target message's `providerMessageId`, its direction/
  `fromMe`, and a short text/caption for providers that want the quoted body).
  The Cloud API stub ignores it (still throws `NotImplementedError` as today).

## 5. Adapter (Evolution)

- **Inbound (`normalizeWebhookEvent`)**: read `contextInfo.stanzaId` from
  `extendedTextMessage` / `imageMessage` / other content (already available via
  `.passthrough()`), and set `IncomingMessage.quotedProviderMessageId`. Absent
  contextInfo leaves it undefined (a normal, non-reply message).
- **Outbound (`sendText`/`sendMedia`)**: when a `quoted` ref is passed, include
  Evolution's `quoted: { key: { id, fromMe, remoteJid } }` (and the minimal
  message body it wants) in the request to `/message/sendText` and
  `/message/sendMedia`. Because Evolution owns message state, the stored id is
  sufficient for it to attach the correct context.
- Adapter unit tests cover: inbound with contextInfo sets the quoted id;
  inbound without it leaves it undefined; outbound includes `quoted` when a ref
  is passed and omits it otherwise.

## 6. Inbound flow

Evolution webhook -> adapter normalizes to `IncomingMessage` (now possibly with
`quotedProviderMessageId`) -> the inbound service, when storing the `Message`,
resolves `quotedProviderMessageId` to a local `Message` in the same
conversation (by `providerMessageId`) and sets `replyToMessageId`. If no local
message matches (the quoted message predates the connection or was never
stored), `replyToMessageId` stays null and the UI shows a muted "quoted a
message" placeholder. Everything else in the inbound path is unchanged.

## 7. Outbound flow

- **Human agent**: the dashboard thread's send path carries an optional
  `replyToMessageId`. The outbound send job payload (Zod schema in
  `packages/shared`) gains an optional `replyToMessageId`; the send worker loads
  that message, builds the `QuotedRef`, and passes it to the adapter. The stored
  outbound `Message` records its own `replyToMessageId`.
- **AI**: the ai-reply job decides a reply target using the "quote when it
  helps" rule: if 2+ inbound customer messages are unanswered since the last
  outbound message, it sets `replyToMessageId` to the most recent of those
  (the message it is answering); otherwise no quote. The rest of the AI pipeline
  (grounding, confidence threshold, handoff) is unchanged; quoting only sets a
  target on the outbound send.
- Both paths flow through the existing PolicyEngine + rate limiter + jitter
  unchanged; quoting adds no new policy surface.

## 8. Thread UI (dashboard)

- **Quoted snippet**: a message that has `replyToMessageId` renders a small bar
  above its bubble showing the quoted message's author label and a one-line
  text/caption excerpt, in the established thread styling. Tapping it scrolls to
  and briefly highlights the original message.
- **Reply affordance**: each message shows a reply control (a reply icon on
  hover on desktop, a small tap target on mobile). Activating it sets a
  "Replying to: <excerpt>" bar above the composer with a cancel (x); sending
  includes the `replyToMessageId` and clears the bar.
- **Resolution**: the thread already loads the conversation's messages, so the
  client resolves `replyToMessageId` to the quoted message locally and renders
  its excerpt; if the target is outside the loaded set, it shows the muted
  placeholder. The message DTO (`packages/shared`) exposes `replyToMessageId`;
  no extra network payload is needed.
- Any new UI copy ("Replying to", "quoted a message", the reply control label)
  ships in `en` and `sw` and passes the parity check.

## 9. Edge cases and boundaries

- **Unresolved quote**: quoted target not in our data -> muted "quoted a
  message" placeholder, never an error.
- **Deleted original**: `onDelete: SetNull` drops the link; the reply renders
  without a snippet.
- **Self-consistency**: an outbound reply and its stored `replyToMessageId`
  match what was sent to the provider.
- **Out of scope**: reactions, forwarding, message editing, and the "answered"
  marker on originals (explicitly declined). Group chats are not in scope
  (WaOS is 1:1 business-to-customer).

## 10. Binding constraints

- The `MessagingPort` change is additive and optional only; the interface's
  existing shape and the Cloud API stub behavior are preserved.
- No payments/billing/checkout. No change to AI grounding, confidence, or
  handoff logic beyond selecting a reply target.
- Multi-tenant: `replyToMessageId` resolution is scoped within the same
  conversation (and therefore organization) via the tenant Prisma extension;
  never resolve a quote across organizations.
- Both locales stay complete; new UI copy ships in `en` and `sw` and passes
  `pnpm check:i18n` (now enforced in lint).
- No em dashes; TypeScript strict, no `any`; conventional commits. Services with
  logic (the inbound resolve, the AI "quote when it helps" rule, the adapter
  in/out) get Vitest tests.

## 11. Sequencing (decomposition)

One implementation plan, subagent-driven, roughly:

- **Task 1: data model + port contract.** `Message.replyToMessageId` migration;
  `IncomingMessage.quotedProviderMessageId`; the optional `quoted` param and
  `QuotedRef` on `MessagingPort`; the outbound job-payload schema gains
  `replyToMessageId`; the message DTO exposes `replyToMessageId`.
- **Task 2: Evolution adapter in/out.** Parse `contextInfo.stanzaId` inbound;
  pass Evolution's `quoted` outbound; adapter tests.
- **Task 3: inbound resolve + persist.** Resolve `quotedProviderMessageId` to a
  local message and set `replyToMessageId` on store; repository/service tests.
- **Task 4: outbound wiring + AI rule.** Thread `replyToMessageId` through the
  send worker to the adapter; implement the AI "quote when it helps" rule; tests
  for the rule (0/1/2+ unanswered messages).
- **Task 5: thread UI.** Quoted snippet, reply affordance, composer "replying
  to" bar, click-to-scroll, en/sw copy.

## 12. Success criteria

- A customer's quoted message renders as a snippet above their bubble in the
  dashboard thread.
- From the thread, the owner can reply to a specific message, and the customer
  receives a native WhatsApp quoted reply.
- The AI attaches a quote only when 2+ customer messages are unanswered since
  the last reply, and no quote otherwise.
- Tapping a quoted snippet scrolls to and highlights the original.
- Unresolved quotes degrade to a muted placeholder, never an error.
- `pnpm typecheck`, `pnpm lint` (incl. i18n parity), and the API test suite
  (incl. the new adapter/inbound/AI-rule tests) pass; the thread renders cleanly
  on desktop and mobile.

## 13. Build-time verification note

The one thing the spike could not prove offline is that a live quoted send from
our connected instance renders as a genuine WhatsApp quoted reply on the
customer's phone. During Task 2/4 this needs a single live confirmation to a
safe test recipient (not a real customer). Edward provides a safe number, or
confirms it himself, before the outbound path is called done.
