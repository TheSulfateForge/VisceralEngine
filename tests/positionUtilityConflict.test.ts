import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v1.32 regression guard — conflicting Tailwind position utilities.
 *
 * Tailwind emits position utilities in a fixed order:
 *
 *     .static  .fixed  .absolute  .relative  .sticky
 *
 * They all have equal specificity, so when two of them land on one element the
 * LAST ONE IN THE STYLESHEET wins — not the last one in the class attribute.
 * `class="fixed relative"` resolves to position: relative, which reads exactly
 * backwards from the source.
 *
 * The bug this caught: Sidebar.tsx appended `${isHighTrauma ? 'relative' : ''}`
 * to a class list starting `fixed lg:static`. Below the lg breakpoint the
 * sidebar is meant to be `fixed` — off-canvas and out of flow. The moment
 * character trauma crossed 70 it silently became an in-flow 20rem flex item,
 * still painted off-screen by -translate-x-full but reserving its width.
 * Measured in Chromium at a 430px viewport, <main> collapsed 430px -> 62px and
 * the narrative wrapped at about one character per line.
 *
 * The failure mode is nasty because it is invisible until a runtime condition
 * flips, and the class list reads correctly to a human. This test scans source
 * instead of waiting for that condition.
 */

const POSITIONS = ['static', 'fixed', 'absolute', 'relative', 'sticky'] as const;

/**
 * Match a position utility ONLY when it carries no variant prefix.
 *
 * `lg:static` is deliberately not a conflict: it applies only above the lg
 * breakpoint, so pairing it with an unprefixed `fixed` is the intended
 * responsive pattern and every mobile-drawer layout uses it. The hazard is two
 * utilities that are live at the SAME breakpoint.
 */
const barePosition = (token: string): string | null => {
    if (token.includes(':')) return null;   // variant-scoped — not a same-breakpoint conflict
    return (POSITIONS as readonly string[]).includes(token) ? token : null;
};

const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith('.tsx')) out.push(full);
    }
    return out;
};

/**
 * Extract each className={`...`} template literal, then report any that contain
 * an UNCONDITIONAL bare position utility alongside a CONDITIONAL one inside an
 * interpolation. Both variants of the same bare name are fine (`fixed` +
 * `lg:static` is the intended responsive pattern); the hazard is two different
 * bare positions where at least one is conditional.
 */
const findConflicts = (source: string, file: string): string[] => {
    const problems: string[] = [];
    const templates = source.match(/className=\{`[^`]*`\}/gs) ?? [];

    for (const tpl of templates) {
        // Interpolated segments — the conditional half.
        const interpolations = tpl.match(/\$\{[^}]*\}/gs) ?? [];
        const outsideInterpolations = tpl.replace(/\$\{[^}]*\}/gs, ' ');

        const staticPositions = new Set(
            outsideInterpolations.split(/[\s`]+/).map(barePosition).filter(Boolean) as string[]
        );
        if (staticPositions.size === 0) continue;

        const conditionalPositions = new Set<string>();
        for (const interp of interpolations) {
            // Pull quoted class strings out of the ternary branches.
            for (const quoted of interp.match(/'[^']*'|"[^"]*"/g) ?? []) {
                for (const token of quoted.slice(1, -1).split(/\s+/)) {
                    const bare = barePosition(token);
                    if (bare) conditionalPositions.add(bare);
                }
            }
        }

        for (const conditional of conditionalPositions) {
            for (const staticPos of staticPositions) {
                if (conditional !== staticPos) {
                    problems.push(
                        `${file}: conditional "${conditional}" conflicts with unconditional "${staticPos}" ` +
                        `in the same className. Tailwind order decides the winner, not class order.`
                    );
                }
            }
        }
    }
    return problems;
};

describe('Tailwind position-utility conflicts', () => {
    it('no component conditionally appends a position utility to a class list that already sets one', () => {
        const files = walk(join(process.cwd(), 'components'));
        expect(files.length).toBeGreaterThan(10);   // sanity: the walk actually found the tree

        const problems = files.flatMap(f => findConflicts(readFileSync(f, 'utf8'), f.replace(process.cwd() + '/', '')));
        expect(problems).toEqual([]);
    });

    it('detects the exact shape of the Sidebar bug in a synthetic sample', () => {
        // Guards the guard: if the matcher silently stopped working, the test
        // above would pass vacuously forever.
        const sample = 'const x = <aside className={`fixed lg:static w-80 ${isHighTrauma ? \'relative\' : \'\'}`} />;';
        const problems = findConflicts(sample, 'synthetic.tsx');
        expect(problems).toHaveLength(1);
        expect(problems[0]).toContain('conditional "relative"');
        expect(problems[0]).toContain('unconditional "fixed"');
    });

    it('does not flag the intended responsive pattern (fixed + lg:static)', () => {
        const sample = 'const x = <aside className={`fixed lg:static ${open ? \'translate-x-0\' : \'-translate-x-full\'}`} />;';
        expect(findConflicts(sample, 'synthetic.tsx')).toEqual([]);
    });
});
