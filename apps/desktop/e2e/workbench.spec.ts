import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

test('V2 统一任务、自定义档案与响应式主流程', async ({ page, request }, testInfo) => {
  const apiHosts = new Set<string>()
  const httpHosts = new Set<string>()
  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url())
    if (url.protocol === 'http:' || url.protocol === 'https:') httpHosts.add(url.hostname)
    if (url.pathname.startsWith('/api/')) apiHosts.add(url.hostname)
  })
  const unique = `${testInfo.project.name}-${Date.now()}`
  const taskTitle = `统一任务-${unique}`
  const archiveTitle = `项目记录-${unique}`
  const relatedArchiveTitle = `关联档案-${unique}`
  const contactEmail = `e2e-${Date.now()}@example.com`
  const collectionName = `项目-${unique}`
  const server = JSON.parse(readFileSync(resolve('test-results/.e2e-server.json'), 'utf8')) as {
    backendUrl: string
    token: string
    workspace: string
  }
  const apiHeaders = {
    Authorization: `Bearer ${server.token}`,
    Origin: 'http://127.0.0.1:1420',
  }
  const backupDirectory = join(server.workspace, 'configured-backups')
  const configured = await request.put(`${server.backendUrl}/api/v3/backup-settings`, {
    headers: apiHeaders,
    data: { backupDirectory },
  })
  expect(configured.ok()).toBeTruthy()
  const resetPreferences = await request.patch(`${server.backendUrl}/api/v3/preferences`, {
    headers: apiHeaders,
    data: {
      theme: 'system',
      sidebarCollapsed: false,
      inspectorWidth: 344,
      recentSearches: [],
    },
  })
  expect(resetPreferences.ok()).toBeTruthy()

  await page.addInitScript(() => {
    if (sessionStorage.getItem('v2-legacy-preferences-seeded')) return
    localStorage.setItem(
      'workbench-layout',
      JSON.stringify({ state: { theme: 'dark', sidebarCollapsed: true, inspectorWidth: 400 } }),
    )
    localStorage.setItem(
      'workbench-recent-search-results',
      JSON.stringify([{ id: 'legacy-task', type: 'task', title: '旧任务', subtitle: '任务' }]),
    )
    sessionStorage.setItem('v2-legacy-preferences-seeded', '1')
  })
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: '今日' })).toBeVisible()
  await expect(page.getByText('E2E 临时工作区').first()).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('workbench-layout'))).toBeNull()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('workbench-recent-search-results')))
    .toBeNull()
  const migratedPreferencesResponse = await request.get(`${server.backendUrl}/api/v3/preferences`, {
    headers: apiHeaders,
  })
  expect(migratedPreferencesResponse.ok()).toBeTruthy()
  const migratedPreferences = (await migratedPreferencesResponse.json()) as {
    theme: string
    sidebarCollapsed: boolean
    inspectorWidth: number
    recentSearches: Array<{ id: string }>
  }
  expect(migratedPreferences).toMatchObject({
    theme: 'dark',
    sidebarCollapsed: true,
    inspectorWidth: 400,
    recentSearches: [{ id: 'legacy-task' }],
  })

  await page.getByLabel('任务标题').fill(taskTitle)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v3/tasks') && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: '添加' }).click(),
  ])
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible()
  if (testInfo.project.name === 'minimum' || testInfo.project.name === 'compact') {
    const inspector = page.locator('.inspector')
    await expect(inspector).toBeVisible()
    await expect
      .poll(() => inspector.evaluate((element) => getComputedStyle(element).position))
      .toBe('fixed')
  }
  const unsavedTitle = `${taskTitle}-未保存`
  const taskEditor = page.locator('.task-editor')
  const taskEditorTitle = taskEditor.getByLabel('标题')
  await taskEditorTitle.fill(unsavedTitle)
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('未保存')
    void dialog.dismiss()
  })
  await page.getByRole('button', { name: '关闭任务详情' }).click()
  await expect(taskEditorTitle).toHaveValue(unsavedTitle)
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('未保存')
    void dialog.accept()
  })
  await page.getByRole('button', { name: '关闭任务详情' }).click()
  await expect(page.getByRole('button', { name: '切换检查器' })).toBeDisabled()
  await page.locator('.sidebar').getByRole('link', { name: '任务', exact: true }).click()
  await expect(page.getByText(taskTitle, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: taskTitle, exact: true }).click()
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible()
  await page.getByLabel('安排到日历').check()
  await page.getByRole('button', { name: '保存' }).click()
  await page.getByRole('button', { name: '关闭任务详情' }).click()

  await page.locator('.sidebar').getByRole('link', { name: '任务', exact: true }).click()
  const views = page.getByLabel('任务视图').getByRole('button')
  await expect(views).toHaveText(['收件箱', '今天', '即将到来', '全部', '已完成'])
  const taskButton = page.getByRole('button', { name: taskTitle, exact: true })
  await expect(taskButton).toBeVisible()
  await taskButton.click()
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible()
  await page.getByRole('button', { name: '关闭任务详情' }).click()

  await page.locator('.sidebar').getByRole('link', { name: '日历', exact: true }).click()
  await expect(page.getByText(taskTitle).first()).toBeVisible()
  await page.getByText(taskTitle).first().click()
  await expect(page.getByRole('heading', { name: taskTitle })).toBeVisible()
  await page.getByRole('button', { name: '关闭任务详情' }).click()

  await page.locator('.sidebar').getByRole('link', { name: '档案', exact: true }).click()
  await page.getByRole('link', { name: '管理集合' }).click()
  await page.getByLabel('新类型名称').fill(collectionName)
  await page.getByRole('button', { name: '创建' }).click()
  await expect(page.getByRole('button', { name: new RegExp(collectionName) })).toBeVisible()
  await page.getByLabel('属性名称').fill('阶段')
  await page.getByLabel('属性键').fill('stage')
  await page.getByLabel('字段类型').selectOption('select')
  await page.getByLabel('选项（逗号分隔）').fill('规划,执行')
  await page.getByRole('button', { name: '添加属性' }).click()
  await expect(page.getByText('stage · select')).toBeVisible()
  await page.getByLabel('属性名称').fill('邮箱')
  await page.getByLabel('属性键').fill('email')
  await page.getByLabel('字段类型').selectOption('email')
  await page.getByRole('button', { name: '添加属性' }).click()
  await expect(page.getByText('email · email')).toBeVisible()

  await page.locator('.back-link').click()
  await page.getByRole('button', { name: '新建记录' }).click()
  await page.locator('.dialog').getByLabel('所属集合').selectOption({ label: collectionName })
  await page.getByLabel('名称').fill(archiveTitle)
  await page.getByLabel('摘要').fill('由 Playwright 通过真实 API 创建')
  await page.getByLabel('邮箱').fill(contactEmail)
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText(archiveTitle)).toBeVisible()

  await page.keyboard.press('Control+K')
  await page.getByLabel('搜索关键词').fill(contactEmail)
  await expect(page.getByRole('button', { name: new RegExp(archiveTitle) })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(archiveTitle) }).click()
  await expect(page.getByRole('heading', { name: '活动' })).toBeVisible()
  await expect(page.getByText('创建档案')).toBeVisible()
  const recordId = new URL(page.url()).pathname.split('/').pop()
  expect(recordId).toBeTruthy()

  const archiveSummary = page.getByLabel('摘要')
  await archiveSummary.fill('未保存的档案摘要')
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('未保存')
    void dialog.dismiss()
  })
  await page.getByRole('button', { name: '档案', exact: true }).click()
  await expect(archiveSummary).toHaveValue('未保存的档案摘要')
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('未保存')
    void dialog.accept()
  })
  await page.getByRole('button', { name: '档案', exact: true }).click()
  await page.goto(`/archives/${recordId}`)
  await expect(page.getByRole('heading', { name: archiveTitle })).toBeVisible()

  const relatedArchiveResponse = await request.post(`${server.backendUrl}/api/v3/archive-records`, {
    headers: apiHeaders,
    data: { collectionId: 'template', title: relatedArchiveTitle },
  })
  expect(relatedArchiveResponse.ok()).toBeTruthy()
  await page.reload()
  const relationSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: '关系' }) })
  await relationSection.getByLabel('搜索档案标题').fill(relatedArchiveTitle)
  const relationCandidate = relationSection.getByRole('button', {
    name: new RegExp(relatedArchiveTitle),
  })
  await expect(relationCandidate).toBeVisible()
  await relationCandidate.click()
  await relationSection.getByLabel('关系类型').fill('合作')
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/relations') && response.request().method() === 'POST',
    ),
    relationSection.getByRole('button', { name: '建立关联' }).click(),
  ])
  const relationLink = relationSection
    .locator('.resource-list')
    .getByRole('button', { name: new RegExp(relatedArchiveTitle) })
  await expect(relationLink).toBeVisible()
  await relationLink.click()
  await expect(page.getByRole('heading', { name: relatedArchiveTitle })).toBeVisible()
  await page.goto(`/archives/${recordId}`)
  await expect(page.getByRole('heading', { name: archiveTitle })).toBeVisible()

  const attachmentSource = join(server.workspace, 'e2e-attachment.txt')
  writeFileSync(attachmentSource, 'Playwright attachment persistence')
  const imported = await request.post(
    `${server.backendUrl}/api/v3/archive-records/${recordId}/attachments`,
    { headers: apiHeaders, data: { paths: [attachmentSource] } },
  )
  expect(imported.ok()).toBeTruthy()
  const attachmentJob = (await imported.json()) as { id: string }
  await expect
    .poll(
      async () => {
        const response = await request.get(`${server.backendUrl}/api/v3/jobs/${attachmentJob.id}`, {
          headers: apiHeaders,
        })
        return response.ok() ? ((await response.json()) as { state: string }).state : 'error'
      },
      { timeout: 20_000 },
    )
    .toBe('succeeded')
  await page.reload()
  await expect(page.getByText('e2e-attachment.txt')).toBeVisible()
  await page.getByRole('button', { name: '移除附件' }).click()
  await expect(page.getByText('e2e-attachment.txt')).toHaveCount(0)

  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: '删除' }).click()
  await expect(page.getByRole('heading', { name: '档案' })).toBeVisible()
  await page.locator('.sidebar').getByRole('link', { name: '回收站', exact: true }).click()
  await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()
  const trashEntry = page.locator('.trash-list > div').filter({ hasText: archiveTitle })
  await expect(trashEntry).toBeVisible()
  await trashEntry.getByRole('button', { name: '恢复' }).click()
  await expect(trashEntry).toHaveCount(0)
  await page.locator('.sidebar').getByRole('link', { name: '档案', exact: true }).click()
  await expect(page.getByText(archiveTitle)).toBeVisible()

  await page.locator('.sidebar').getByRole('link', { name: '备份', exact: true }).click()
  await expect(page.getByText(backupDirectory)).toBeVisible()
  await page.getByRole('button', { name: '立即备份' }).click()
  await expect(page.getByText('备份成功').first()).toBeVisible({ timeout: 20_000 })

  await page.locator('.sidebar').getByRole('link', { name: '设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  const darkTheme = page.getByRole('button', { name: '深色' })
  if ((await darkTheme.getAttribute('class'))?.includes('active')) {
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v3/preferences') && response.request().method() === 'PATCH',
      ),
      page.getByRole('button', { name: '浅色' }).click(),
    ])
  }
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v3/preferences') && response.request().method() === 'PATCH',
    ),
    darkTheme.click(),
  ])
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByText('仅 Web 预览')).toBeVisible()
  await expect(page.getByRole('button', { name: '新建或打开' })).toBeDisabled()
  await page.goto('/diagnostics')
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await expect(page.locator('.command-title > span')).toHaveText('设置')
  await expect(
    page.locator('.sidebar').getByRole('link', { name: '设置', exact: true }),
  ).toHaveClass(/active/)
  await expect(page.getByText('监督状态', { exact: true })).toBeVisible()
  await expect(page.getByText('搜索索引', { exact: true })).toBeVisible()
  expect([...apiHosts]).toEqual(['127.0.0.1'])
  expect([...httpHosts]).toEqual(['127.0.0.1'])

  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }))
  expect(overflow.document).toBeLessThanOrEqual(1)
  expect(overflow.body).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('v2-workbench.png'), fullPage: true })
})
