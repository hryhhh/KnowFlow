import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:5173';

test.describe('Chat Session - No duplicate blank sessions', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/knowledge-bases/test-kb/chat`);
  });

  test('should not create duplicate blank sessions when clicking 新建 repeatedly', async ({
    page,
    context,
  }) => {
    // Mock API calls to avoid real database operations
    await page.route('**/chat/sessions', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        // Return empty session list initially
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: [] }),
        });
      } else if (method === 'POST') {
        // Return a new session on creation
        const body = JSON.parse(route.request().postData());
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              id: 'test-session-1',
              kbId: body.kbId,
              title: '新会话',
              createdAt: new Date().toISOString(),
            },
          }),
        });
      } else if (method === 'PATCH') {
        // Mock update title
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: null }),
        });
      } else if (method === 'DELETE') {
        await route.fulfill({ status: 204 });
      }
    });

    // Mock messages endpoint
    await page.route('**/chat/sessions/*/messages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [] }),
      });
    });

    // Click 新建 button to create first blank session
    const createBtn = page.getByRole('button', { name: /新建/ });
    await createBtn.click();

    // Wait a moment for state to settle
    await page.waitForTimeout(300);

    // Get initial session count via store state or DOM
    // The blank session is NOT in visibleSessions, so list should be empty
    const sessionList = page.locator('.session-item');
    await expect(sessionList).toHaveCount(0);

    // Click 新建 again - should NOT create another session
    await createBtn.click();
    await page.waitForTimeout(300);

    // Should still be 0 visible sessions (no new session created)
    await expect(sessionList).toHaveCount(0);

    // Click a third time - still should not create
    await createBtn.click();
    await page.waitForTimeout(300);
    await expect(sessionList).toHaveCount(0);
  });

  test('should not create new session when current session is blank', async ({ page }) => {
    // Track how many POST /chat/sessions calls are made
    let createCount = 0;

    await page.route('**/chat/sessions', async (route) => {
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

    await page.route('**/chat/sessions/*/messages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [] }),
      });
    });

    // Click 新建 once
    await page.getByRole('button', { name: /新建/ }).click();
    await page.waitForTimeout(200);
    expect(createCount).toBe(1);

    // Click 新建 again - should NOT create another
    await page.getByRole('button', { name: /新建/ }).click();
    await page.waitForTimeout(200);
    expect(createCount).toBe(1); // Still 1, no new session created

    // Click a third time
    await page.getByRole('button', { name: /新建/ }).click();
    await page.waitForTimeout(200);
    expect(createCount).toBe(1); // Still 1
  });

  test('should create new session when current session has messages', async ({ page }) => {
    let createCount = 0;
    let sessionIndex = 0;

    await page.route('**/chat/sessions', async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        // Return sessions with the current one having messages
        const sessions = [
          {
            id: 'session-1',
            kbId: 'test-kb',
            title: '有消息的会话',
            messageCount: 2,
            createdAt: new Date().toISOString(),
          },
        ];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ code: 0, data: sessions }),
        });
      } else if (method === 'POST') {
        createCount++;
        sessionIndex++;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 0,
            data: {
              id: `session-new-${sessionIndex}`,
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
      }
    });

    await page.route('**/chat/sessions/*/messages', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [] }),
      });
    });

    // Page loads with an existing session that has messages
    // Click 新建 - should create a NEW session since current has messages
    await page.getByRole('button', { name: /新建/ }).click();
    await page.waitForTimeout(200);
    expect(createCount).toBe(1);

    // Click 新建 again - should create ANOTHER session (previous one now has messageCount=0 but is current)
    // Wait, the previous one was just created blank, so this should NOT create
    await page.getByRole('button', { name: /新建/ }).click();
    await page.waitForTimeout(200);
    // Should still be 1 because current session is now blank
    expect(createCount).toBe(1);
  });
});
