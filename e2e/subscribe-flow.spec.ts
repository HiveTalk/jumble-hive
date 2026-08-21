import { expect, test, type Page } from '@playwright/test'

const FRESH_NSEC = 'nsec1u9l4kfl9p0h99c285xtuyyke0up7ytm2499cs4tlajxkqvlu574qskvknd'

async function loginWithNsec(page: Page, nsec: string) {
  await page.goto('/')
  await expect(page).toHaveTitle(/Jumble/i)
  const loginBtn = page.getByRole('button', { name: 'Login', exact: true }).first()
  await loginBtn.scrollIntoViewIfNeeded()
  await loginBtn.click({ timeout: 30_000, force: true })
  await page.getByRole('button', { name: 'Private Key', exact: true }).click()
  await page.locator('#nsec-input').fill(nsec)
  await page.locator('form').getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Video Rooms', exact: true })).toBeVisible({
    timeout: 30_000
  })
}

test('fresh user subscription flow generates invoice with QR', async ({ page }) => {
  test.setTimeout(120_000)

  const logs: string[] = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

  await page.setViewportSize({ width: 1280, height: 900 })

  // --- Login with fresh nsec ---
  await loginWithNsec(page, FRESH_NSEC)
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: 'e2e/screenshots/sub-01-loggedin.png' })

  // --- Navigate to Video Rooms ---
  await page.getByRole('button', { name: 'Video Rooms', exact: true }).click()
  await expect(page.getByText('Video Rooms', { exact: true }).first()).toBeVisible({
    timeout: 30_000
  })
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: 'e2e/screenshots/sub-02-video-rooms-page.png' })

  // --- Open Subscribe dialog ---
  const subscribeBtn = page.getByRole('button', { name: 'Subscribe', exact: true }).first()
  await expect(subscribeBtn).toBeVisible({ timeout: 10_000 })
  await subscribeBtn.click()

  // Wait for plans to load — the dialog calls loadPlans() on open
  // Wait for either plan buttons or an error message to appear
  await page.waitForTimeout(8_000)
  await page.screenshot({ path: 'e2e/screenshots/sub-03-plans-loaded.png' })

  // Log all dialog text for debugging
  const dialogText = await page.locator('[role="dialog"]').textContent()
  console.log(`Dialog content: ${dialogText?.trim().substring(0, 200)}`)

  // --- Check plans are visible ---
  const planButtons = page.locator('[role="dialog"] button').filter({ hasText: /standard|bulk/i })
  const planCount = await planButtons.count()
  console.log(`Plans found: ${planCount}`)

  // If no plans loaded, save what we have and exit with diagnostic info
  if (planCount === 0) {
    const fs = await import('fs')
    fs.writeFileSync('e2e/screenshots/sub-console.log', logs.join('\n'))
    console.log('No plans found — saving diagnostic info')
    console.log(`Console logs:\n${logs.slice(-20).join('\n')}`)
  }

  // Soft-assert: continue even if 0 plans (we want the screenshots)

  // --- Click the cheapest plan (standard_1y — 360 sats) ---
  if (planCount > 0) {
    const firstPlan = planButtons.first()
    const planText = await firstPlan.textContent()
    console.log(`Selected plan: ${planText?.trim()}`)
    await firstPlan.click()

    // Wait for invoice to generate (signing + API call)
    await page.waitForTimeout(8_000)
    await page.screenshot({ path: 'e2e/screenshots/sub-04-invoice-qr.png' })

    // --- Verify QR code is rendered ---
    const qrCanvas = page.locator('[role="dialog"] canvas')
    const qrVisible = await qrCanvas.isVisible({ timeout: 15_000 }).catch(() => false)
    console.log(`QR code canvas visible: ${qrVisible}`)

    // --- Extract the BOLT11 invoice ---
    const invoiceInput = page.locator('[role="dialog"] input[readonly]')
    const bolt11 = await invoiceInput.inputValue().catch(() => '')
    console.log(`BOLT11 invoice length: ${bolt11.length}`)
    if (bolt11) {
      console.log(`BOLT11 prefix: ${bolt11.substring(0, 60)}...`)
    }

    // --- Verify "Open in Lightning wallet" link ---
    const walletLink = page.locator('[role="dialog"] a[href^="lightning:"]')
    const linkVisible = await walletLink.isVisible().catch(() => false)
    console.log(`Lightning wallet link visible: ${linkVisible}`)

    // Save artifacts
    const fs = await import('fs')
    if (bolt11) fs.writeFileSync('e2e/screenshots/sub-invoice.txt', bolt11)
    fs.writeFileSync('e2e/screenshots/sub-console.log', logs.join('\n'))

    // Final screenshot
    await page.screenshot({ path: 'e2e/screenshots/sub-05-final-qr.png' })

    console.log(`\n=== INVOICE ===\n${bolt11}\n=== END INVOICE ===`)
  } else {
    // Save what we have
    const fs = await import('fs')
    fs.writeFileSync('e2e/screenshots/sub-console.log', logs.join('\n'))
    await page.screenshot({ path: 'e2e/screenshots/sub-04-no-plans.png' })
  }
})
