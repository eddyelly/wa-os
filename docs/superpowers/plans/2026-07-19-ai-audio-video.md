# AI Audio and Video Understanding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI understands customer voice notes (transcribe, then answer at full pipeline strength with the transcript saved on the message) and videos (attached to the Gemini call like images), with every unprocessable case handing off to a human, and the inbox thread rendering audio/video players.

**Architecture:** Additive across four layers. (1) `VIDEO` becomes a first-class message type and the Evolution adapter captures video bytes (today they are dropped). (2) The LLM port gains a generic `media` content part that the Gemini adapter maps to `inlineData` exactly like images, plus a `transcribeAudio` helper. (3) The ai-reply worker enqueues for AUDIO/VIDEO, transcribes audio into the message body (visible in the thread, drives retrieval), attaches video via a generalized `finalMedia`, applies a 14MB cap, and routes failures through an early-handoff path identical in effect to the existing low-confidence handoff. (4) The thread renders `<audio>`/`<video>` players.

**Tech Stack:** Prisma (enum migration), Zod, Gemini via LLMPort, BullMQ worker, Vitest (API). Next.js thread component (web).

## Global Constraints

- **No change** to `MessagingPort`, policies, pacing, send behavior, grounding rules, the confidence threshold/PENDING flip, the double-send guard, quoting (`replyTargetForAi`), or AiReplyLog semantics. (Spec sections 5, 8.)
- **Never log transcripts or media bytes** (CLAUDE.md: no message bodies in logs); ids and metadata only. (Spec section 8.)
- **Size cap:** attach media to Gemini only when raw bytes <= 14MB (`14 * 1024 * 1024`); an over-cap trigger hands off. (Spec section 5.)
- **Failure = handoff:** missing bytes, over-cap media, empty/failed transcription flip the conversation to PENDING + HANDOFF notification + `conversation.updated` emit + an `AiReplyLog` row with `action: 'HANDED_OFF'`. Exception: if the org's AI is disabled the worker still returns silently (owner's choice), as today. (Spec sections 2, 5.)
- **Tenancy:** everything stays inside the worker's `runWithRequestContext` and tenant-scoped repositories. (Spec section 8.)
- **Both locales complete** for any new UI copy; `pnpm lint` enforces parity. No em dashes; strict TS, no `any`; conventional commits. (Spec section 8.)
- **Migration command** (repo gotcha): from `apps/api`, run `pnpm exec dotenv -e ../../.env -- prisma migrate dev --name <name>`; the `pnpm db:migrate -- --name` form mangles args. Never edit a committed migration.
- **API gate:** `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`. **Web gate:** `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`. Run `tsc` explicitly.

---

## File Structure

- Task 1: `apps/api/prisma/schema.prisma` (+migration), `packages/ports/src/messaging.ts`, `packages/shared/src/schemas/transport.ts`, `packages/shared/src/schemas/conversation.ts`, `apps/api/src/adapters/evolution/evolution-adapter.ts` (+test).
- Task 2: `packages/ports/src/llm.ts`, `apps/api/src/adapters/llm/gemini-adapter.ts`, `apps/api/src/services/ai-reply.ts` (+test).
- Task 3: `apps/api/src/services/inbound-service.ts` (+test), `apps/api/src/repositories/message-repository.ts`, `apps/api/src/services/ai-reply.ts` (history builder generalization, +tests), `apps/api/src/workers/ai-reply-worker.ts`.
- Task 4: `apps/web/src/components/conversation-thread.tsx`.

---

### Task 1: VIDEO message type and inbound video capture

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (MessageType enum) + new migration
- Modify: `packages/ports/src/messaging.ts:28` (IncomingMessageType)
- Modify: `packages/shared/src/schemas/transport.ts` (incomingMessageTypeSchema)
- Modify: `packages/shared/src/schemas/conversation.ts` (messageTypeSchema)
- Modify: `apps/api/src/adapters/evolution/evolution-adapter.ts` (videoMessage branch)
- Test: `apps/api/src/adapters/evolution/evolution-adapter.test.ts`

