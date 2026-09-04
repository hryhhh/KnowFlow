import type { SourceRef, SearchParams } from '../types';

export interface ProcessIndicator {
  stage: 'retrieving' | 'rag_fallback' | 'generating' | 'agent_start' | 'agent_done';
  label: string;
  agent?: string;
}

export interface StreamHandlers {
  onSources: (sources: SourceRef[]) => void;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onMeta?: (event: { type: string; value: unknown }) => void;
}

export async function streamChat(
  kbId: string,
  query: string,
  params: SearchParams,
  handlers: StreamHandlers,
  options?: { sessionId?: string },
): Promise<{ sessionId: string }> {
  
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kbId, query, sessionId: options?.sessionId, params }),
  });
  
  
  if (!response.ok || !response.body) {
    handlers.onError(`请求失败: ${response.status}`);
    return { sessionId: '' };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sessionId = options?.sessionId ?? '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload) continue;
      try {
        const event = JSON.parse(payload);
        
        switch (event.type) {
          case 'session_id':
            sessionId = event.value as string;
            break;
          case 'sources':
            handlers.onSources(event.value as SourceRef[]);
            break;
          case 'token':
            handlers.onToken(event.value as string);
            break;
          case 'done':
            handlers.onDone();
            break;
          case 'error':
            handlers.onError(event.value as string);
            break;
          case 'process':
            handlers.onMeta?.({ type: 'process', value: event.value });
            break;
          default:
            handlers.onMeta?.(event);
        }
      } catch (e) {
        console.error('[SSE] Parse error:', e, payload.substring(0, 100));
      }
    }
  }
  
  return { sessionId };
}
