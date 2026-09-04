import { test, expect } from '@playwright/test';
test('check for JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[CONSOLE ERROR] ${msg.text()}`);
  });
  
  await page.goto('http://127.0.0.1:5173/knowledge-bases/fe329a69-e454-417e-8128-a61c8889420e/chat');
  await page.waitForTimeout(5000);
  
  console.log('Errors:', errors);
  console.log('Body text:', document.body.innerText.substring(0, 200));
});
