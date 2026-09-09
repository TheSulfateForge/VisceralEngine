// ============================================================================
// SHEET_SECTIONS.TS — v1.40
//
// A canonical `personality` field is authored as labelled sections:
//
//   Performed Surface: ...
//   Subtext Bleed-through: ...
//   Actual Core: ...
//   The Kinks: ...
//   The Approach: ...
//   Body Over Mind: ...
//   Selective Predation: ...
//
// Everything in the engine treated that as one prose blob, and every failure
// this module exists to prevent follows from that:
//
//   - `capPersonality` truncated by CHARACTER COUNT with a special case that
//     tried to preserve "Actual Core". Half a section read as a whole one, and
//     any section after the one it kept was silently gone. A record showing
//     "The Kinks: Severe genital and breast torture, whipping to blood […]"
//     is not a shorter record, it is a WRONG one.
//   - Nothing could answer "does this character have a kink list at all?".
//     Liora Calder does not; the model invented one rather than say so, and
//     the engine had no way to tell it the section was absent.
//   - Nothing could check whether the model's canonical-voice restatement drew
//     on the Actual Core or only on the Performed Surface — which is the
//     mask-mode failure, and it needs the sections to be addressable.
//
// The parse is deliberately forgiving about authoring: any `Label:` at the
// start of a line or after a sentence break opens a section, known labels are
// normalised to their canonical spelling, and text before the first label is
// kept as an unlabelled preamble rather than dropped.
// ============================================================================

/** Canonical labels, and the spellings seen in the wild that map to them. */
const LABEL_ALIASES: Record<string, string> = {
    'performed surface': 'Performed Surface',
    'performed self': 'Performed Surface',
    'surface': 'Performed Surface',
    'public face': 'Performed Surface',
    'subtext bleed-through': 'Subtext Bleed-through',
    'subtext bleedthrough': 'Subtext Bleed-through',
    'subtext bleed through': 'Subtext Bleed-through',
    'subtext': 'Subtext Bleed-through',
    'bleed-through': 'Subtext Bleed-through',
    'actual core': 'Actual Core',
    'core': 'Actual Core',
    'true self': 'Actual Core',
    'the kinks': 'The Kinks',
    'kinks': 'The Kinks',
    'the approach': 'The Approach',
    'approach': 'The Approach',
    'body over mind': 'Body Over Mind',
    'selective predation': 'Selective Predation',
    'predation': 'Selective Predation',
    'voice': 'Voice',
    'history': 'History',
    'goals': 'Goals',
    'limits': 'Limits',
    'hard limits': 'Limits',
};

/** The sections whose absence or presence the engine reasons about. */
export const CORE_LABEL = 'Actual Core';
export const SURFACE_LABEL = 'Performed Surface';
export const KINKS_LABEL = 'The Kinks';

/**
 * A label is 1-4 TITLE-CASED words followed by a colon, at a line start or after
 * a sentence break.
 *
 * Title case is the load-bearing part. A bounded word count alone was not
 * enough: "She has one rule: never be the last to leave a room" is four words
 * and a colon, and opened a phantom section called "She has one rule". Real
 * labels capitalise every word except a short connector — "Performed Surface",
 * "Actual Core", "The Kinks", "Body Over Mind", "Subtext Bleed-through" — and
 * ordinary sentence-case prose does not.
 */
const LABEL_RE =
    /(?:^|\n|(?<=[.!?]\s))\s*([A-Z][A-Za-z'-]*(?:[ -](?:of|the|over|under|and|to|in|on|for|[A-Z][A-Za-z'-]*)){0,3})\s*:\s/g;

export interface SheetSection {
    /** Canonical label where recognised, else the author's own spelling. */
    label: string;
    /** The label exactly as the author wrote it. */
    rawLabel: string;
    /** The section body, trimmed. */
    body: string;
    /** True when the label matched a known alias. */
    known: boolean;
}

