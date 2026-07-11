# Revamp Phase A: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all AI to Gemini behind the existing ports, introduce the organization `modules` concept with API gating and module-aware onboarding, and add CI.

**Architecture:** The Anthropic adapter is replaced by a `GeminiLlmAdapter` (chat, vision-capable parts, function calling) and a `GeminiEmbeddingAdapter`, both behind the extended `LLMPort`/`EmbeddingPort` in `packages/ports`. `Organization` gains a `modules String[]` column; a `requireModule` middleware gates module routes with a typed `MODULE_DISABLED` error; the web app reads modules from the stored auth session to filter navigation, the settings page toggles them, and onboarding's profile step selects them. A GitHub Actions workflow finally enforces typecheck, lint, unit tests, integration tests, and the web build.

**Tech Stack:** Express 5, TypeScript strict, Prisma + Postgres 16 (pgvector), BullMQ, Zod, Next.js 15 App Router, next-intl, `@google/genai` SDK, Vitest, GitHub Actions.

**Master design:** `docs/superpowers/specs/2026-07-11-waos-revamp-master-design.md`. Phase A deliberately EXCLUDES the shop data model, selling agent tools, and the shop onboarding sub-step (products quick-add): those are Phase B. Onboarding in Phase A adds the module picker only.

## Global Constraints

- TypeScript `strict: true`; the `any` type is forbidden (use `unknown` + narrowing).
- No em dashes anywhere: code, comments, docs, or UI copy.
- Every user-facing string exists in BOTH `apps/web/messages/en.json` and `sw.json`.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:` with scope).
- No floating promises (ESLint `no-floating-promises` is an error).
- Layering: controllers/routes/middleware/sockets/workers never import `@prisma/client` or `lib/prisma.js` (ESLint enforces).
- Provider SDKs (`@google/genai`) never imported outside `apps/api/src/adapters/`.
- Never log message bodies, tokens, QR payloads, or API keys.
- All checks run from the repo root: `pnpm typecheck && pnpm lint && pnpm test` must pass at every commit.
- On this dev machine Postgres is on host port 5433 and Redis on 6380 (see `infra/.env`); `.env` already points there.

---

### Task 0: Repo hygiene (working tree cleanup)

**Files:**
- Revert: `apps/web/messages/sw.json` (two stray blank lines before `{`)
- Commit: `infra/docker-compose.yml` (already-modified host-port parametrization)

**Interfaces:**
- Consumes: nothing
- Produces: a clean working tree so every later commit contains only its own change

- [ ] **Step 1: Revert the accidental sw.json edit**

```bash
git checkout -- apps/web/messages/sw.json
git diff --stat   # expect: only infra/docker-compose.yml remains modified
```

- [ ] **Step 2: Commit the compose port parametrization**

```bash
git add infra/docker-compose.yml
git commit -m "chore(infra): make postgres and redis host ports overridable for local dev"
```

- [ ] **Step 3: Verify clean tree**

Run: `git status --short`
Expected: empty output.

---

### Task 1: Extend LLMPort and EmbeddingPort in packages/ports

**Files:**
- Modify: `packages/ports/src/llm.ts` (full rewrite below)
- Modify: `packages/ports/src/embedding.ts` (add intent parameter)

**Interfaces:**
- Consumes: nothing (leaf package)
- Produces (later tasks depend on these EXACT names):
  - `LlmContentPart` = `{ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string } | { type: 'tool_result'; name: string; response: unknown }`
  - `LlmMessage.content: string | LlmContentPart[]`
  - `LlmToolDefinition { name: string; description: string; parameters: Record<string, unknown> }`
  - `LlmToolCall { name: string; args: Record<string, unknown> }`
  - `LlmCompletionParams` gains `tools?: LlmToolDefinition[]`
  - `LlmCompletion` gains `toolCalls?: LlmToolCall[]`
  - `EmbeddingIntent = 'document' | 'query'`; `EmbeddingPort.embed(texts: string[], intent?: EmbeddingIntent)`

- [ ] **Step 1: Rewrite `packages/ports/src/llm.ts`**

```ts
/**
 * LLMPort: the core never imports an LLM SDK directly.
 * The default adapter uses the Gemini SDK with the model id from env.
 */

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'tool_result'; name: string; response: unknown };

export interface LlmMessage {
  role: 'user' | 'assistant';
  /** Plain text, or multimodal/tool parts. A string means one text part. */
  content: string | LlmContentPart[];
}

