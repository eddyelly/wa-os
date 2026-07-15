# Quoted Replies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a WaOS message reply to a specific earlier message (WhatsApp-style quoted replies): customers' quotes render in the inbox thread, a human agent can reply to a specific message, and the AI quotes the message it answers when a customer sent 2+ unanswered texts.

**Architecture:** One nullable self-reference on `Message` (`replyToMessageId`) is the spine. The `MessagingPort` gains an optional, additive `quoted` argument and `IncomingMessage` an optional `quotedProviderMessageId`, so the sacred interface and the Cloud API stub are unaffected. The Evolution adapter reads the quoted id that already arrives inbound (`contextInfo.stanzaId`) and passes Evolution's `quoted` outbound. The inbound service resolves the quoted provider id to a local message; the outbound worker (which already loads the full message row) resolves `replyToMessageId` to a `QuotedRef` and passes it to the adapter. The AI worker applies a pure "quote when 2+ unanswered" rule. The dashboard thread renders a quoted snippet, a per-message reply affordance, and a "Replying to" composer bar.

**Tech Stack:** Node 20+, Express, TypeScript strict, Prisma/Postgres, BullMQ, Vitest (API). Next.js 15/React 19/Tailwind/next-intl (web). Evolution API v2.3.7.

## Global Constraints

- **Additive/optional port change only.** `MessagingPort`'s existing signatures keep working; the new `quoted` arg is optional and the Cloud API stub ignores it (still throws `NotImplementedError`). (Spec section 10.)
- **No payments/billing.** No change to AI grounding, confidence, or handoff logic beyond selecting a reply target. (Spec section 10.)
- **Tenant-scoped resolution.** Resolve a quoted message only within the same conversation/organization via the tenant Prisma extension; never across organizations. (Spec section 10.)
- **AI quotes only when it helps:** the AI attaches a quote only when 2+ inbound messages are unanswered since the last outbound; otherwise no quote. (Spec section 2.)
- **Both locales complete.** New UI copy ships in `en` and `sw` and passes `pnpm check:i18n` (now part of `pnpm lint`). (Spec section 10.)
- **No em dashes. TypeScript strict, no `any`. Conventional commits.** Services with logic get Vitest tests. (Spec section 10.)
- **API gate:** `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`. **Web gate:** `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`. Run `tsc` (typecheck) explicitly; the build's esbuild transform does not type-check.

---

## File Structure

- `apps/api/prisma/schema.prisma` — `Message.replyToMessageId` self-relation (Task 1).
- `packages/ports/src/messaging.ts` — `QuotedRef`, `IncomingMessage.quotedProviderMessageId`, optional `quoted` on `sendText`/`sendMedia` (Task 1).
- `packages/shared/src/schemas/conversation.ts` — `messageSchema.replyToMessageId`, `sendMessageRequestSchema.replyToMessageId` (Task 1).
- `apps/api/src/repositories/message-repository.ts` — `createOutbound`/`createInbound` accept `replyToMessageId`; add `findById` (Task 1).
- `apps/api/src/adapters/evolution/evolution-schemas.ts` + `evolution-adapter.ts` + `evolution-client.ts` — inbound `contextInfo.stanzaId`, outbound `quoted` (Task 2).
- `apps/api/src/services/inbound-service.ts` + `conversation-service.ts` — resolve + persist inbound quote; expose `replyToMessageId` in the message DTO (Task 3).
- `apps/api/src/services/outbound-service.ts` + `workers/outbound-worker.ts` + `conversation-service.ts` + `controllers/conversation-controller.ts` + `services/ai-reply.ts` + `workers/ai-reply-worker.ts` — outbound wiring + AI rule (Task 4).
- `apps/web/src/components/conversation-thread.tsx` + `apps/web/messages/{en,sw}.json` — thread UI + copy (Task 5).

---

### Task 1: Data model, port contract, and shared schemas

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Message model)
- Modify: `packages/ports/src/messaging.ts`
- Modify: `packages/shared/src/schemas/conversation.ts`
- Modify: `apps/api/src/repositories/message-repository.ts`

