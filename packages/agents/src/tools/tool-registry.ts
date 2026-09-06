import type { Tool } from './base-tool';

/**
 * 工具注册中心 — 管理所有可用工具
 *
 * 提供注册、查询、列表及 LLM tool calling 所需的定义列表。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 返回所有工具的 name + description + parameters，供 LLM tool calling 使用 */
  getAllDefinitions(): Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
  }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /** 返回所有已注册工具名列表 */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 判断工具是否已注册 */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}
