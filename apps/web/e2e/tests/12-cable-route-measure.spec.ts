/**
 * Cable route measurement — trace → save → recall → remove, end to end.
 *
 * Requires a signed-in session (auth.setup) holding ORG_WRITE_ROLES on the
 * project, and three env vars naming a DRAFT-revision run and a calibrated
 * drawing on that project:
 *
 *   E2E_ROUTE_PROJECT_ID   the project
 *   E2E_ROUTE_PLAN_ID      a calibrated drawing (tenants.floor_plans.id)
 *   E2E_ROUTE_SUPPLY_ID    a run (cable_schedule.supplies.id) on a DRAFT revision
 *   E2E_ROUTE_REVISION_ID  that revision
 *
 * Skips otherwise — the same pattern as 09-rbac-admin-routes. Writes a route
 * on the named run and removes it at the end; it never presses Assign, so no
 * schedule length changes.
 */
import { test, expect } from '@playwright/test'

const PROJECT = process.env.E2E_ROUTE_PROJECT_ID
const PLAN = process.env.E2E_ROUTE_PLAN_ID
const SUPPLY = process.env.E2E_ROUTE_SUPPLY_ID
const REVISION = process.env.E2E_ROUTE_REVISION_ID
const SKIP = 'E2E_ROUTE_* not set — name a project, calibrated drawing, DRAFT run and revision to enable'

test.describe('cable route measurement', () => {
  test.beforeEach(() => {
    test.skip(!PROJECT || !PLAN || !SUPPLY || !REVISION, SKIP)
  })

  test('traces a leg, saves it, recalls it on the plain drawing, and removes it', async ({ page }) => {
    await page.goto(`/projects/${PROJECT}/floor-plans/${PLAN}?mode=route&supply=${SUPPLY}`)
    // The polyline must be in hand on arrival, and the sheet rasterised.
    await expect(page.getByRole('button', { name: /Segmented line/ })).toBeVisible()
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible({ timeout: 90_000 })
    const box = await canvas.boundingBox()
    if (!box) throw new Error('no canvas box')

    // Three corners, double-click to finish → a pending leg with a Save button.
    const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })
    await page.mouse.click(at(0.35, 0.45).x, at(0.35, 0.45).y)
    await page.mouse.click(at(0.50, 0.50).x, at(0.50, 0.50).y)
    await page.mouse.click(at(0.60, 0.62).x, at(0.60, 0.62).y)
    await page.mouse.dblclick(at(0.60, 0.62).x, at(0.60, 0.62).y)
    await expect(page.getByText(/leg finished — press Save leg/)).toBeVisible()
    const save = page.getByRole('button', { name: /^Save leg · [\d.]+ m$/ })
    await expect(save).toBeVisible()
    await save.click()
    await expect(page.getByText(/1 leg saved · [\d.]+ m/)).toBeVisible({ timeout: 15_000 })

    // Recall on the PLAIN drawing: no mode, the route is drawn and toggleable.
    await page.goto(`/projects/${PROJECT}/floor-plans/${PLAN}`)
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90_000 })
    await expect(page.getByRole('button', { name: /cable route.* saved on this drawing/ })).toBeVisible()

    // Remove it from the worklist so the run is outstanding again.
    await page.goto(`/projects/${PROJECT}/cables/${REVISION}/measure?supply=${SUPPLY}`)
    await page.getByRole('button', { name: 'Remove route' }).click()
    await expect(page.getByText(/Route removed/)).toBeVisible({ timeout: 15_000 })
  })
})
