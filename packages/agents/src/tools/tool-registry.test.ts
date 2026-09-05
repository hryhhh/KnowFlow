import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from './tool-registry';
import type { Tool } from './base-tool';

function makeTool(name: string): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => ({ toolCallId: '', content: 'ok', isError: false }),
  };
}

describe('ToolRegistry', () => {
  it('register 后 get 可取出', () => {
    const reg = new ToolRegistry();
    const tool = makeTool('test_tool');
    reg.register(tool);
    expect(reg.get('test_tool')).toBe(tool);
  });

  it('get 不存在返回 undefined', () => {
    const reg = new ToolRegistry();
    expect(reg.get('no_such_tool')).toBeUndefined();
  });

  it('has 正确反映注册状态', () => {
    const reg = new ToolRegistry();
    expect(reg.has('foo')).toBe(false);
    reg.register(makeTool('foo'));
    expect(reg.has('foo')).toBe(true);
  });

  it('list 返回所有工具名', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a'));
    reg.register(makeTool('b'));
    expect(reg.list()).toEqual(['a', 'b']);
  });

  it('getAllDefinitions 格式正确', () => {
    const reg = new ToolRegistry();
    const tool = makeTool('my_tool');
    reg.register(tool);
    const defs = reg.getAllDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: 'my_tool',
      description: 'Tool my_tool',
      parameters: { type: 'object', properties: {}, required: [] },
    });
  });

  it('多次 register 同名工具保留最后一个', () => {
    const reg = new ToolRegistry();
    const t1 = makeTool('dup');
    const t2 = makeTool('dup');
    reg.register(t1);
    reg.register(t2);
    // Map 会用同一个 key，后面的覆盖前面的，但 list() 仍然只返回一个
    expect(reg.list()).toEqual(['dup']);
    expect(reg.get('dup')).toBe(t2);
  });

  it('getAllDefinitions 为空时返回空数组', () => {
    const reg = new ToolRegistry();
    expect(reg.getAllDefinitions()).toEqual([]);
  });
});
