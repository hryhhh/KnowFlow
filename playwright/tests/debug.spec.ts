import { test, expect } from '@playwright/test';
test('debug 康美玥 final', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/knowledge-bases/fe329a69-e454-417e-8128-a61c8889420e/chat');
  await page.waitForTimeout(3000);
  
  // Clear all sessions first
  const clearBtn = page.locator('button:has-text("清空")').first();
  if (await clearBtn.count() > 0) {
    await clearBtn.click();
    await page.waitForTimeout(1000);
  }
  
  const input = page.locator('input').first();
  await input.fill('康美玥综测多少');
  await input.press('Enter');
  
  await page.waitForTimeout(20000);
  
  const msgs = await page.locator('.msg.assistant').all();
  console.log(`Total assistant messages: ${msgs.length}`);
  for (let i = 0; i < msgs.length; i++) {
    const text = await msgs[i].textContent();
    console.log(`Msg ${i}: ${text?.substring(0, 100)}`);
  }
  
  const indicators = await page.locator('.process-indicator').count();
  console.log(`Indicators: ${indicators}`);
  
  const badges = await page.locator('.citation-badge').count();
  console.log(`Badges: ${badges}`);
});
