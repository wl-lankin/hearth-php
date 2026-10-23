// Signs dist/manifest.json with the catalog key (minisign, Tauri's key format) and writes
// dist/manifest.json.sig. Key and password come from HEARTH_PHP_SIGNING_KEY(_PASSWORD).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const key = process.env.HEARTH_PHP_SIGNING_KEY;
if (!key) {
  console.error('HEARTH_PHP_SIGNING_KEY is not set');
  process.exit(1);
}
// The CLI's JS entry runs under this Node directly: no shell, so nothing is concatenated into a command line.
execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'signer', 'sign', 'dist/manifest.json'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.HEARTH_PHP_SIGNING_KEY_PASSWORD ?? '',
  },
});
if (!existsSync('dist/manifest.json.sig')) {
  console.error('the signature was not written');
  process.exit(1);
}
