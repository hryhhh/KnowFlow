import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:5173';

test.describe('Chat Session - No duplicate blank sessions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/knowledge-bases/test-kb/chat`);
  });

  test('should not create duplicate blank sessions', async ({ page }) => {
    // 拦截所有 API 请求并追踪
    const createRequests: string[] = [];
    
    await page.route('**/api/chat/sessions*', async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: [] }),
        });
      } else if (method === 'POST') {
        createRequests.push(url);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              id: `session-${Date.now()}`,
              kbId: 'test-kb',
              title: '新会话',
              createdAt: new Date().toISOString(),
            },
          }),
        });
      } else if (method === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: null }),
        });
      } else if (method === 'DELETE') {
        await route.fulfill({ status: 204 });
      }
    });

    await page.route('**/api/chat/sessions/*/messages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [] }),
      });
    });

    const createBtn = page.getByRole('button', { name: /新建/ });
    
    // 点击 3 次
    await createBtn.click();
    await page.waitForTimeout(500);
    await createBtn.click();
    await page.waitForTimeout(500);
    await createBtn.click();
    await page.waitForTimeout(500);

    // 应该只有 1 次 POST 请求
    expect(createRequests.length).toBeLessThanOrEqual(1);
  });

  test('blank sessions should not appear in history list', async ({ page }) => {
    await page.route('**/api/chat/sessions*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: [] }),
        });
      } else if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              id: 'blank-session',
              kbId: 'test-kb',
              title: '新会话',
              createdAt: new Date().toISOString(),
            },
          }),
        });
      } else if (route.request().method() === 'PATCH') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: null }),
        });
      }
    });

    await page.route('**/api/chat/sessions/*/messages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [] }),
      });
    });

    const createBtn = page.getByRole('button', { name: /新建/ });
    
    // 创建空白会话
    await createBtn.click();
    await page.waitForTimeout(500);

    // 空白会话不应该出现在历史列表中（visibleSessions 过滤掉了 messageCount=0 的）
    const sessionItems = page.locator('.session-item');
    await expect(sessionItems).toHaveCount(0);

    // 再次点击应该不创建新会话
    await createBtn.click();
    await page.waitForTimeout(500);

    // 仍然应该是 0 个
    await expect(sessionItems).toHaveCount(0);
  });
});
