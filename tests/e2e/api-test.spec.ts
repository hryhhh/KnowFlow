import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:5173';

test.describe('API Test Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/knowledge-bases/test-kb/api-test`);
    // Wait for page to fully load
    await page.waitForLoadState('networkidle');
  });

  test('should render API test page with correct title', async ({ page }) => {
    await expect(page.getByText('API 调用测试')).toBeVisible();
  });

  test('should show sidebar navigation includes API Test', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'API 测试' })).toBeVisible();
  });

  test('should have test input fields visible', async ({ page }) => {
    // Find the inputs by placeholder text
    await expect(page.getByPlaceholder(/输入要测试的问题/)).toBeVisible();
    await expect(page.getByRole('button', { name: /发送测试/ })).toBeVisible();
  });

  test('should show service list section or empty state', async ({ page }) => {
    await expect(page.getByText('已发布的 API 服务')).toBeVisible();
    // Either shows services or empty message
    const hasContent = page.locator('.retrieval .params').first();
    await expect(hasContent).toBeVisible();
  });

  test('should have TopK and DenseWeight controls', async ({ page }) => {
    await expect(page.getByLabel('TopK')).toBeVisible();
    await expect(page.getByLabel('DenseWeight')).toBeVisible();
  });

  test('should disable send button when query is empty', async ({ page }) => {
    const sendBtn = page.getByRole('button', { name: /发送测试/ });
    await expect(sendBtn).toBeDisabled();
  });

  test('should show log output area', async ({ page }) => {
    await expect(page.getByText('调用日志')).toBeVisible();
  });

  test('should show copy button for services', async ({ page }) => {
    const copyBtn = page.getByRole('button', { name: /复制服务 ID/ }).first();
    await expect(copyBtn).toBeVisible();
  });
});