/** Tool exposed to the model. `parameters` is a JSON Schema object. */
export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LlmCompletionParams {
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCompletion {
  text: string;
  toolCalls?: LlmToolCall[];
}

export interface LLMPort {
  complete(params: LlmCompletionParams): Promise<LlmCompletion>;
}
```

- [ ] **Step 2: Extend `packages/ports/src/embedding.ts`**

Replace the interface with:

```ts
/** Retrieval role of the texts being embedded; providers may optimize. */
export type EmbeddingIntent = 'document' | 'query';

export interface EmbeddingPort {
  /**
   * Embed each text; result is index-aligned with the input.
   * `intent` defaults to 'document'.
   */
  embed(texts: string[], intent?: EmbeddingIntent): Promise<number[][]>;
}
```

Check `packages/ports/src/index.ts` re-exports these types; add `EmbeddingIntent`, `LlmContentPart`, `LlmToolDefinition`, `LlmToolCall` to the type exports if the barrel lists names explicitly.

- [ ] **Step 3: Typecheck the whole workspace (this is the test for a types-only change)**

Run: `pnpm typecheck`
Expected: PASS. `content: string` remains assignable, and the existing `HttpEmbeddingAdapter.embed(texts)` still satisfies the port (the new parameter is optional).

- [ ] **Step 4: Commit**

```bash
git add packages/ports
git commit -m "feat(ports): add multimodal parts, tool calling, and embedding intent to AI ports"
```

---

### Task 2: Gemini LLM adapter replaces Anthropic (config + adapter + wiring, one atomic task)

**Files:**
- Modify: `apps/api/src/lib/config.ts` (swap `ANTHROPIC_API_KEY` for `GEMINI_API_KEY`)
- Modify: `apps/api/src/lib/config.test.ts` (same swap in fixtures/assertions)
- Modify: `apps/api/src/test/setup.ts` (swap default env var)
- Create: `apps/api/src/adapters/llm/gemini-adapter.ts`
- Create: `apps/api/src/adapters/llm/gemini-adapter.test.ts`
- Delete: `apps/api/src/adapters/llm/anthropic-adapter.ts`
- Modify: `apps/api/src/workers/ai-reply-worker.ts:5` (import from `gemini-adapter.js`)
- Modify: `apps/api/src/services/ai-test-service.ts` (import from `gemini-adapter.js`)
- Modify: `apps/api/package.json` (add `@google/genai`, remove `@anthropic-ai/sdk`)
- Modify: `.env.example` (Gemini vars; also add missing `WEB_ORIGIN`, `API_PUBLIC_URL`)

**Interfaces:**
- Consumes: `LLMPort`, `LlmCompletionParams`, `LlmCompletion`, `LlmMessage`, `LlmContentPart` from Task 1; `config.GEMINI_API_KEY`, `config.LLM_MODEL_ID`
- Produces: `export const llmPort: LLMPort` from `apps/api/src/adapters/llm/gemini-adapter.js` (same export name the worker already imports); `GeminiLlmAdapter` class

- [ ] **Step 1: Swap the dependency**

```bash
pnpm -F @waos/api remove @anthropic-ai/sdk
pnpm -F @waos/api add @google/genai
```

- [ ] **Step 2: Update config schema**

In `apps/api/src/lib/config.ts` replace the line `ANTHROPIC_API_KEY: z.string().min(1),` with:

```ts
  GEMINI_API_KEY: z.string().min(1),
```

(`LLM_MODEL_ID` stays.) In `apps/api/src/test/setup.ts` replace `ANTHROPIC_API_KEY: 'test-anthropic-key',` with `GEMINI_API_KEY: 'test-gemini-key',` and set `LLM_MODEL_ID: 'gemini-test-model',`. In `apps/api/src/lib/config.test.ts` update every `ANTHROPIC_API_KEY` reference to `GEMINI_API_KEY` (fixtures and the missing-var assertion if present).

- [ ] **Step 3: Write the failing adapter test**

Create `apps/api/src/adapters/llm/gemini-adapter.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { GeminiLlmAdapter } from './gemini-adapter.js';

describe('GeminiLlmAdapter', () => {
  beforeEach(() => {
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: 'hello', functionCalls: undefined });
  });

  it('maps roles and string content to Gemini contents', async () => {
    const adapter = new GeminiLlmAdapter();
    await adapter.complete({
      system: 'sys',
      messages: [
        { role: 'user', content: 'habari' },
        { role: 'assistant', content: 'karibu' },
      ],
    });
    const call = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
      config: { systemInstruction: string };
    };
    expect(call.contents).toEqual([
      { role: 'user', parts: [{ text: 'habari' }] },
      { role: 'model', parts: [{ text: 'karibu' }] },
    ]);
    expect(call.config.systemInstruction).toBe('sys');
  });

  it('maps image and tool_result parts', async () => {
    const adapter = new GeminiLlmAdapter();
    await adapter.complete({
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this?' },
            { type: 'image', mimeType: 'image/jpeg', data: 'aGVsbG8=' },
            { type: 'tool_result', name: 'searchProducts', response: { hits: 1 } },
          ],
        },
      ],
    });
    const call = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ parts: unknown[] }>;
    };
    expect(call.contents[0]?.parts).toEqual([
      { text: 'what is this?' },
      { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } },
      { functionResponse: { name: 'searchProducts', response: { output: { hits: 1 } } } },
    ]);
  });

  it('passes tool definitions and returns tool calls', async () => {
    generateContent.mockResolvedValue({
      text: '',
      functionCalls: [{ name: 'negotiate', args: { productId: 'p1', proposedPrice: 900 } }],
    });
    const adapter = new GeminiLlmAdapter();
    const result = await adapter.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'bei gani?' }],
      tools: [{ name: 'negotiate', description: 'propose a price', parameters: { type: 'object' } }],
    });
    expect(result.toolCalls).toEqual([
      { name: 'negotiate', args: { productId: 'p1', proposedPrice: 900 } },
    ]);
    const call = generateContent.mock.calls[0]?.[0] as {
      config: { tools?: Array<{ functionDeclarations: Array<{ name: string }> }> };
    };
    expect(call.config.tools?.[0]?.functionDeclarations[0]?.name).toBe('negotiate');
  });

  it('returns plain text with no toolCalls when the model just answers', async () => {
    const adapter = new GeminiLlmAdapter();
    const result = await adapter.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'habari' }],
    });
    expect(result).toEqual({ text: 'hello', toolCalls: undefined });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm -F @waos/api test -- gemini-adapter`
Expected: FAIL ("Cannot find module './gemini-adapter.js'").

- [ ] **Step 5: Implement the adapter**

Create `apps/api/src/adapters/llm/gemini-adapter.ts`:

```ts
import { GoogleGenAI } from '@google/genai';
import type {
  LLMPort,
  LlmCompletion,
  LlmCompletionParams,
  LlmMessage,
  LlmToolCall,
} from '@waos/ports';
import { config } from '../../lib/config.js';

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionResponse: { name: string; response: { output: unknown } } };

function toParts(message: LlmMessage): GeminiPart[] {
  if (typeof message.content === 'string') {
    return [{ text: message.content }];
  }
  return message.content.map((part): GeminiPart => {
    switch (part.type) {
      case 'text':
        return { text: part.text };
      case 'image':
        return { inlineData: { mimeType: part.mimeType, data: part.data } };
      case 'tool_result':
        return { functionResponse: { name: part.name, response: { output: part.response } } };
    }
  });
}

/**
 * Default LLMPort implementation. The SDK never leaks past this file; the
 * model id comes from env so upgrades are a config change.
 */
export class GeminiLlmAdapter implements LLMPort {
  private readonly client = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

  async complete(params: LlmCompletionParams): Promise<LlmCompletion> {
    const response = await this.client.models.generateContent({
      model: config.LLM_MODEL_ID,
      contents: params.messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: toParts(message),
      })),
      config: {
        systemInstruction: params.system,
        maxOutputTokens: params.maxTokens ?? 1024,
        temperature: params.temperature ?? 0.2,
        ...(params.tools && params.tools.length > 0
          ? {
              tools: [
                {
                  functionDeclarations: params.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parametersJsonSchema: tool.parameters,
                  })),
                },
              ],
            }
          : {}),
      },
    });
    const toolCalls: LlmToolCall[] = (response.functionCalls ?? []).map((call) => ({
      name: call.name ?? '',
      args: (call.args ?? {}) as Record<string, unknown>,
    }));
    return { text: response.text ?? '', toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}

