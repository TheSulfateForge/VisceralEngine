#!/usr/bin/env node
// ============================================================================
// prompt-regression/replay.mjs — v1.24
//
// Replays captured "golden" turns against Gemini so prompt changes can be
// A/B'd instead of vibes-tested. See README.md in this folder.
//
// Usage:
//   GEMINI_API_KEY=<key> node prompt-regression/replay.mjs [name] [--current] [--model=<model>]
//
//   [name]      replay only goldens whose filename contains this substring
//   --current   swap in the CURRENT SYSTEM_INSTRUCTIONS from
//               ../systemInstructions.ts instead of the captured one
//   --model     override the model (default: the golden's captured model,
//               falling back to gemini-2.5-flash)
// ============================================================================

import { GoogleGenAI } from '@google/genai';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDENS_DIR = join(__dirname, 'goldens');
const OUT_ROOT = join(__dirname, 'out');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY env var is required.');
  process.exit(1);
}

const args = process.argv.slice(2);
const useCurrent = args.includes('--current');
const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1];
const nameFilter = args.find(a => !a.startsWith('--'));

// --current: extract the SYSTEM_INSTRUCTIONS template literal from the TS
// source without a build step. The banned-names interpolation is replaced
// with a placeholder — irrelevant for regression judgment.
let currentSystemInstructions = null;
if (useCurrent) {
  const src = readFileSync(join(__dirname, '..', 'systemInstructions.ts'), 'utf8');
  const m = src.match(/export const SYSTEM_INSTRUCTIONS = `([\s\S]*)`;\s*$/);
  if (!m) {
    console.error('Could not extract SYSTEM_INSTRUCTIONS from systemInstructions.ts');
    process.exit(1);
  }
  currentSystemInstructions = m[1].replace(/\$\{BANNED_NAMES_PROMPT_STRING\}/g, '(banned names list)');
}

let goldenFiles;
try {
  goldenFiles = readdirSync(GOLDENS_DIR).filter(f => f.endsWith('.json'));
} catch {
  console.error(`No goldens directory at ${GOLDENS_DIR}. See README.md to capture goldens.`);
  process.exit(1);
}
if (nameFilter) goldenFiles = goldenFiles.filter(f => f.includes(nameFilter));
if (goldenFiles.length === 0) {
  console.error('No matching goldens found.');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(OUT_ROOT, stamp + (useCurrent ? '-current' : '-captured'));
mkdirSync(outDir, { recursive: true });

for (const file of goldenFiles) {
  const golden = JSON.parse(readFileSync(join(GOLDENS_DIR, file), 'utf8'));
  const name = file.replace(/\.json$/, '');
  const model = modelArg ?? golden.modelName ?? 'gemini-2.5-flash';
  const systemInstruction = useCurrent ? currentSystemInstructions : golden.systemInstruction;

  const userMessage = [
    golden.dynamicContext ? `[CURRENT STATE — this turn's world context]\n${golden.dynamicContext}` : null,
    `[PLAYER ACTION]\n${golden.userText}`,
  ].filter(Boolean).join('\n\n');

  process.stdout.write(`Replaying ${name} on ${model}... `);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: userMessage,
      config: {
        systemInstruction,
        temperature: 0.9,
        responseMimeType: 'application/json',
      },
    });

    let narrative = response.text ?? '';
    let thought = '';
    try {
      const parsed = JSON.parse(narrative);
      thought = parsed.thought_process ?? '';
      narrative = parsed.narrative ?? narrative;
    } catch { /* non-JSON output — dump raw */ }

    const report = [
      `# ${name}`,
      `- model: ${model}`,
      `- system: ${useCurrent ? 'CURRENT systemInstructions.ts' : 'captured at ' + (golden.capturedAt ?? '?')}`,
      golden.notes ? `\n## What went wrong originally\n${golden.notes}` : '',
      golden.expect ? `\n## A good output should\n${Array.isArray(golden.expect) ? golden.expect.map(e => `- ${e}`).join('\n') : golden.expect}` : '',
      `\n## thought_process\n${thought || '(none)'}`,
      `\n## narrative\n${narrative}`,
    ].filter(Boolean).join('\n');

    writeFileSync(join(outDir, `${name}.md`), report, 'utf8');
    console.log('done');
  } catch (e) {
    console.log(`FAILED: ${e.message}`);
    writeFileSync(join(outDir, `${name}.ERROR.txt`), String(e), 'utf8');
  }
}

console.log(`\nOutputs: ${outDir}`);
