// ============================================================================
// utils/engine/bodyModel.ts — v1.48: bodies as data
// ============================================================================
//
// The 2026-10-31 Nissa save. The player restated over OOC, in the middle of a
// sex scene, measurements that were ALREADY written on both character sheets:
// her anatomy was in `appearance` almost word for word, and Ivo's length and
// girth were in his `personality` record. Only her 6" depth was genuinely new.
//
// The data reached the prompt. It did not reach the model's attention:
//   - the PC's appearance travels once, in the cached static prefix, tens of
//     thousands of characters before the turn;
//   - NPCs had no body field at all, so Ivo's measurements lived inside his
//     Kinks paragraph, which is capped to 460 chars whenever he is mentioned
//     but not present;
//   - nothing tracked what happened to a body. Conditions were single words
//     ("Stretched", "Bleeding"), virginity was never marked lost, and
//     `bio.timestamps.lastOrgasm` stayed 0 through several.
//
// This module is the fix's arithmetic. It is pure: no store, no model call.
//   1. resolveBody     — structured fields, falling back to what can be parsed
//                        out of the prose sheets (so existing saves benefit
//                        without the player editing anything);
//   2. computeFit      — the numbers the player was doing by hand ("he is 4
//                        inches longer than her maximum depth");
//   3. applyBodyEvents — the model's `body_events` → BodyState, including
//                        vaginal AND anal virginity;
//   4. tickBodyState   — injuries heal, fluids clear, stretch recovers;
//   5. the [BODIES IN CONTACT] block, injected at the tail in intimate scenes.
// ============================================================================

import type {
    BodyProfile,
    BodyState,
    BodyEvent,
    BodyInjury,
    BodyInjurySeverity,
    BodyFluid,
    Character,
    KnownEntity,
    PlayerCanonEntry,
} from '../../types';

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
    nineteen: 19, twenty: 20,
};

/** A number as digits or a word, optionally followed by "and a half" / ".5". */
const NUM = `(\\d+(?:\\.\\d+)?|${Object.keys(NUMBER_WORDS).join('|')})(\\s+and\\s+a\\s+half)?`;

const toNumber = (raw: string | undefined, half?: string): number | undefined => {
    if (!raw) return undefined;
    const k = raw.toLowerCase();
    const base = k in NUMBER_WORDS ? NUMBER_WORDS[k] : parseFloat(k);
    if (!Number.isFinite(base)) return undefined;
    return half ? base + 0.5 : base;
};

const INCH = `(?:-|\\s)*(?:inch(?:es)?|in\\.?(?=\\s|$|[,;])|"|″)`;

// ---------------------------------------------------------------------------
// Prose parsing
// ---------------------------------------------------------------------------

const PENIS_WORDS = /\b(?:cock|penis|dick|shaft|erection)\b/i;
const VAGINA_WORDS = /\b(?:vagina|vaginal|cunt|pussy|canal|cervix)\b/i;

/** Split prose into sentence-ish windows so a number binds to its own noun. */
const sentences = (text: string): string[] =>
    text.split(/(?<=[.!?;])\s+|\n+/).map(s => s.trim()).filter(Boolean);

export interface ParsedBody {
    profile: BodyProfile;
    /** Human-readable contradictions found in the prose ("two heights: 4'5\", 5'5\""). */
    conflicts: string[];
}