export const llmPort: LLMPort = new GeminiLlmAdapter();
```

NOTE for the implementer: if the installed `@google/genai` version's `FunctionDeclaration` type has no `parametersJsonSchema` field, use `parameters` instead (older SDK versions take an OpenAPI-style schema there). Check `node_modules/@google/genai/dist` types; the test asserts only `name`, so both spellings pass, but typecheck will tell you which field exists.

- [ ] **Step 6: Rewire the two consumers and delete the Anthropic adapter**

In `apps/api/src/workers/ai-reply-worker.ts` change line 5 to:

```ts
import { llmPort } from '../adapters/llm/gemini-adapter.js';
```

In `apps/api/src/services/ai-test-service.ts` change the `llmPort` import the same way. Then:

```bash
rm apps/api/src/adapters/llm/anthropic-adapter.ts
```

- [ ] **Step 7: Update `.env.example`**

Replace the `ANTHROPIC_API_KEY=` line with `GEMINI_API_KEY=`, set `LLM_MODEL_ID=gemini-2.5-flash`, and append (with a short comment) the two missing vars the RUNBOOK requires:

```
# Dashboard origin allowed by CORS; public base URL of this API (webhooks).
WEB_ORIGIN=http://localhost:3000
API_PUBLIC_URL=http://localhost:4000
```

Also edit the real `/home/edward/projects/wa-os/.env`: rename `ANTHROPIC_API_KEY` to `GEMINI_API_KEY` (keep the placeholder value if no real key yet; boot only requires it non-empty) and set `LLM_MODEL_ID=gemini-2.5-flash`.

- [ ] **Step 8: Run all checks**

Run: `pnpm typecheck && pnpm lint && pnpm -F @waos/api test`
Expected: all PASS; the gemini-adapter tests pass, no remaining references to `anthropic` anywhere (`grep -ri anthropic apps packages --include='*.ts'` returns nothing).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(ai): replace the anthropic adapter with a gemini adapter behind LLMPort"
```

---

### Task 3: Gemini embedding adapter

**Files:**
- Create: `apps/api/src/adapters/embeddings/gemini-embedding-adapter.ts`
- Create: `apps/api/src/adapters/embeddings/gemini-embedding-adapter.test.ts`
- Modify: `apps/api/src/adapters/embeddings/embedding-adapter.ts:63` (factory picks by provider)
- Modify: `apps/api/src/test/setup.ts` (set `EMBEDDING_DIM: '4'` is NOT needed; keep defaults)

**Interfaces:**
- Consumes: `EmbeddingPort`, `EmbeddingIntent` from Task 1; `config.GEMINI_API_KEY`, `config.EMBEDDING_MODEL_ID`, `config.EMBEDDING_DIM`
- Produces: `GeminiEmbeddingAdapter` class; the existing `export const embeddingPort: EmbeddingPort` in `embedding-adapter.ts` now resolves to the Gemini adapter when `EMBEDDING_PROVIDER === 'gemini'`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/adapters/embeddings/gemini-embedding-adapter.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const embedContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { embedContent };
  },
}));

import { config } from '../../lib/config.js';
import { GeminiEmbeddingAdapter } from './gemini-embedding-adapter.js';

function fakeVector(dim: number): number[] {
  return Array.from({ length: dim }, () => 0.1);
}

