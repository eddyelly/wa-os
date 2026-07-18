# WaOS AI Audio and Video Understanding

Date: 2026-07-19
Status: Approved by Edward (direction and section-level design, 2026-07-19).
One implementation plan follows before code.

## 1. Summary

The AI currently understands customer text and images; voice notes and videos
are stored but never answered (the AI is silent on them). This feature makes
the AI listen and watch:

- A **voice note** is transcribed by Gemini (Swahili or English), the
  transcript is saved onto the message (visible to the owner in the inbox
  thread), and the reply pipeline then runs exactly as if the customer had
  typed it: knowledge retrieval, the shop tool loop, bargaining, confidence
  threshold, and handoff all at full strength.
- A **video** is attached to the reply call the way images are today (Gemini
  ingests it natively), so "do you have this?" works from a video via the
  product tools. Videos are size-capped; over the cap the conversation hands
  off.
- Anything unprocessable (failed download, oversize video, unintelligible
  audio) **hands off to a human**: the conversation flips to PENDING and lands
  in the inbox, consistent with the existing low-confidence doctrine.
- The **inbox thread renders players**: an audio player for voice notes (with
  the transcript below it once produced) and a video player for videos. Both
  are a bare link today.

Discovered gap this feature also fixes: inbound videos currently map to
message type `OTHER` and their bytes are never downloaded; only the caption
survives. Videos become a first-class `VIDEO` message type with media stored
in MinIO like images and audio.

## 2. Decisions made (with Edward, 2026-07-19)

| Decision | Choice |
| --- | --- |
| Voice notes | Transcribe-then-answer. One extra Gemini call (~1s); the transcript persists on the message so the owner reads it in the thread, retrieval works (it searches by text), and conversation history carries what was said. |
| Failure path | Hand off to human (PENDING + inbox), never a dismissive "please type it" reply. The thread's new players let the owner listen/watch the original themselves. |
| Video handling | Attach bytes to the reply call like images (no transcription pass); caption text drives retrieval when present; product tools cover the "is this in stock?" case. |
| Scope | Customer AUDIO and VIDEO understanding only. Documents (PDF) belong to the knowledge feature; the AI sending audio/video is out of scope. |

## 3. Data model and inbound capture

- **`MessageType` gains `VIDEO`** (Prisma enum migration + the shared
  `messageTypeSchema`). Additive; no existing rows change.
- **Evolution adapter, `videoMessage` branch**: set `type: 'VIDEO'`, keep the
  caption as `text`, and set the media ref (`providerRef: msg.key.id`,
  `mimeType: content.videoMessage.mimetype ?? 'video/mp4'`). The existing
  inbound pipeline then downloads the bytes to MinIO via the already-generic
  `getBase64FromMediaMessage` (keep `convertToMp4: false`), exactly like
  audio and images today. Media-download failure already stores the message
  without media; that path is unchanged.
- Audio capture is already correct (type `AUDIO`, `audio/ogg` default) and
  needs no change.

## 4. LLM port (additive)

`LlmContentPart` gains one variant:

```ts
| { type: 'media'; mimeType: string; data: string }
```

The Gemini adapter maps it to `inlineData` exactly as it maps `image` (the
mechanism is identical; Gemini accepts audio and video mime types through the
same part). No other port change; existing callers unaffected.

## 5. AI pipeline

**Trigger:** the inbound service enqueues `ai-reply` for `TEXT | IMAGE |
AUDIO | VIDEO` (today: TEXT | IMAGE).

**Audio (transcribe-then-answer):** in the ai-reply worker, when the
triggering message is `AUDIO` with a `mediaKey`:

1. Load the bytes from MinIO; run one `llm.complete` transcription call (the
   audio as a `media` part plus a strict instruction: transcribe verbatim in
   the speaker's language, Swahili or English; return only the transcript
   text; no tools, no JSON).
2. Persist the transcript to the message `body` (repository update) and emit
   `message.updated` so the open thread shows it live.
