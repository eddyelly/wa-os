import type { EmbeddingPort, LLMPort } from '@waos/ports';
import { embeddingPort } from '../adapters/embeddings/embedding-adapter.js';
import { llmPort } from '../adapters/llm/gemini-adapter.js';
import { config } from '../lib/config.js';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError } from '../lib/errors.js';
import { knowledgeRepository } from '../repositories/knowledge-repository.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { buildSystemPrompt, completeWithRepair, decideAiAction } from './ai-reply.js';

export interface AiTestResult {
  reply: string | null;
  confidence: number;
  intent: string | null;
  action: 'REPLY' | 'HANDOFF';
  chunksUsed: number;
}

/**
 * The onboarding "send yourself a test question" step: runs the exact RAG
 * pipeline the ai-reply worker uses, without touching WhatsApp.
 */
export async function runAiTest(
  question: string,
  ports: { llm: LLMPort; embeddings: EmbeddingPort } = { llm: llmPort, embeddings: embeddingPort },
): Promise<AiTestResult> {
  const organization = await organizationRepository.findCurrent(
    requireRequestContext().organizationId,
  );
  if (!organization) {
    throw new NotFoundError('Your business could not be found.');
  }
  const [queryEmbedding] = await ports.embeddings.embed([question]);
  const chunks = queryEmbedding ? await knowledgeRepository.searchChunks(queryEmbedding) : [];
  const settings =
    typeof organization.settings === 'object' && organization.settings !== null
      ? (organization.settings as Record<string, unknown>)
      : {};
  const threshold =
    typeof settings.aiConfidenceThreshold === 'number'
      ? settings.aiConfidenceThreshold
      : config.AI_CONFIDENCE_THRESHOLD;
  const system = buildSystemPrompt({
    businessName: organization.name,
    vertical: organization.vertical,
    defaultLanguage: organization.language,
    toneNotes: typeof settings.toneNotes === 'string' ? settings.toneNotes : undefined,
    chunks,
  });
  const output = await completeWithRepair(ports.llm, system, [
    { role: 'user', content: question },
  ]);
  const action = decideAiAction(output, threshold);
  return {
    reply: output?.reply ?? null,
    confidence: output?.confidence ?? 0,
    intent: output?.intent ?? null,
    action,
    chunksUsed: chunks.length,
  };
}
