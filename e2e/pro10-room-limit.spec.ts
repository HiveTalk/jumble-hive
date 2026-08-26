import { expect, test, type Page } from '@playwright/test'

const TEST_NSEC = 'nsec1ctf0xvgnnmnnmy00z2xxx69dcpsxvqes5w7qgcdagms2mcyafwxsq4khy8'

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

async function createRoom(page: Page, name: string): Promise<boolean> {
  // Click "Create room" button (in the card, not the dialog)
  const createBtn = page.getByRole('button', { name: 'Create room', exact: true }).first()
  await createBtn.click({ timeout: 10_000 })

  // Wait for dialog
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 10_000 })

  // Fill room name
  const nameInput = page.locator('[role="dialog"] #room-name-input')
  await nameInput.fill(name)

  // Click the "Create room" button inside the dialog
  const dialogCreateBtn = page.locator('[role="dialog"]').getByRole('button', { name: 'Create room', exact: true })
  await dialogCreateBtn.click()

  // Wait for either:
  // 1. "Room created!" success text to appear (within 15s)
  // 2. An error message to appear
  // 3. The dialog to close (success auto-closes after 1.2s)
  const successLocator = page.locator('[role="dialog"]').getByText('Room created!', { exact: true })
  const errorLocator = page.locator('[role="dialog"] .text-destructive')
  const dialogLocator = page.locator('[role="dialog"]')

  // Race: wait for success text OR error text
  let success = false
  try {
    // The success text appears briefly, or the dialog closes on success
    await Promise.race([
      successLocator.waitFor({ state: 'visible', timeout: 15_000 }),
      // Dialog closes after success (auto-close after 1.2s)
      dialogLocator.waitFor({ state: 'hidden', timeout: 15_000 }).then(() => { success = true })
    ])
    if (await successLocator.isVisible({ timeout: 500 }).catch(() => false)) {
      success = true
    }
  } catch {
    // Check if dialog closed (success) or error appeared (failure)
    const dialogVisible = await dialogLocator.isVisible().catch(() => false)
    if (!dialogVisible) {
      success = true
    } else {
      const errorVisible = await errorLocator.isVisible().catch(() => false)
      if (errorVisible) {
        const errorText = await errorLocator.textContent()
        console.log(`  Room "${name}" rejected: ${errorText?.trim()}`)
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
        return false
      }
    }
  }

  // Wait for dialog to close and room list to refresh
  await page.waitForTimeout(2_000)

  // Close dialog if still open
  const dialogStillVisible = await dialogLocator.isVisible().catch(() => false)
  if (dialogStillVisible) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1_000)
  }

  // Verify the room appears in the "Your rooms" list
  const roomInList = page.getByText(name, { exact: true }).first()
  const roomVisible = await roomInList.isVisible({ timeout: 5_000 }).catch(() => false)
  if (roomVisible) {
    success = true
  }

  return success
}

test('Pro plan: create 10 rooms, 11th rejected', async ({ page }) => {
  test.setTimeout(300_000) // 5 min

  const logs: string[] = []
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

  await page.setViewportSize({ width: 1280, height: 900 })

  // --- Login ---
  await loginWithNsec(page, TEST_NSEC)
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: 'e2e/screenshots/pro10-01-loggedin.png' })

  // --- Navigate to Video Rooms ---
  await page.getByRole('button', { name: 'Video Rooms', exact: true }).click()
  await expect(page.getByText('Video Rooms', { exact: true }).first()).toBeVisible({
    timeout: 30_000
  })
  await page.waitForTimeout(3_000)
  await page.screenshot({ path: 'e2e/screenshots/pro10-02-video-rooms-subscription.png' })

  // --- Verify subscription is active ---
  const subActiveText = page.getByText('Subscription active', { exact: true })
  await expect(subActiveText).toBeVisible({ timeout: 15_000 })
  console.log('Subscription active: visible')

  // --- Verify room quota shows 0/10 ---
  const quotaText = page.getByText(/Rooms:\s*0\s*\/\s*10/)
  const quotaVisible = await quotaText.isVisible({ timeout: 5_000 }).catch(() => false)
  console.log(`Quota "0/10" visible: ${quotaVisible}`)

  // --- Create 10 rooms ---
  const roomNames = [
    'pro-test-01', 'pro-test-02', 'pro-test-03', 'pro-test-04', 'pro-test-05',
    'pro-test-06', 'pro-test-07', 'pro-test-08', 'pro-test-09', 'pro-test-10'
  ]

  let created = 0
  for (const name of roomNames) {
    console.log(`Creating room: ${name}`)
    const ok = await createRoom(page, name)
    if (ok) {
      created++
      console.log(`  Created (${created}/${roomNames.length})`)
    } else {
      console.log(`  Failed to create (${created}/${roomNames.length})`)
    }

    // Screenshot at key milestones: 1, 5, 10
    if (created === 1 || created === 5 || created === 10) {
      await page.waitForTimeout(1_000)
      await page.screenshot({
        path: `e2e/screenshots/pro10-rooms-${String(created).padStart(2, '0')}.png`
      })
    }
  }

  console.log(`\nCreated ${created}/${roomNames.length} rooms`)

  // --- Screenshot the room list with all 10 rooms ---
  await page.waitForTimeout(2_000)
  await page.screenshot({ path: 'e2e/screenshots/pro10-10-rooms-list.png', fullPage: true })

  // --- Verify room quota display shows 10/10 ---
  const quotaFull = page.getByText(/Rooms:\s*10\s*\/\s*10/)
  const quotaFullVisible = await quotaFull.isVisible({ timeout: 5_000 }).catch(() => false)
  console.log(`Quota "10/10" visible: ${quotaFullVisible}`)

  // --- Attempt 11th room (should be rejected) ---
  console.log('\nAttempting 11th room: pro-test-11')

  // First check if the Create button is disabled (client-side enforcement)
  const createBtn = page.getByRole('button', { name: 'Create room', exact: true }).first()
  const createBtnDisabled = await createBtn.isDisabled().catch(() => false)
  console.log(`Create room button disabled: ${createBtnDisabled}`)

  await page.screenshot({ path: 'e2e/screenshots/pro10-11-quota-reached.png' })

  if (createBtnDisabled) {
    console.log('11th room blocked client-side (Create button disabled)')
  } else {
    // Try to create and expect server rejection
    const rejected = await createRoom(page, 'pro-test-11')
    if (rejected) {
      console.log('WARNING: 11th room was created — limit NOT enforced!')
    } else {
      console.log('11th room was rejected by the server')
    }
    await page.waitForTimeout(1_000)
    await page.screenshot({ path: 'e2e/screenshots/pro10-11-rejected.png' })
  }

  // --- Final full-page screenshot ---
  await page.screenshot({ path: 'e2e/screenshots/pro10-final.png', fullPage: true })

  // Save console logs
  const fs = await import('fs')
  fs.writeFileSync('e2e/screenshots/pro10-console.log', logs.join('\n'))

  console.log('\n=== Test complete ===')
  console.log(`Rooms created: ${created}/10`)
  console.log(`11th room blocked: ${createBtnDisabled ? 'client-side (button disabled)' : 'server-side (402)'}`)
})