**Interfaces:**
- Produces: `QuotedRef` (from `@waos/ports`); `IncomingMessage.quotedProviderMessageId?: string`; `MessagingPort.sendText(channelId, to, text, quoted?)` and `sendMedia(channelId, to, media, caption?, quoted?)`; `messageSchema` and `MessageDto` with `replyToMessageId`; `sendMessageRequestSchema` with `replyToMessageId`; `messageRepository.createOutbound`/`createInbound` accepting `replyToMessageId?: string`; `messageRepository.findById(id): Promise<Message | null>`.

- [ ] **Step 1: Add the self-reference to the Prisma Message model**

In `apps/api/prisma/schema.prisma`, inside `model Message`, add the field and self-relation (place the scalar near `providerMessageId`, and the relations with the other relation fields):
```prisma
  replyToMessageId String?
  replyTo          Message?  @relation("MessageReplies", fields: [replyToMessageId], references: [id], onDelete: SetNull)
  replies          Message[] @relation("MessageReplies")
```

- [ ] **Step 2: Create the migration**

Run: `pnpm -F @waos/api exec prisma migrate dev --name message_reply_to`
Expected: a new migration under `apps/api/prisma/migrations/` adds `replyToMessageId` (nullable) with a self FK; `prisma generate` updates the client. Do not edit any previously committed migration.

- [ ] **Step 3: Extend the port types**

In `packages/ports/src/messaging.ts`, add `quotedProviderMessageId` to `IncomingMessage`, add the `QuotedRef` type, and add the optional `quoted` parameter to `sendText`/`sendMedia`:
```ts
export interface IncomingMessage {
  channelId: string;
  providerMessageId: string;
  from: string;
  contactName?: string;
  type: IncomingMessageType;
  text?: string;
  media?: IncomingMedia;
  sentAt: Date;
  /** Provider id of the message this one quotes, when the sender replied to one. */
  quotedProviderMessageId?: string;
}

/** A reference to the message a send is replying to (quoting). */
export interface QuotedRef {
  /** The quoted message's provider id (WhatsApp message id). */
  providerMessageId: string;
  /** True when we sent the quoted message (direction OUT); false for the contact's. */
  fromMe: boolean;
  /** Quoted body/caption excerpt, for providers that want the quoted content. */
  text?: string;
}
```
And in the `MessagingPort` interface, change the two signatures:
```ts
  sendText(channelId: string, to: string, text: string, quoted?: QuotedRef): Promise<SendResult>;
  sendMedia(
    channelId: string,
    to: string,
    media: MediaRef,
    caption?: string,
    quoted?: QuotedRef,
  ): Promise<SendResult>;
```

- [ ] **Step 4: Extend the shared message and send-request schemas**

In `packages/shared/src/schemas/conversation.ts`, add `replyToMessageId` to `messageSchema` (after `blockedReason`) and to `sendMessageRequestSchema`:
```ts
export const messageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  direction: messageDirectionSchema,
  type: messageTypeSchema,
  body: z.string().nullable(),
  mediaUrl: z.string().nullable().optional(),
  authorType: authorTypeSchema,
  status: messageStatusSchema,
  blockedReason: z.string().nullable().optional(),
  replyToMessageId: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
});
```
```ts
export const sendMessageRequestSchema = z.object({
  body: z.string().trim().min(1).max(4096),
  replyToMessageId: z.string().optional(),
});
```

- [ ] **Step 5: Thread `replyToMessageId` through the message repository**

In `apps/api/src/repositories/message-repository.ts`: add `replyToMessageId?: string` to both `createOutbound` and `createInbound` data params and set it in the `data` object; add a lean `findById`.

`createOutbound` param object gains `replyToMessageId?: string;` and the `data` gains `replyToMessageId: data.replyToMessageId ?? null,`. Same for `createInbound`. Then add, after `findByProviderId`:
```ts
  findById(id: string): Promise<Message | null> {
    return prisma.message.findUnique({ where: { id } });
  },
```

