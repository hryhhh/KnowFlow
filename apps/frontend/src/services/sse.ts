import type { SourceRef, SearchParams } from "../types";

export interface StreamHandlers {
  onSources: (sources: SourceRef[]) => void;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

/**
 * 通过 fetch + ReadableStream 消费 POST SSE 流式接口。
 * 后端返回 text/event-stream，每行 `data: {json}`。
 */
export async function streamChat(
  kbId: string,
  query: string,
  params: SearchParams,
  handlers: StreamHandlers,
): Promise<void> {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kbId, query, params }),
  });

  if (!response.ok || !response.body) {
    handlers.onError(`请求失败: ${response.status}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const event = JSON.parse(payload);
        switch (event.type) {
          case "sources":
            handlers.onSources(event.value as SourceRef[]);
            break;
          case "token":
            handlers.onToken(event.value as string);
            break;
          case "done":
            handlers.onDone();
            break;
          case "error":
            handlers.onError(event.value as string);
            break;
        }
      } catch {
        // 忽略无法解析的行
      }
    }
  }
}