describe('GeminiEmbeddingAdapter', () => {
  beforeEach(() => {
    embedContent.mockReset();
  });

  it('returns [] for empty input without calling the API', async () => {
    const adapter = new GeminiEmbeddingAdapter();
    expect(await adapter.embed([])).toEqual([]);
    expect(embedContent).not.toHaveBeenCalled();
  });

  it('embeds texts with the configured dimension and document task type', async () => {
    embedContent.mockResolvedValue({
      embeddings: [{ values: fakeVector(config.EMBEDDING_DIM) }],
    });
    const adapter = new GeminiEmbeddingAdapter();
    const result = await adapter.embed(['bei ya rasta']);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(config.EMBEDDING_DIM);
    const call = embedContent.mock.calls[0]?.[0] as {
      contents: string[];
      config: { outputDimensionality: number; taskType: string };
    };
    expect(call.contents).toEqual(['bei ya rasta']);
    expect(call.config.outputDimensionality).toBe(config.EMBEDDING_DIM);
    expect(call.config.taskType).toBe('RETRIEVAL_DOCUMENT');
  });

  it("uses the query task type for intent 'query'", async () => {
    embedContent.mockResolvedValue({
      embeddings: [{ values: fakeVector(config.EMBEDDING_DIM) }],
    });
    const adapter = new GeminiEmbeddingAdapter();
    await adapter.embed(['nywele ngapi?'], 'query');
    const call = embedContent.mock.calls[0]?.[0] as { config: { taskType: string } };
    expect(call.config.taskType).toBe('RETRIEVAL_QUERY');
  });

  it('throws EMBEDDING_DIM_MISMATCH when the provider returns a wrong width', async () => {
    embedContent.mockResolvedValue({ embeddings: [{ values: fakeVector(3) }] });
    const adapter = new GeminiEmbeddingAdapter();
    await expect(adapter.embed(['x'])).rejects.toMatchObject({
      code: 'EMBEDDING_DIM_MISMATCH',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @waos/api test -- gemini-embedding`
Expected: FAIL ("Cannot find module './gemini-embedding-adapter.js'").

- [ ] **Step 3: Implement the adapter**

Create `apps/api/src/adapters/embeddings/gemini-embedding-adapter.ts`:

```ts
import { GoogleGenAI } from '@google/genai';
import type { EmbeddingIntent, EmbeddingPort } from '@waos/ports';
import { AppError } from '../../lib/errors.js';
import { config } from '../../lib/config.js';

/**
 * Gemini EmbeddingPort. Uses the same GEMINI_API_KEY as the LLM adapter and
 * requests EMBEDDING_DIM-wide vectors so the pgvector column never changes.
 * Cosine distance is scale invariant, so truncated vectors need no
 * re-normalization for our retrieval query.
 */
export class GeminiEmbeddingAdapter implements EmbeddingPort {
  private readonly client = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });

  async embed(texts: string[], intent: EmbeddingIntent = 'document'): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.client.models.embedContent({
      model: config.EMBEDDING_MODEL_ID,
      contents: texts,
      config: {
        outputDimensionality: config.EMBEDDING_DIM,
        taskType: intent === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
      },
    });
    const vectors = (response.embeddings ?? []).map((item) => item.values ?? []);
    if (vectors.length !== texts.length) {
      throw new AppError('The embedding service returned the wrong number of vectors.', {
        statusCode: 502,
        code: 'EMBEDDING_FAILED',
        details: { expected: texts.length, got: vectors.length },
      });
    }
    for (const vector of vectors) {
      if (vector.length !== config.EMBEDDING_DIM) {
        throw new AppError(
          `Embedding dimension mismatch: expected ${config.EMBEDDING_DIM}, got ${vector.length}. Check EMBEDDING_MODEL_ID and EMBEDDING_DIM.`,
          { statusCode: 500, code: 'EMBEDDING_DIM_MISMATCH' },
        );
      }
    }
    return vectors;
  }
}
```

- [ ] **Step 4: Make the factory provider-aware**

In `apps/api/src/adapters/embeddings/embedding-adapter.ts`, add the import and replace the last line (`export const embeddingPort: EmbeddingPort = new HttpEmbeddingAdapter();`) with:

```ts
import { GeminiEmbeddingAdapter } from './gemini-embedding-adapter.js';

export const embeddingPort: EmbeddingPort =
  config.EMBEDDING_PROVIDER === 'gemini' ? new GeminiEmbeddingAdapter() : new HttpEmbeddingAdapter();
```

(Place the import at the top of the file with the others; the `HttpEmbeddingAdapter` stays for the voyage/openai fallback.)

- [ ] **Step 5: Point retrieval callers at the query intent**

In `apps/api/src/workers/ai-reply-worker.ts`, find the question-embedding call (`ports.embeddings.embed([...])` around line 72) and pass the intent:

```ts
const [queryEmbedding] = await ports.embeddings.embed([question], 'query');
```

In `apps/api/src/services/ai-test-service.ts`, make the same change to its `embed` call. The embeddings worker (`apps/api/src/workers/embeddings-worker.ts`) keeps the default `'document'` intent (no change).

- [ ] **Step 6: Run tests and checks**

Run: `pnpm -F @waos/api test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Update env docs**

In `.env.example` set `EMBEDDING_PROVIDER=gemini`, `EMBEDDING_MODEL_ID=gemini-embedding-001`, keep `EMBEDDING_DIM=1536`, and comment that `EMBEDDING_API_KEY` is only used by the voyage/openai fallback (Gemini reuses `GEMINI_API_KEY`). Mirror the same values in the real `.env`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ai): add gemini embedding adapter with retrieval intent"
```

---

### Task 4: Idempotent embeddings jobs + re-embed script

**Files:**
- Modify: `apps/api/src/lib/queues.ts:60-63` (`enqueueEmbeddings`)
- Create: `apps/api/src/lib/queues.test.ts`
- Create: `apps/api/scripts/re-embed.ts`
- Modify: `apps/api/package.json` (add `re-embed` script)

**Interfaces:**
- Consumes: `embeddingsJobSchema` from `@waos/shared`; `basePrisma` from `lib/prisma.js`; `runWithRequestContext` from `lib/context.js`
- Produces: `enqueueEmbeddings(payload)` now uses deterministic jobId `embed-<docId>` (removes a finished duplicate first); `pnpm -F @waos/api re-embed` re-enqueues every knowledge doc across all orgs

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/queues.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const added: Array<{ name: string; data: unknown; opts: { jobId?: string } }> = [];
const getJob = vi.fn();
const removeExisting = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class {
    add = (name: string, data: unknown, opts: { jobId?: string }): Promise<void> => {
      added.push({ name, data, opts });
      return Promise.resolve();
    };
    getJob = getJob;
    close = (): Promise<void> => Promise.resolve();
  },
}));

import { enqueueEmbeddings } from './queues.js';

describe('enqueueEmbeddings', () => {
  beforeEach(() => {
    added.length = 0;
    getJob.mockReset();
    removeExisting.mockReset();
  });

  it('uses a deterministic job id (no timestamp suffix)', async () => {
    getJob.mockResolvedValue(null);
    await enqueueEmbeddings({ organizationId: 'org1', docId: 'doc1' });
    expect(added[0]?.opts.jobId).toBe('embed-doc1');
  });

  it('removes a finished job with the same id before re-adding', async () => {
    getJob.mockResolvedValue({
      isCompleted: () => Promise.resolve(true),
      isFailed: () => Promise.resolve(false),
      remove: removeExisting,
    });
    await enqueueEmbeddings({ organizationId: 'org1', docId: 'doc1' });
    expect(removeExisting).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(1);
  });

  it('leaves a pending job in place (dedupe) and still calls add, which BullMQ ignores', async () => {
    getJob.mockResolvedValue({
      isCompleted: () => Promise.resolve(false),
      isFailed: () => Promise.resolve(false),
      remove: removeExisting,
    });
    await enqueueEmbeddings({ organizationId: 'org1', docId: 'doc1' });
    expect(removeExisting).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @waos/api test -- queues`
Expected: FAIL (jobId is `embed-doc1-<timestamp>`, and `getJob` is never consulted).

- [ ] **Step 3: Implement**

In `apps/api/src/lib/queues.ts` replace `enqueueEmbeddings` with:

```ts
export async function enqueueEmbeddings(payload: EmbeddingsJob): Promise<void> {
  const data = embeddingsJobSchema.parse(payload);
  const jobId = `embed-${data.docId}`;
  // A finished job with the same id would make BullMQ silently ignore the
  // re-add; drop it first. A pending/active job stays and dedupes the add.
  const existing = await embeddingsQueue.getJob(jobId);
  if (existing && ((await existing.isCompleted()) || (await existing.isFailed()))) {
    await existing.remove();
  }
  await embeddingsQueue.add('embed', data, { jobId });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @waos/api test -- queues`
Expected: PASS.

- [ ] **Step 5: Write the re-embed script**

Create `apps/api/scripts/re-embed.ts`:

```ts
/**
 * Re-embeds every knowledge doc for every organization, one embeddings job
 * per doc. Run after switching embedding providers (vector spaces are not
 * compatible across providers). Usage: pnpm -F @waos/api re-embed
 */
import { basePrisma } from '../src/lib/prisma.js';
import { runWithRequestContext } from '../src/lib/context.js';
import { closeQueues, enqueueEmbeddings } from '../src/lib/queues.js';

async function main(): Promise<void> {
  const docs = await basePrisma.knowledgeDoc.findMany({
    select: { id: true, organizationId: true },
  });
  for (const doc of docs) {
    await runWithRequestContext(
      { organizationId: doc.organizationId, userId: 'script:re-embed', role: 'OWNER' },
      () => enqueueEmbeddings({ organizationId: doc.organizationId, docId: doc.id }),
    );
  }
  console.log(`Enqueued re-embedding for ${docs.length} docs.`);
  await closeQueues();
  await basePrisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

Add to `apps/api/package.json` scripts:

```json
"re-embed": "dotenv -e ../../.env -- tsx scripts/re-embed.ts"
```

NOTE: `runWithRequestContext` may be synchronous-callback typed; check `apps/api/src/lib/context.ts` and match its signature (it wraps `AsyncLocalStorage.run`, which passes through the callback's return value, so `await` on it works if the callback returns a promise).

- [ ] **Step 6: Verify the script end to end (infra must be up, API running)**

```bash
pnpm -F @waos/api re-embed
```

Expected output: `Enqueued re-embedding for 1 docs.` (the seed doc). With a real `GEMINI_API_KEY` in `.env` and `pnpm dev` running, the embeddings worker fills `KnowledgeChunk.embedding`; verify with:

```bash
PGPASSWORD=waos psql -h localhost -p 5433 -U waos -d waos_dev -tAc 'SELECT count(*) FROM "KnowledgeChunk" WHERE embedding IS NOT NULL;'
```

Expected: a number greater than 0. Without a real key, the worker logs `embeddings job failed` and the count stays 0; that is expected until Edward provides the key, and the script itself still exits 0.

- [ ] **Step 7: Run all checks and commit**

```bash
pnpm typecheck && pnpm lint && pnpm -F @waos/api test
git add -A
git commit -m "feat(embeddings): idempotent embed job ids and a cross-provider re-embed script"
```

---

### Task 5: Organization.modules (schema, migration, shared schemas, API pass-through)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Organization model)
- Create: migration via `pnpm db:migrate` (name: `add_organization_modules`)
- Modify: `packages/shared/src/schemas/organization.ts`
- Modify: `packages/shared/src/schemas/auth.ts:47` (`authOrganizationSchema` gains `modules`)
- Modify: `apps/api/src/services/auth-service.ts` (include `modules` in auth responses)
- Modify: `apps/api/src/controllers/organization-controller.ts` (include `modules`, owner-gate module changes)
- Modify: `apps/api/src/repositories/organization-repository.ts:25` (update data type)
- Create: `apps/api/src/services/organization-modules.test.ts`

**Interfaces:**
- Consumes: existing `updateOrganizationRequestSchema`, `authOrganizationSchema`, tenant prisma client
- Produces (later tasks depend on these EXACT names):
  - Prisma: `Organization.modules: string[]` (default `["appointments"]`)
  - `businessModuleSchema = z.enum(['appointments', 'shop'])`, `type BusinessModule` from `@waos/shared`
  - `updateOrganizationRequestSchema` accepts `modules?: BusinessModule[]` (min 1, deduped)
  - `authOrganizationSchema` includes `modules: z.array(businessModuleSchema)` so web sessions carry modules
  - `GET/PATCH /api/v1/organization` responses include `modules`

- [ ] **Step 1: Add the column**

In `apps/api/prisma/schema.prisma`, inside `model Organization` after the `plan` line add:

```prisma
  // Enabled feature modules; gates API routes, AI tools, and dashboard nav.
  modules  String[] @default(["appointments"])
```

Run: `pnpm db:migrate` and name the migration `add_organization_modules`.
Expected: migration SQL contains `ALTER TABLE "Organization" ADD COLUMN "modules" TEXT[] NOT NULL DEFAULT ARRAY['appointments']::TEXT[];` and existing rows are backfilled by the default. Verify:

```bash
PGPASSWORD=waos psql -h localhost -p 5433 -U waos -d waos_dev -tAc 'SELECT modules FROM "Organization" LIMIT 1;'
```

Expected: `{appointments}`.

- [ ] **Step 2: Write the failing schema test**

Create `apps/api/src/services/organization-modules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { businessModuleSchema, updateOrganizationRequestSchema } from '@waos/shared';

describe('modules schemas', () => {
  it('accepts appointments and shop', () => {
    expect(businessModuleSchema.parse('appointments')).toBe('appointments');
    expect(businessModuleSchema.parse('shop')).toBe('shop');
  });

  it('rejects unknown modules', () => {
    expect(() => businessModuleSchema.parse('billing')).toThrow();
  });

  it('org update accepts a module list and dedupes it', () => {
    const parsed = updateOrganizationRequestSchema.parse({
      modules: ['shop', 'shop', 'appointments'],
    });
    expect(parsed.modules).toEqual(['shop', 'appointments']);
  });

  it('org update rejects an empty module list', () => {
    expect(() => updateOrganizationRequestSchema.parse({ modules: [] })).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @waos/api test -- organization-modules`
Expected: FAIL (`businessModuleSchema` is not exported).

- [ ] **Step 4: Implement the shared schemas**

In `packages/shared/src/schemas/organization.ts` add before `updateOrganizationRequestSchema`:

```ts
export const businessModuleSchema = z.enum(['appointments', 'shop']);
export type BusinessModule = z.infer<typeof businessModuleSchema>;
```

and add to `updateOrganizationRequestSchema`:

```ts
  modules: z
    .array(businessModuleSchema)
    .min(1)
    .transform((modules) => [...new Set(modules)])
    .optional(),
```

In `packages/shared/src/schemas/auth.ts` import `businessModuleSchema` from `./organization.js` and add to `authOrganizationSchema`:

```ts
  modules: z.array(businessModuleSchema),
```

CHECK: if this creates a circular import (auth.ts <- organization.ts <- auth.ts because organization.ts imports `supportedLanguageSchema` from auth.ts), move `businessModuleSchema` + `BusinessModule` into a new file `packages/shared/src/schemas/modules.ts`, import it from both, and re-export it from `packages/shared/src/index.ts`.

- [ ] **Step 5: Thread modules through the API**

- `apps/api/src/repositories/organization-repository.ts`: widen the `update` data parameter type to include `modules?: string[]` (match the file's existing inline type style).
- `apps/api/src/services/auth-service.ts`: in `toAuthResponse` (and the `me` response builder if separate), add `modules: organization.modules as BusinessModule[]` to the organization object (import `type BusinessModule` from `@waos/shared`). Prisma stores plain `string[]`; the cast is safe because writes only accept `businessModuleSchema` values.
- `apps/api/src/controllers/organization-controller.ts`: add `modules: organization.modules` to BOTH the `get` and `update` response objects. In `update`, owner-gate module changes:

```ts
  const { organizationId, role } = requireRequestContext();
  if (input.modules && role !== 'OWNER') {
    throw new ForbiddenError('Only the owner can change enabled modules.');
  }
```

(import `ForbiddenError` from `../lib/errors.js`).

- [ ] **Step 6: Run tests and checks**

Run: `pnpm -F @waos/api test && pnpm typecheck && pnpm lint`
Expected: PASS. If the auth integration test asserts an exact organization shape, update it to include `modules: ['appointments']`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(modules): add Organization.modules with shared schemas and owner-gated updates"
```

---

### Task 6: MODULE_DISABLED error + requireModule middleware, gate appointments routes

**Files:**
- Modify: `apps/api/src/lib/errors.ts` (add `ModuleDisabledError`)
- Create: `apps/api/src/middleware/require-module.ts`
- Create: `apps/api/src/middleware/require-module.test.ts`
- Modify: `apps/api/src/routes/appointments.ts` (apply the guard)

**Interfaces:**
- Consumes: `requireRequestContext` from `lib/context.js`; `organizationRepository.findCurrent(id)`; `BusinessModule` from `@waos/shared`
- Produces: `requireModule(module: BusinessModule): RequestHandler` (async); `ModuleDisabledError` (403, code `MODULE_DISABLED`). Phase B will reuse `requireModule('shop')` on shop routes.

- [ ] **Step 1: Write the failing middleware test**

Create `apps/api/src/middleware/require-module.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from '../lib/context.js';
import { ModuleDisabledError } from '../lib/errors.js';

vi.mock('../repositories/organization-repository.js', () => ({
  organizationRepository: {
    findCurrent: vi.fn((id: string) =>
      Promise.resolve({ id, modules: ['appointments'] as string[] }),
    ),
  },
}));

import { requireModule } from './require-module.js';

const ctx = { organizationId: 'org1', userId: 'u1', role: 'OWNER' as const };

async function invoke(module: 'appointments' | 'shop'): Promise<unknown> {
  return new Promise((resolve) => {
    const next: NextFunction = (err?: unknown) => resolve(err);
    void runWithRequestContext(ctx, () =>
      requireModule(module)({} as Request, {} as Response, next),
    );
  });
}

describe('requireModule', () => {
  it('passes when the module is enabled', async () => {
    expect(await invoke('appointments')).toBeUndefined();
  });

  it('rejects with ModuleDisabledError when the module is off', async () => {
    const err = await invoke('shop');
    expect(err).toBeInstanceOf(ModuleDisabledError);
    expect((err as ModuleDisabledError).code).toBe('MODULE_DISABLED');
    expect((err as ModuleDisabledError).statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @waos/api test -- require-module`
Expected: FAIL (`ModuleDisabledError` and `require-module.js` do not exist).

- [ ] **Step 3: Implement error and middleware**

In `apps/api/src/lib/errors.ts` add (matching the file's existing class style):

```ts
export class ModuleDisabledError extends AppError {
  constructor(module: string) {
    super(`The ${module} module is not enabled for this business.`, {
      statusCode: 403,
      code: 'MODULE_DISABLED',
    });
  }
}
```

Create `apps/api/src/middleware/require-module.ts`:

```ts
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { BusinessModule } from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { ModuleDisabledError, NotFoundError } from '../lib/errors.js';
import { organizationRepository } from '../repositories/organization-repository.js';

/** Gate a router behind an enabled organization module. Mount after requireAuth. */
export function requireModule(module: BusinessModule): RequestHandler {
  return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const { organizationId } = requireRequestContext();
      const organization = await organizationRepository.findCurrent(organizationId);
      if (!organization) {
        throw new NotFoundError('Your business could not be found.');
      }
      if (!organization.modules.includes(module)) {
        throw new ModuleDisabledError(module);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
```

In `apps/api/src/routes/appointments.ts` add after `appointmentRoutes.use(requireAuth);`:

```ts
import { requireModule } from '../middleware/require-module.js';
// ...
appointmentRoutes.use(requireModule('appointments'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @waos/api test -- require-module`
Expected: PASS.

- [ ] **Step 5: Smoke the live behavior**

With `pnpm dev` running and the demo login token:

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"demo@waos.dev","password":"DemoOwner123!"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).tokens.accessToken))")
curl -s http://localhost:4000/api/v1/appointments -H "Authorization: Bearer $TOKEN" | head -c 120
```

Expected: an appointments JSON response (module enabled by default). Then disable it and confirm the block:

```bash
curl -s -X PATCH http://localhost:4000/api/v1/organization -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"modules":["shop"]}' >/dev/null
curl -s http://localhost:4000/api/v1/appointments -H "Authorization: Bearer $TOKEN"
curl -s -X PATCH http://localhost:4000/api/v1/organization -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"modules":["appointments"]}' >/dev/null
```

Expected middle response: `{"error":{"code":"MODULE_DISABLED","message":"The appointments module is not enabled for this business."}}` (last command restores the module).

- [ ] **Step 6: Run all checks and commit**

```bash
pnpm typecheck && pnpm lint && pnpm -F @waos/api test
git add -A
git commit -m "feat(modules): gate appointments routes behind an enabled-module middleware"
```

---

### Task 7: Web module awareness (nav filtering + settings toggles)

**Files:**
- Modify: `apps/web/src/lib/api.ts` (add `updateStoredOrganization` helper)
- Modify: `apps/web/src/components/app-shell.tsx:40-46` (nav items gain `requiredModule`)
- Modify: `apps/web/src/app/[locale]/settings/page.tsx` (Modules card)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (settings + nav keys)

**Interfaces:**
- Consumes: `getStoredUser()` from `apps/web/src/lib/api.ts` (session already carries `organization.modules` after Task 5); `PATCH /api/v1/organization` with `{ modules }`
- Produces: `updateStoredOrganization(patch: Partial<StoredUser['organization']>): void` in `lib/api.ts`; nav hides module screens; settings toggles persist modules

- [ ] **Step 1: Add the session updater in `apps/web/src/lib/api.ts`**

Next to the existing session helpers add (adapt the exact stored-user type name used in the file):

```ts
export function updateStoredOrganization(
  patch: Partial<StoredUser['organization']>,
): void {
  const user = getStoredUser();
  if (!user) return;
  window.localStorage.setItem(
    USER_KEY,
    JSON.stringify({ ...user, organization: { ...user.organization, ...patch } }),
  );
}
```

(`USER_KEY` is the existing `waos.user` constant; reuse whatever the file names it.)

- [ ] **Step 2: Filter nav by modules in `apps/web/src/components/app-shell.tsx`**

Replace the `navItems` array with:

```tsx
  const modules = user?.organization.modules ?? ['appointments'];
  const navItems = [
    { href: '/home', label: t('home') },
    { href: '/inbox', label: t('inbox') },
    { href: '/appointments', label: t('appointments'), requiredModule: 'appointments' },
    { href: '/contacts', label: t('contacts') },
    { href: '/settings', label: t('settings') },
  ].filter((item) => !item.requiredModule || modules.includes(item.requiredModule));
```

(`user` already comes from `getStoredUser()` in this component; keep TypeScript happy by typing `requiredModule` as `'appointments' | 'shop' | undefined` via `as const` objects or an explicit interface. Older stored sessions may lack `modules`; the `?? ['appointments']` fallback covers them until next login.)

- [ ] **Step 3: Add the Modules card to `apps/web/src/app/[locale]/settings/page.tsx`**

Below the profile section (owner-only, mirroring how the team section checks `role === 'OWNER'`), add a card with two checkboxes bound to local state initialized from the loaded organization:

```tsx
<Card>
  <h2 className="text-base font-semibold text-brand-900">{t('modulesSection')}</h2>
  <p className="mt-1 text-sm text-brand-700">{t('modulesHint')}</p>
  <div className="mt-3 flex flex-col gap-2">
    {(['appointments', 'shop'] as const).map((module) => (
      <label key={module} className="flex items-center gap-2 text-sm text-brand-900">
        <input
          type="checkbox"
          checked={modules.includes(module)}
          onChange={() => toggleModule(module)}
          disabled={modules.length === 1 && modules.includes(module)}
        />
        {module === 'appointments' ? t('moduleAppointments') : t('moduleShop')}
      </label>
    ))}
  </div>
  <Button className="mt-3" onClick={() => void saveModules()} disabled={savingModules}>
    {savingModules ? t('saving') : t('save')}
  </Button>
</Card>
```

with state and handlers in the component:

```tsx
const [modules, setModules] = useState<Array<'appointments' | 'shop'>>(['appointments']);
const [savingModules, setSavingModules] = useState(false);

// in the existing load() after the organization fetch succeeds:
setModules((org.modules ?? ['appointments']) as Array<'appointments' | 'shop'>);

const toggleModule = (module: 'appointments' | 'shop'): void => {
  setModules((current) =>
    current.includes(module) ? current.filter((m) => m !== module) : [...current, module],
  );
};

const saveModules = async (): Promise<void> => {
  setSavingModules(true);
  try {
    const response = await apiFetch<{ organization: { modules: string[] } }>(
      '/api/v1/organization',
      { method: 'PATCH', body: JSON.stringify({ modules }) },
    );
    updateStoredOrganization({ modules: response.organization.modules });
    setNotice(t('saved'));
  } catch {
    setError(t('saveError'));
  } finally {
    setSavingModules(false);
  }
};
```

Adapt names (`setNotice`, `setError`, `apiFetch` call style, `Card`/`Button` imports) to the file's existing patterns; a `saving` key may need adding if settings lacks one. If the settings page needs `t('saving')`, reuse `onboarding.saving` style by adding a `saving` key to the `settings` namespace.

- [ ] **Step 4: Add the copy to BOTH locales**

`apps/web/messages/en.json` `settings` namespace, add:

```json
"modulesSection": "What your business does",
"modulesHint": "Turn on the parts of WaOS you need. At least one stays on.",
"moduleAppointments": "Bookings and reminders",
"moduleShop": "Shop and selling (coming soon)",
"saving": "Saving..."
```

`apps/web/messages/sw.json` `settings` namespace, add:

```json
"modulesSection": "Biashara yako inafanya nini",
"modulesHint": "Washa sehemu za WaOS unazohitaji. Angalau moja hubaki imewashwa.",
"moduleAppointments": "Miadi na vikumbusho",
"moduleShop": "Duka na mauzo (inakuja hivi karibuni)",
"saving": "Inahifadhi..."
```

("coming soon"/"inakuja hivi karibuni" is honest until Phase B ships the shop screens; Phase B removes that suffix.)

- [ ] **Step 5: Verify in the browser**

Run `pnpm -F @waos/web typecheck && pnpm lint`, then with `pnpm dev` running:

```bash
google-chrome --headless=new --disable-gpu --no-sandbox --window-size=1440,900 --screenshot=/tmp/claude-1000/settings.png http://localhost:3000/en/settings
```

Log in via the UI if needed (screenshots of authed pages need a token in localStorage; alternatively verify manually). Confirm: the Modules card renders, unchecking Bookings while it is the only module is impossible, saving Shop-only hides the Appointments tab after reload.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): module-aware navigation and settings toggles"
```

---

### Task 8: Onboarding profile step selects modules

**Files:**
- Modify: `apps/web/src/app/[locale]/onboarding/profile/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/sw.json` (`onboarding` namespace)

**Interfaces:**
- Consumes: `PATCH /api/v1/organization` accepting `modules` (Task 5); `updateStoredOrganization` (Task 7)
- Produces: onboarding profile step writes `modules` before the connect step; stored session stays in sync

- [ ] **Step 1: Add the picker UI**

In `apps/web/src/app/[locale]/onboarding/profile/page.tsx`, add state defaulting from the loaded org (`['appointments']` fallback) and a three-option radio-card group between the vertical field and language field:

```tsx
type ModuleChoice = 'appointments' | 'shop' | 'both';

const [moduleChoice, setModuleChoice] = useState<ModuleChoice>('appointments');

// when the org loads:
const loaded = (org.modules ?? ['appointments']) as string[];
setModuleChoice(
  loaded.includes('shop') && loaded.includes('appointments')
    ? 'both'
    : loaded.includes('shop')
      ? 'shop'
      : 'appointments',
);

const choiceToModules: Record<ModuleChoice, string[]> = {
  appointments: ['appointments'],
  shop: ['shop'],
  both: ['appointments', 'shop'],
};
```

```tsx
<Field label={t('modulesLabel')} hint={t('modulesHint')}>
  <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('modulesLabel')}>
    {(['appointments', 'shop', 'both'] as const).map((choice) => (
      <label
        key={choice}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${
          moduleChoice === choice
            ? 'border-brand-600 bg-brand-50 text-brand-900'
            : 'border-brand-100 bg-white text-brand-700'
        }`}
      >
        <input
          type="radio"
          name="modules"
          checked={moduleChoice === choice}
          onChange={() => setModuleChoice(choice)}
        />
        <span>
          <span className="block font-medium">{t(`modules_${choice}`)}</span>
          <span className="block text-xs text-brand-600">{t(`modules_${choice}Hint`)}</span>
        </span>
      </label>
    ))}
  </div>
