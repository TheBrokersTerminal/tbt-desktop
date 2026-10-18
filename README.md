# The Brokers Terminal — desktop app

A native window around the live terminal at https://thebrokersterminal.com/dashboard.html.
The terminal itself is not bundled: every update published to the website reaches the app at once.

- `npm start` — run it from this folder
- `npx electron-builder --mac dmg --arm64` (and `--x64` for Intel Macs) — Mac installer in `dist/`
- `npx electron-builder --win zip --x64` — Windows test build (the Windows installer, NSIS, must be built on Windows or a GitHub Actions Windows runner; this Mac has no Rosetta)
- Set `CSC_IDENTITY_AUTO_DISCOVERY=false` for unsigned test builds.

Before public release: Apple Developer ID signing + notarisation (Mac), a Windows code-signing certificate, and an update channel for the app shell.

## Releases (from 18 Oct 2026)
Downloads and automatic updates come from this repository's Releases page. To release: raise `version` in package.json,
commit, then `git tag v<version> && git push && git push --tags`. GitHub builds the Mac and Windows installers
(.github/workflows/release.yml) and publishes them; installed apps update themselves.
