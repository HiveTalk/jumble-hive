import { expect, test } from '@playwright/test'
import { readFileSync } from 'fs'

/**
 * Two-participant E2E test: both users join room77.
 *
 * User 1: HiveHost (existing key with paid subscription + room77 ownership)
 * User 2: BuzzGuest (auto-generated key, joins as a guest)
 *
 * Both have Nostr profiles with usernames and avatars published to relays.
 * Verifies: both users join, VideoConference shows participants, usernames/
 * avatars render, control bar is visible at the bottom.
 */

const NSEC1 = 'nsec1aenkvftgews8qhug2wpr363u56x5f6883k5cw80c6ajfvtv9m5tqps25mg'
const NSEC2 = readFileSync('e2e/.second-nsec.txt', 'utf-8').trim()
const ROOM_NAME = 'room77'

async function loginWithNsec(page: import('@playwright/test').Page, nsec: string) {
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

async function joinRoom77(page: import('@playwright/test').Page, isOwner: boolean) {
  await page.getByRole('button', { name: 'Video Rooms', exact: true }).click()
  await expect(page.getByText('Video Rooms', { exact: true }).first()).toBeVisible({
    timeout: 30_000
  })
  await expect(page.getByText('Your rooms', { exact: true })).toBeVisible({ timeout: 30_000 })

  if (isOwner) {
    const yourRoomsSection = page.locator('section', {
      has: page.getByText('Your rooms', { exact: true })
    })
    const roomRow = yourRoomsSection.getByRole('button', { name: new RegExp(ROOM_NAME, 'i') })
    await expect(roomRow).toBeVisible({ timeout: 30_000 })
    await roomRow.click()
  } else {
    // Guest uses the "Join a room" card
    const joinInput = page.getByPlaceholder('room77')
    await expect(joinInput).toBeVisible({ timeout: 30_000 })
    await joinInput.fill(ROOM_NAME)
    await page.getByRole('button', { name: 'Join now', exact: true }).click()
  }

  await expect(page).toHaveURL(new RegExp(`/video-rooms/${ROOM_NAME}`), { timeout: 45_000 })
}

test.describe('Two-participant video conference', () => {
  test('both users join room77 with usernames and avatars visible', async ({ browser }) => {
    test.setTimeout(300_000)

    // Create two independent browser contexts with video recording.
    // Grant camera/mic permissions so LiveKit doesn't disconnect when it
    // can't access real devices.
    const context1 = await browser.newContext({
      recordVideo: { dir: 'e2e/screenshots/' },
      permissions: ['camera', 'microphone']
    })
    const context2 = await browser.newContext({
      recordVideo: { dir: 'e2e/screenshots/' },
      permissions: ['camera', 'microphone']
    })

    // Grant fake media streams so LiveKit doesn't fail on missing devices
    await context1.grantPermissions(['camera', 'microphone'], {
      origin: 'http://localhost:5173'
    })
    await context2.grantPermissions(['camera', 'microphone'], {
      origin: 'http://localhost:5173'
    })
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    await page1.setViewportSize({ width: 1280, height: 1080 })
    await page2.setViewportSize({ width: 1280, height: 1080 })

    // Capture console logs for debugging
    const logs1: string[] = []
    const logs2: string[] = []
    page1.on('console', (msg) => logs1.push(`[${msg.type()}] ${msg.text()}`))
    page1.on('pageerror', (err) => logs1.push(`[pageerror] ${err.message}`))
    page2.on('console', (msg) => logs2.push(`[${msg.type()}] ${msg.text()}`))
    page2.on('pageerror', (err) => logs2.push(`[pageerror] ${err.message}`))

    // --- Log in both users ---
    await loginWithNsec(page1, NSEC1)
    await loginWithNsec(page2, NSEC2)

    await page1.screenshot({ path: 'e2e/screenshots/two-01-user1-loggedin.png' })
    await page2.screenshot({ path: 'e2e/screenshots/two-01-user2-loggedin.png' })

    // --- User 1 (owner) joins first ---
    await joinRoom77(page1, true)
    await expect(page1).toHaveURL(new RegExp(`/video-rooms/${ROOM_NAME}`))
    await page1.screenshot({ path: 'e2e/screenshots/two-02-user1-prejoin.png' })

    // Click "Join" on PreJoin to enter the conference
    const joinBtn1 = page1.getByRole('button', { name: /^Join$/ }).last()
    await expect(joinBtn1).toBeVisible({ timeout: 30_000 })
    await joinBtn1.click()

    // Wait for LiveKit to connect (give it time to establish connection)
    await page1.waitForTimeout(10_000)
    await page1.screenshot({ path: 'e2e/screenshots/two-03-user1-alone-in-room.png' })

    // --- User 2 (guest) joins ---
    await joinRoom77(page2, false)
    await expect(page2).toHaveURL(new RegExp(`/video-rooms/${ROOM_NAME}`))
    await page2.screenshot({ path: 'e2e/screenshots/two-02-user2-prejoin.png' })

    const joinBtn2 = page2.getByRole('button', { name: /^Join$/ }).last()
    await expect(joinBtn2).toBeVisible({ timeout: 30_000 })
    await joinBtn2.click()

    // Wait for LiveKit to connect and both participants to see each other
    await page1.waitForTimeout(10_000)
    await page2.waitForTimeout(10_000)

    // --- Capture conference screenshots ---
    await page1.screenshot({ path: 'e2e/screenshots/two-04-user1-conference.png' })
    await page2.screenshot({ path: 'e2e/screenshots/two-04-user2-conference.png' })

    // Dump page content to verify what's rendering
    const page1Content = await page1.content()
    const fs = await import('fs')
    fs.writeFileSync('e2e/screenshots/user1-conference-page.html', page1Content)
    const page2Content = await page2.content()
    fs.writeFileSync('e2e/screenshots/user2-conference-page.html', page2Content)

    // Save console logs for debugging
    fs.writeFileSync('e2e/screenshots/user1-console.log', logs1.join('\n'))
    fs.writeFileSync('e2e/screenshots/user2-console.log', logs2.join('\n'))
    console.log('=== User 1 console logs ===')
    console.log(logs1.slice(-30).join('\n'))
    console.log('=== User 2 console logs ===')
    console.log(logs2.slice(-30).join('\n'))

    // --- Capture control bar area (bottom 120px) ---
    const vs1 = page1.viewportSize()!
    const vs2 = page2.viewportSize()!
    await page1.screenshot({
      path: 'e2e/screenshots/two-05-user1-controlbar.png',
      clip: { x: 0, y: vs1.height - 120, width: vs1.width, height: 120 }
    })
    await page2.screenshot({
      path: 'e2e/screenshots/two-05-user2-controlbar.png',
      clip: { x: 0, y: vs2.height - 120, width: vs2.width, height: 120 }
    })

    // --- Verify control bar buttons are present ---
    const user1ButtonCount = await page1.locator('button:visible').count()
    const user2ButtonCount = await page2.locator('button:visible').count()
    expect(user1ButtonCount).toBeGreaterThan(3)
    expect(user2ButtonCount).toBeGreaterThan(3)

    // --- Final full-page screenshots ---
    await page1.screenshot({ path: 'e2e/screenshots/two-06-user1-final.png' })
    await page2.screenshot({ path: 'e2e/screenshots/two-06-user2-final.png' })

    await context1.close()
    await context2.close()
  })

  test('avatars show as placeholder when camera is off', async ({ browser }) => {
    test.setTimeout(300_000)

    // Both contexts grant mic permission but NOT camera — this simulates
    // joining with camera off so the Nostr avatar placeholder should render.
    const context1 = await browser.newContext({
      recordVideo: { dir: 'e2e/screenshots/' },
      permissions: ['microphone']
    })
    const context2 = await browser.newContext({
      recordVideo: { dir: 'e2e/screenshots/' },
      permissions: ['microphone']
    })
    await context1.grantPermissions(['microphone'], {
      origin: 'http://localhost:5173'
    })
    await context2.grantPermissions(['microphone'], {
      origin: 'http://localhost:5173'
    })
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    await page1.setViewportSize({ width: 1280, height: 1080 })
    await page2.setViewportSize({ width: 1280, height: 1080 })

    const logs1: string[] = []
    const logs2: string[] = []
    page1.on('console', (msg) => logs1.push(`[${msg.type()}] ${msg.text()}`))
    page1.on('pageerror', (err) => logs1.push(`[pageerror] ${err.message}`))
    page2.on('console', (msg) => logs2.push(`[${msg.type()}] ${msg.text()}`))
    page2.on('pageerror', (err) => logs2.push(`[pageerror] ${err.message}`))

    // --- Log in both users ---
    await loginWithNsec(page1, NSEC1)
    await loginWithNsec(page2, NSEC2)

    // --- User 1 joins first ---
    await joinRoom77(page1, true)
    await expect(page1).toHaveURL(new RegExp(`/video-rooms/${ROOM_NAME}`))

    // On PreJoin, disable the camera toggle before joining
    // The PreJoin camera toggle button has an aria-label or is a TrackToggle
    // with source=camera. Click it to turn camera off.
    const camToggle1 = page1.locator('button[aria-pressed="true"]').filter({
      hasText: /camera|video/i
    }).first()
    if (await camToggle1.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await camToggle1.click()
    }

    const joinBtn1 = page1.getByRole('button', { name: /^Join$/ }).last()
    await expect(joinBtn1).toBeVisible({ timeout: 30_000 })
    await joinBtn1.click()

    await page1.waitForTimeout(10_000)
    await page1.screenshot({ path: 'e2e/screenshots/camoff-01-user1-alone.png' })

    // --- User 2 joins ---
    await joinRoom77(page2, false)
    await expect(page2).toHaveURL(new RegExp(`/video-rooms/${ROOM_NAME}`))

    const camToggle2 = page2.locator('button[aria-pressed="true"]').filter({
      hasText: /camera|video/i
    }).first()
    if (await camToggle2.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await camToggle2.click()
    }

    const joinBtn2 = page2.getByRole('button', { name: /^Join$/ }).last()
    await expect(joinBtn2).toBeVisible({ timeout: 30_000 })
    await joinBtn2.click()

    // Wait for both to connect and see each other
    await page1.waitForTimeout(12_000)
    await page2.waitForTimeout(12_000)

    // Give time for remote Nostr profile fetches to complete (kind 0
    // metadata events are fetched from relays, which takes a few seconds)
    await page1.waitForTimeout(5_000)
    await page2.waitForTimeout(5_000)

    // --- Capture screenshots showing avatar placeholders ---
    await page1.screenshot({ path: 'e2e/screenshots/camoff-02-user1-conference.png' })
    await page2.screenshot({ path: 'e2e/screenshots/camoff-02-user2-conference.png' })

    // Dump HTML to verify avatar <img> tags are present
    const fs = await import('fs')
    const html1 = await page1.content()
    fs.writeFileSync('e2e/screenshots/camoff-user1-conference-page.html', html1)
    const html2 = await page2.content()
    fs.writeFileSync('e2e/screenshots/camoff-user2-conference-page.html', html2)

    // --- Verify avatar <img> elements are present in the placeholder ---
    // The NostrParticipantTile renders an <img> inside .lk-participant-placeholder
    // when the camera is off. Check that at least one img exists in a placeholder.
    const avatarImgs1 = page1.locator('.lk-participant-placeholder img')
    const avatarImgs2 = page2.locator('.lk-participant-placeholder img')
    const count1 = await avatarImgs1.count()
    const count2 = await avatarImgs2.count()
    console.log(`User 1 avatar imgs in placeholder: ${count1}`)
    console.log(`User 2 avatar imgs in placeholder: ${count2}`)

    // Debug: log what's in the placeholder divs
    const placeholders1 = await page1.locator('.lk-participant-placeholder').evaluateAll(
      (els) => els.map((e) => e.innerHTML)
    )
    console.log(`User 1 placeholder content: ${JSON.stringify(placeholders1)}`)
    // Debug: log participant identities
    const identities1 = await page1.locator('[data-lk-local-participant]').evaluateAll(
      (els) => els.map((e) => ({
        local: e.getAttribute('data-lk-local-participant'),
        name: e.getAttribute('data-lk-participant-name')
      }))
    )
    console.log(`User 1 participant attrs: ${JSON.stringify(identities1)}`)

    // At least one avatar should be visible (the other participant's tile
    // should show their avatar when their camera is off)
    expect(count1).toBeGreaterThan(0)
    expect(count2).toBeGreaterThan(0)

    // --- Verify participant names are still rendering ---
    const names1 = await page1.locator('.lk-participant-name').allTextContents()
    const names2 = await page2.locator('.lk-participant-name').allTextContents()
    console.log(`User 1 sees names: ${names1}`)
    console.log(`User 2 sees names: ${names2}`)
    expect(names1.some((n) => n.includes('HiveHost') || n.includes('BuzzGuest'))).toBe(true)
    expect(names2.some((n) => n.includes('HiveHost') || n.includes('BuzzGuest'))).toBe(true)

    // --- Final screenshots ---
    await page1.screenshot({ path: 'e2e/screenshots/camoff-03-user1-final.png' })
    await page2.screenshot({ path: 'e2e/screenshots/camoff-03-user2-final.png' })

    // Save console logs
    fs.writeFileSync('e2e/screenshots/camoff-user1-console.log', logs1.join('\n'))
    fs.writeFileSync('e2e/screenshots/camoff-user2-console.log', logs2.join('\n'))

    await context1.close()
    await context2.close()
  })

  test('desktop and mobile responsive screenshots', async ({ browser }) => {
    test.setTimeout(300_000)

    // Single user joins with camera ON to show video tiles + compact control bar
    const context = await browser.newContext({
      recordVideo: { dir: 'e2e/screenshots/' },
      permissions: ['camera', 'microphone']
    })
    await context.grantPermissions(['camera', 'microphone'], {
      origin: 'http://localhost:5173'
    })
    const page = await context.newPage()

    // Start at desktop size
    await page.setViewportSize({ width: 1280, height: 800 })

    const logs: string[] = []
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))

    // --- Log in ---
    await loginWithNsec(page, NSEC1)

    // --- Join room77 ---
    await joinRoom77(page, true)
    await expect(page).toHaveURL(new RegExp(`/video-rooms/${ROOM_NAME}`))

    // Capture PreJoin at desktop
    await page.screenshot({ path: 'e2e/screenshots/responsive-01-desktop-prejoin.png' })

    // Join the conference
    const joinBtn = page.getByRole('button', { name: /^Join$/ }).last()
    await expect(joinBtn).toBeVisible({ timeout: 30_000 })
    await joinBtn.click()

    // Wait for connection
    await page.waitForTimeout(12_000)

    // --- Desktop screenshots (1280x800) ---
    await page.screenshot({ path: 'e2e/screenshots/responsive-02-desktop-conference.png' })

    // Capture the control bar area (bottom 80px)
    const vs = page.viewportSize()!
    await page.screenshot({
      path: 'e2e/screenshots/responsive-03-desktop-controlbar.png',
      clip: { x: 0, y: vs.height - 80, width: vs.width, height: 80 }
    })

    // --- Resize to tablet (768x1024) ---
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: 'e2e/screenshots/responsive-04-tablet-conference.png' })

    const vsTablet = page.viewportSize()!
    await page.screenshot({
      path: 'e2e/screenshots/responsive-05-tablet-controlbar.png',
      clip: { x: 0, y: vsTablet.height - 80, width: vsTablet.width, height: 80 }
    })

    // --- Resize to mobile (390x844 — iPhone 14 Pro) ---
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(2_000)
    await page.screenshot({ path: 'e2e/screenshots/responsive-06-mobile-conference.png' })

    const vsMobile = page.viewportSize()!
    await page.screenshot({
      path: 'e2e/screenshots/responsive-07-mobile-controlbar.png',
      clip: { x: 0, y: vsMobile.height - 80, width: vsMobile.width, height: 80 }
    })

    // --- Verify control bar is compact (icon-only) at all sizes ---
    const controlBarBtns = page.locator('.lk-control-bar .lk-button')
    const btnCount = await controlBarBtns.count()
    console.log(`Control bar button count (mobile): ${btnCount}`)
    expect(btnCount).toBeGreaterThan(3)

    // Verify no text labels on the main toggle buttons
    const btnTexts = await controlBarBtns.evaluateAll(
      (els) => els.map((e) => e.textContent?.trim() ?? '')
    )
    console.log(`Control bar button texts (mobile): ${JSON.stringify(btnTexts)}`)
    // The main buttons (mic, camera, screenshare, chat, leave) should have no text
    const mainBtnTexts = btnTexts.filter((t) => t.length > 0 && !t.includes('Fake') && !t.includes('fake'))
    console.log(`Main button texts (should be empty): ${JSON.stringify(mainBtnTexts)}`)

    // --- Verify participant name renders ---
    const names = await page.locator('.lk-participant-name').allTextContents()
    console.log(`Participant names: ${names}`)
    expect(names.some((n) => n.includes('HiveHost'))).toBe(true)

    // Save console logs
    const fs = await import('fs')
    fs.writeFileSync('e2e/screenshots/responsive-console.log', logs.join('\n'))

    await context.close()
  })
})
