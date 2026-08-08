import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { LLMConfig, RetrievalResult, SourceRef, StreamCallbacks } from "../types.js";

export const DEFAULT_SYSTEM_PROMPT = `你是一个知识库助手。请根据以下参考资料回答用户问题。
如果资料中没有相关信息，请明确告知用户，不要编造。
回答时请尽量引用具体的来源信息，保持简洁准确。`;

export interface ChatRequest {
  query: string;
  context: string;
  systemPrompt?: string;
}

/** 将检索结果拼装为上下文 */
export function buildContext(results: RetrievalResult[]): string {
  if (!results.length) return "（暂无可用参考资料）";
  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.content}\n(来源: ${r.sourceFile}, 相关度: ${r.score})`,
    )
    .join("\n\n");
}

/**
 * 流式对话生成。通过 callbacks 实时推送来源、token 与完成事件。
 */
export async function streamChat(
  request: ChatRequest,
  config: LLMConfig,
  callbacks: StreamCallbacks,
): Promise<void> {
  const llm = new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    temperature: config.temperature ?? 0.7,
    streaming: true,
    configuration: { baseURL: config.baseURL },
  });

  const systemPrompt = request.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const userPrompt = `参考资料：\n${request.context}\n\n用户问题：${request.query}`;

  try {
    const stream = await llm.stream([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    for await (const chunk of stream) {
      const content = chunk.content as string;
      if (content) callbacks.onToken(content);
    }
    callbacks.onDone();
  } catch (error) {
    callbacks.onError(error as Error);
  }
}

export type { SourceRef };
