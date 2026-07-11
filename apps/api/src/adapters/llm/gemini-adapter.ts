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
  | { functionResponse: { name: string; response: { output: unknown } } }
  | { functionCall: { name: string; args: Record<string, unknown> } };

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
      case 'tool_call':
        return { functionCall: { name: part.name, args: part.args } };
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
      args: call.args ?? {},
    }));
    return { text: response.text ?? '', toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}

export const llmPort: LLMPort = new GeminiLlmAdapter();