const fmtHeight = (inches: number): string => `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;

// ---------------------------------------------------------------------------
// v1.48: the labeled "Body:" block (World Seed Format Spec, Rule 7D)
// ---------------------------------------------------------------------------
//
//   Body:
//   Height: 5'4"
//   Weight: 140 lbs
//   Build: curvy
//   Breasts: 34DD
//   Penis: 7 in long, 6 in around
//   Vaginal Depth: 6 in
//   Vaginal Tightness: tight
//   Anal Tightness: tight
//   Vaginal Virgin: Yes
//   Anal Virgin: Yes
//
// Read with plain string matching — exact, free, and not at the mercy of an
// extraction model. Labeled values always win over anything read from prose.

const LABELS: Record<string, keyof BodyProfile | 'penis' | 'virgin'> = {
    'height': 'heightIn',
    'weight': 'weightLb',
    'build': 'build',
    'breasts': 'breasts',
    'breast size': 'breasts',
    'cup': 'breasts',
    'penis': 'penis',
    'penis length': 'penisLengthIn',
    'length': 'penisLengthIn',
    'penis girth': 'penisGirthIn',
    'girth': 'penisGirthIn',
    'vaginal depth': 'vaginalDepthIn',
    'depth': 'vaginalDepthIn',
    'vaginal tightness': 'vaginalTightness',
    'anal tightness': 'analTightness',
    'genitals': 'genitals',
    'body notes': 'notes',
    'vaginal virgin': 'vaginalVirgin',
    'anal virgin': 'analVirgin',
    'virgin': 'virgin',
};

const parseYesNo = (v: string): boolean | undefined => {
    const t = v.trim().toLowerCase();
    if (/^(?:yes|y|true|virgin|intact)\b/.test(t)) return true;
    if (/^(?:no|n|false|not)\b/.test(t)) return false;
    return undefined;
};

const parseHeightValue = (v: string): number | undefined => {
    const t = v.trim();
    const ftIn = t.match(/^(\d)\s*['′]\s*(\d{1,2})?/);
    if (ftIn) return parseInt(ftIn[1], 10) * 12 + (ftIn[2] ? parseInt(ftIn[2], 10) : 0);
    const W = Object.keys(NUMBER_WORDS).join('|');
    const words = t.match(new RegExp(`^(\\d|${W})[-\\s]+(?:foot|feet|ft)(?:[-\\s]+(\\d{1,2}|${W}))?`, 'i'));
    if (words) return (toNumber(words[1]) ?? 0) * 12 + (toNumber(words[2]) ?? 0);
    const cm = t.match(/^(\d{2,3})\s*cm\b/i);
    if (cm) return Math.round(parseInt(cm[1], 10) / 2.54);
    const inches = t.match(/^(\d{2,3})\s*(?:in|inches|")?\b/i);
    if (inches) return parseInt(inches[1], 10);
    return undefined;
};

const parseInches = (v: string): number | undefined => {
    const m = v.trim().match(new RegExp(`^${NUM}`, 'i'));
    if (!m) return undefined;
    const n = toNumber(m[1], m[2]);
    return /^\s*[\d.]+\s*cm\b/i.test(v) && n !== undefined ? Math.round((n / 2.54) * 10) / 10 : n;
};

/**
 * The labeled Body block, if the text has one. Only lines after a "Body:"
 * header are read, so "Height:" elsewhere in a sheet (or an unrelated
 * "Length:" in lore) is never mistaken for a body field. The block ends at the
 * first line whose label is not a body label.
 */
export const parseLabeledBody = (text: string): BodyProfile => {
    const out: BodyProfile = {};
    if (!text) return out;
    const lines = text.split(/\r?\n/);
    let inBlock = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (/^body\s*:\s*$/i.test(line)) { inBlock = true; continue; }
        // "Body: Height: 5'4" | Weight: 140 lbs" on one line is accepted too.
        const inline = line.match(/^body\s*:\s*(.+)$/i);
        const candidates = inline ? inline[1].split(/\s*[|;]\s*/) : inBlock ? [line] : [];
        if (inline) inBlock = true;
        if (!inBlock) continue;
        if (!line) continue;
        let anyLabel = false;
        for (const c of candidates) {
            const m = c.match(/^([A-Za-z][A-Za-z ]{1,24}?)\s*:\s*(.+)$/);
            if (!m) continue;
            const key = LABELS[m[1].trim().toLowerCase()];
            if (!key) continue;
            anyLabel = true;
            const val = m[2].trim();
            switch (key) {
                case 'heightIn': { const h = parseHeightValue(val); if (h) out.heightIn = h; break; }
                case 'weightLb': {
                    const w = val.match(/^(\d{2,3})\s*(kg)?/i);
                    if (w) out.weightLb = w[2] ? Math.round(parseInt(w[1], 10) * 2.2046) : parseInt(w[1], 10);
                    break;
                }
                case 'penisLengthIn': { const n = parseInches(val); if (n) out.penisLengthIn = n; break; }
                case 'penisGirthIn': { const n = parseInches(val); if (n) out.penisGirthIn = n; break; }
                case 'vaginalDepthIn': { const n = parseInches(val); if (n) out.vaginalDepthIn = n; break; }
                case 'penis': {
                    const len = val.match(new RegExp(`${NUM}${INCH}?\\s*(?:long|length)`, 'i'));
                    const gir = val.match(new RegExp(`${NUM}${INCH}?\\s*(?:around|girth|circumference)`, 'i'));
                    if (len) out.penisLengthIn = toNumber(len[1], len[2]);
                    if (gir) out.penisGirthIn = toNumber(gir[1], gir[2]);
                    // "7 x 6" / "7 by 6"
                    const by = val.match(new RegExp(`^${NUM}\\s*(?:in\\.?|")?\\s*(?:x|×|by)\\s*${NUM}`, 'i'));
                    if (!len && !gir && by) { out.penisLengthIn = toNumber(by[1], by[2]); out.penisGirthIn = toNumber(by[3], by[4]); }
                    break;
                }
                case 'vaginalVirgin': case 'analVirgin': {
                    const b = parseYesNo(val); if (b !== undefined) out[key] = b; break;
                }
                case 'virgin': {
                    // "Virgin: Yes" = both; "Virgin: vaginal only" / "anal only"
                    const t = val.toLowerCase();
                    if (/vaginal only/.test(t)) { out.vaginalVirgin = true; out.analVirgin = false; }
                    else if (/anal only/.test(t)) { out.analVirgin = true; out.vaginalVirgin = false; }
                    else { const b = parseYesNo(val); if (b !== undefined) { out.vaginalVirgin = b; out.analVirgin = b; } }
                    break;
                }
                case 'breasts': out.breasts = val; break;
                default: (out as Record<string, unknown>)[key] = val;
            }
        }
        if (!inline && !anyLabel) inBlock = false;   // left the block
    }
    return out;
};

/**
 * Pull whatever measurable body facts the prose states. Conservative: a number
 * is only taken when it sits in the same sentence as the body part it measures.
 */
