const { test, expect } = require('@playwright/test');

test.describe('Pulse Analytics Interactive Dashboard', () => {

  test('should render header, KPI cards, and initial dashboard elements', async ({ page }) => {
    await page.goto('/');

    // Check title & branding
    await expect(page.locator('h1')).toContainText('Pulse Analytics');
    await expect(page.locator('#live-status-pill')).toBeVisible();

    // Check 4 KPI tiles
    await expect(page.locator('#kpi-val-revenue')).toBeVisible();
    await expect(page.locator('#kpi-val-orders')).toBeVisible();
    await expect(page.locator('#kpi-val-conversion')).toBeVisible();
    await expect(page.locator('#kpi-val-aov')).toBeVisible();

    // Check sparklines rendered inside KPI tiles
    const revenueSparkline = page.locator('#sparkline-revenue polyline');
    await expect(revenueSparkline).toBeVisible();

    // Check SVG Charts
    const trendSvg = page.locator('#trend-svg');
    await expect(trendSvg).toBeVisible();

    const channelSvg = page.locator('#channel-svg');
    await expect(channelSvg).toBeVisible();

    // Check that channel bars exist
    const bars = page.locator('#channel-svg rect');
    await expect(await bars.count()).toBeGreaterThanOrEqual(4);

    // Save initial screenshot
    await page.screenshot({ path: 'test-screenshot-initial.png', fullPage: true });
  });

  test('should support interactive hover & crosshair on trend chart', async ({ page }) => {
    await page.goto('/');

    const trendSvg = page.locator('#trend-svg');
    const box = await trendSvg.boundingBox();
    expect(box).not.toBeNull();

    // Hover near the center of the chart
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);

    // Check that tooltip becomes visible
    const tooltip = page.locator('#trend-tooltip');
    await expect(tooltip).toHaveClass(/visible/);
    await expect(tooltip.locator('.tooltip-title')).toBeVisible();
    await expect(tooltip.locator('.tooltip-row')).toHaveCount(2); // Revenue + Orders
  });

  test('should support hover tooltip on channel bar chart', async ({ page }) => {
    await page.goto('/');

    const firstBar = page.locator('#channel-svg rect').first();
    await firstBar.hover();

    const tooltip = page.locator('#channel-tooltip');
    await expect(tooltip).toHaveClass(/visible/);
    await expect(tooltip.locator('.tooltip-title')).toContainText('Direct');
    await expect(tooltip).toContainText('Revenue:');
    await expect(tooltip).toContainText('Contribution:');
  });

  test('should update data when switching time ranges', async ({ page }) => {
    await page.goto('/');

    const initialRev = await page.locator('#kpi-val-revenue').innerText();

    // Click 'Today' filter chip
    await page.click('button[data-range="today"]');
    await expect(page.locator('button[data-range="today"]')).toHaveClass(/active/);

    // Revenue should update
    const todayRev = await page.locator('#kpi-val-revenue').innerText();
    expect(todayRev).not.toBe(initialRev);

    // Period label should update to 'vs yesterday'
    await expect(page.locator('#kpi-period-revenue')).toContainText('vs yesterday');

    // Click 'Last 7 Days'
    await page.click('button[data-range="7d"]');
    await expect(page.locator('button[data-range="7d"]')).toHaveClass(/active/);
  });

  test('should filter data when selecting channel dropdown', async ({ page }) => {
    await page.goto('/');

    const initialRev = await page.locator('#kpi-val-revenue').innerText();

    // Select 'Direct' channel
    await page.selectOption('#channel-select', 'direct');

    const filteredRev = await page.locator('#kpi-val-revenue').innerText();
    expect(filteredRev).not.toBe(initialRev);
  });

  test('should toggle between chart and accessible table view', async ({ page }) => {
    await page.goto('/');

    const trendSvg = page.locator('#trend-svg');
    const trendTable = page.locator('#trend-table-container');
    const toggleBtn = page.locator('#btn-toggle-trend-view');

    // Initially chart is visible, table is hidden
    await expect(trendSvg).toBeVisible();
    await expect(trendTable).toBeHidden();

    // Click to toggle to table
    await toggleBtn.click();
    await expect(trendSvg).toBeHidden();
    await expect(trendTable).toBeVisible();
    await expect(toggleBtn).toContainText('Chart View');

    // Table rows should be rendered
    const rows = trendTable.locator('tbody tr');
    await expect(await rows.count()).toBeGreaterThan(0);

    // Click back to chart
    await toggleBtn.click();
    await expect(trendSvg).toBeVisible();
    await expect(trendTable).toBeHidden();
    await expect(toggleBtn).toContainText('Table View');
  });

  test('should toggle light and dark mode', async ({ page }) => {
    await page.goto('/');

    const root = page.locator('html');
    const themeBtn = page.locator('#btn-theme-toggle');

    // Toggle theme
    const currentTheme = await root.getAttribute('data-theme');
    await themeBtn.click();

    const newTheme = await root.getAttribute('data-theme');
    expect(newTheme).not.toBe(currentTheme);

    // Screenshot in dark mode if switched to dark
    if (newTheme === 'dark') {
      await page.screenshot({ path: 'test-screenshot-dark.png', fullPage: true });
    }
  });

  test('should simulate live transaction and trigger toast notification', async ({ page }) => {
    await page.goto('/');

    const initialRowCount = await page.locator('#orders-tbody tr').count();

    // Click simulate order button
    await page.click('#btn-simulate-order');

    // Toast notification should appear
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('New live order:');

    // Table should now have +1 row
    const updatedRowCount = await page.locator('#orders-tbody tr').count();
    expect(updatedRowCount).toBe(initialRowCount + 1);
  });

  test('should filter and search recent transactions table', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.locator('#order-search');
    await searchInput.fill('Sarah Jenkins');

    const rows = page.locator('#orders-tbody tr');
    // If Sarah Jenkins was in the mock transactions, only her row should appear
    const count = await rows.count();
    if (count > 0) {
      await expect(rows.first()).toContainText('Sarah Jenkins');
    }

    // Clear search
    await searchInput.fill('');
    const fullCount = await rows.count();
    expect(fullCount).toBeGreaterThanOrEqual(10);
  });
});