</Field>
```

In the submit handler, include `modules: choiceToModules[moduleChoice]` in the PATCH body and call `updateStoredOrganization({ modules: choiceToModules[moduleChoice] })` on success. Adapt to the page's existing `Field`/form patterns.

- [ ] **Step 2: Add the copy to BOTH locales**

`en.json` `onboarding` namespace:

```json
"modulesLabel": "What does your business do?",
"modulesHint": "This decides which tools your dashboard shows. You can change it later in Settings.",
"modules_appointments": "Take bookings",
"modules_appointmentsHint": "Appointments, reminders, and a calendar.",
"modules_shop": "Sell products",
"modules_shopHint": "A catalog your AI sells from. Shop tools arrive soon.",
"modules_both": "Both",
"modules_bothHint": "Bookings and selling in one place."
```

`sw.json` `onboarding` namespace:

```json
"modulesLabel": "Biashara yako inafanya nini?",
"modulesHint": "Hii huamua zana zitakazoonekana kwenye dashibodi. Unaweza kubadilisha baadaye kwenye Mipangilio.",
"modules_appointments": "Kupokea miadi",
"modules_appointmentsHint": "Miadi, vikumbusho, na kalenda.",
"modules_shop": "Kuuza bidhaa",
"modules_shopHint": "Katalogi ambayo AI yako inauzia. Zana za duka zinakuja hivi karibuni.",
"modules_both": "Vyote viwili",
"modules_bothHint": "Miadi na mauzo mahali pamoja."
```

- [ ] **Step 3: Verify**

`pnpm -F @waos/web typecheck && pnpm lint`, then drive it: sign up a fresh account via the UI (or curl + browser), land on `/onboarding/profile`, pick "Sell products", save, reload `/en/settings`: the Shop checkbox is on and the Appointments nav tab is hidden. Screenshot the profile step:

```bash
google-chrome --headless=new --disable-gpu --no-sandbox --window-size=1440,900 --screenshot=/tmp/claude-1000/onboarding-profile.png http://localhost:3000/en/onboarding/profile
```

(Unauthenticated it redirects to login; verify the picker visually via an authed browser session.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(onboarding): choose business modules on the profile step"
```

