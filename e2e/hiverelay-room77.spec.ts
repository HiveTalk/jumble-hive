import { expect, test } from '@playwright/test'

/**
 * E2E test: Jumble Nostr client connecting to the HiveRelay paid subscription
 * (l402.exe.xyz staging relay) and accessing the permanent room "room77".
 *
 * Flow:
 *  1. Load the Jumble dev client.
 *  2. Log in with the nsec private key (Private Key login flow).
 *  3. Open the Video Rooms page — calls HiveRelay's authenticated
 *     /api/subscription, /api/rooms-by-pubkey, and /api/list-rooms endpoints.
 *  4. Assert the paid subscription is active ("Subscription active").
 *  5. Assert the permanent room "room77" is listed under "Your rooms".
 *  6. Join room77 -> HiveRelay /api/get-token mints a LiveKit JWT -> the
 *     VideoRoomPage PreJoin screen renders, proving the token was issued.
 */

const NSEC = 'nsec1aenkvftgews8qhug2wpr363u56x5f6883k5cw80c6ajfvtv9m5tqps25mg'
const ROOM_NAME = 'room77'

test.describe('HiveRelay paid subscription + room77', () => {
  test('logs in, sees active subscription, joins room77', async ({ page }) => {
    test.setTimeout(120_000)

    // Use a tall viewport so the sidebar Login button is visible without scrolling
    await page.setViewportSize({ width: 1280, height: 1080 })

    await page.goto('/')
    await expect(page).toHaveTitle(/Jumble/i)
    await page.screenshot({ path: 'e2e/screenshots/01-loaded.png', fullPage: true })

    // Open the login dialog. The Login button is at the bottom of the sidebar
    // and may be outside the viewport on short windows, so scroll it into view
    // first, then force-click.
    const loginBtn = page.getByRole('button', { name: 'Login', exact: true }).first()
    await loginBtn.scrollIntoViewIfNeeded()
    await loginBtn.click({ timeout: 30_000, force: true })
    await page.screenshot({ path: 'e2e/screenshots/02-login-dialog.png', fullPage: true })

    // Pick "Private Key" login method
    const privateKeyTile = page.getByRole('button', { name: 'Private Key', exact: true })
    await privateKeyTile.click()
    await page.screenshot({ path: 'e2e/screenshots/03-nsec-form.png', fullPage: true })

    // Enter the nsec and submit
    const nsecInput = page.locator('#nsec-input')
    await nsecInput.fill(NSEC)
    const formLoginBtn = page.locator('form').getByRole('button', { name: 'Login', exact: true })
    await formLoginBtn.click()

    // Wait for login to complete — the "Video Rooms" sidebar item becomes visible
    const videoRoomsNav = page.getByRole('button', { name: 'Video Rooms', exact: true })
    await expect(videoRoomsNav).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: 'e2e/screenshots/04-logged-in.png', fullPage: true })

    // Open the Video Rooms page
    await videoRoomsNav.click()
    await expect(page.getByText('Video Rooms', { exact: true }).first()).toBeVisible({
      timeout: 30_000
    })

    // Wait for subscription status to show "Subscription active"
    await expect(
      page.getByText('Subscription active', { exact: true })
    ).toBeVisible({ timeout: 45_000 })
    await page.screenshot({ path: 'e2e/screenshots/05-subscription-active.png', fullPage: true })

    // Assert room77 is listed under "Your rooms"
    const yourRoomsSection = page.locator('section', {
      has: page.getByText('Your rooms', { exact: true })
    })
    const roomRow = yourRoomsSection.getByRole('button', {
      name: new RegExp(ROOM_NAME, 'i')
    })
    await expect(roomRow).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: 'e2e/screenshots/06-room77-listed.png', fullPage: true })

    // Join room77 -> get-token -> prejoin screen
    await roomRow.click()
    await expect(page).toHaveURL(new RegExp(`/video-rooms/${ROOM_NAME}`), { timeout: 45_000 })

    // The room name appears in the title bar
    await expect(
      page.getByText(ROOM_NAME, { exact: true }).first()
    ).toBeVisible({ timeout: 30_000 })

    // Ensure we did NOT land in the error state
    await expect(page.getByText('Connection lost')).toHaveCount(0)

    await page.screenshot({ path: 'e2e/screenshots/07-room77-prejoin.png', fullPage: true })

    // Final URL proof
    const finalUrl = page.url()
    expect(finalUrl).toContain(`/video-rooms/${ROOM_NAME}`)
  })
})
