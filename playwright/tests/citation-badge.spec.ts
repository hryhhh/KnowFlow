import { test, expect } from '@playwright/test';

test.describe('Citation Badge Persistence Across Session Switches', () => {
  const KB_ID = '537fbfbf-360e-4b85-8f2d-2babb72def4f';

  test.beforeEach(async ({ page }) => {
    await page.goto(`http://127.0.0.1:5173/knowledge-bases/${KB_ID}/chat`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
  });

  test('citation badges should persist after switching sessions', async ({ page }) => {
    // 清空历史会话
    const clearBtn = page.locator('button:has-text("清空")').first();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click();
      await page.waitForTimeout(1000);
    }

    const input = page.locator('input').first();
    await expect(input).toBeVisible();

    // 发送第一条消息
    await input.fill('张戎浩学号多少');
    await input.press('Enter');

    // 等待答案出现
    await page.waitForFunction(
      () => {
        const msgs = document.querySelectorAll('.msg.assistant');
        const last = msgs[msgs.length - 1];
        return last && !last.textContent?.includes('思考') && !last.textContent?.includes('⏳');
      },
      { timeout: 30000 },
    );

    await page.waitForTimeout(2000);

    // 检查第一条消息有 citation badges
    let badges = await page.locator('.citation-badge').count();
    console.log(`After first message: ${badges} badges`);
    expect(badges).toBeGreaterThan(0);

    // 记录第一条消息的 badge 状态
    const firstBadgeHoverable = await page
      .locator('.citation-badge')
      .first()
      .evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    expect(firstBadgeHoverable).toBe(true);

    // 截图保存
    await page.screenshot({ path: '/tmp/citation-1.png', fullPage: true });

    // 切换到其他会话（如果有）
    const sessionItems = page.locator('.session-item');
    const sessionCount = await sessionItems.count();
    console.log(`Session count: ${sessionCount}`);

    if (sessionCount > 1) {
      // 点击第二个会话
      await sessionItems.nth(1).click();
      await page.waitForTimeout(1000);

      // 切回第一个会话
      await sessionItems.nth(0).click();
      await page.waitForTimeout(1000);

      // 检查 badges 是否仍然存在
      badges = await page.locator('.citation-badge').count();
      console.log(`After switching back: ${badges} badges`);
      expect(badges).toBeGreaterThan(0);

      // 检查第一个 badge 是否可以 hover
      await page.locator('.citation-badge').first().hover();
      await page.waitForTimeout(500);
      const tooltipVisible = await page.locator('.citation-tooltip').isVisible();
      console.log(`Tooltip visible after switch: ${tooltipVisible}`);
      expect(tooltipVisible).toBe(true);
    } else {
      // 如果只有一个会话，重新加载页面模拟"重新进入"
      await page.reload();
      await page.waitForTimeout(3000);

      // 检查 badges 是否仍然存在
      badges = await page.locator('.citation-badge').count();
      console.log(`After page reload: ${badges} badges`);
      expect(badges).toBeGreaterThan(0);

      // 检查第一个 badge 是否可以 hover
      await page.locator('.citation-badge').first().hover();
      await page.waitForTimeout(500);
      const tooltipVisible = await page.locator('.citation-tooltip').isVisible();
      console.log(`Tooltip visible after reload: ${tooltipVisible}`);
      expect(tooltipVisible).toBe(true);
    }

    await page.screenshot({ path: '/tmp/citation-2.png', fullPage: true });
  });

  test('citation badges should have correct source data on hover', async ({ page }) => {
    // 清空历史会话
    const clearBtn = page.locator('button:has-text("清空")').first();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click();
      await page.waitForTimeout(1000);
    }

    const input = page.locator('input').first();
    await expect(input).toBeVisible();

    // 发送消息
    await input.fill('张戎浩学号多少');
    await input.press('Enter');

    // 等待答案出现
    await page.waitForFunction(
      () => {
        const msgs = document.querySelectorAll('.msg.assistant');
        const last = msgs[msgs.length - 1];
        return last && !last.textContent?.includes('思考') && !last.textContent?.includes('⏳');
      },
      { timeout: 30000 },
    );

    await page.waitForTimeout(2000);

    // Hover 第一个 badge
    await page.locator('.citation-badge').first().hover();
    await page.waitForTimeout(500);

    // 检查 tooltip 内容
    const tooltipFile = await page.locator('.citation-tooltip-file').textContent();
    const tooltipScore = await page.locator('.citation-tooltip-score').textContent();
    const tooltipContent = await page.locator('.citation-tooltip-content').textContent();

    console.log(`Tooltip file: ${tooltipFile}`);
    console.log(`Tooltip score: ${tooltipScore}`);
    console.log(`Tooltip content length: ${tooltipContent?.length}`);

    expect(tooltipFile).toBeTruthy();
    expect(tooltipFile).not.toBe('');
    expect(tooltipScore).toBeTruthy();
    expect(tooltipContent).toBeTruthy();

    await page.screenshot({ path: '/tmp/citation-tooltip.png', fullPage: true });
  });

  test('citation badges should persist after page reload', async ({ page }) => {
    // 清空历史会话
    const clearBtn = page.locator('button:has-text("清空")').first();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click();
      await page.waitForTimeout(1000);
    }

    const input = page.locator('input').first();
    await expect(input).toBeVisible();

    // 发送消息
    await input.fill('张戎浩学号多少');
    await input.press('Enter');

    // 等待答案出现
    await page.waitForFunction(
      () => {
        const msgs = document.querySelectorAll('.msg.assistant');
        const last = msgs[msgs.length - 1];
        return last && !last.textContent?.includes('思考') && !last.textContent?.includes('⏳');
      },
      { timeout: 30000 },
    );

    await page.waitForTimeout(2000);

    // 检查初始状态
    let badges = await page.locator('.citation-badge').count();
    console.log(`Initial badges: ${badges}`);
    expect(badges).toBeGreaterThan(0);

    // 重新加载页面
    await page.reload();
    await page.waitForTimeout(3000);

    // 页面重载后 store 重置，需要点击会话恢复
    const sessionItems = page.locator('.session-item');
    const sessionCount = await sessionItems.count();
    console.log(`Sessions after reload: ${sessionCount}`);

    if (sessionCount > 0) {
      await sessionItems.first().click();
      await page.waitForTimeout(1000);
    }

    // 检查 badges 是否仍然存在
    badges = await page.locator('.citation-badge').count();
    console.log(`After reload: ${badges} badges`);
    expect(badges).toBeGreaterThan(0);

    // 检查第一个 badge 是否可以 hover
    await page.locator('.citation-badge').first().hover();
    await page.waitForTimeout(500);
    const tooltipVisible = await page.locator('.citation-tooltip').isVisible();
    console.log(`Tooltip visible after reload: ${tooltipVisible}`);
    expect(tooltipVisible).toBe(true);

    // 检查 tooltip 内容
    const tooltipFile = await page.locator('.citation-tooltip-file').textContent();
    const tooltipScore = await page.locator('.citation-tooltip-score').textContent();

    expect(tooltipFile).toBeTruthy();
    expect(tooltipScore).toBeTruthy();

    await page.screenshot({ path: '/tmp/citation-reload.png', fullPage: true });
  });

  test('citation badges should work after navigating back to session', async ({ page }) => {
    // 清空历史会话
    const clearBtn = page.locator('button:has-text("清空")').first();
    if ((await clearBtn.count()) > 0) {
      await clearBtn.click();
      await page.waitForTimeout(1000);
    }

    const input = page.locator('input').first();
    await expect(input).toBeVisible();

    // 发送第一条消息
    await input.fill('张戎浩学号多少');
    await input.press('Enter');

    // 等待答案出现
    await page.waitForFunction(
      () => {
        const msgs = document.querySelectorAll('.msg.assistant');
        const last = msgs[msgs.length - 1];
        return last && !last.textContent?.includes('思考') && !last.textContent?.includes('⏳');
      },
      { timeout: 30000 },
    );

    await page.waitForTimeout(2000);

    // 检查第一条消息有 citation badges
    let badges = await page.locator('.citation-badge').count();
    console.log(`After first message: ${badges} badges`);
    expect(badges).toBeGreaterThan(0);

    // 发送第二条消息（创建新会话）
    await input.fill('齐志乐学号多少');
    await input.press('Enter');

    // 等待答案出现
    await page.waitForFunction(
      () => {
        const msgs = document.querySelectorAll('.msg.assistant');
        const last = msgs[msgs.length - 1];
        return last && !last.textContent?.includes('思考') && !last.textContent?.includes('⏳');
      },
      { timeout: 30000 },
    );

    await page.waitForTimeout(2000);

    // 切换到第一个会话
    const sessionItems = page.locator('.session-item');
    await sessionItems.nth(0).click();
    await page.waitForTimeout(1000);

    // 检查第一个会话的 badges 仍然存在
    badges = await page.locator('.citation-badge').count();
    console.log(`After switching to first session: ${badges} badges`);
    expect(badges).toBeGreaterThan(0);

    // 检查第一个 badge 是否可以 hover
    await page.locator('.citation-badge').first().hover();
    await page.waitForTimeout(500);
    const tooltipVisible = await page.locator('.citation-tooltip').isVisible();
    console.log(`Tooltip visible: ${tooltipVisible}`);
    expect(tooltipVisible).toBe(true);

    // 切回第二个会话
    await sessionItems.nth(1).click();
    await page.waitForTimeout(1000);

    // 检查第二个会话
    badges = await page.locator('.citation-badge').count();
    console.log(`In second session: ${badges} badges`);
    expect(badges).toBeGreaterThan(0);

    await page.screenshot({ path: '/tmp/citation-multi-session.png', fullPage: true });
  });
});