- [ ] **Step 6: Run the API gate**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Expected: typecheck clean (the port change is additive so all existing `sendText`/`sendMedia` callers still compile), the existing suite green, lint clean. Note: `pnpm -F @waos/shared build` if the shared package builds separately; otherwise consumers read source.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/ports/src/messaging.ts packages/shared/src/schemas/conversation.ts apps/api/src/repositories/message-repository.ts
git commit -m "feat(api): add Message.replyToMessageId and optional quoted messaging-port arg"
```

---

### Task 2: Evolution adapter reads inbound quotes and sends quoted replies

**Files:**
- Modify: `apps/api/src/adapters/evolution/evolution-schemas.ts`
- Modify: `apps/api/src/adapters/evolution/evolution-adapter.ts`
- Modify: `apps/api/src/adapters/evolution/evolution-client.ts`
- Test: `apps/api/src/adapters/evolution/evolution-adapter.test.ts`

**Interfaces:**
- Consumes: `QuotedRef`, `IncomingMessage.quotedProviderMessageId` (Task 1).
- Produces: `evolutionClient.sendText(instance, number, text, quoted?)` and `sendMedia(..., quoted?)`; the adapter sets `quotedProviderMessageId` inbound and forwards `quoted` outbound.

- [ ] **Step 1: Write failing adapter tests**

In `apps/api/src/adapters/evolution/evolution-adapter.test.ts`, add:
```ts
it('captures the quoted message id from an inbound reply', () => {
  const result = evolutionAdapter.normalizeWebhookEvent({
    event: 'messages.upsert',
    instance: 'chan1',
    data: {
      key: { remoteJid: '255700000000@s.whatsapp.net', fromMe: false, id: 'WAMSG2' },
      message: {
        extendedTextMessage: {
          text: 'yes that one',
          contextInfo: { stanzaId: 'WAMSG1' },
        },
      },
    },
  });
  expect(result?.event.kind).toBe('message');
  if (result?.event.kind === 'message') {
    expect(result.event.message.quotedProviderMessageId).toBe('WAMSG1');
  }
});