**Interfaces:**
- Produces: `'VIDEO'` as a valid value of the Prisma `MessageType` enum, `IncomingMessageType`, `incomingMessageTypeSchema`, and `messageTypeSchema`; inbound videos normalized as `{ type: 'VIDEO', text: caption?, media: { providerRef, mimeType } }` so the existing pipeline stores their bytes in MinIO.

- [ ] **Step 1: Write the failing adapter test**

In `apps/api/src/adapters/evolution/evolution-adapter.test.ts`, add (follow the existing normalize tests' envelope shape):
```ts
it('normalizes a video message with media ref and caption', () => {
  const result = evolutionAdapter.normalizeWebhookEvent({
    event: 'messages.upsert',
    instance: 'chan1',
    data: {
      key: { remoteJid: '255700000000@s.whatsapp.net', fromMe: false, id: 'WAVID1' },
      message: { videoMessage: { caption: 'do you sell this?', mimetype: 'video/mp4' } },
    },
  });
  expect(result?.event.kind).toBe('message');
  if (result?.event.kind === 'message') {
    expect(result.event.message.type).toBe('VIDEO');
    expect(result.event.message.text).toBe('do you sell this?');
    expect(result.event.message.media).toEqual({ providerRef: 'WAVID1', mimeType: 'video/mp4' });
  }
});

it('defaults a video message without mimetype to video/mp4', () => {
  const result = evolutionAdapter.normalizeWebhookEvent({
    event: 'messages.upsert',
    instance: 'chan1',
    data: {
      key: { remoteJid: '255700000000@s.whatsapp.net', fromMe: false, id: 'WAVID2' },
      message: { videoMessage: {} },
    },
  });
  if (result?.event.kind === 'message') {
    expect(result.event.message.type).toBe('VIDEO');
    expect(result.event.message.media?.mimeType).toBe('video/mp4');
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm -F @waos/api test -- evolution-adapter`
Expected: FAIL (type is `'OTHER'` and `media` is undefined for video messages; `'VIDEO'` is not yet a valid `IncomingMessageType`, so this may surface as a type error first — that is the same failure).

- [ ] **Step 3: Add VIDEO to the four type definitions**

1. `packages/ports/src/messaging.ts:28`:
```ts
export type IncomingMessageType = 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' | 'OTHER';
```
2. `packages/shared/src/schemas/transport.ts`, add `'VIDEO'` to the `incomingMessageTypeSchema` enum list (keep the same order: after `'AUDIO'`).
3. `packages/shared/src/schemas/conversation.ts`, add `'VIDEO'` to `messageTypeSchema` (after `'AUDIO'`).
4. `apps/api/prisma/schema.prisma`, in `enum MessageType` add `VIDEO` on its own line after `AUDIO`.

- [ ] **Step 4: Create the migration**

From `apps/api`: `pnpm exec dotenv -e ../../.env -- prisma migrate dev --name message_type_video`
Expected: a new migration with `ALTER TYPE "MessageType" ADD VALUE 'VIDEO';` (Prisma may emit it in its own transaction file); `prisma generate` refreshes the client. Do not edit committed migrations.

- [ ] **Step 5: Capture the media ref in the adapter**

In `apps/api/src/adapters/evolution/evolution-adapter.ts`, replace the `videoMessage` branch:
```ts
        } else if (content.videoMessage) {
          type = 'VIDEO';
          text = content.videoMessage.caption;
          media = {
            providerRef: msg.key.id,
            mimeType: content.videoMessage.mimetype ?? 'video/mp4',
          };
        }
```
(The `videoMessage` Zod schema already carries `caption`, `mimetype`, and `contextInfo`; no schema change needed. The inbound pipeline's existing `downloadMedia` call is keyed on `incoming.media` being set, so video bytes now land in MinIO with no further change.)

- [ ] **Step 6: Run to verify the tests pass, then the API gate**

Run: `pnpm -F @waos/api test -- evolution-adapter`
Expected: PASS (2 new tests; existing video-quote test still green).
Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src/adapters/evolution packages/ports/src/messaging.ts packages/shared/src/schemas/transport.ts packages/shared/src/schemas/conversation.ts
git commit -m "feat(api): capture inbound videos as a first-class VIDEO message type"
```

---

### Task 2: LLM media part and the transcription helper

**Files:**
- Modify: `packages/ports/src/llm.ts` (LlmContentPart)
- Modify: `apps/api/src/adapters/llm/gemini-adapter.ts` (toParts)
- Modify: `apps/api/src/services/ai-reply.ts` (transcribeAudio)
- Test: `apps/api/src/services/ai-reply.test.ts`

**Interfaces:**
- Consumes: `LLMPort.complete(params: { system, messages, tools?, maxTokens?, temperature? }): Promise<{ text: string; toolCalls?: ... }>` (existing).
- Produces: `LlmContentPart` variant `{ type: 'media'; mimeType: string; data: string }`; `transcribeAudio(llm: LLMPort, audio: { mimeType: string; data: string }): Promise<string | null>` exported from `ai-reply.ts` (null = unusable transcript, caller hands off). Consumed by Task 3.

- [ ] **Step 1: Add the port variant**

In `packages/ports/src/llm.ts`, extend `LlmContentPart`:
```ts
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
  /** Generic inline media (audio/video); providers ingest it like an image part. */
  | { type: 'media'; mimeType: string; data: string }
  | { type: 'tool_result'; name: string; response: unknown }
  /** Echoes a prior model tool call back into history (assistant message part). */
  | { type: 'tool_call'; name: string; args: Record<string, unknown> };
```

- [ ] **Step 2: Map it in the Gemini adapter**

In `apps/api/src/adapters/llm/gemini-adapter.ts`'s `toParts`, extend the `case 'image':` to also cover media (Gemini's `inlineData` is the same mechanism):
```ts
      case 'image':
      case 'media':
        return { inlineData: { mimeType: part.mimeType, data: part.data } };
```

- [ ] **Step 3: Write the failing transcribeAudio tests**

In `apps/api/src/services/ai-reply.test.ts`, add (LLMPort is already mockable in this file's style; build a minimal fake):
```ts
import { transcribeAudio } from './ai-reply.js';

function fakeLlm(response: { text: string } | Error) {
  return {
    complete: vi.fn(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve({ text: response.text }),
    ),
  };
}

describe('transcribeAudio', () => {
  const audio = { mimeType: 'audio/ogg', data: 'BASE64BYTES' };

  it('returns the trimmed transcript and passes the audio as a media part with no tools', async () => {
    const llm = fakeLlm({ text: '  Bei ya rasta ni ngapi?  ' });
    const result = await transcribeAudio(llm, audio);
    expect(result).toBe('Bei ya rasta ni ngapi?');
    const params = llm.complete.mock.calls[0]?.[0] as {
      system: string;
      messages: { role: string; content: unknown }[];
      tools?: unknown;
    };
    expect(params.tools).toBeUndefined();
    expect(params.messages[0]?.content).toEqual([
      { type: 'media', mimeType: 'audio/ogg', data: 'BASE64BYTES' },
      { type: 'text', text: expect.stringContaining('Transcribe') as unknown as string },
    ]);
  });

  it('returns null for the EMPTY sentinel', async () => {
    expect(await transcribeAudio(fakeLlm({ text: 'EMPTY' }), audio)).toBeNull();
  });

  it('returns null for a blank transcript', async () => {
    expect(await transcribeAudio(fakeLlm({ text: '   ' }), audio)).toBeNull();
  });

  it('returns null when the model call throws', async () => {
    expect(await transcribeAudio(fakeLlm(new Error('down')), audio)).toBeNull();
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm -F @waos/api test -- ai-reply`
Expected: FAIL (`transcribeAudio` is not exported).

- [ ] **Step 5: Implement transcribeAudio**

In `apps/api/src/services/ai-reply.ts` (near the other helpers; `LLMPort` and `logger` import patterns already exist in this file's module graph — import `LLMPort` from `@waos/ports` and `logger` from `../lib/logger.js` if not present):
```ts
const TRANSCRIBE_SYSTEM = [
  'You transcribe WhatsApp voice notes for a business inbox.',
  'Return ONLY the verbatim transcript, in the language actually spoken (Swahili or English). No translation, no commentary, no quotes.',
  'If the audio is silent, unintelligible, or contains no speech, return exactly: EMPTY',
].join('\n');

/**
 * One-shot voice note transcription (spec: transcribe-then-answer). Returns
 * the transcript, or null when the audio is unusable so the caller can hand
 * off. Never logs the transcript or the bytes (ids/metadata only upstream).
 */
export async function transcribeAudio(
  llm: LLMPort,
  audio: { mimeType: string; data: string },
): Promise<string | null> {
  try {
    const completion = await llm.complete({
      system: TRANSCRIBE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'media', mimeType: audio.mimeType, data: audio.data },
            { type: 'text', text: 'Transcribe this voice note.' },
          ],
        },
      ],
    });
    const text = completion.text.trim();
    if (text.length === 0 || text === 'EMPTY') {
      return null;
    }
    return text;
  } catch (error) {
    logger.warn({ err: error }, 'voice note transcription failed');
    return null;
  }
}
```

- [ ] **Step 6: Run to verify pass, then the API gate; commit**

Run: `pnpm -F @waos/api test -- ai-reply` (PASS, 4 new tests), then the full API gate.
```bash
git add packages/ports/src/llm.ts apps/api/src/adapters/llm/gemini-adapter.ts apps/api/src/services/ai-reply.ts apps/api/src/services/ai-reply.test.ts
git commit -m "feat(api): generic LLM media part and voice note transcription helper"
```

---

### Task 3: Worker wiring (enqueue, transcribe-then-answer, video attach, cap, handoffs)

**Files:**
- Modify: `apps/api/src/services/inbound-service.ts:130` (enqueue types); Test: `apps/api/src/services/inbound-service.test.ts`
- Modify: `apps/api/src/repositories/message-repository.ts` (setBody)
- Modify: `apps/api/src/services/ai-reply.ts` (finalMedia generalization + cap constant); Test: `apps/api/src/services/ai-reply.test.ts`
- Modify: `apps/api/src/workers/ai-reply-worker.ts`

**Interfaces:**
- Consumes: `transcribeAudio` and the `media` part (Task 2); `VIDEO` type (Task 1); existing `getMediaObject(key): Promise<{ data: Buffer; mimeType: string }>`, `emitToOrg`, `notificationService.notify('HANDOFF', ...)`, `aiReplyLogRepository.create`, `conversationRepository.updateStatus`.
- Produces: `MAX_AI_MEDIA_BYTES` (const, `14 * 1024 * 1024`) and `isOversizeMedia(byteLength: number): boolean` exported from `ai-reply.ts`; `buildConversationMessages(history, finalMedia?: FinalMedia)` where `FinalMedia = { messageId: string; mimeType: string; data: string; kind: 'image' | 'video' }`; `messageRepository.setBody(id: string, body: string): Promise<Message>`.

- [ ] **Step 1: Enqueue AUDIO and VIDEO (failing test first)**

In `apps/api/src/services/inbound-service.test.ts`, add a case in the existing mocked style: an incoming message with `type: 'AUDIO'` (and a media download mock consistent with the file's existing setup) results in `enqueueAiReply` being called; same for `type: 'VIDEO'`. Then in `apps/api/src/services/inbound-service.ts:130` change the condition to:
```ts
  if (
    conversation.aiEnabled &&
    (incoming.type === 'TEXT' ||
      incoming.type === 'IMAGE' ||
      incoming.type === 'AUDIO' ||
      incoming.type === 'VIDEO')
  ) {
```
Run `pnpm -F @waos/api test -- inbound-service`: the new cases fail before the change and pass after.

- [ ] **Step 2: Add messageRepository.setBody**

In `apps/api/src/repositories/message-repository.ts` (after `findById`):
```ts
  /** Persists a derived body (e.g. a voice note transcript) onto a message. */
  setBody(id: string, body: string): Promise<Message> {
    return prisma.message.update({ where: { id }, data: { body } });
  },
```

- [ ] **Step 3: Generalize the history builder (failing tests first)**

In `apps/api/src/services/ai-reply.test.ts`: update the four existing `buildConversationMessages(history, { ... })` call sites to add `kind: 'image' as const` to the second argument (their assertions are otherwise unchanged: image triggers still produce an `image` part). Add two new tests:
```ts
it('attaches a video trigger as a media part with the video fallback question', () => {
  const history = [message({ id: 'm1', direction: 'IN', body: null, type: 'VIDEO' })];
  const transcript = buildConversationMessages(history, {
    messageId: 'm1',
    mimeType: 'video/mp4',
    data: 'VID64',
    kind: 'video',
  });
  expect(transcript[0]?.content).toEqual([
    { type: 'media', mimeType: 'video/mp4', data: 'VID64' },
    { type: 'text', text: expect.stringContaining('video') as unknown as string },
  ]);
});

it('flags media over the 14MB cap and accepts media at the cap', () => {
  expect(isOversizeMedia(MAX_AI_MEDIA_BYTES + 1)).toBe(true);
  expect(isOversizeMedia(MAX_AI_MEDIA_BYTES)).toBe(false);
});
```
(Reuse the file's existing `message(...)` fixture helper; if its type union needs `'VIDEO'`, Task 1 already added it to the shared schema.)

Then in `apps/api/src/services/ai-reply.ts`:
```ts
export const MAX_AI_MEDIA_BYTES = 14 * 1024 * 1024;

/** Gemini inline requests cap at 20MB; 14MB of raw bytes stays safely under it after base64 inflation. */
export function isOversizeMedia(byteLength: number): boolean {
  return byteLength > MAX_AI_MEDIA_BYTES;
}

const NO_CAPTION_VIDEO =
  'The customer sent this video with no text. Watch it and respond; if it shows a product, check whether we sell it.';

export interface FinalMedia {
  messageId: string;
  mimeType: string;
  data: string;
  kind: 'image' | 'video';
}
```
Change `buildConversationMessages(history: Message[], finalMedia?: FinalMedia)` (rename the parameter from `finalImage`; update the internal references). In the attach branch:
```ts
      if (message === targetMessage && finalMedia !== undefined) {
        const caption = (message.body ?? '').trim();
        const fallback = finalMedia.kind === 'video' ? NO_CAPTION_VIDEO : NO_CAPTION_QUESTION;
        return {
          role: 'user' as const,
          content: [
            finalMedia.kind === 'video'
              ? { type: 'media' as const, mimeType: finalMedia.mimeType, data: finalMedia.data }
              : { type: 'image' as const, mimeType: finalMedia.mimeType, data: finalMedia.data },
            { type: 'text' as const, text: caption.length > 0 ? caption : fallback },
          ],
        };
      }
```
Run `pnpm -F @waos/api test -- ai-reply`: all pass.

- [ ] **Step 4: Wire the worker**

In `apps/api/src/workers/ai-reply-worker.ts`, apply these changes inside `processAiReplyJob` (imports: add `isOversizeMedia`, `transcribeAudio`, and the `FinalMedia` type to the existing `../services/ai-reply.js` import; `messageRepository` and `emitToOrg` are already imported):

(a) Replace the trigger detection and bail block (currently the `question`/`isImageTrigger` lines) with:
```ts
      let question = lastInbound?.body ?? '';
      // Media turns trigger the agent even without text: images/videos go to
      // the model directly, voice notes are transcribed first.
      const isImageTrigger = lastInbound?.type === 'IMAGE' && Boolean(lastInbound.mediaKey);
      const isVideoTrigger = lastInbound?.type === 'VIDEO' && Boolean(lastInbound.mediaKey);
      const isAudioTrigger = lastInbound?.type === 'AUDIO' && Boolean(lastInbound.mediaKey);
      // An audio/video message whose media never downloaded has nothing the
      // AI can work with: hand it to a human instead of staying silent.
      const mediaLost =
        (lastInbound?.type === 'AUDIO' || lastInbound?.type === 'VIDEO') &&
        !lastInbound.mediaKey &&
        question.trim().length === 0;
      if (!mediaLost && question.trim().length === 0 && !isImageTrigger && !isVideoTrigger && !isAudioTrigger) {
        return;
      }
```
(b) Keep the organization/settings load exactly where it is (an AI turned off globally still returns silently). AFTER the `threshold` line, add the early-handoff helper and the media steps:
```ts
      const handOffUnprocessable = async (): Promise<void> => {
        await conversationRepository.updateStatus(conversation.id, 'PENDING');
        try {
          await notificationService.notify('HANDOFF', buildHandoffNotifyPayload(conversation));
        } catch (error) {
          logger.warn(
            { err: error, conversationId: conversation.id },
            'handoff notification failed',
          );
        }
        emitToOrg(payload.organizationId, 'conversation.updated', {
          conversationId: conversation.id,
        });
        await aiReplyLogRepository.create({
          conversationId: conversation.id,
          retrievedChunkIds: [],
          confidence: 0,
          action: 'HANDED_OFF',
          latencyMs: Date.now() - startedAt,
          toolsUsed: [],
        });
        logger.info(
          { conversationId: conversation.id, action: 'HANDOFF', latencyMs: Date.now() - startedAt, chunks: 0 },
          'ai reply decision',
        );
      };

      if (mediaLost) {
        await handOffUnprocessable();
        return;
      }

      // Voice note: transcribe first, persist the transcript so the owner
      // reads it in the thread and future turns carry it, then continue the
      // normal pipeline with the transcript as the question.
      if (isAudioTrigger && lastInbound?.mediaKey) {
        const media = await getMediaObject(lastInbound.mediaKey);
        if (isOversizeMedia(media.data.length)) {
          await handOffUnprocessable();
          return;
        }
        const transcript = await transcribeAudio(ports.llm, {
          mimeType: media.mimeType,
          data: media.data.toString('base64'),
        });
        if (transcript === null) {
          await handOffUnprocessable();
          return;
        }
        await messageRepository.setBody(lastInbound.id, transcript);
        lastInbound.body = transcript; // the history array holds this same row
        question = transcript;
        emitToOrg(payload.organizationId, 'message.updated', {
          messageId: lastInbound.id,
          conversationId: conversation.id,
          status: lastInbound.status,
        });
      }
```
(c) Replace the `finalImage` block with the generalized `finalMedia` (video over the cap hands off; the same guard now covers images, which in practice never exceed it):
```ts
      let finalMedia: FinalMedia | undefined;
      if ((isImageTrigger || isVideoTrigger) && lastInbound?.mediaKey) {
        const media = await getMediaObject(lastInbound.mediaKey);
        if (isOversizeMedia(media.data.length)) {
          await handOffUnprocessable();
          return;
        }
        finalMedia = {
          messageId: lastInbound.id,
          mimeType: media.mimeType,
          data: media.data.toString('base64'),
          kind: isVideoTrigger ? 'video' : 'image',
        };
      }
      const messages = buildConversationMessages(inbound, finalMedia);
```
(d) Nothing else changes: the embedding line already reads `question` (now possibly the transcript), and the tool loop, guard, quoting, send, and the post-LLM handoff branch are untouched.

- [ ] **Step 5: Run the full API gate**

Run: `pnpm -F @waos/api typecheck && pnpm -F @waos/api test && pnpm lint`
Expected: all clean (typecheck confirms the worker rewiring; the suite covers the helpers; the worker's orchestration is exercised by typecheck + the existing guard tests, with the live drive as the end-to-end proof).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/inbound-service.ts apps/api/src/services/inbound-service.test.ts apps/api/src/repositories/message-repository.ts apps/api/src/services/ai-reply.ts apps/api/src/services/ai-reply.test.ts apps/api/src/workers/ai-reply-worker.ts
git commit -m "feat(api): AI answers voice notes via transcription and watches videos"
```

---

### Task 4: Thread audio/video players

**Files:**
- Modify: `apps/web/src/components/conversation-thread.tsx` (the media render block, ~lines 364-380)

**Interfaces:**
- Consumes: `MessageDto.type` now includes `'VIDEO'` (Task 1's shared schema change); `mediaUrl` presigned as today.

- [ ] **Step 1: Render players**

In the bubble's media block, replace the current two-way branch (`IMAGE` img, else link) with a four-way branch:
```tsx
                    {message.mediaUrl ? (
                      message.type === 'IMAGE' ? (
                        <img
                          src={message.mediaUrl}
                          alt={t('mediaAlt')}
                          className="mb-1 max-h-64 rounded-lg"
                        />
                      ) : message.type === 'AUDIO' ? (
                        <audio controls preload="metadata" src={message.mediaUrl} className="mb-1 w-56 max-w-full" />
                      ) : message.type === 'VIDEO' ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption -- customer-sent WhatsApp video, no caption track exists
                        <video controls preload="metadata" src={message.mediaUrl} className="mb-1 max-h-64 rounded-lg" />
                      ) : (
                        <a
                          href={message.mediaUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mb-1 text-sm font-medium text-brand-700 underline"
                        >
                          {t('downloadMedia')}
                        </a>
                      )
                    ) : null}
```
(If `pnpm lint` reports the a11y disable directive as unused, drop the comment; if it flags `<audio>` the same way, apply the same treatment there. The transcript renders below automatically: the existing `{message.body ? <p>...}` block shows it once the worker saves it, live via the socket refresh.)

No new i18n keys are needed (the players carry native controls; `mediaAlt`/`downloadMedia` already exist in both locales).

- [ ] **Step 2: Run the web gate**

Run: `pnpm -F @waos/web typecheck && pnpm lint && pnpm -F @waos/web build`
Expected: all clean. Live-drive note (Edward, post-merge): send a voice note and a short video to the connected number; the thread should show players, the transcript should appear under the voice note within a few seconds, and the AI should reply to both.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/conversation-thread.tsx
git commit -m "feat(web): audio and video players in the conversation thread"
```

---

## Self-Review

**1. Spec coverage:** Section 3 (VIDEO enum + capture): Task 1. Section 4 (media part): Task 2. Section 5 (enqueue AUDIO/VIDEO; transcribe -> persist body -> emit -> continue-as-text; finalMedia video attach; 14MB cap; handoff on mediaLost/oversize/failed-transcript; org-AI-off still silent): Task 3, with the early-handoff helper mirroring the existing PENDING+notify+emit+log branch. Section 6 (players; transcript-as-caption falls out of the existing body render; DOCUMENT/OTHER keep the link; no new copy needed so parity is untouched): Task 4. Section 8 (no transcript/bytes in logs: `transcribeAudio` logs only the error object; setBody/emit carry ids): honored. Section 10 regression criterion: existing image/text behavior preserved (image keeps the `image` part type and `NO_CAPTION_QUESTION`; the four updated fixtures assert unchanged output).

**2. Placeholder scan:** none. All code complete; the one judgment left to the implementer (whether the a11y eslint directive is needed) has both outcomes specified, matching the Task-1-of-shop-tables precedent.

**3. Type consistency:** `FinalMedia { messageId, mimeType, data, kind }` (Task 3 Step 3) matches the worker's construction (Step 4c) and the video test. `transcribeAudio(llm, { mimeType, data }): Promise<string | null>` (Task 2) matches the worker call (Task 3 Step 4b). `isOversizeMedia(byteLength)` + `MAX_AI_MEDIA_BYTES` defined and tested in Task 3 Step 3, used in Step 4b/4c. `messageRepository.setBody(id, body)` defined Step 2, used Step 4b. The `media` part (Task 2 Step 1) is produced by `transcribeAudio` and the video branch of the history builder and consumed by the Gemini adapter's `case 'media'`. `'VIDEO'` flows ports -> shared -> Prisma -> adapter -> worker -> thread. Consistent.
