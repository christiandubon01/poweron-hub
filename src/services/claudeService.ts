/**
 * claudeService.ts
 * V3 integration adapter for nexusPromptEngine.ts.
 *
 * The V3 NEXUS Prompt Engine calls claudeService.callClaude({ prompt, context, agentMode }).
 * This adapter bridges that V3 API to V2's claudeProxy.callClaude({ messages, system }).
 *
 * V2 code should use claudeProxy.ts directly. This file exists only for NEXUS compatibility.
 */

import { callClaude as proxyClaude, extractText } from './claudeProxy';

export interface ClaudeServiceRequest {
  prompt: string;
  // context can be a JSON string (V3 nexusPromptEngine passes sessionContext as string)
  // or a structured object — both are accepted
  context?: string | Record<string, unknown>;
  agentMode?: string;
  system?: string;
  maxTokens?: number;
}

export interface ClaudeServiceResponse {
  text: string;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Call Claude via the V2 proxy, adapting V3 nexusPromptEngine API.
 */
export async function callClaude(req: ClaudeServiceRequest): Promise<ClaudeServiceResponse> {
  const response = await proxyClaude({
    messages: [{ role: 'user', content: req.context ? String(req.context) : 'respond' }],
    system: req.prompt,
    max_tokens: req.maxTokens ?? 2048,
  });

  return {
    text: extractText(response),
    model: response.model,
    usage: response.usage,
  };
}
