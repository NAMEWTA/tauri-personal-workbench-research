import { expect, test } from '@playwright/test'

test('V2 统一任务、自定义档案与响应式主流程', async ({ page }, testInfo) => {
  const unique = `${testInfo.project.name}-${Date.now()}`
  const taskTitle = `统一任务-${unique}`
  const archiveTitle = `个人档案-${unique}`
  const identityNumber = `3101011990${String(Date.now()).slice(-8)}`
  const typeName = `项目-${unique}`

  await page.goto('/today')
  await expect(page.getByRole('heading', { name: '今日' })).toBeVisible()
  await expect(page.getByText('E2E 临时工作区').first()).toBeVisible()

  await page.getByLabel('任务标题').fill(taskTitle)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v2/tasks') && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: '添加' }).click(),
  ])
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible()
  await page.getByLabel('安排到日历').check()
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: '关闭任务详情' }).click()

  await page.locator('.sidebar').getByRole('link', { name: '任务', exact: true }).click()
  const views = page.getByLabel('任务视图').getByRole('button')
  await expect(views).toHaveText(['今天', '明天', '全部', '已完成'])
  await expect(page.getByText(taskTitle)).toBeVisible()
  await page.getByText(taskTitle).click()
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible()
  await page.getByRole('button', { name: '关闭任务详情' }).click()

  await page.locator('.sidebar').getByRole('link', { name: '日历', exact: true }).click()
  await expect(page.getByText(taskTitle).first()).toBeVisible()
  await page.getByText(taskTitle).first().click()
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible()
  await page.getByRole('button', { name: '关闭任务详情' }).click()

  await page.locator('.sidebar').getByRole('link', { name: '档案', exact: true }).click()
  await page.getByRole('link', { name: '档案类型' }).click()
  await page.getByLabel('新类型名称').fill(typeName)
  await page.getByRole('button', { name: '创建' }).click()
  await expect(page.getByRole('button', { name: new RegExp(typeName) })).toBeVisible()
  await page.getByLabel('属性名称').fill('阶段')
  await page.getByLabel('属性键').fill('stage')
  await page.getByLabel('字段类型').selectOption('select')
  await page.getByLabel('选项（逗号分隔）').fill('规划,执行')
  await page.getByRole('button', { name: '添加属性' }).click()
  await expect(page.getByText('stage · select')).toBeVisible()

  await page.locator('.back-link').click()
  await page.getByRole('button', { name: '新建档案' }).click()
  await page.locator('.dialog').getByLabel('档案类型').selectOption('person')
  await page.getByLabel('名称').fill(archiveTitle)
  await page.getByLabel('摘要').fill('由 Playwright 通过真实 V2 API 创建')
  await page.getByLabel('证件号码').fill(identityNumber)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText(archiveTitle)).toBeVisible()

  await page.keyboard.press('Control+K')
  await page.getByLabel('搜索关键词').fill(identityNumber)
  await expect(page.getByRole('button', { name: new RegExp(archiveTitle) })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(archiveTitle) }).click()
  await expect(page.getByRole('heading', { name: '活动' })).toBeVisible()
  await expect(page.getByText('创建档案')).toBeVisible()

  await page.locator('.sidebar').getByRole('link', { name: '备份', exact: true }).click()
  await page.getByRole('button', { name: '立即备份' }).click()
  await expect(page.getByText('备份成功').first()).toBeVisible({ timeout: 20_000 })

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('v2-workbench.png'), fullPage: true })
})