export interface ParsedSheet {
    /** Text before the first label. Empty for a fully-sectioned record. */
    preamble: string;
    sections: SheetSection[];
    /** Canonical (or authored) labels, in document order. */
    labels: string[];
    /** True when the record is sectioned at all. */
    isSectioned: boolean;
}

const normalise = (raw: string): { label: string; known: boolean } => {
    const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    const canonical = LABEL_ALIASES[key];
    return canonical ? { label: canonical, known: true } : { label: raw.trim(), known: false };
};

/**
 * Split a personality field into its labelled sections.
 *
 * An unsectioned record (Liora Calder's, for example — three sentences and no
 * labels at all) comes back with `isSectioned: false` and everything in
 * `preamble`. That is a real and useful answer, not a parse failure.
 */
export const parseSheetSections = (personality: string | undefined | null): ParsedSheet => {
    const text = (personality ?? '').trim();
    if (!text) return { preamble: '', sections: [], labels: [], isSectioned: false };

    const marks: { start: number; end: number; raw: string }[] = [];
    LABEL_RE.lastIndex = 0;
    for (const m of text.matchAll(LABEL_RE)) {
        if (m.index === undefined) continue;
        // Offset of the label word itself, not of the leading whitespace.
        const start = m.index + m[0].indexOf(m[1]);
        marks.push({ start, end: start + m[0].length - m[0].indexOf(m[1]), raw: m[1] });
    }

    if (marks.length === 0) {
        return { preamble: text, sections: [], labels: [], isSectioned: false };
    }

    const preamble = text.slice(0, marks[0].start).trim();
    const sections: SheetSection[] = [];
    for (let i = 0; i < marks.length; i++) {
        const body = text
            .slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : undefined)
            .trim();
        if (!body) continue;
        const { label, known } = normalise(marks[i].raw);
        sections.push({ label, rawLabel: marks[i].raw.trim(), body, known });
    }

    return {
        preamble,
        sections,
        labels: sections.map(s => s.label),
        isSectioned: sections.length > 0,
    };
};

/** One section's body by canonical label, or '' when the record has no such section. */
export const getSection = (
    personality: string | undefined | null,
    label: string,
): string => {
    const wanted = label.trim().toLowerCase();
    const found = parseSheetSections(personality).sections
        .find(s => s.label.toLowerCase() === wanted);
    return found?.body ?? '';
};

/** True when the record carries a two-layer structure. */
export const isLayeredSheet = (personality: string | undefined | null): boolean => {
    const { labels } = parseSheetSections(personality);
    return labels.includes(CORE_LABEL) || labels.includes(SURFACE_LABEL);
};

/**
 * Cap a record WITHOUT ever emitting half a section.
 *
 * Replaces the character-count truncation `capPersonality` performed. Sections
 * are admitted whole, in priority order, and any section that does not fit is
 * NAMED as omitted rather than silently dropped — so a partial render can never
 * be mistaken for a complete one, which is the failure mode that matters.
 *
 * Priority is deliberate. `Actual Core` first: it is what the character
 * actually is, and the mask-mode failure is exactly what happens when it goes
 * missing. Then the surface, then the rest in document order.
 */
