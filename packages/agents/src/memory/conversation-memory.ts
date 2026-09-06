/**
 * ConversationMemory — 对话记忆加载
 *
 * 从 SessionService 加载最近 N 条消息，注入到 ReAct 循环的消息历史中。
 * 异常时返回空数组，不阻塞主流程。
 */

export interface MessageItem {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 对话记忆接口 — 由实现方注入
 */
export interface MemoryLoader {
  /**
   * 加载最近 N 条消息
   * @param sessionId 会话 ID（null 表示匿名/未登录）
   * @param maxMessages 最大消息数（默认 6，即最近 3 轮 user/assistant）
   */
  load(sessionId: string | null, maxMessages?: number): Promise<MessageItem[]>;
}

/**
 * ConversationMemory — 默认实现，依赖 SessionService
 */
export class ConversationMemory {
  constructor(private readonly memoryLoader: MemoryLoader) {}

  /**
   * 加载对话历史
   * @param sessionId 会话 ID
   * @param maxMessages 最大消息数（默认 6）
   */
  async load(sessionId: string | null, maxMessages: number = 6): Promise<MessageItem[]> {
    if (!sessionId) {
      return [];
    }
    try {
      return await this.memoryLoader.load(sessionId, maxMessages);
    } catch {
      // 异常时返回空数组，不阻塞主流程
      return [];
    }
  }
}
