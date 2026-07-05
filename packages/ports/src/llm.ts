/**
 * LLMPort: the core never imports an LLM SDK directly.
 * The default adapter uses the Anthropic SDK with the model id from env.
 */

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmCompletionParams {
  system: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCompletion {
  text: string;
}

export interface LLMPort {
  complete(params: LlmCompletionParams): Promise<LlmCompletion>;
}
