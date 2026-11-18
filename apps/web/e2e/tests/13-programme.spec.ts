/**
 * Programme (Gantt) screen — the signed-in walk, from the empty project state.
 *
 * Projects list → project → Programme → create the programme → add three tasks →
 * link them → the finish moves → save a baseline → drag the middle task → its bar
 * leaves the baseline → undo → reload and the work is still there → phone layout.
 *
 * Requires a signed-in owner/admin/PM session (auth.setup) and a throwaway project
 * that has NO programme yet:
 *
 *   E2E_PROGRAMME_PROJECT_ID   the project (uuid)
 *
 * The screen must also be switched on for the deployment under test
 * (PROGRAMME_ENABLED, Preview only — see docs/programme/runbook.md section 4).
 * Skips when the variable is unset, the same pattern as 12-cable-route-measure.
 * It writes to the project and removes nothing.
 */
import { test, expect, type Page, type Locator } from '@playwright/test'

const PROJECT = process.env.E2E_PROGRAMME_PROJECT_ID
const SKIP = 'E2E_PROGRAMME_PROJECT_ID not set — name a project with no programme to enable'
const NAMES = ['Walk task A', 'Walk task B', 'Walk task C'] as const

async function settled(page: Page) {
  await expect(page.getByText('Saving…')).toHaveCount(0, { timeout: 20_000 })
  await expect(page.getByText('Not saved')).toHaveCount(0, { timeout: 20_000 })
}

async function centre(l: Locator) {
  const b = await l.boundingBox()
  if (!b) throw new Error('element has no box')
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}

const bars = (page: Page) => page.locator('[data-bar-id]')

test.describe('programme (Gantt)', () => {
  test.beforeEach(() => { test.skip(!PROJECT, SKIP) })

  test('builds a programme, links, baselines, drags, undoes and persists', async ({ page }) => {
    // From the list, as a person would.
    await page.goto('/projects')
    await page.locator(`a[href="/projects/${PROJECT}"]`).first().click()
    await page.waitForURL(new RegExp(`/projects/${PROJECT}`))
    await page.getByRole('link', { name: 'Project Programme', exact: true }).first().click()
    await page.waitForURL(/\/programme/)

    // Empty state → create.
    await page.getByRole('button', { name: 'Create programme' }).click()
    const grid = page.getByRole('grid', { name: 'Activities' })
    await expect(grid).toBeVisible({ timeout: 20_000 })

    // Three tasks, each named in place.
    for (const name of NAMES) {
      await page.getByRole('button', { name: 'Add task', exact: true }).click()
      const input = grid.getByRole('textbox', { name: 'Name' })
      await expect(input).toBeVisible()
      await input.fill(name)
      await input.press('Enter')
      await settled(page)
    }
    for (const name of NAMES) await expect(grid.getByRole('row', { name })).toBeVisible()
    await expect(bars(page)).toHaveCount(3)

    // Link A → B and B → C by dragging from the handle at a bar's end.
    const finish = page.getByTestId('programme-finish')
    const finishBefore = await finish.innerText()
    for (const [from, to] of [[0, 1], [1, 2]] as const) {
      const src = bars(page).nth(from)
      const srcBar = await centre(src.locator('[data-part="bar"]'))
      await page.mouse.move(srcBar.x, srcBar.y) // hover shows the handle
      const handle = await centre(src.locator('[data-part="handle"]'))
      const dst = await centre(bars(page).nth(to).locator('[data-part="bar"]'))
      await page.mouse.move(handle.x, handle.y)
      await page.mouse.down()
      await page.mouse.move(dst.x, dst.y, { steps: 12 })
      await page.mouse.up()
      await settled(page)
    }
    await expect(page.locator('[data-link-id]')).toHaveCount(2)
    await expect(finish).not.toHaveText(finishBefore) // the chain pushes the finish out

    // Save a baseline.
    await page.getByRole('button', { name: /^Baselines \(/ }).click()
    await page.getByRole('button', { name: 'Save baseline…' }).click()
    await page.getByRole('textbox', { name: 'Baseline name' }).fill('Walk baseline')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('programme-baselines').getByText('Walk baseline')).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: /^Baselines \(/ }).click() // close the menu
    // Active baseline: a baseline line sits under each bar, level with it.
    const middle = bars(page).nth(1)
    await expect(middle.locator('[data-part="baseline"]')).toBeVisible({ timeout: 20_000 })
    const startOf = async (part: 'bar' | 'baseline') => (await centre(middle.locator(`[data-part="${part}"]`))).box.x
    expect(Math.abs((await startOf('bar')) - (await startOf('baseline')))).toBeLessThan(2)

    // Drag the middle task later: its bar leaves its baseline.
    const mid = await centre(middle.locator('[data-part="bar"]'))
    await page.mouse.move(mid.x, mid.y)
    await page.mouse.down()
    await page.mouse.move(mid.x + 160, mid.y, { steps: 12 })
    await page.mouse.up()
    await settled(page)
    await expect.poll(async () => Math.abs((await startOf('bar')) - (await startOf('baseline')))).toBeGreaterThan(10)

    // Undo puts it back on the baseline.
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await settled(page)
    await expect.poll(async () => Math.abs((await startOf('bar')) - (await startOf('baseline')))).toBeLessThan(2)

    // Reload: everything persisted.
    await page.reload()
    const again = page.getByRole('grid', { name: 'Activities' })
    await expect(again).toBeVisible({ timeout: 20_000 })
    for (const name of NAMES) await expect(again.getByRole('row', { name })).toBeVisible()
    await expect(page.locator('[data-link-id]')).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Baselines (1)' })).toBeVisible()

    // Phone: three columns, the timeline behind its toggle, nothing scrolls sideways.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    const phoneGrid = page.getByRole('grid', { name: 'Activities' })
    await expect(phoneGrid).toBeVisible({ timeout: 20_000 })
    await expect(phoneGrid.getByRole('columnheader')).toHaveText(['Name', 'Start', 'Finish'])
    // The grid pane itself must not scroll sideways (the page cannot, its split is overflow: hidden,
    // so the document's scrollWidth would never show it).
    const gridOverflow = await page.getByTestId('programme-grid-scroll').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(gridOverflow).toBeLessThanOrEqual(0)
    await expect(page.getByTestId('programme-timeline')).toHaveCount(0)
    await page.getByRole('button', { name: 'Timeline', exact: true }).click()
    await expect(page.getByTestId('programme-timeline')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
