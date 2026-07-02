# Prompt Regression Harness

Every prompt change (systemInstructions.ts, sectionReminders.ts) risks silently
regressing something you fixed months ago — v1.20's characterization diet exists
because v1.15's threat-parity language caused the clinical-voice collapse. This
folder turns prompt tuning from vibes into evidence.

## Capturing a golden (a "problem turn")

Every live turn stores its full prompt parts on `window.__vreLastTurn`. When a
turn produces a bad output (voice flip, fade-to-black, retroactive lore, etc.):

1. Open DevTools console on the game tab.
2. Run: `copy(JSON.stringify(window.__vreLastTurn, null, 2))`
3. Paste into a new file: `goldens/<short-name>.json`
4. Add two fields by hand:
   - `"notes"`: what went wrong on this turn
   - `"expect"`: 1-3 things a GOOD output does (checked by eyeball, not code)

Aim for 10-15 goldens covering your recurring failure modes: one voice-flip
case, one intimate-scene case, one origin-gate case, one genre-lock case, etc.

## Replaying against current prompts

```
GEMINI_API_KEY=<key> node prompt-regression/replay.mjs            # all goldens
GEMINI_API_KEY=<key> node prompt-regression/replay.mjs duke-voice  # one golden
```

Each golden is re-run with its captured `dynamicContext` + `userText`, but the
CURRENT `systemInstruction` is swapped in when you pass `--current` (reads the
string live from systemInstructions.ts via a regex extract — no build needed):

```
GEMINI_API_KEY=<key> node prompt-regression/replay.mjs --current
```

Outputs land in `prompt-regression/out/<timestamp>/<name>.md` with the
narrative, thought_process, and your `expect` list side by side. Diff two runs
(before/after a prompt change) to see what moved.

## What this is NOT

Not CI, not automated scoring. It's a repeatable A/B loop: change a prompt,
replay the goldens, read the outputs against `expect`. Manual judgment,
mechanical reproduction.
