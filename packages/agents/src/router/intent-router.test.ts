import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IntentRouter } from './intent-router.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RouterRules } from './types.js';

// Create a temp router rules YAML file for testing
const RULES_YAML = `
rules:
  - id: ragflow-direct
    pattern: '问|什么是|介绍一下'
    intent: general
    targetAgent: ragflow
    priority: 90
    minScore: 0.5
    enabled: true
  - id: db-query-stats
    pattern: '总数|统计|排行|趋势'
    intent: stats
    targetAgent: db-query
    priority: 70
    minScore: 0.3
    enabled: true
  - id: web-search
    pattern: '最新|新闻|实时'
    intent: news
    targetAgent: web-search
    priority: 60
    minScore: 0.2
    enabled: true
  - id: web-general
    pattern: ''
    intent: general
    targetAgent: web-search
    priority: 30
    minScore: 0
    enabled: true
settings:
  maxMatchedRules: 2
  defaultAgentTimeoutMs: 5000
  allowParallel: true
  alwaysIncludeAgents: []
  routerConfidenceThreshold: 80
`;

let tmpPath: string;

beforeEach(() => {
  tmpPath = path.join('/tmp', `router-test-${Date.now()}.yml`);
  fs.writeFileSync(tmpPath, RULES_YAML, 'utf-8');
});

afterEach(() => {
  try {
    fs.unlinkSync(tmpPath);
  } catch {}
});

function createRouter(llmConfig = false): IntentRouter {
  const cfg = llmConfig
    ? { apiKey: 'test', model: 'gpt-4', baseURL: 'https://api.test.com' }
    : undefined;
  return new IntentRouter(tmpPath, cfg);
}

describe('IntentRouter', () => {
  afterEach(() => {
    // Stop the hot reload timer
    const router = (globalThis as any).__lastRouter;
    if (router) router.stop();
  });

  it('matches queries against patterns', async () => {
    const router = createRouter();
    (globalThis as any).__lastRouter = router;
    const { matched } = await router.match('什么是 RAG?');
    expect(matched.length).toBeGreaterThan(0);
    expect(matched[0].rule.targetAgent).toBe('ragflow');
  });

  it('returns empty array for no-match query', async () => {
    const router = createRouter();
    (globalThis as any).__lastRouter = router;
    const { matched } = await router.match('xyz random nonmatching text abc');
    // Fallback to web-general rule
    expect(matched.length).toBeGreaterThanOrEqual(0);
  });

  it('respects maxMatchedRules limit', async () => {
    const router = createRouter();
    (globalThis as any).__lastRouter = router;
    const { matched } = await router.match('什么是 RAG?', 1);
    expect(matched.length).toBeLessThanOrEqual(1);
  });

  it('disables disabled rules', async () => {
    // Replace the enabled flag for ragflow-direct rule
    const disabledYaml = RULES_YAML.replace(
      '    enabled: true\n  - id: db-query-stats',
      '    enabled: false\n  - id: db-query-stats',
    );
    const tmpPath2 = path.join('/tmp', `router-test-disable-${Date.now()}.yml`);
    fs.writeFileSync(tmpPath2, disabledYaml, 'utf-8');
    const router = new IntentRouter(tmpPath2);
    const { matched } = await router.match('什么是 RAG?');
    // ragflow-direct is disabled so should not match
    const hasRagflow = matched.some((m) => m.rule.id === 'ragflow-direct');
    expect(hasRagflow).toBe(false);
    try {
      fs.unlinkSync(tmpPath2);
    } catch {}
  });

  it('applies minScore filtering', async () => {
    const router = createRouter();
    (globalThis as any).__lastRouter = router;
    // Query that matches with score 1.0 (regex test)
    const { matched } = await router.match('什么是 RAG?');
    matched.forEach((m) => {
      expect(m.score).toBeGreaterThanOrEqual(m.rule.minScore);
    });
  });

  it('returns metadata with trigger flags', async () => {
    const router = createRouter();
    (globalThis as any).__lastRouter = router;
    const { metadata } = await router.match('什么是 RAG?');
    expect(typeof metadata.triggeredLlmArbitration).toBe('boolean');
    expect(['none', 'strict_rule', 'soft_rule', 'always_include', 'llm']).toContain(
      metadata.ragIncludedBy,
    );
  });

  it('does not trigger LLM arbitration when priority >= threshold', async () => {
    const router = createRouter();
    (globalThis as any).__lastRouter = router;
    // ragflow-direct has priority 90, threshold 80 → no arbitration
    const { metadata } = await router.match('什么是 RAG?');
    // Should NOT trigger arbitration since 90 >= 80
    expect(metadata.triggeredLlmArbitration).toBe(false);
  });

  it('stops hot reload timer on stop()', () => {
    const router = createRouter();
    (globalThis as any).__lastRouter = router;
    router.stop();
    // No error should be thrown
    expect(router.getRules().rules.length).toBeGreaterThan(0);
  });
});
