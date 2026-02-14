/**
 * encode-logos.mjs
 * ================
 * Reads public/logo192.png & public/logo512.png and writes
 * their base64 representations to scripts/logo-vault.json.
 *
 * Called by the "Encode Logo Vault" GitHub Action workflow.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const files = ['public/logo192.png', 'public/logo512.png'];
const vault = {};

for (const relPath of files) {
  const absPath = resolve(ROOT, relPath);
  if (!existsSync(absPath)) {
    console.error(`❌ File not found: ${relPath}`);
    process.exit(1);
  }
  const buf = readFileSync(absPath);
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) {
    console.error(`❌ ${relPath} is NOT a valid PNG (bad header). Fix it first.`);
    process.exit(1);
  }
  vault[relPath] = buf.toString('base64');
  console.log(`✅ Encoded ${relPath} (${buf.length} bytes)`);
}

const outPath = resolve(__dirname, 'logo-vault.json');
writeFileSync(outPath, JSON.stringify(vault, null, 2));
console.log(`\n🔒 Vault written to scripts/logo-vault.json`);
