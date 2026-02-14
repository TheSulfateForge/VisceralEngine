/**
 * restore-logos.mjs
 * =================
 * Runs automatically before every build (via the "prebuild" npm script).
 * Decodes the base64 logo data from logo-vault.json back into real PNGs
 * in the public/ folder so Vite can bundle them normally.
 *
 * This completely bypasses the Google AI Studio sync corruption issue
 * because the vault file is plain text (base64) which syncs cleanly.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const VAULT_PATH = resolve(__dirname, 'logo-vault.json');

if (!existsSync(VAULT_PATH)) {
  console.error('❌ scripts/logo-vault.json not found!');
  console.error('   Run "node scripts/encode-logos.mjs" first with good PNGs.');
  process.exit(1);
}

const vault = JSON.parse(readFileSync(VAULT_PATH, 'utf-8'));
let restored = 0;

for (const [relPath, b64] of Object.entries(vault)) {
  const absPath = resolve(ROOT, relPath);
  const dir = dirname(absPath);

  // Ensure directory exists
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const buf = Buffer.from(b64, 'base64');

  // Validate PNG signature before writing
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
    console.error(`❌ Vault data for ${relPath} is not a valid PNG. Vault may be corrupted.`);
    process.exit(1);
  }

  writeFileSync(absPath, buf);
  console.log(`✅ Restored ${relPath} (${buf.length} bytes)`);
  restored++;
}

console.log(`\n🔓 ${restored} logo(s) restored from vault.`);
