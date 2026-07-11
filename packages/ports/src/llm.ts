/**
 * LLMPort: the core never imports an LLM SDK directly.
 * The default adapter uses the Gemini SDK with the model id from env.
 */

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'tool_result'; name: string; response: unknown }
  /** Echoes a prior model tool call back into history (assistant message part). */
  | { type: 'tool_call'; name: string; args: Record<string, unknown> };

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
