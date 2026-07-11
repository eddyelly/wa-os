import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMPort,
  LlmCompletion,
  LlmCompletionParams,
  LlmContentPart,
} from '@waos/ports';
import { config } from '../../lib/config.js';

/**
 * Default LLMPort implementation. The SDK never leaks past this file; the
 * model id comes from env so upgrades are a config change.
 */
export class AnthropicAdapter implements LLMPort {
  private readonly client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  private transformContent(
    content: string | LlmContentPart[]
  ): string | Anthropic.ContentBlockParam[] {
    if (typeof content === 'string') {
      return content;
    }

    return content.map((part): Anthropic.ContentBlockParam => {
      switch (part.type) {
        case 'text':
          return {
            type: 'text',
            text: part.text,
          };
        case 'image':
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.mimeType as
                | 'image/jpeg'
                | 'image/png'
                | 'image/gif'
                | 'image/webp',
              data: part.data,
            },
          };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: part.name,
            content: JSON.stringify(part.response),
          };
      }
    });
  }

  async complete(params: LlmCompletionParams): Promise<LlmCompletion> {
    const response = await this.client.messages.create({
      model: config.LLM_MODEL_ID,
      max_tokens: params.maxTokens ?? 1024,
      temperature: params.temperature ?? 0.2,
      system: params.system,
      messages: params.messages.map((message) => ({
        role: message.role,
        content: this.transformContent(message.content),
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