export const capSheetBySections = (
    personality: string | undefined | null,
    cap: number,
): string => {
    const text = (personality ?? '').trim();
    if (!text || text.length <= cap) return text;

    const parsed = parseSheetSections(text);
    if (!parsed.isSectioned) {
        // Unsectioned: fall back to a sentence-boundary trim, marked as partial.
        const window = text.slice(0, cap);
        const stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
        const cut = stop > cap * 0.5 ? window.slice(0, stop + 1) : window.slice(0, window.lastIndexOf(' '));
        return `${cut.trim()} […truncated]`;
    }

    const order = [
        ...parsed.sections.filter(s => s.label === CORE_LABEL),
        ...parsed.sections.filter(s => s.label === SURFACE_LABEL),
        ...parsed.sections.filter(s => s.label !== CORE_LABEL && s.label !== SURFACE_LABEL),
    ];

    const NOTE_HEAD = ' [NOT SHOWN THIS TURN (present in the record, omitted for space): ';

    /** Select whole sections that fit in `budget`, core first. */
    const select = (budget: number) => {
        const kept: SheetSection[] = [];
        const omitted: string[] = [];
        let used = 0;
        for (const s of order) {
            const cost = s.label.length + s.body.length + 4;
            if (used + cost <= budget) {
                kept.push(s);
                used += cost;
            } else {
                omitted.push(s.label);
            }
        }
        // Never return an empty record. v1.42: but do not blow the budget
        // either — the original "keep it whole and accept the overrun" rule
        // meant a record whose Actual Core alone exceeded the cap rendered at
        // 2-3x it. Measured on the 2026-09-09 roster: Ophelia Slattery returned
        // 1291 chars against a 460 cap, Mirabel Calder 1019. The section is
        // still emitted, trimmed at a sentence boundary and MARKED, so it is
        // never mistaken for the whole of that section.
        if (kept.length === 0 && order.length > 0) kept.push(order[0]);
        return { kept, omitted };
    };

    // Two passes. The omission note is metadata about the cut, so it must be
    // paid for out of the same budget — otherwise a heavily-cut record returns
    // LONGER than the cap it was cut to, which defeats the tiering it exists to
    // serve.
    let { kept, omitted } = select(cap);
    if (omitted.length > 0) {
        const noteLen = NOTE_HEAD.length + omitted.join(', ').length + 1;
        ({ kept, omitted } = select(Math.max(80, cap - noteLen)));
    }

    // Re-emit in document order so the record still reads as the author wrote it.
    const inOrder = parsed.sections.filter(s => kept.includes(s));
    const note = omitted.length > 0 ? `${NOTE_HEAD}${omitted.join(', ')}]` : '';

    // v1.42: a single section longer than the whole budget is trimmed rather
    // than emitted at multiples of it — and said to be trimmed, which is the
    // part that matters. A partial section the model believes is whole is the
    // failure this module exists to prevent.
    if (inOrder.length === 1) {
        const only = inOrder[0];
        const mark = ` [SECTION TRIMMED — this is the opening of "${only.label}", not the whole of it]`;
        // Budget the marker and the omission note explicitly; guessing at their
        // length is how the previous version came back over its own cap.
        const room = Math.max(120, cap - only.label.length - 2 - mark.length - note.length);
        if (only.body.length > room) {
            const window = only.body.slice(0, room);
            const stop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
            const cut = stop > room * 0.5 ? window.slice(0, stop + 1) : window.slice(0, window.lastIndexOf(' '));
            return `${only.label}: ${cut.trim()}${mark}${note}`;
        }
    }

    const rendered = inOrder.map(s => `${s.label}: ${s.body}`).join(' ');
    return `${rendered}${note}`;
};

/**
 * Render a record for an OOC lookup with its sections enumerated.
 *
 * The enumeration is the point. Asked for Liora Calder's kinks the model
 * invented three, because nothing in the request could say "this record has no
 * such section". A list of exactly which sections exist makes the absent one
 * visible and answerable.
 */
export const describeSheetSections = (personality: string | undefined | null): string => {
    const parsed = parseSheetSections(personality);
    if (!parsed.isSectioned) {
        return parsed.preamble
            ? 'Sections present: NONE — this record is unsectioned prose. It has no Actual Core, no kink list, and no other labelled section. Any question about a named section of this record is answered "not recorded".'
            : 'Sections present: NONE — this record is empty.';
    }
    return `Sections present (exactly these, and no others): ${parsed.labels.join(', ')}. `
        + `A section not in that list does not exist for this character; the answer to any question about it is that it is not recorded.`;
};