---

### Task 9: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts `typecheck`, `lint`, `test`; `pnpm -F @waos/api db:generate` and prisma migrate; integration gating via `INTEGRATION_DATABASE_URL`
- Produces: CI that fails PRs on typecheck/lint/unit/integration/web-build errors

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

env:
  DATABASE_URL: postgresql://waos:waos@localhost:5432/waos_test
  REDIS_URL: redis://localhost:6379
  MINIO_ENDPOINT: localhost:9000
  MINIO_ACCESS_KEY: ci-access-key
  MINIO_SECRET_KEY: ci-secret-key
  EVOLUTION_API_URL: http://localhost:8080
  EVOLUTION_API_KEY: ci-evolution-key
  EVOLUTION_WEBHOOK_SECRET: ci-webhook-secret
  JWT_ACCESS_SECRET: ci-access-secret-0123456789-0123456789
  JWT_REFRESH_SECRET: ci-refresh-secret-0123456789-0123456789
  GEMINI_API_KEY: ci-gemini-key
  LLM_MODEL_ID: gemini-2.5-flash
  EMBEDDING_PROVIDER: gemini
  EMBEDDING_API_KEY: ci-embedding-key
  EMBEDDING_MODEL_ID: gemini-embedding-001
  NEXT_PUBLIC_APP_NAME: WaOS
  NEXT_PUBLIC_API_URL: http://localhost:4000

