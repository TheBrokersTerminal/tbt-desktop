/* Free signature fix (17 Oct 2026): without an Apple Developer ID the app gets an "ad-hoc" signature. electron-builder left
   it half-signed, so macOS called downloaded copies "damaged" with only Move to Bin. Signing the whole app properly (still
   ad-hoc) turns that into the normal "Apple could not verify…" message, which users can allow once in
   System Settings → Privacy & Security → Open Anyway. Replace with a Developer ID + notarisation when the company enrols. */
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], { stdio: 'inherit' });
};