3. Continue the existing pipeline with the transcript as the message text:
   embedding + retrieval, the tool loop, confidence branching. The history
   builder needs no special casing because the body now carries the text.
4. Empty transcript, transcription error, or missing media: hand off
   (PENDING + notify), and log the AiReplyLog row as `HANDED_OFF` as the
   pipeline already does for low confidence.

**Video (attach like an image):** generalize the worker's `finalImage`
mechanism to `finalMedia` (message id, mimeType, data, kind). For a `VIDEO`
trigger with media at or under the size cap, attach the bytes as a `media`
part on the final user turn; the no-caption fallback text is type-aware (for
video: the customer sent this video, look at it and respond, checking the
catalog if it shows a product; the existing image question stays as is).
Caption text drives retrieval exactly as image captions do today.

**Size cap:** attach media to Gemini only when the raw bytes are at or under
14MB (base64 inflation keeps the request safely under Gemini's 20MB inline
limit). An over-cap video, or missing bytes, hands off. Voice notes are far
below any cap in practice; the same guard applies for safety.

**Unchanged:** grounding rules, the confidence threshold and PENDING flip,
the guard against duplicate sends, quoting (`replyTargetForAi`), policy and
pacing, AiReplyLog semantics.

## 6. Thread UI

- `AUDIO` messages render `<audio controls>` with the presigned `mediaUrl`;
  the body (transcript, once saved) renders below it like a caption. The
  transcript appears live via the existing socket-driven refresh.
- `VIDEO` messages render `<video controls>` (constrained width, like
  images).
- `DOCUMENT`/`OTHER` keep the existing link fallback.
- Any new copy ships in `en` and `sw` (`pnpm lint` enforces parity).

## 7. Cost and latency notes (accepted)

- Audio: ~32 Gemini tokens/second; a 30s voice note ≈ 1k tokens plus one
  extra round trip (~1s added latency before the normal pipeline).
- Video: ~300 tokens/second; a 1-minute clip ≈ 18k tokens per reply. Fine on
  Flash at current scale; the size cap bounds the worst case.

## 8. Boundaries and constraints

- Gemini only (LLMPort); the additive `media` part is provider-neutral.
- No change to `MessagingPort`, policies, pacing, or send behavior.
- Multi-tenant: all reads/writes stay inside the existing tenant-scoped
  repositories and worker request context.
- Never log transcripts or media bytes (CLAUDE.md: no message bodies in
  logs); log ids and metadata only.
- Vitest for services/adapters with logic: the adapter video branch, the
  transcription step (happy path, empty transcript, error -> handoff), the
  size-cap guard, and the media-part history builder. Web gate: typecheck +
  lint + build + live drive.

## 9. Sequencing (decomposition)

One implementation plan, subagent-driven, roughly four tasks:

1. **VIDEO type + capture**: Prisma enum migration, shared schema, adapter
   `videoMessage` branch (type + media ref) with tests.
2. **Port + transcription step**: the `media` content part (port + Gemini
   adapter mapping), a `transcribeAudio` helper in the AI service with tests
   (mocked LLM: happy path, empty, error).
3. **Worker wiring**: enqueue for AUDIO/VIDEO; audio transcribe -> persist
   body -> emit -> continue-as-text; video `finalMedia` attach with the
   14MB cap; handoff paths; tests.
4. **Thread players + copy**: audio/video elements, transcript-as-caption,
   en+sw keys, web gate + live drive.

## 10. Success criteria

- A Swahili or English voice note gets a correct AI reply grounded in the
  knowledge base or catalog; the transcript is visible in the inbox thread.
- A short product video gets an AI reply that can reference the catalog.
- Oversize/unprocessable media flips the conversation to PENDING and the
  owner can play the audio/video in the thread.
- Existing text and image behavior is unchanged (regression: API suite
  green).
- en/sw parity holds; API and web gates green.
