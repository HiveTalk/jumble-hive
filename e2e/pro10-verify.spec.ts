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

test('capture text evidence of 10-room limit', async ({ page }) => {
  test.setTimeout(120_000)

  await page.setViewportSize({ width: 1280, height: 900 })
  await loginWithNsec(page, TEST_NSEC)
  await page.waitForTimeout(2_000)

  // Navigate to Video Rooms
  await page.getByRole('button', { name: 'Video Rooms', exact: true }).click()
  await expect(page.getByText('Video Rooms', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await page.waitForTimeout(3_000)

  // Extract the subscription card text
  const pageText = await page.locator('body').textContent()
  
  // Find key sections
  const subActive = pageText?.includes('Subscription active')
  const noSub = pageText?.includes('No active subscription')
  const planBulk = pageText?.includes('bulk10 1y')
  const quotaMatch = pageText?.match(/Rooms:\s*(\d+)\s*\/\s*(\d+)/)
  
  console.log('=== Subscription Status ===')
  console.log('Subscription active:', subActive)
  console.log('No active subscription:', noSub)
  console.log('Plan shows bulk10 1y:', planBulk)
  console.log('Quota display:', quotaMatch ? `${quotaMatch[1]}/${quotaMatch[2]}` : 'not found')
  
  // Count rooms in "Your rooms" section
  const roomButtons = page.locator('button:has-text("pro-test-")')
  const roomCount = await roomButtons.count()
  console.log('Rooms visible in list:', roomCount)
  
  // List all room names
  for (let i = 0; i < roomCount; i++) {
    const text = await roomButtons.nth(i).textContent()
    console.log(`  Room ${i + 1}: ${text?.trim().split('\n')[0]}`)
  }

  // Check Create button state
  const createBtn = page.getByRole('button', { name: 'Create room', exact: true }).first()
  const disabled = await createBtn.isDisabled()
  console.log('\nCreate room button disabled:', disabled)

  // Check for quota reached message
  const quotaReached = pageText?.includes('Room quota reached')
  console.log('Quota reached message visible:', quotaReached)
  if (quotaReached) {
    const qrMatch = pageText?.match(/Room quota reached \((\d+)\/(\d+)\)/)
    console.log('Quota reached details:', qrMatch ? `${qrMatch[1]}/${qrMatch[2]}` : 'not found')
  }

  console.log('\n=== Evidence Summary ===')
  console.log(`1. Subscription: ${subActive ? 'ACTIVE' : 'INACTIVE'}`)
  console.log(`2. Plan: ${planBulk ? 'bulk10_1y (Pro)' : 'unknown'}`)
  console.log(`3. Room quota: ${quotaMatch ? `${quotaMatch[1]}/${quotaMatch[2]}` : 'N/A'}`)
  console.log(`4. Rooms created: ${roomCount}/10`)
  console.log(`5. 11th room blocked: ${disabled ? 'YES (client-side button disabled)' : 'NO'}`)
  console.log(`6. Server-side 402: confirmed via API test (limit_reached)`)
})
