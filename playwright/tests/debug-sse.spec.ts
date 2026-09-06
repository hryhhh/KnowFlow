import { test, expect } from '@playwright/test';
test('debug SSE with error tracking', async ({ page }) => {
  await page.goto(
    'http://localhost:5173/knowledge-bases/fe329a69-e454-417e-8128-a61c8889420e/chat',
  );
  await page.waitForTimeout(1000);

  const errors: string[] = [];
  const logs: string[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('process') || text.includes('ChatPage') || text.includes('Store')) {
      logs.push(`[${msg.type()}] ${text.substring(0, 100)}`);
    }
    if (msg.type() === 'error') {
      errors.push(text);
    }
  });
  page.on('pageerror', (err) => errors.push(err.message));

  const input = page.locator('input[placeholder*="知识库"]').first();
  await input.fill('张戎浩学号多少');
  await input.press('Enter');

  // Wait and check
  await page.waitForTimeout(8000);

  // Check DOM
  const dom = await page.evaluate(() => ({
    indicators: document.querySelectorAll('.process-indicator').length,
    msgs: document.querySelectorAll('.msg.assistant').length,
    bodyText: document.body.innerText.substring(0, 300),
  }));

  console.log('DOM state:', dom);
  console.log('Errors:', errors);
  console.log('=== LOGS ===');
  logs.forEach((l) => console.log(l));

  await page.screenshot({ path: '/tmp/sse-errors.png', fullPage: true });
});