jobs:
  checks:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: waos
          POSTGRES_PASSWORD: waos
          POSTGRES_DB: waos_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U waos -d waos_test"
          --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm -F @waos/api db:generate
      - run: pnpm typecheck
      - run: pnpm lint
      - name: migrate test database
        run: pnpm -F @waos/api exec prisma migrate deploy
      - name: unit and integration tests
        run: pnpm test
        env:
          INTEGRATION_DATABASE_URL: postgresql://waos:waos@localhost:5432/waos_test
      - name: web build
        run: pnpm -F @waos/web build
```

NOTE: `pnpm -F @waos/api db:migrate`/`db:deploy` wrap prisma with `dotenv -e ../../.env`, which does not exist in CI; that is why the migrate step calls `pnpm -F @waos/api exec prisma migrate deploy` directly (it reads `DATABASE_URL` from the job env). If `pnpm -F @waos/api db:generate` also fails on the missing `.env`, check the script; `db:generate` has no dotenv wrapper today, so it is fine.

- [ ] **Step 2: Validate locally as far as possible**

```bash
pnpm -F @waos/api exec prisma migrate deploy   # against the local 5433 DB via .env: confirms the command shape
pnpm -F @waos/web build                         # confirms the web build passes
```

Expected: both succeed. (Full workflow validation happens on the first push; if the repo has no GitHub remote CI yet, this lands dormant and correct.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore(ci): add github actions for typecheck, lint, tests, and web build"
```

