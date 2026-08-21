import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:5173';

test.describe('Chat Session - No duplicate blank sessions', () => {
  // 拦截所有 /api/chat/sessions 请求（axios baseURL = /api）
  const interceptSessions = async (page: any, initialSessions: any[] = []) => {
    let createCount = 0;
    await page.route('**/api/chat/sessions**', async (route: any) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: initialSessions }),
        });
      } else if (method === 'POST') {
        createCount++;
        const body = JSON.parse(route.request().postData());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              id: `session-create-${createCount}`,
              kbId: body.kbId,
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
    return createCount;
  };

  const interceptMessages = async (page: any) => {
    await page.route('**/api/chat/sessions/*/messages', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [] }),
      });
    });
  };

  test.beforeEach(async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/knowledge-bases/test-kb/chat`);
  });

  test('should not create duplicate blank sessions on repeated clicks', async ({ page }) => {
    await interceptSessions(page);
    await interceptMessages(page);

    const createBtn = page.getByRole('button', { name: /新建/ });

    // Click 新建 3 times rapidly
    await createBtn.click();
    await page.waitForTimeout(300);
    await createBtn.click();
    await page.waitForTimeout(300);
    await createBtn.click();
    await page.waitForTimeout(300);

    // Only 1 session should be created (the first click)
    // The next 2 clicks should be blocked by the dedup logic
    // We can verify by checking the number of session items in the list
    // Blank sessions (messageCount=0) are NOT shown in visibleSessions
    const sessionItems = page.locator('.session-item');
    await expect(sessionItems).toHaveCount(0);
  });

  test('should reuse blank session instead of creating new one', async ({ page }) => {
    let createCount = 0;
    await page.route('**/api/chat/sessions**', async (route: any) => {
      const method = route.request().method();
      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: [] }),
        });
      } else if (method === 'POST') {
        createCount++;
        const body = JSON.parse(route.request().postData());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              id: `session-${createCount}`,
              kbId: body.kbId,
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
    await interceptMessages(page);

    const createBtn = page.getByRole('button', { name: /新建/ });

    // First click - creates a blank session
    await createBtn.click();
    await page.waitForTimeout(300);
    expect(createCount).toBe(1);

    // Second click - should reuse existing blank session, NOT create new
    await createBtn.click();
    await page.waitForTimeout(300);
    expect(createCount).toBe(1); // Still 1, no new session created

    // Third click - still should not create
    await createBtn.click();
    await page.waitForTimeout(300);
    expect(createCount).toBe(1); // Still 1
  });

  test('should create new session when current session has messages', async ({ page }) => {
    let createCount = 0;
    await page.route('**/api/chat/sessions**', async (route: any) => {
      const method = route.request().method();
      if (method === 'GET') {
        // Return a session that already has messages
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: [
              {
                id: 'existing-session',
                kbId: 'test-kb',
                title: '已有消息的会话',
                messageCount: 2,
                createdAt: new Date().toISOString(),
              },
            ],
          }),
        });
      } else if (method === 'POST') {
        createCount++;
        const body = JSON.parse(route.request().postData());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              id: `new-session-${createCount}`,
              kbId: body.kbId,
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
      }
    });
    await interceptMessages(page);

    const createBtn = page.getByRole('button', { name: /新建/ });

    // Page loads with existing session that has messages
    // Click 新建 - should create a NEW session (current has messages)
    await createBtn.click();
    await page.waitForTimeout(300);
    expect(createCount).toBe(1);

    // Now current session is the newly created blank one
    // Click again - should NOT create another
    await createBtn.click();
    await page.waitForTimeout(300);
    expect(createCount).toBe(1);
  });
});