export const parseBodyFromText = (text: string, options: { excerptGenitals?: boolean } = {}): ParsedBody => {
    const profile: BodyProfile = {};
    const conflicts: string[] = [];
    if (!text || !text.trim()) return { profile, conflicts };

    // --- height -------------------------------------------------------------
    // Collected with their position so "first stated" means first in the text,
    // not first pattern to match.
    const heightHits: Array<{ at: number; h: number }> = [];
    const pushHeight = (at: number, ft?: number, inch?: number) => {
        if (ft === undefined || ft < 2 || ft > 9) return;
        heightHits.push({ at, h: ft * 12 + (inch ?? 0) });
    };
    for (const m of text.matchAll(/\b(\d)\s*['′]\s*(\d{1,2})?\s*(?:["″]|in\b)?/g)) {
        pushHeight(m.index ?? 0, toNumber(m[1]), toNumber(m[2]));
    }
    const W = Object.keys(NUMBER_WORDS).join('|');
    for (const m of text.matchAll(new RegExp(`\\b(\\d|${W})[-\\s]+(?:foot|feet|ft)(?:[-\\s]+(\\d{1,2}|${W}))?\\b`, 'gi'))) {
        pushHeight(m.index ?? 0, toNumber(m[1]), toNumber(m[2]));
    }
    const heights: number[] = [];
    for (const { h } of heightHits.sort((a, b) => a.at - b.at)) if (!heights.includes(h)) heights.push(h);
    if (heights.length > 0) profile.heightIn = heights[0];
    if (heights.length > 1) {
        conflicts.push(`${heights.length} different heights: ${heights.map(fmtHeight).join(', ')}`);
    }

    // --- weight -------------------------------------------------------------
    const weights: number[] = [];
    for (const m of text.matchAll(/\b(\d{2,3})\s*(?:lbs?|pounds)\b/gi)) {
        const w = parseInt(m[1], 10);
        if (!weights.includes(w)) weights.push(w);
    }
    if (weights.length > 0) profile.weightLb = weights[0];
    if (weights.length > 1) {
        conflicts.push(`${weights.length} different weights: ${weights.map(w => `${w} lb`).join(', ')}`);
    }

    // --- cup ----------------------------------------------------------------
    const cup = text.match(/\b(\d{2}\s?[A-K]{1,3})\s*cup\b/i) ?? text.match(/\b([A-K]{1,3})[-\s]cup\b/);
    if (cup) profile.breasts = `${cup[1].replace(/\s/g, '')} cup`;

    // --- per-sentence genital measurements ----------------------------------
    const genitalSentences: string[] = [];
    for (const s of sentences(text)) {
        const isPenis = PENIS_WORDS.test(s);
        const isVagina = VAGINA_WORDS.test(s);
        // A genital noun in a sentence about hitting someone ("spanks land on
        // ass, tits, or cunt") is not a description of this body.
        if ((isPenis || isVagina || /\b(?:labia|clit|clitoris|asshole|anus|balls|scrotum|sheath)\b/i.test(s))
            && !/\b(?:spank|slap|smack|punch|hit|strike)\w*/i.test(s)
            && !genitalSentences.includes(s)) {
            genitalSentences.push(s);
        }

        if (isPenis) {
            const girth =
                s.match(new RegExp(`\\b${NUM}(?:${INCH})?\\s+(?:around|in\\s+girth|girth|in\\s+circumference|circumference)\\b`, 'i')) ??
                s.match(new RegExp(`\\b(?:girth|circumference)\\s+(?:of\\s+)?${NUM}`, 'i'));
            if (girth && profile.penisGirthIn === undefined) profile.penisGirthIn = toNumber(girth[1], girth[2]);

            const length =
                s.match(new RegExp(`\\b${NUM}${INCH}\\s*(?:long|in\\s+length)\\b`, 'i')) ??
                s.match(new RegExp(`\\b${NUM}[-\\s]inch\\s+(?:long\\s+)?(?:cock|penis|dick|shaft)`, 'i')) ??
                s.match(new RegExp(`\\blength\\s+(?:of\\s+)?${NUM}`, 'i'));
            if (length && profile.penisLengthIn === undefined) profile.penisLengthIn = toNumber(length[1], length[2]);
        }

        if (isVagina) {
            const depth =
                s.match(new RegExp(`\\bdepth\\b[^.]{0,40}?\\b${NUM}${INCH}`, 'i')) ??
                s.match(new RegExp(`\\b${NUM}${INCH}\\s*deep\\b`, 'i'));
            if (depth && profile.vaginalDepthIn === undefined) profile.vaginalDepthIn = toNumber(depth[1], depth[2]);
        }
    }
    if (options.excerptGenitals !== false && genitalSentences.length > 0) {
        const joined = genitalSentences.join(' ');
        profile.genitals = joined.length > 700 ? `${joined.slice(0, 700).replace(/\s+\S*$/, '')}…` : joined;
    }

    // --- virginity ----------------------------------------------------------
    const NOT_SEXUAL = /\bvirgin\s+(?:forest|soil|olive|wool|snow|territory|land|ground|timber)\b/i;
    const noPriorSex = /\bno\s+(?:prior\s+|previous\s+)?sexual\s+(?:activity|experience|history|contact)\b|\bnever\s+(?:had\s+sex|been\s+touched)\b/i;
    const analVirgin = /\banal\s+virgin\b|\bvirgin\s+(?:ass|asshole|anus|arse)\b|\bnever\s+(?:been\s+)?(?:taken|fucked|had\s+anything)\s+(?:in|up)\s+(?:the|her|his|my)\s+(?:ass|arse|asshole)\b/i;
    const anyVirgin = /\bvirgin(?:al)?\b/i;
    if (anyVirgin.test(text) && !NOT_SEXUAL.test(text)) {
        // "virgin" alone is vaginal when there is vaginal anatomy to speak of.
        if (VAGINA_WORDS.test(text) || /\bvirgin\s+(?:hole|cunt|pussy)\b/i.test(text) || noPriorSex.test(text)) {
            profile.vaginalVirgin = true;
        }
    }
    if (analVirgin.test(text) || (noPriorSex.test(text) && anyVirgin.test(text))) {
        profile.analVirgin = true;
    }

    // v1.48: the labeled Body block wins over prose. A prose figure that
    // disagrees with it is still worth reporting, but the "first one stated"
    // wording no longer applies.
    const labeled = parseLabeledBody(text);
    const finalConflicts = conflicts.filter(c =>
        !(labeled.heightIn !== undefined && /height/.test(c)) &&
        !(labeled.weightLb !== undefined && /weight/.test(c)));
    if (labeled.heightIn !== undefined && heights.some(h => h !== labeled.heightIn)) {
        finalConflicts.push(`a height in the prose (${heights.filter(h => h !== labeled.heightIn).map(fmtHeight).join(', ')}) that disagrees with the Body block (${fmtHeight(labeled.heightIn)}) — the Body block is used`);
    }
    if (labeled.weightLb !== undefined && weights.some(w => w !== labeled.weightLb)) {
        finalConflicts.push(`a weight in the prose (${weights.filter(w => w !== labeled.weightLb).map(w => `${w} lb`).join(', ')}) that disagrees with the Body block (${labeled.weightLb} lb) — the Body block is used`);
    }
    return { profile: { ...profile, ...labeled }, conflicts: finalConflicts };
};

// ---------------------------------------------------------------------------
// Resolution — explicit fields win, prose fills the gaps
// ---------------------------------------------------------------------------

export interface ResolvedBody {
    profile: BodyProfile;
    /** Field names that came from prose rather than the structured editor. */
    parsedFields: string[];
    conflicts: string[];
}

const mergeProfiles = (explicit: BodyProfile | undefined, parsed: BodyProfile): { profile: BodyProfile; parsedFields: string[] } => {
    const out: BodyProfile = { ...(explicit ?? {}) };
    const parsedFields: string[] = [];
    for (const [k, v] of Object.entries(parsed) as [keyof BodyProfile, unknown][]) {
        const cur = out[k];
        const empty = cur === undefined || cur === null || (typeof cur === 'string' && !cur.trim());
        if (empty && v !== undefined) {
            (out as Record<string, unknown>)[k] = v;
            parsedFields.push(k);
        }
    }
    return { profile: out, parsedFields };
};

export const resolveCharacterBody = (character: Character, canon: PlayerCanonEntry[] = []): ResolvedBody => {
    // Canon first among the prose sources: it is what the player stated most
    // recently, and in the reviewed save it is the only place the depth lives.
    //
    // Two passes: the sheet supplies everything including the verbatim genital
    // excerpt; canon supplies numbers and flags only, because canon already
    // rides the prompt in [PLAYER CANON] and is often a paraphrase of the sheet.
    const sheet = parseBodyFromText(character.appearance ?? '');
    const extras = [
        parseBodyFromText(character.notableFeatures ?? '', { excerptGenitals: false }),
        parseBodyFromText(canon.map(c => c.fact).join('\n'), { excerptGenitals: false }),
    ];
    const parsed: BodyProfile = { ...sheet.profile };
    for (const extra of extras) {
        for (const [k, v] of Object.entries(extra.profile) as [keyof BodyProfile, unknown][]) {
            if (parsed[k] === undefined && v !== undefined) (parsed as Record<string, unknown>)[k] = v;
        }
    }
    const { profile, parsedFields } = mergeProfiles(character.body, parsed);
    return { profile, parsedFields, conflicts: sheet.conflicts };
};

export const resolveEntityBody = (entity: KnownEntity): ResolvedBody => {
    const text = [entity.appearance ?? '', entity.personality ?? ''].join('\n');
    const parsed = parseBodyFromText(text);
    const { profile, parsedFields } = mergeProfiles(entity.body, parsed.profile);
    return { profile, parsedFields, conflicts: parsed.conflicts };
};

/** True when a profile has anything the bodies block can use. */
export const hasBodyData = (p: BodyProfile): boolean =>
    Object.values(p).some(v => v !== undefined && v !== null && !(typeof v === 'string' && !v.trim()));

// ---------------------------------------------------------------------------
// Virginity
// ---------------------------------------------------------------------------

export type VirginityStatus = 'virgin' | 'not virgin' | 'unknown';

export const vaginalVirginity = (p: BodyProfile, s?: BodyState): VirginityStatus => {
    if (s?.vaginalVirginityLost) return 'not virgin';
    if (p.vaginalVirgin === true) return 'virgin';
    if (p.vaginalVirgin === false) return 'not virgin';
    return 'unknown';
};

export const analVirginity = (p: BodyProfile, s?: BodyState): VirginityStatus => {
    if (s?.analVirginityLost) return 'not virgin';
    if (p.analVirgin === true) return 'virgin';
    if (p.analVirgin === false) return 'not virgin';
    return 'unknown';
};

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

/** Commonly cited adult averages, used only as a comparison point. */
export const AVERAGE_ERECT_LENGTH_IN = 5.2;
export const AVERAGE_ERECT_GIRTH_IN = 4.6;

const r1 = (n: number) => Math.round(n * 10) / 10;

export interface FitLine {
    /** e.g. "Ivo Kerrick → Nissa Quickbrook (vaginal)" */
    pair: string;
    lines: string[];
}

export const computeFit = (
    penetratorName: string,
    pen: BodyProfile,
    receiverName: string,
    rec: BodyProfile,
    recState: BodyState | undefined,
): FitLine[] => {
    const out: FitLine[] = [];
    const L = pen.penisLengthIn;
    const G = pen.penisGirthIn;
    if (L === undefined && G === undefined) return out;

    const girthLines = (): string[] => {
        if (G === undefined) return [];
        const dia = G / Math.PI;
        return [
            `Girth ${r1(G)} in around = ${r1(dia)} in across — ${r1(G / AVERAGE_ERECT_GIRTH_IN)}× the average adult girth (${AVERAGE_ERECT_GIRTH_IN} in).`,
        ];
    };

    // Vaginal
    if (rec.vaginalDepthIn !== undefined || rec.vaginalTightness || rec.vaginalVirgin !== undefined || recState?.vaginalVirginityLost) {
        const lines: string[] = [];
        if (L !== undefined && rec.vaginalDepthIn !== undefined) {
            const excess = L - rec.vaginalDepthIn;
            if (excess > 0) {
                lines.push(
                    `Length ${r1(L)} in vs her maximum depth ${r1(rec.vaginalDepthIn)} in: ${r1(excess)} in longer than she is deep. ` +
                    `He bottoms out against her cervix with ${r1(excess)} in still outside her; any of that ${r1(excess)} in that goes in does so only by driving the cervix and uterus deeper into her body.`,
                );
            } else {
                lines.push(`Length ${r1(L)} in vs her maximum depth ${r1(rec.vaginalDepthIn)} in: fits fully without reaching past the cervix.`);
            }
        }
        lines.push(...girthLines());
        const v = vaginalVirginity(rec, recState);
        if (v === 'virgin') lines.push('She is a vaginal virgin: first penetration breaks the hymen and is the tightest her body will ever be.');
        if (recState?.vaginalStretch) lines.push(`Current vaginal stretch: ${stretchLabel(recState.vaginalStretch)}.`);
        if (rec.vaginalTightness) lines.push(`Tightness (sheet): ${rec.vaginalTightness}.`);
        if (lines.length > 0) out.push({ pair: `${penetratorName} → ${receiverName} (vaginal)`, lines });
    }

    // Anal — no depth figure; girth and virginity are what matter.
    {
        const lines: string[] = [];
        lines.push(...girthLines());
        const a = analVirginity(rec, recState);
        if (a === 'virgin') lines.push(`${receiverName} is an anal virgin: first anal penetration is the tightest it will ever be.`);
        if (recState?.analStretch) lines.push(`Current anal stretch: ${stretchLabel(recState.analStretch)}.`);
        if (rec.analTightness) lines.push(`Tightness (sheet): ${rec.analTightness}.`);
        if (a !== 'unknown' || rec.analTightness || recState?.analStretch) {
            out.push({ pair: `${penetratorName} → ${receiverName} (anal)`, lines });
        }
    }
    return out;
};

// ---------------------------------------------------------------------------
// Events → state
// ---------------------------------------------------------------------------

const HEAL_MINUTES: Record<BodyInjurySeverity, number> = {
    minor: 24 * 60,
    moderate: 4 * 24 * 60,
    severe: 14 * 24 * 60,
};
const FLUID_CLEAR_MINUTES: Record<string, number> = {
    vagina: 8 * 60,
    anus: 4 * 60,
    mouth: 60,
};
/** One stretch level recovers per this many minutes. */
export const STRETCH_RECOVERY_MINUTES = 12 * 60;

export const stretchLabel = (n: number): string =>
    n >= 3 ? 'gaped (3/3)' : n === 2 ? 'badly stretched (2/3)' : n === 1 ? 'stretched (1/3)' : 'recovered';

const normSeverity = (s: string | undefined): BodyInjurySeverity =>
    s === 'severe' || s === 'moderate' ? s : 'minor';

const orificeWhere = (o: string | undefined): 'vagina' | 'anus' | 'mouth' | undefined => {
    const k = (o ?? '').toLowerCase();
    if (/vag|pussy|cunt/.test(k)) return 'vagina';
    if (/anal|anus|ass|rect/.test(k)) return 'anus';
    if (/oral|mouth|throat/.test(k)) return 'mouth';
    return undefined;
};

/** Stretch caused by a girth against a receiver, before decay. 0-3. */
export const stretchFromGirth = (girthIn: number | undefined, wasVirgin: boolean, tightness?: string): number => {
    if (girthIn === undefined) return wasVirgin ? 1 : 0;
    const ratio = girthIn / AVERAGE_ERECT_GIRTH_IN;
    let level = ratio >= 1.8 ? 3 : ratio >= 1.4 ? 2 : ratio >= 1.1 ? 1 : 0;
    if (wasVirgin || /tight/i.test(tightness ?? '')) level += 1;
    return Math.max(0, Math.min(3, level));
};

export interface BodyTarget {
    kind: 'pc' | 'npc';
    name: string;
    /** index into the entity list when kind === 'npc' */
    index?: number;
}

const firstName = (n: string) => n.trim().split(/\s+/)[0]?.toLowerCase() ?? '';

/** Resolve an event's `who` / `by` to the PC or a known entity. */
export const resolveBodyTarget = (
    raw: string | undefined,
    pcName: string,
    entities: KnownEntity[],
): BodyTarget | null => {
    const who = (raw ?? '').trim().toLowerCase();
    if (!who) return null;
    if (who === 'player' || who === 'pc' || who === 'you' || who === pcName.toLowerCase() || who === firstName(pcName)) {
        return { kind: 'pc', name: pcName };
    }
    const exact = entities.findIndex(e => e.name.toLowerCase() === who);
    if (exact >= 0) return { kind: 'npc', name: entities[exact].name, index: exact };
    const byFirst = entities
        .map((e, i) => ({ e, i }))
        .filter(({ e }) => firstName(e.name) === who || e.name.toLowerCase().includes(who));
    if (byFirst.length === 1) return { kind: 'npc', name: byFirst[0].e.name, index: byFirst[0].i };
    return null;
};

export interface ApplyBodyEventsResult {
    character: Character;
    entities: KnownEntity[];
    logs: string[];
}

/**
 * Fold this turn's body events into BodyState. Pure: returns new objects.
 *
 * Only PENILE penetration takes virginity on its own — in the reviewed save the
 * player was explicit that a finger "is the largest thing I have ever had
 * inside my virgin cunt", i.e. still a virgin. Anything else takes it only via
 * an explicit `virginity_lost` event.
 */
export const applyBodyEvents = (
    events: BodyEvent[] | undefined,
    character: Character,
    entities: KnownEntity[],
    turn: number,
    nowMinute: number,
    canon: PlayerCanonEntry[] = [],
): ApplyBodyEventsResult => {
    const logs: string[] = [];
    let pc: Character = { ...character, bodyState: { ...(character.bodyState ?? {}) } };
    const ents: KnownEntity[] = entities.map(e => e);
    if (!events || events.length === 0) return { character: pc, entities: ents, logs };

    const getState = (t: BodyTarget): BodyState =>
        t.kind === 'pc' ? (pc.bodyState ?? {}) : { ...(ents[t.index!].bodyState ?? {}) };
    const getProfile = (t: BodyTarget): BodyProfile =>
        t.kind === 'pc' ? resolveCharacterBody(pc, canon).profile : resolveEntityBody(ents[t.index!]).profile;
    const setState = (t: BodyTarget, s: BodyState) => {
        if (t.kind === 'pc') pc = { ...pc, bodyState: s };
        else ents[t.index!] = { ...ents[t.index!], bodyState: s };
    };

    let seq = 0;
    const id = (p: string) => `${p}_${turn}_${seq++}`;

    for (const ev of events) {
        const target = resolveBodyTarget(ev.who, character.name, ents);
        if (!target) {
            logs.push(`[BODY] Ignored event for unknown character "${ev.who}" (${ev.kind}).`);
            continue;
        }
        const by = (ev.by ?? '').trim();
        const byTarget = resolveBodyTarget(by, character.name, ents);
        const byName = byTarget?.name ?? (by || 'unknown');
        const kind = (ev.kind ?? '').toLowerCase();
        const where = orificeWhere(ev.orifice);
        const state = getState(target);
        const profile = getProfile(target);

        if (kind === 'penetration' || kind === 'virginity_lost') {
            const withPenis = /penis|cock|dick/i.test(ev.with ?? '') || (kind === 'penetration' && !ev.with && byTarget !== null && getProfile(byTarget).penisLengthIn !== undefined);
            const takes = kind === 'virginity_lost' || withPenis;
            if (where === 'vagina' || (kind === 'virginity_lost' && !where)) {
                const wasVirgin = vaginalVirginity(profile, state) === 'virgin';
                if (takes && !state.vaginalVirginityLost && profile.vaginalVirgin !== false) {
                    state.vaginalVirginityLost = { turn, atMinute: nowMinute, by: byName };
                    logs.push(`[BODY] ${target.name}: vaginal virginity taken by ${byName} (turn ${turn}).`);
                }
                if (withPenis && byTarget) {
                    const lvl = stretchFromGirth(getProfile(byTarget).penisGirthIn, wasVirgin, profile.vaginalTightness);
                    if (lvl > (state.vaginalStretch ?? 0)) {
                        state.vaginalStretch = lvl;
                        state.stretchUpdatedAtMinute = nowMinute;
                        logs.push(`[BODY] ${target.name}: vaginal stretch → ${stretchLabel(lvl)}.`);
                    }
                }
            } else if (where === 'anus') {
                const wasVirgin = analVirginity(profile, state) === 'virgin';
                if (takes && !state.analVirginityLost && profile.analVirgin !== false) {
                    state.analVirginityLost = { turn, atMinute: nowMinute, by: byName };
                    logs.push(`[BODY] ${target.name}: anal virginity taken by ${byName} (turn ${turn}).`);
                }
                if (withPenis && byTarget) {
                    const lvl = stretchFromGirth(getProfile(byTarget).penisGirthIn, wasVirgin, profile.analTightness);
                    if (lvl > (state.analStretch ?? 0)) {
                        state.analStretch = lvl;
                        state.stretchUpdatedAtMinute = nowMinute;
                        logs.push(`[BODY] ${target.name}: anal stretch → ${stretchLabel(lvl)}.`);
                    }
                }
            }
        } else if (kind === 'stretch') {
            const lvl = Math.max(0, Math.min(3, Math.round(ev.level ?? 1)));
            if (where === 'anus') state.analStretch = Math.max(state.analStretch ?? 0, lvl);
            else state.vaginalStretch = Math.max(state.vaginalStretch ?? 0, lvl);
            state.stretchUpdatedAtMinute = nowMinute;
            logs.push(`[BODY] ${target.name}: ${where === 'anus' ? 'anal' : 'vaginal'} stretch → ${stretchLabel(lvl)}.`);
        } else if (kind === 'orgasm') {
            state.orgasmCount = (state.orgasmCount ?? 0) + 1;
            state.lastOrgasmTurn = turn;
            if (target.kind === 'pc' && pc.bio) {
                pc = { ...pc, bio: { ...pc.bio, timestamps: { ...pc.bio.timestamps, lastOrgasm: nowMinute } } };
            }
            logs.push(`[BODY] ${target.name}: orgasm (${state.orgasmCount} total).`);
        } else if (kind === 'injury') {
            const site = (ev.site ?? ev.orifice ?? 'unspecified').trim();
            const severity = normSeverity(ev.severity);
            const injuries = [...(state.injuries ?? [])];
            const existing = injuries.findIndex(i => i.site.toLowerCase() === site.toLowerCase());
            const rank = (s: BodyInjurySeverity) => (s === 'severe' ? 2 : s === 'moderate' ? 1 : 0);
            if (existing >= 0) {
                const cur = injuries[existing];
                const sev = rank(severity) > rank(cur.severity) ? severity : cur.severity;
                injuries[existing] = {
                    ...cur,
                    severity: sev,
                    description: ev.description?.trim() || cur.description,
                    healsAtMinute: Math.max(cur.healsAtMinute, nowMinute + HEAL_MINUTES[sev]),
                };
            } else {
                const inj: BodyInjury = {
                    id: id('inj'),
                    site,
                    description: (ev.description ?? '').trim() || site,
                    severity,
                    turnInflicted: turn,
                    healsAtMinute: nowMinute + HEAL_MINUTES[severity],
                };
                injuries.push(inj);
            }
            state.injuries = injuries;
            logs.push(`[BODY] ${target.name}: ${severity} injury — ${site}${ev.description ? `: ${ev.description}` : ''}.`);
        } else if (kind === 'insemination') {
            const place = where ?? 'vagina';
            const what = `${byName}'s semen`;
            const fluids = (state.fluids ?? []).filter(f => !(f.what === what && f.where === place));
            const fl: BodyFluid = {
                id: id('fl'),
                what,
                where: place,
                turn,
                clearsAtMinute: nowMinute + (FLUID_CLEAR_MINUTES[place] ?? 4 * 60),
            };
            fluids.push(fl);
            state.fluids = fluids;
            logs.push(`[BODY] ${target.name}: ${what} in ${place}.`);
        } else {
            logs.push(`[BODY] Ignored unknown event kind "${ev.kind}" for ${target.name}.`);
            continue;
        }
        setState(target, state);
    }
    return { character: pc, entities: ents, logs };
};

/** Heal injuries, clear fluids, recover stretch. Virginity never comes back. */
export const tickBodyState = (s: BodyState | undefined, nowMinute: number): { state: BodyState | undefined; healed: string[] } => {
    if (!s) return { state: s, healed: [] };
    const healed: string[] = [];
    const next: BodyState = { ...s };
    if (s.injuries?.length) {
        next.injuries = s.injuries.filter(i => {
            if (nowMinute >= i.healsAtMinute) { healed.push(`${i.site} healed`); return false; }
            return true;
        });
    }
    if (s.fluids?.length) {
        next.fluids = s.fluids.filter(f => nowMinute < f.clearsAtMinute);
    }
    if ((s.vaginalStretch || s.analStretch) && s.stretchUpdatedAtMinute !== undefined) {
        const steps = Math.floor((nowMinute - s.stretchUpdatedAtMinute) / STRETCH_RECOVERY_MINUTES);
        if (steps > 0) {
            const v = Math.max(0, (s.vaginalStretch ?? 0) - steps);
            const a = Math.max(0, (s.analStretch ?? 0) - steps);
            if (v !== (s.vaginalStretch ?? 0)) healed.push(`vaginal stretch → ${stretchLabel(v)}`);
            if (a !== (s.analStretch ?? 0)) healed.push(`anal stretch → ${stretchLabel(a)}`);
            next.vaginalStretch = v;
            next.analStretch = a;
            next.stretchUpdatedAtMinute = s.stretchUpdatedAtMinute + steps * STRETCH_RECOVERY_MINUTES;
        }
    }
    return { state: next, healed };
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const fmtLoss = (label: string, status: VirginityStatus, loss?: { turn: number; by: string }) =>
    status === 'virgin'
        ? `${label}: VIRGIN`
        : loss
            ? `${label}: not a virgin (taken by ${loss.by}, turn ${loss.turn})`
            : status === 'not virgin'
                ? `${label}: not a virgin`
                : `${label}: not recorded`;

/** One compact line of a body's CURRENT state, or '' when nothing is going on. */
export const describeBodyState = (s: BodyState | undefined, nowMinute: number): string => {
    if (!s) return '';
    const parts: string[] = [];
    if (s.vaginalStretch) parts.push(`vagina ${stretchLabel(s.vaginalStretch)}`);
    if (s.analStretch) parts.push(`anus ${stretchLabel(s.analStretch)}`);
    for (const i of s.injuries ?? []) {
        const hrs = Math.max(0, Math.round((i.healsAtMinute - nowMinute) / 60));
        parts.push(`${i.severity} injury at ${i.site} (${i.description}; ~${hrs}h to heal)`);
    }
    for (const f of s.fluids ?? []) parts.push(`${f.what} in ${f.where}`);
    if (s.orgasmCount) parts.push(`${s.orgasmCount} orgasm(s) so far${s.lastOrgasmTurn !== undefined ? `, last on turn ${s.lastOrgasmTurn}` : ''}`);
    return parts.join('; ');
};

const describeProfile = (p: BodyProfile): string[] => {
    const out: string[] = [];
    const size: string[] = [];
    if (p.heightIn !== undefined) size.push(fmtHeight(p.heightIn));
    if (p.weightLb !== undefined) size.push(`${p.weightLb} lb`);
    if (p.build) size.push(p.build);
    if (size.length) out.push(`Size: ${size.join(', ')}.`);
    if (p.penisLengthIn !== undefined || p.penisGirthIn !== undefined) {
        out.push(`Penis: ${p.penisLengthIn !== undefined ? `${r1(p.penisLengthIn)} in long` : 'length not recorded'}, ${p.penisGirthIn !== undefined ? `${r1(p.penisGirthIn)} in around (${r1(p.penisGirthIn / Math.PI)} in across)` : 'girth not recorded'}.`);
    }
    if (p.vaginalDepthIn !== undefined) out.push(`Vagina: ${r1(p.vaginalDepthIn)} in maximum aroused depth to the cervix.`);
    if (p.breasts) out.push(`Breasts: ${p.breasts}.`);
    if (p.genitals) out.push(`Genitals (author's words): ${p.genitals}`);
    if (p.notes) out.push(`Notes: ${p.notes}`);
    return out;
};

export interface BodyParticipant {
    name: string;
    isPlayer: boolean;
    profile: BodyProfile;
    state?: BodyState;
    conflicts: string[];
}

/**
 * [BODIES IN CONTACT]. Goes in the trailer, immediately before the standing
 * directives, on turns the scene is intimate.
 */
export const buildBodiesInContactBlock = (
    participants: BodyParticipant[],
    nowMinute: number,
    realism: boolean,
): string => {
    const withData = participants.filter(p => hasBodyData(p.profile) || describeBodyState(p.state, nowMinute));
    if (withData.length === 0) return '';

    const sections: string[] = [];
    for (const p of withData) {
        const lines = describeProfile(p.profile);
        const hasPenis = p.profile.penisLengthIn !== undefined || p.profile.penisGirthIn !== undefined;
        const hasVagina = p.profile.vaginalDepthIn !== undefined || p.profile.vaginalVirgin !== undefined || !!p.state?.vaginalVirginityLost
            || (!hasPenis && /\b(?:vagina|cunt|pussy|labia)\b/i.test(p.profile.genitals ?? ''));
        const vs = vaginalVirginity(p.profile, p.state);
        const as = analVirginity(p.profile, p.state);
        // An unrecorded status is worth saying only for the player — it tells
        // them what to fill in. For an NPC it is noise.
        if (hasVagina && (vs !== 'unknown' || p.isPlayer)) lines.push(fmtLoss('Vaginal virginity', vs, p.state?.vaginalVirginityLost));
        if (as !== 'unknown' || p.isPlayer) lines.push(fmtLoss('Anal virginity', as, p.state?.analVirginityLost));
        const now = describeBodyState(p.state, nowMinute);
        if (now) lines.push(`RIGHT NOW: ${now}.`);
        for (const c of p.conflicts) lines.push(/Body block is used/.test(c) ? `⚠ The sheet has ${c}.` : `⚠ The sheet contradicts itself — it gives ${c}. The first one stated is used above.`);
        sections.push(`${p.name.toUpperCase()}${p.isPlayer ? ' (player character)' : ''}\n${lines.map(l => `  - ${l}`).join('\n')}`);
    }

    const fits: string[] = [];
    for (const a of withData) {
        for (const b of withData) {
            if (a === b) continue;
            for (const f of computeFit(a.name, a.profile, b.name, b.profile, b.state)) {
                fits.push(`${f.pair}\n${f.lines.map(l => `  - ${l}`).join('\n')}`);
            }
        }
    }
    const ha = withData.filter(p => p.profile.heightIn !== undefined);
    if (ha.length >= 2) {
        const [x, y] = [...ha].sort((m, n) => (n.profile.heightIn! - m.profile.heightIn!));
        const diff = x.profile.heightIn! - y.profile.heightIn!;
        if (diff >= 6) fits.push(`Size difference: ${x.name} is ${Math.round(diff)} in taller than ${y.name}${x.profile.weightLb && y.profile.weightLb ? ` and ${r1(x.profile.weightLb / y.profile.weightLb)}× the weight` : ''}.`);
    }

    return `[BODIES IN CONTACT — physical facts from the character sheets and tracked state. Binding.]
These are the bodies in this scene. Every description of size, depth, fit,
stretch, pain, injury, fluid and aftermath must agree with these numbers and
this state. Do not shrink, enlarge, or forget any of it from one turn to the
next. The engine computed the comparisons below; do not contradict them.

${sections.join('\n\n')}${fits.length ? `\n\nFIT (computed by the engine)\n${fits.join('\n')}` : ''}${realism ? `

ANATOMICAL REALISM: the consequences of these numbers are real and they
persist — pain, stretching, tearing, bleeding, soreness, and how the body
looks and works afterward follow from the measurements above and carry into
later turns through RIGHT NOW. Report what happened to bodies this turn in
\`body_events\`: every penetration (with orifice and what penetrated), every
orgasm, every injury (site + severity), every insemination.` : `

Report what happened to bodies this turn in \`body_events\`.`}`;
};

// ---------------------------------------------------------------------------
// Scene gate
// ---------------------------------------------------------------------------

/**
 * Sexual content only. `containsMatureContent` (playerFraming) also matches
 * violence, and the bodies block has nothing to say in a sword fight.
 */
const SEXUAL_RE = /\b(?:sex|sexual|sexually|fuck\w*|cock|cocks|cunt\w*|pussy|pussies|clit\w*|labia|penis\w*|vagina\w*|cervix|cervical|breasts?|nipples?|tits?|asshole|anus|anal|cum|cumming|orgasm\w*|naked|nude|arous\w*|thrust\w*|penetrat\w*|erect\w*|squirt\w*|virgin\w*|hymen|semen|climax\w*)\b/i;

export const containsSexualContent = (text: string | undefined | null): boolean =>
    !!text && SEXUAL_RE.test(text);
