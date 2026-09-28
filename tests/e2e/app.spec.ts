import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function setup(page: import('@playwright/test').Page, manual = true, count = '150') {
  await page.goto('/');
  await page.getByLabel('イベント名', { exact: true }).fill('秋祭り パエリア出店');
  await page.getByLabel('整理券発行枚数').fill(count);
  await page.getByRole('button', { name: '管理を開始する' }).click();
  await expect(page.getByRole('heading', { name: '秋祭り パエリア出店' })).toBeVisible();
  if (manual) await page.getByRole('button', { name: '番号を指定して配布', exact: true }).click();
}
test('sequential distribution needs no input, skips invalid tickets and stops when exhausted', async ({
  page,
}) => {
  await setup(page, false, '3');
  await expect(page.locator('#issue')).toHaveCount(0);
  await page.getByRole('button', { name: '整理券一覧', exact: true }).click();
  await page.getByRole('button', { name: '整理券 No.2 未配布', exact: true }).click();
  await page.getByRole('button', { name: '無効化', exact: true }).click();
  await page.getByRole('button', { name: '無効にする', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '配布', exact: true }).click();
  await page.getByRole('button', { name: 'No.001 を配布する', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No.1 を配布済みにしました');
  await page.getByRole('button', { name: 'No.003 を配布する', exact: true }).click();
  await expect(page.getByRole('button', { name: '配布完了', exact: true })).toBeDisabled();
  await expect(page.locator('.stat.waiting strong')).toHaveText('2枚');
  await page.reload();
  await expect(page.getByRole('button', { name: '配布完了', exact: true })).toBeDisabled();
});
test('normal operations, rejection, confirmations, filtering and persistence', async ({ page }) => {
  await setup(page);
  await page.locator('#issue').fill('43');
  await page.locator('#issue').press('Enter');
  await expect(page.getByRole('status')).toContainText('No.43 を配布済みにしました');
  await expect(page.locator('#issue')).toHaveValue('');
  await expect(page.locator('#issue')).toBeFocused();
  await page.locator('#issue').fill('43');
  await page.locator('#issue').press('Enter');
  await expect(page.getByRole('alert')).toContainText('すでに配布済み');
  await expect(page.locator('#serve')).toHaveCount(0);
  await page.getByRole('button', { name: '提供', exact: true }).click();
  await expect(page.locator('#issue')).toHaveCount(0);
  await page.locator('#serve').fill('80');
  await page.locator('#serve').press('Enter');
  await expect(page.getByRole('alert')).toContainText('まだ配布されていません');
  await page.locator('#serve').fill('151');
  await page.locator('#serve').press('Enter');
  await expect(page.getByRole('alert')).toContainText('存在しません');
  await page.locator('#serve').fill('43');
  await page.locator('#serve').press('Enter');
  await expect(page.getByRole('status')).toContainText('提供済みにしました');
  await page.locator('#serve').fill('43');
  await page.locator('#serve').press('Enter');
  await expect(page.getByRole('alert')).toContainText('すでに提供済み');
  await page.reload();
  await expect(page.locator('.stat.served strong')).toHaveText('1枚');
  await page.getByRole('button', { name: '整理券一覧', exact: true }).click();
  await page.getByLabel('整理券番号で検索').fill('43');
  await page.getByRole('button', { name: '整理券 No.43 提供済み', exact: true }).click();
  await page.getByRole('button', { name: '配布済みへ戻す', exact: true }).click();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.detail-status')).toContainText('提供済み');
  await page.getByRole('button', { name: '配布済みへ戻す', exact: true }).click();
  await page.getByRole('button', { name: '戻す', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.detail-status')).toContainText('配布済み');
  await page.getByRole('button', { name: '無効化', exact: true }).click();
  await page.getByRole('button', { name: '無効にする', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.detail-status')).toContainText('無効');
  await page.getByRole('button', { name: '無効化前の状態に戻す', exact: true }).click();
  await page.getByRole('button', { name: '戻す', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.detail-status')).toContainText('配布済み');
  await page.getByRole('button', { name: '未配布へ戻す', exact: true }).click();
  await page.getByRole('button', { name: '戻す', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.detail-status')).toContainText('未配布');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '操作履歴', exact: true }).click();
  await expect(page.locator('.log')).toHaveCount(6);
  await page.getByRole('button', { name: '新しいイベントを開始', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存して新しく開始' })).toBeDisabled();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.getByRole('heading', { name: '秋祭り パエリア出店' })).toBeVisible();
  await page.getByRole('button', { name: '新しいイベントを開始', exact: true }).click();
  await page.locator('#reset-name').fill('秋祭り パエリア出店');
  await page.getByRole('button', { name: '保存して新しく開始' }).click();
  await expect(page.getByRole('button', { name: '管理を開始する' })).toBeVisible();
});
test('two tabs cannot distribute the same ticket twice', async ({ page, context }) => {
  await setup(page);
  const second = await context.newPage();
  await second.goto('/');
  await second.getByRole('button', { name: '番号を指定して配布', exact: true }).click();
  await expect(second.locator('#issue')).toBeVisible();
  await page.locator('#issue').fill('1');
  await second.locator('#issue').fill('1');
  await Promise.all([
    page.locator('#issue').press('Enter'),
    second.locator('#issue').press('Enter'),
  ]);
  await page.reload();
  await page.getByRole('button', { name: '操作履歴', exact: true }).click();
  await expect(page.locator('.log')).toHaveCount(1);
});
test('persistent browser profile survives full browser restart', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'paella-e2e-'));
  let context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge',
    headless: true,
    baseURL: 'http://127.0.0.1:5173',
  });
  try {
    const page = await context.newPage();
    await setup(page);
    await page.locator('#issue').fill('31');
    await page.locator('#issue').press('Enter');
    await expect(page.getByRole('status')).toContainText('配布済みにしました');
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge',
      headless: true,
      baseURL: 'http://127.0.0.1:5173',
    });
    const restored = await context.newPage();
    await restored.goto('/');
    await expect(restored.locator('.stat.waiting strong')).toHaveText('1枚');
    await restored.getByRole('button', { name: '操作履歴', exact: true }).click();
    await expect(restored.locator('.log')).toContainText('No.031');
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
test('desktop and mobile controls fit viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await setup(page);
  await page.getByRole('button', { name: '通知を閉じる' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

test('saved events survive reload and can be reopened while saving current event', async ({
  page,
}) => {
  await setup(page, false, '3');
  await page.getByRole('button', { name: 'No.001 を配布する', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('配布済みにしました');
  await page.getByRole('button', { name: '新しいイベントを開始', exact: true }).click();
  await page.locator('#reset-name').fill('秋祭り パエリア出店');
  await page.getByRole('button', { name: '保存して新しく開始' }).click();
  await page.reload();
  await page.getByLabel('イベント名', { exact: true }).fill('翌日の出店');
  await page.getByRole('button', { name: '管理を開始する' }).click();
  await page.getByRole('button', { name: '保存したイベント', exact: true }).click();
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.getByRole('heading', { name: '翌日の出店', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await page.getByRole('button', { name: 'このイベントを開く', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '秋祭り パエリア出店', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.stat.waiting strong')).toHaveText('1枚');
  await page.getByRole('button', { name: '操作履歴', exact: true }).click();
  await expect(page.locator('.log')).toHaveCount(1);
  await page.getByRole('button', { name: '保存したイベント', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('翌日の出店');
  await page.getByRole('button', { name: '開く', exact: true }).click();
  await page.getByRole('button', { name: 'このイベントを開く', exact: true }).click();
  await expect(page.getByRole('heading', { name: '翌日の出店', exact: true })).toBeVisible();
});
