import { test, expect } from '@playwright/test';

const FRONTEND_URL = 'http://localhost:5173';

test.describe('Frontend Retrieval Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${FRONTEND_URL}/knowledge-bases/test-kb/retrieval`);
  });

  test('should render retrieval page with search input', async ({ page }) => {
    await expect(page.getByPlaceholder('输入查询词，回车检索')).toBeVisible();
    await expect(page.getByRole('button', { name: /检索/ })).toBeVisible();
  });

  test('should show empty state when no query', async ({ page }) => {
    await expect(page.getByText('输入查询词后查看命中结果')).toBeVisible();
  });

  test('should send search request when clicking search button', async ({ page }) => {
    // Mock the API call
    await page.route('**/retrieval/search', async (route) => {
      const response = await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            results: [
              {
                chunkId: 'test#0.9',
                content: 'PostgreSQL向量检索原理详解',
                sourceFile: 'test.txt',
                score: 0.9,
              },
            ],
            searchHistory: [],
          },
        }),
      });
    });

    await page.getByPlaceholder('输入查询词，回车检索').fill('PostgreSQL向量检索');
    await page.getByRole('button', { name: /检索/ }).click();

    // Should show results
    await expect(page.getByText('PostgreSQL向量检索原理详解')).toBeVisible();
    await expect(page.getByText('相似度 0.9000')).toBeVisible();
  });

  test('should update search params when adjusting inputs', async ({ page }) => {
    const topKInput = page.locator('input[type="number"]').first();
    await expect(topKInput).toBeVisible();
    await topKInput.fill('5');
    await expect(topKInput).toHaveValue('5');
  });

  test('should toggle reranker button', async ({ page }) => {
    const rerankerToggle = page.locator('.toggle').first();
    await rerankerToggle.click();
    await expect(rerankerToggle).toHaveClass(/on/);
  });
});