---

### Task 10: Sync CLAUDE.md and README to the new reality

**Files:**
- Modify: `CLAUDE.md` (sections 2, 4, 7, 10)
- Modify: `README.md` (stack + env mentions)

**Interfaces:**
- Consumes: the master design doc's scope decisions
- Produces: a rulebook that matches the code so future sessions do not fight it

- [ ] **Step 1: Update CLAUDE.md**

- Section 2 (scope rules): replace rule 2 "No commerce layer..." with:

```
2. **Commerce is module-scoped, payments stay out.** The `shop` module
   (catalog, orders, AI selling) is being built per
   docs/superpowers/specs/2026-07-11-waos-revamp-master-design.md. The
   platform NEVER processes payments: no gateways, no checkout, no billing.
   The AI may only relay the owner's payment instructions as text.
```

- Section 4 (tech stack): change the LLM row to `LLMPort interface; Gemini SDK (@google/genai) default, model from env` and the Embeddings row to note Gemini as the default provider.
- Section 7 (data model): add `modules String[]` to the Organization bullet: enabled feature modules (`appointments`, `shop`), gates routes/nav/AI tools.
- Section 10 (env vars): replace `ANTHROPIC_API_KEY=` with `GEMINI_API_KEY=`, set the documented defaults `LLM_MODEL_ID=gemini-2.5-flash`, `EMBEDDING_PROVIDER=gemini`, `EMBEDDING_MODEL_ID=gemini-embedding-001`, and add the missing `WEB_ORIGIN=`, `API_PUBLIC_URL=`, `REMINDER_OFFSETS_MINUTES=`, `PORT=`, `NODE_ENV=` lines so the list matches `config.ts`.
- Do NOT touch the ban-risk, tenant, or no-em-dash rules.

- [ ] **Step 2: Update README.md**

In the Stack paragraph replace the Anthropic mention (if any) with Gemini; note that a `GEMINI_API_KEY` is required for AI replies; mention `pnpm -F @waos/api re-embed` after switching embedding providers.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: sync CLAUDE.md and README with gemini, modules, and env reality"
```

---

## Final verification (whole phase)

- [ ] `pnpm typecheck && pnpm lint && pnpm test` all green.
- [ ] `INTEGRATION_DATABASE_URL=postgresql://waos:waos@localhost:5433/waos_dev pnpm -F @waos/api test` green (integration suites run against the migrated local DB).
- [ ] `pnpm dev`: signup -> onboarding shows the module picker -> settings toggles modules -> appointments tab and API react to the toggle (403 `MODULE_DISABLED` when off).
- [ ] With a real `GEMINI_API_KEY`: onboarding test step returns an AI answer grounded in the seeded knowledge after `pnpm -F @waos/api re-embed` (proves LLM + embeddings + retrieval on Gemini end to end).
- [ ] `git log --oneline` shows one conventional commit per task.
