import { test, expect } from '@playwright/test';

test('chat page layout: left panel and conversation fit in viewport', async ({ page }) => {
  await page.goto(
    'http://127.0.0.1:5173/knowledge-bases/6de466ff-150e-40a1-9260-245f31090fa2/chat',
  );
  await page.waitForTimeout(2000);

  // Evaluate layout metrics
  const metrics = await page.evaluate(() => {
    const chat = document.querySelector('.chat');
    const leftPanel = document.querySelector('.left-panel');
    const sessionHistory = document.querySelector('.session-history');
    const sources = document.querySelector('.sources');
    const conversation = document.querySelector('.conversation');
    const content = document.querySelector('.content.chat-page');

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      contentHeight: content ? content.getBoundingClientRect().height : 0,
      chatHeight: chat ? chat.getBoundingClientRect().height : 0,
      chatOverflow: getComputedStyle(chat).overflow,
      leftPanelHeight: leftPanel ? leftPanel.getBoundingClientRect().height : 0,
      conversationHeight: conversation ? conversation.getBoundingClientRect().height : 0,
      sessionHistoryScrollHeight: sessionHistory ? sessionHistory.scrollHeight : 0,
      sessionHistoryOffsetHeight: sessionHistory ? sessionHistory.offsetHeight : 0,
      sourcesScrollHeight: sources ? sources.scrollHeight : 0,
      sourcesOffsetHeight: sources ? sources.offsetHeight : 0,
    };
  });

  console.log('Layout metrics:', JSON.stringify(metrics, null, 2));

  // The chat container should NOT overflow the content area
  expect(metrics.chatHeight).toBeLessThanOrEqual(metrics.contentHeight);

  // The left panel should fit within the chat container
  expect(metrics.leftPanelHeight).toBeLessThanOrEqual(metrics.chatHeight);

  // The conversation should fit within the chat container
  expect(metrics.conversationHeight).toBeLessThanOrEqual(metrics.chatHeight);

  // The chat should not have visible overflow
  expect(metrics.chatOverflow).not.toBe('visible');
});
