require('dotenv').config({ path: 'electron-builder.env' })

const hasAppleNotarizeCreds = !!process.env.APPLE_ID
const hasMacSigningCert = !!process.env.CSC_LINK || hasAppleNotarizeCreds

module.exports = {
  appId: 'com.codytseng.jumble',
  productName: 'Jumble',
  copyright: 'Copyright © ${author}',
  // Inside flatpak-builder, module builds run sandboxed without network, so
  // electron-builder can't download the Electron zip from github.com. The
  // flatpak manifest pre-fetches it into FLATPAK_ELECTRON_CACHE; resolve it
  // there instead of downloading.
  electronDist: (options) => {
    const cache = process.env.FLATPAK_ELECTRON_CACHE
    if (!cache) return null
    return `${cache}/electron-v${options.version}-${options.platformName}-${options.arch}.zip`
  },
  directories: {
    output: 'release/${version}',
    buildResources: 'build'
  },
  publish: {
    provider: 'github',
    owner: 'CodyTseng',
    repo: 'jumble',
    releaseType: 'draft'
  },
  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
    '!node_modules/**/*',
    'node_modules/ws/**/*'
  ],
  asar: true,
  mac: {
    category: 'public.app-category.social-networking',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    identity: hasMacSigningCert ? 'Developer ID Application' : null,
    notarize: hasAppleNotarizeCreds,
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] }
    ],
    artifactName: 'Jumble-mac-${arch}.${ext}',
    icon: 'public/pwa-512x512.png'
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Jumble-windows-${arch}.${ext}',
    icon: 'public/pwa-512x512.png'
  },
  nsis: {
    oneClick: true,
    perMachine: false
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Network',
    artifactName: 'Jumble-linux-${arch}.${ext}',
    icon: 'public/pwa-512x512.png'
  }
}