it('leaves quotedProviderMessageId undefined for a non-reply message', () => {
  const result = evolutionAdapter.normalizeWebhookEvent({
    event: 'messages.upsert',
    instance: 'chan1',
    data: {
      key: { remoteJid: '255700000000@s.whatsapp.net', fromMe: false, id: 'WAMSG3' },
      message: { conversation: 'hello' },
    },
  });
  if (result?.event.kind === 'message') {
    expect(result.event.message.quotedProviderMessageId).toBeUndefined();
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @waos/api test -- evolution-adapter`
Expected: FAIL (`quotedProviderMessageId` is always undefined; contextInfo is not read yet).

- [ ] **Step 3: Type contextInfo in the message-content schema**

In `apps/api/src/adapters/evolution/evolution-schemas.ts`, add an optional `contextInfo` to each replyable message-content member so `stanzaId` is typed. Define once and attach:
```ts
const contextInfoSchema = z
  .object({ stanzaId: z.string().optional(), participant: z.string().optional() })
  .passthrough();
```
Then add `contextInfo: contextInfoSchema.optional(),` inside the `extendedTextMessage`, `imageMessage`, `audioMessage`, `documentMessage`, and `videoMessage` object schemas (keep their existing fields and `.passthrough()`).

- [ ] **Step 4: Read the quoted id in the adapter**

In `apps/api/src/adapters/evolution/evolution-adapter.ts`, within `normalizeWebhookEvent`, after the content type/text/media branches and before building the `IncomingMessage`, compute the quoted id from whichever content member is present:
```ts
    const quotedProviderMessageId =
      content.extendedTextMessage?.contextInfo?.stanzaId ??
      content.imageMessage?.contextInfo?.stanzaId ??
      content.audioMessage?.contextInfo?.stanzaId ??
      content.documentMessage?.contextInfo?.stanzaId ??
      content.videoMessage?.contextInfo?.stanzaId ??
      undefined;
```
Add `quotedProviderMessageId,` to the returned `IncomingMessage` object.

- [ ] **Step 5: Forward `quoted` in the adapter send methods**

In the same file, thread the optional `quoted` through:
```ts
  async sendText(channelId: string, to: string, text: string, quoted?: QuotedRef): Promise<SendResult> {
    const providerMessageId = await evolutionClient.sendText(
      channelId,
      toProviderNumber(to),
      text,
      quoted,
    );
    return { providerMessageId };
  }
```
and add `quoted?: QuotedRef` as the last parameter of `sendMedia`, passing it to `evolutionClient.sendMedia(...)` as the final argument. Import `QuotedRef` from `@waos/ports` alongside the existing port-type imports.

- [ ] **Step 6: Build the Evolution `quoted` payload in the client**

In `apps/api/src/adapters/evolution/evolution-client.ts`, add a helper and thread `quoted` into `sendText`/`sendMedia` request bodies. `number` here is already digits (no `+`).
```ts
function buildQuoted(number: string, quoted: QuotedRef): {
  key: { id: string; fromMe: boolean; remoteJid: string };
  message: { conversation: string } | Record<string, never>;
} {
  return {
    key: { id: quoted.providerMessageId, fromMe: quoted.fromMe, remoteJid: `${number}@s.whatsapp.net` },
    message: quoted.text ? { conversation: quoted.text } : {},
  };
}
```
Change `sendText` to `async sendText(instanceName, number, text, quoted?: QuotedRef)` and send `{ number, text, ...(quoted ? { quoted: buildQuoted(number, quoted) } : {}) }`. Change `sendMedia` to accept a trailing `quoted?: QuotedRef` and add `...(quoted ? { quoted: buildQuoted(number, quoted) } : {})` to its request body. Import `QuotedRef` from `@waos/ports`.

- [ ] **Step 7: Add an outbound-quoted test**

In `evolution-adapter.test.ts` (or the existing client-mock test file for the adapter), add a test that calls `evolutionAdapter.sendText('chan1', '+255700000000', 'hi', { providerMessageId: 'WAMSG1', fromMe: false, text: 'q' })` with the evolution client mocked, and asserts the client's `sendText` mock received the `quoted` ref as its 4th argument. Follow the existing mock pattern in that test file.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm -F @waos/api test -- evolution-adapter`
Expected: PASS (inbound quote captured, non-reply undefined, outbound forwards quoted).

- [ ] **Step 9: Run the API gate and commit**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
```bash
git add apps/api/src/adapters/evolution/
git commit -m "feat(api): evolution adapter reads inbound quotes and sends quoted replies"
```

---

### Task 3: Resolve and persist the inbound quote link

**Files:**
- Modify: `apps/api/src/services/inbound-service.ts`
- Modify: `apps/api/src/services/conversation-service.ts` (message DTO mapping)
- Test: `apps/api/src/services/ai-reply.test.ts` is unrelated; add a focused test in an inbound test file (see Step 1)

**Interfaces:**
- Consumes: `IncomingMessage.quotedProviderMessageId` (Task 2), `messageRepository.findByProviderId`, `createInbound(replyToMessageId?)` (Task 1).
- Produces: inbound `Message` rows carry `replyToMessageId` when the quote resolves; `MessageDto.replyToMessageId` populated by `conversationService.messages`.

- [ ] **Step 1: Write a failing inbound-resolve test**

Create `apps/api/src/services/inbound-service.test.ts` (mock the repositories, following the `notification-service.test.ts` `vi.hoisted` pattern). Assert that when `messageRepository.findByProviderId` returns a message with id `local-1` for the incoming `quotedProviderMessageId`, `createInbound` is called with `replyToMessageId: 'local-1'`; and when it returns null, `createInbound` is called with `replyToMessageId: undefined`. Mock the adapter's `normalizeWebhookEvent` to return a `message` event carrying `quotedProviderMessageId`, and mock contact/conversation upserts.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @waos/api test -- inbound-service`
Expected: FAIL (inbound service does not resolve or pass `replyToMessageId` yet).

- [ ] **Step 3: Resolve the quote in the inbound service**

In `apps/api/src/services/inbound-service.ts`, inside `handleIncomingMessage`, before the `createInbound` call, resolve the quoted id to a local message and pass it:
```ts
  let replyToMessageId: string | undefined;
  if (incoming.quotedProviderMessageId) {
    const quoted = await messageRepository.findByProviderId(incoming.quotedProviderMessageId);
    if (quoted && quoted.conversationId === conversation.id) {
      replyToMessageId = quoted.id;
    }
  }

  const message = await messageRepository.createInbound({
    conversationId: conversation.id,
    providerMessageId: incoming.providerMessageId,
    type: incoming.type,
    body: incoming.text ?? null,
    mediaKey,
    replyToMessageId,
  });
```
The `quoted.conversationId === conversation.id` guard keeps resolution within the conversation (and therefore the tenant). An unresolved quote leaves `replyToMessageId` undefined.

- [ ] **Step 4: Expose `replyToMessageId` in the message DTO**

In `apps/api/src/services/conversation-service.ts`, the `messages` method maps rows to `MessageDto`. Add `replyToMessageId: row.replyToMessageId` to that mapping (alongside `body`, `status`, etc.). If the mapping is a shared helper, add it there so both list and any single-message DTO carry it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @waos/api test -- inbound-service`
Expected: PASS.

- [ ] **Step 6: Run the API gate and commit**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
```bash
git add apps/api/src/services/inbound-service.ts apps/api/src/services/conversation-service.ts apps/api/src/services/inbound-service.test.ts
git commit -m "feat(api): resolve and persist inbound quoted-message links"
```

---

### Task 4: Outbound wiring and the AI quote-when-helps rule

**Files:**
- Modify: `apps/api/src/services/outbound-service.ts`
- Modify: `apps/api/src/workers/outbound-worker.ts`
- Modify: `apps/api/src/services/conversation-service.ts` (`sendFromAgent`)
- Modify: `apps/api/src/controllers/conversation-controller.ts` (`send`)
- Modify: `apps/api/src/services/ai-reply.ts` (rule helper)
- Modify: `apps/api/src/workers/ai-reply-worker.ts` (apply the rule)
- Test: `apps/api/src/services/ai-reply.test.ts` (rule), and the outbound worker test file

**Interfaces:**
- Consumes: `createOutbound(replyToMessageId?)`, `messageRepository.findById` (Task 1); `QuotedRef` (Task 1); `port.sendText/sendMedia(..., quoted?)` (Task 2).
- Produces: `outboundService.sendText/sendMedia` accept `replyToMessageId?: string`; `conversationService.sendFromAgent(id, body, replyToMessageId?)`; `replyTargetForAi(messages, inboundMessageId): string | undefined` from `ai-reply.ts`.

- [ ] **Step 1: Write a failing test for the AI rule**

In `apps/api/src/services/ai-reply.test.ts`, add tests for a new pure function `replyTargetForAi(messages, inboundMessageId)`:
```ts
import { replyTargetForAi } from './ai-reply.js';

const inbound = (id: string) => ({ id, direction: 'IN' as const });
const outbound = (id: string) => ({ id, direction: 'OUT' as const });

it('returns the inbound id when 2+ messages are unanswered since the last outbound', () => {
  const messages = [outbound('o1'), inbound('i1'), inbound('i2')];
  expect(replyTargetForAi(messages, 'i2')).toBe('i2');
});

it('returns undefined for a single unanswered message', () => {
  const messages = [outbound('o1'), inbound('i1')];
  expect(replyTargetForAi(messages, 'i1')).toBeUndefined();
});

it('returns undefined when the last message is outbound', () => {
  const messages = [inbound('i1'), outbound('o1')];
  expect(replyTargetForAi(messages, 'i1')).toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @waos/api test -- ai-reply`
Expected: FAIL (`replyTargetForAi` not exported).

- [ ] **Step 3: Implement the rule in ai-reply.ts**

In `apps/api/src/services/ai-reply.ts`, add the pure helper (it only reads `direction`, so it accepts a minimal shape):
```ts
/**
 * Quote-when-it-helps: the AI attaches a quote only when the customer left 2+
 * messages unanswered since our last outbound (so the reply points at the one
 * it addressed). Returns the message id to quote, or undefined for no quote.
 */
export function replyTargetForAi(
  messages: { direction: 'IN' | 'OUT' }[],
  inboundMessageId: string,
): string | undefined {
  let trailingInbound = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.direction === 'IN') {
      trailingInbound += 1;
    } else {
      break;
    }
  }
  return trailingInbound >= 2 ? inboundMessageId : undefined;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm -F @waos/api test -- ai-reply`
Expected: PASS.

- [ ] **Step 5: Accept `replyToMessageId` in the outbound service**

In `apps/api/src/services/outbound-service.ts`, add `replyToMessageId?: string` to the params of both `sendText` and `sendMedia`, and pass it to BOTH `createOutbound` calls in each method (the BLOCKED path and the normal path). Example for `sendText`'s normal path:
```ts
    const message = await messageRepository.createOutbound({
      conversationId: conversation.id,
      body: params.body,
      type: 'TEXT',
      authorType: params.authorType,
      replyToMessageId: params.replyToMessageId,
    });
```
Do the same (`replyToMessageId: params.replyToMessageId`) in the BLOCKED `createOutbound` and in both `sendMedia` `createOutbound` calls. The enqueue payload is unchanged (the worker reads the row).

- [ ] **Step 6: Resolve and pass the quote in the outbound worker**

In `apps/api/src/workers/outbound-worker.ts`, after loading `message` (via `findByIdWithThread`) and before the send branch, build an optional `QuotedRef` from the row's `replyToMessageId`:
```ts
      let quoted: QuotedRef | undefined;
      if (message.replyToMessageId) {
        const target = await messageRepository.findById(message.replyToMessageId);
        if (target?.providerMessageId) {
          quoted = {
            providerMessageId: target.providerMessageId,
            fromMe: target.direction === 'OUT',
            text: target.body ?? undefined,
          };
        }
      }
```
Then pass `quoted` as the last argument of both send calls:
```ts
        const result = await port.sendMedia(channel.id, to, { kind: 'url', url, mimeType }, message.body ?? undefined, quoted);
```
```ts
        const result = await port.sendText(channel.id, to, message.body ?? '', quoted);
```
Import `QuotedRef` from `@waos/ports`. A quote whose target has no `providerMessageId` (never delivered) simply sends without a quote.

- [ ] **Step 7: Thread `replyToMessageId` through the human-agent send path**

In `apps/api/src/services/conversation-service.ts`, change `sendFromAgent` to `sendFromAgent(conversationId: string, body: string, replyToMessageId?: string)` and pass `replyToMessageId` to `outboundService.sendText({ ..., replyToMessageId })`. In `apps/api/src/controllers/conversation-controller.ts` `send`, pass it from the parsed request:
```ts
  const message = await conversationService.sendFromAgent(
    routeParam(req.params.id),
    input.body,
    input.replyToMessageId,
  );
```

- [ ] **Step 8: Apply the AI rule in the ai-reply worker**

In `apps/api/src/workers/ai-reply-worker.ts`, the full message list is already loaded around line 100 (`const inbound = await messageRepository.listByConversation(conversation.id, 200);`). Import `replyTargetForAi` from `../services/ai-reply.js`, compute the target once, and pass it to both outbound sends (the `sendMedia` and `sendText` branches around lines 193-206):
```ts
      const replyToMessageId = replyTargetForAi(inbound, payload.inboundMessageId);
```
Add `replyToMessageId,` to the `outboundService.sendMedia({ ... })` and `outboundService.sendText({ ... })` calls in that block.

- [ ] **Step 9: Add an outbound-worker quoted test**

In the outbound worker's test file, add a case: a QUEUED text message whose `replyToMessageId` points at a message with `providerMessageId: 'WAMSG1'` and `direction: 'IN'` causes `port.sendText` to be called with a 4th `quoted` argument `{ providerMessageId: 'WAMSG1', fromMe: false, text: <body> }`. Mock `messageRepository.findById` to return that target. Follow the existing worker-test mock setup.

- [ ] **Step 10: Run the API gate and commit**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Expected: all green, including the new rule and worker tests.
```bash
git add apps/api/src/services/outbound-service.ts apps/api/src/workers/outbound-worker.ts apps/api/src/services/conversation-service.ts apps/api/src/controllers/conversation-controller.ts apps/api/src/services/ai-reply.ts apps/api/src/workers/ai-reply-worker.ts apps/api/src/services/ai-reply.test.ts
git commit -m "feat(api): send quoted replies for human agents and the AI (quote-when-helps)"
```

**Live-verification note (spec section 13):** once Task 5 ships the UI, a single live quoted send to a safe test recipient (not a real customer) confirms the Evolution `quoted` payload renders as a native WhatsApp quoted reply. Flag this to the controller; do not send to a real customer.

---

### Task 5: Thread UI (quoted snippet, reply affordance, composer bar)

**Files:**
- Modify: `apps/web/src/components/conversation-thread.tsx`
- Modify: `apps/web/messages/en.json` and `apps/web/messages/sw.json`

**Interfaces:**
- Consumes: `MessageDto.replyToMessageId` (Task 1/3); the existing `POST /conversations/:id/messages` now accepts `replyToMessageId` (Task 4).

- [ ] **Step 1: Add the thread copy to both locales**

In `apps/web/messages/en.json`, inside the existing `thread` object, add:
```json
      "reply": "Reply",
      "replyingTo": "Replying to",
      "quotedUnavailable": "Quoted a message",
      "cancelReply": "Cancel reply"
```
In `apps/web/messages/sw.json`, inside `thread`, add:
```json
      "reply": "Jibu",
      "replyingTo": "Unajibu",
      "quotedUnavailable": "Amenukuu ujumbe",
      "cancelReply": "Ghairi jibu"
```

- [ ] **Step 2: Hold reply state and resolve quoted messages**

In `apps/web/src/components/conversation-thread.tsx`, add a `replyingTo` state (the target `MessageDto | null`) near the other message state, and a helper to resolve a `replyToMessageId` to the loaded message:
```tsx
  const [replyingTo, setReplyingTo] = useState<MessageDto | null>(null);
  const messageById = useMemo(
    () => new Map(messages.map((m) => [m.id, m])),
    [messages],
  );
  const excerpt = (m: MessageDto): string => (m.body ?? '').slice(0, 80) || t('quotedUnavailable');
```
(Use the component's existing `t` for the `thread` namespace and its existing `messages` array and `useMemo`/`useState` imports; add any missing import.)

- [ ] **Step 3: Render the quoted snippet above a reply's bubble**

Where each message bubble renders, when `message.replyToMessageId` is set, render a small quoted bar above the bubble. Resolve the target from `messageById`; if absent, show the muted placeholder. The bar is a button that scrolls to the original:
```tsx
{message.replyToMessageId ? (
  <button
    type="button"
    onClick={() => scrollToMessage(message.replyToMessageId!)}
    className="mb-1 block w-full max-w-[85%] truncate rounded-lg border-l-2 border-brand-400 bg-brand-50 px-2 py-1 text-left text-xs text-brand-700"
  >
    {(() => {
      const q = messageById.get(message.replyToMessageId!);
      return q ? excerpt(q) : t('quotedUnavailable');
    })()}
  </button>
) : null}
```
Add `scrollToMessage(id)` which finds the element by a `data-message-id` attribute (add `data-message-id={message.id}` to each bubble's wrapper) and calls `scrollIntoView({ block: 'center' })` plus a brief highlight class toggle.

- [ ] **Step 4: Add a per-message reply affordance**

On each message bubble wrapper, add a reply control that sets `replyingTo`. Desktop shows it on hover; mobile shows a small always-visible tap target. Minimal version (a small reply button that appears within the bubble group):
```tsx
<button
  type="button"
  aria-label={t('reply')}
  onClick={() => setReplyingTo(message)}
  className="text-xs font-medium text-brand-500 opacity-0 transition-opacity hover:text-brand-700 group-hover:opacity-100"
>
  {t('reply')}
</button>
```
Wrap the bubble row with `className="group ..."` so `group-hover` reveals it; on small screens drop the `opacity-0`/`group-hover:opacity-100` via a `sm:` prefix so it stays tappable.

- [ ] **Step 5: Show the "Replying to" composer bar and include the id on send**

Above the composer input, when `replyingTo` is set, render a bar with the excerpt and a cancel:
```tsx
{replyingTo ? (
  <div className="flex items-center justify-between gap-2 border-l-2 border-brand-400 bg-brand-50 px-3 py-1.5 text-xs text-brand-700">
    <span className="truncate">
      {t('replyingTo')}: {excerpt(replyingTo)}
    </span>
    <button type="button" aria-label={t('cancelReply')} onClick={() => setReplyingTo(null)} className="font-bold text-brand-500">
      {'×'}
    </button>
  </div>
) : null}
```
In the existing `send` handler (the `POST /api/v1/conversations/${id}/messages` call), include the target and clear it on success:
```tsx
      await apiFetch(`/api/v1/conversations/${id}/messages`, {
        method: 'POST',
        body: { body: text, ...(replyingTo ? { replyToMessageId: replyingTo.id } : {}) },
      });
      setReplyingTo(null);
```
(Keep the rest of the send handler as-is; `text` is the existing composed body variable.)

- [ ] **Step 6: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean; `pnpm lint`'s i18n parity check passes (the four new `thread.*` keys exist in both locales). Live-drive note (controller): open a thread, reply to a specific message, confirm the quoted snippet renders and the composer bar clears on send.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/conversation-thread.tsx apps/web/messages/en.json apps/web/messages/sw.json
git commit -m "feat(web): reply to a specific message with a quoted snippet in the thread"
```

---

## Self-Review

**1. Spec coverage (spec sections mapped to tasks):**
- Section 3 (data model, `Message.replyToMessageId`): Task 1. Section 4 (port contract, `IncomingMessage.quotedProviderMessageId`, optional `quoted`): Task 1. Section 5 (Evolution adapter in/out): Task 2. Section 6 (inbound resolve within conversation/tenant): Task 3. Section 7 (outbound human + AI quote-when-helps): Task 4. Section 8 (thread UI: quoted snippet, reply affordance, composer bar, click-to-scroll, en/sw copy): Task 5. Section 9 edge cases (unresolved quote → placeholder; `onDelete: SetNull`): Task 1 (SetNull) + Task 3/Task 5 (placeholder). Section 12 success criteria: covered across tasks; the live quoted-send proof is flagged in Task 4/Task 5 per section 13.
- Deliberate: the AI-rule "2+ unanswered" counts the trailing run of `direction === 'IN'` messages, which is exactly "unanswered since the last outbound"; single-message and last-is-outbound cases return undefined (tested in Task 4).

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code or an exact edit; command steps show expected results. Swahili strings are concrete.

**3. Type consistency:**
- `QuotedRef` fields (`providerMessageId`, `fromMe`, `text?`) are defined in Task 1 Step 3 and constructed identically in the outbound worker (Task 4 Step 6) and the adapter test (Task 2 Step 7); the client's `buildQuoted` consumes the same fields (Task 2 Step 6).
- `IncomingMessage.quotedProviderMessageId` (Task 1) is set by the adapter (Task 2 Step 4) and read by the inbound service (Task 3 Step 3).
- `messageRepository.createOutbound/createInbound` gain `replyToMessageId?` (Task 1 Step 5) and are called with it in Task 3 (inbound) and Task 4 (outbound). `findById` (Task 1 Step 5) is used by the outbound worker (Task 4 Step 6).
- `MessageDto.replyToMessageId` (Task 1 Step 4) is populated in Task 3 Step 4 and consumed by the thread UI (Task 5).
- `sendMessageRequestSchema.replyToMessageId` (Task 1 Step 4) flows controller → `sendFromAgent` → `outboundService.sendText` (Task 4 Step 7) and is sent by the web composer (Task 5 Step 5).
- `replyTargetForAi(messages, inboundMessageId)` (Task 4 Step 3) is called in the AI worker (Task 4 Step 8) with the already-loaded `inbound` list and `payload.inboundMessageId`.
- The `MessagingPort.sendText/sendMedia` optional `quoted` (Task 1 Step 3) is honored by the Evolution adapter (Task 2) and passed by the outbound worker (Task 4); the Cloud API stub is unaffected (its methods ignore extra args and still throw).

No inconsistencies found.
