import Anthropic from '@anthropic-ai/sdk';
import type { LLMPort, LlmCompletion, LlmCompletionParams } from '@waos/ports';
import { config } from '../../lib/config.js';

/**
 * Default LLMPort implementation. The SDK never leaks past this file; the
 * model id comes from env so upgrades are a config change.
 */
export class AnthropicAdapter implements LLMPort {
  private readonly client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  async complete(params: LlmCompletionParams): Promise<LlmCompletion> {
    const response = await this.client.messages.create({
      model: config.LLM_MODEL_ID,
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.2,
      system: params.system,
      messages: params.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return { text };
  }
}

export const llmPort: LLMPort = new AnthropicAdapter();
