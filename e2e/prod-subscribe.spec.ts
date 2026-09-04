import { expect, test, type Page } from '@playwright/test'
import { generateSecretKey, nip19 } from 'nostr-tools'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'https://jumble-hive.vercel.app'

// Use an env var if provided; otherwise generate an ephemeral key at runtime
// so no private key is ever committed to the repository.
function getTestNsec(): string {
  const env = process.env.TEST_NSEC
  if (env) return env
  const sk = generateSecretKey()
  return nip19.nsecEncode(sk)
}

async function loginWithNsec(page: Page, nsec: string) {
  await page.goto(BASE)
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

const RUN_ID = Date.now().toString()

function screenshotPath(name: string): string {
  return `e2e/screenshots/prod-sub-${name}-${RUN_ID}.png`
}

async function safeWriteFile(path: string, content: string): Promise<void> {
  try {
    const fs = await import('fs')
    fs.writeFileSync(path, content)
  } catch (e) {
    console.error(`Failed to save artifact ${path}:`, e)
  }
}

test('subscribe flow generates invoice on production', async ({ page }) => {
  test.setTimeout(120_000)

  const nsec = getTestNsec()
  const logs: string[] = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
  page.on('requestfailed', (req) =>
    logs.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`)
  )

  await page.setViewportSize({ width: 1280, height: 900 })

  // --- Login ---
  await loginWithNsec(page, nsec)
  await page.waitForLoadState('networkidle')

  // --- Navigate to Video Rooms ---
  await page.getByRole('button', { name: 'Video Rooms', exact: true }).click()
  await expect(page.getByText('Video Rooms', { exact: true }).first()).toBeVisible({
    timeout: 30_000
  })

  // --- Open Subscribe dialog ---
  const subscribeBtn = page.getByRole('button', { name: 'Subscribe', exact: true }).first()
  await expect(subscribeBtn).toBeVisible({ timeout: 10_000 })
  await subscribeBtn.click()
  await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 10_000 })

  // Wait for plans to load — look for plan buttons or an error state
  await page
    .locator('[role="dialog"] button')
    .filter({ hasText: /^standard|^bulk/i })
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page.screenshot({ path: screenshotPath('03-plans') })

  const dialogText = await page.locator('[role="dialog"]').textContent()
  console.log(`Dialog content: ${dialogText?.trim().substring(0, 300)}`)

  // Match only plan buttons: those whose text starts with "standard" or "bulk"
  const planButtons = page
    .locator('[role="dialog"] button')
    .filter({ hasText: /^standard|^bulk/i })
  const planCount = await planButtons.count()
  console.log(`Plans found: ${planCount}`)

  if (planCount === 0) {
    await safeWriteFile('e2e/screenshots/prod-sub-console.log', logs.join('\n'))
    console.log(`Console logs (last 30):\n${logs.slice(-30).join('\n')}`)
    throw new Error('No plans loaded — check console logs')
  }

  // --- Click the cheapest plan ---
  const firstPlan = planButtons.first()
  const planText = await firstPlan.textContent()
  console.log(`Selected plan: ${planText?.trim()}`)
  await firstPlan.click()

  // Verify the "paying" phase appears — this confirms the L402 challenge was parsed
  await expect(
    page.locator('[role="dialog"]').getByText('Complete the payment in your wallet')
  ).toBeVisible({ timeout: 20_000 })

  await page.screenshot({ path: screenshotPath('04-paying') })

  // The "paying" phase visible means the proxy successfully delivered the L402 challenge.
  // A full invoice QR is only rendered when a Lightning wallet is connected, which
  // Playwright does not have. We verify the phase transition as the success signal.
  const payingVisible = await page
    .locator('[role="dialog"]')
    .getByText('Complete the payment in your wallet')
    .isVisible()
    .catch(() => false)

  console.log(`Paying phase visible: ${payingVisible}`)

  // Check for error messages (should not appear if proxy works)
  const errorPhase = page.locator('[role="dialog"]').getByText('Go back')
  const errorVisible = await errorPhase.isVisible({ timeout: 1_000 }).catch(() => false)

  if (errorVisible) {
    const errorText = await page.locator('[role="dialog"]').textContent()
    console.log(`Error phase detected: ${errorText?.trim().substring(0, 300)}`)
  }

  // Save artifacts
  await safeWriteFile('e2e/screenshots/prod-sub-console.log', logs.join('\n'))
  await page.screenshot({ path: screenshotPath('05-final') })

  console.log(`\n=== CONSOLE LOGS (last 40) ===\n${logs.slice(-40).join('\n')}`)

  // The key assertion: the paying phase appeared, meaning the L402 challenge
  // was successfully parsed through the proxy. Without the proxy, this would
  // show the error "HiveRelay asked for payment but sent no L402 invoice".
  expect(payingVisible).toBe(true)
  expect(errorVisible).toBe(false)
})
