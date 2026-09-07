import { describe, it, expect } from 'vitest';
import {
    splitPrivateBackstory,
    buildPrivateKnowledgeBlock,
    extractPrivateTerms,
    extractSpokenText,
    detectPrivateKnowledgeLeak,
    privateTermsForCharacter,
    NPC_KNOWLEDGE_RULE,
} from '../utils/engine/privateKnowledge';
import type { Character } from '../types';

// ============================================================================
// v1.39 — the epistemic boundary.
//
// NPCs who had just met Carissa Vorn cited her private history back to her.
// The player had already forbidden it, IN the backstory field, in these words:
//
//     [ALL BELOW INFORMATION IS GM KNOWLEDGE ONLY. NO NPC IS AWARE OF IT.]
//
// The engine rendered the whole field — marker included — under a header
// reading "This is the player character. This data is ABSOLUTE TRUTH", in the
// cached static prefix. Nothing parsed the marker.
//
// The backstory fragments below are verbatim from that save.
// ============================================================================

/** Verbatim, including the marker. */
const CARISSA_BACKSTORY =
    'Carissa arrived in Caerveld eight days ago and has been learning the streets. ' +
    'She presents as a young native hucow and has told no one otherwise. ' +
    'She walked in through the gates.\n\n' +
    '[ALL BELOW INFORMATION IS GM KNOWLEDGE ONLY. NO NPC IS AWARE OF IT.]\n\n' +
    'ORIGIN\n' +
    'Carissa was born in the Sunken Courts, the hucow daughter of a merchant family. ' +
    'A surviving civil registry records her birth, her parentage, and little else. ' +
    'After the age of six, the official trail ends completely.\n' +
    'Her family sold her into contract slavery to a small, isolated research facility ' +
    'studying hucow biology and active magical development in subjects young enough to ' +
    'be deliberately shaped. Her resonant milk was the facility’s central result.';

const character = (over: Partial<Character> = {}): Character => ({
    name: 'Carissa Vorn', gender: 'female', race: 'Hucow',
    appearance: '', notableFeatures: '', backstory: CARISSA_BACKSTORY,
    setting: '', inventory: [], relationships: [], conditions: [], goals: [],
    trauma: 0, bio: {} as Character['bio'],
    ...over,
} as Character);

describe('v1.39 — the author marker is parsed', () => {
    it('splits the backstory on the marker the player actually wrote', () => {
        const { publicHalf, privateHalf, marker } = splitPrivateBackstory(CARISSA_BACKSTORY);
        expect(marker).toContain('GM KNOWLEDGE ONLY');
        expect(publicHalf).toContain('arrived in Caerveld eight days ago');
        expect(publicHalf).not.toContain('Sunken Courts');
        expect(privateHalf).toContain('Sunken Courts');
        expect(privateHalf).toContain('research facility');
        // The marker itself must not survive into either half.
        expect(publicHalf).not.toContain('GM KNOWLEDGE');
        expect(privateHalf).not.toContain('GM KNOWLEDGE');
    });

    it('accepts the other spellings an author might reach for', () => {
        for (const m of [
            '[GM ONLY]', '[GM-ONLY]', '(SECRET)', '[HIDDEN]', '[PRIVATE]',
            '[NOT KNOWN TO ANY NPC]', '[NO NPC IS AWARE OF THIS]',
            '[GM eyes only — the rest is secret]',
        ]) {
            const out = splitPrivateBackstory(`Public part.\n${m}\nSecret part.`);
            expect(out.privateHalf, m).toBe('Secret part.');
            expect(out.publicHalf, m).toBe('Public part.');
        }
    });

    it('treats an unmarked backstory as entirely public', () => {
        // The pre-v1.39 default, and the right one: an unmarked field makes no
        // claim of secrecy, and silently hiding half of it would be worse.
        const out = splitPrivateBackstory('She grew up on the coast and learned to sail.');
        expect(out.privateHalf).toBe('');
        expect(out.marker).toBeNull();
        expect(out.publicHalf).toContain('learned to sail');
    });

    it('does not fire on a bracketed aside that is not a secrecy marker', () => {
        const out = splitPrivateBackstory('She was born in Ostmere [see the civil registry] and left at six.');
        expect(out.privateHalf).toBe('');
    });

    it('is safe on empty input', () => {
        expect(splitPrivateBackstory('').privateHalf).toBe('');
        expect(splitPrivateBackstory(undefined).publicHalf).toBe('');
    });
});

describe('v1.39 — the private block states a real prohibition', () => {
    const { privateHalf } = splitPrivateBackstory(CARISSA_BACKSTORY);
    const block = buildPrivateKnowledgeBlock(privateHalf);

    it('corrects the identity block framing by name', () => {
        expect(block).toMatch(/ABSOLUTE TRUTH.*true-of-her, not known-to-others/s);
    });

    it('closes the "well-connected NPC would have heard" loophole', () => {
        expect(block).toMatch(/NO NPC KNOWS ANY OF THIS/);
        expect(block).toMatch(/would have heard something/);
        expect(block).toMatch(/informants/);
    });

    it('says discovery must happen on the page and then be recorded', () => {
        expect(block).toMatch(/ON THE PAGE/);
        expect(block).toMatch(/ledger/i);
    });

    it('still carries the secret itself — this is GM context, not redaction', () => {
        expect(block).toContain('Sunken Courts');
        expect(block).toContain('resonant milk');
    });

    it('folds hiddenNotes in, and renders nothing when there is no secret', () => {
        expect(buildPrivateKnowledgeBlock('', 'She is the heir.')).toContain('She is the heir.');
        expect(buildPrivateKnowledgeBlock('', '')).toBe('');
        expect(buildPrivateKnowledgeBlock('')).toBe('');
    });
});

describe('v1.39 — the knowledge rule runs in both directions', () => {
    it('bounds what an NPC may know', () => {
        expect(NPC_KNOWLEDGE_RULE).toMatch(/observed in a scene they were present for/);
        expect(NPC_KNOWLEDGE_RULE).toMatch(/Ledger is that record/);
    });

    it('denies that perceptiveness is a licence to know more', () => {
        expect(NPC_KNOWLEDGE_RULE).toMatch(/several moves ahead/);
        expect(NPC_KNOWLEDGE_RULE).toMatch(/not a licence to know more/);
    });

    it('also insists an NPC knows their OWN sheet', () => {
        // The complaint was two failures at once; the rule must answer both.
        expect(NPC_KNOWLEDGE_RULE).toMatch(/DOES know their own sheet/);
        expect(NPC_KNOWLEDGE_RULE).toMatch(/act against, what their own record says/);
    });
});

describe('v1.39 — leak detection reads dialogue, not narration', () => {
    const terms = privateTermsForCharacter(character());

    it('extracts the distinctive private phrases', () => {
        expect(terms).toContain('Sunken Courts');
        expect(terms).toContain('resonant milk');
    });

    it('does not extract anything the public half already says', () => {
        // "young native hucow" is public; it must never become a leak term.
        expect(terms.some(t => t.includes('native hucow'))).toBe(false);
    });

    it('flags an NPC speaking the secret aloud', () => {
        const out = detectPrivateKnowledgeLeak(
            `Sania's hand settled on her shoulder. 'We know about the Sunken Courts, dear,' she said.`,
            null,
            terms,
        );
        expect(out.leaked).toBe(true);
        expect(out.terms).toContain('Sunken Courts');
        expect(out.excerpt).toContain('Sunken Courts');
    });

    it('flags it in the structured dialogue field too', () => {
        const out = detectPrivateKnowledgeLeak(
            'She watched him across the table.',
            'Your resonant milk is why you are here.',
            terms,
        );
        expect(out.leaked).toBe(true);
        expect(out.terms).toContain('resonant milk');
    });

    it('does NOT flag the narrator or the PC remembering her own past', () => {
        // This is correct writing and the most important false positive to avoid.
        const out = detectPrivateKnowledgeLeak(
            'The smell of the room pulled her back to the Sunken Courts, and to the ' +
            'facility that had made her resonant milk what it was. She said nothing.',
            null,
            terms,
        );
        expect(out.leaked).toBe(false);
    });

    it('is inert for a character with no marked secrets', () => {
        const plain = character({ backstory: 'She grew up on the coast.' });
        expect(privateTermsForCharacter(plain)).toEqual([]);
        expect(detectPrivateKnowledgeLeak('Anything at all.', null, []).leaked).toBe(false);
    });

    it('pulls spoken text from all three quote styles this engine uses', () => {
        const spoken = extractSpokenText(
            `"Straight." Then “curly.” Then 'the single-quote style she favours.'`,
            null,
        );
        expect(spoken).toContain('Straight');
        expect(spoken).toContain('curly');
        expect(spoken).toContain('single-quote style');
    });

    it('excludes entity and PC names from the term list', () => {
        const withNames = privateTermsForCharacter(character(), [
            { id: 'a', name: 'Sania Blackmoor' } as never,
        ]);
        expect(withNames.some(t => t.toLowerCase().includes('sania'))).toBe(false);
        expect(withNames.some(t => t.toLowerCase().includes('carissa'))).toBe(false);
    });
});

describe('v1.39 — extractPrivateTerms edge cases', () => {
    it('never emits a bare single common noun', () => {
        const terms = extractPrivateTerms('She kept a knife.', '');
        expect(terms.every(t => t.includes(' '))).toBe(true);
    });

    it('drops a phrase that also appears in the public half', () => {
        const terms = extractPrivateTerms(
            'The resonant milk was the result.',
            'Her resonant milk is common knowledge in the district.',
        );
        expect(terms).not.toContain('resonant milk');
    });

    it('returns nothing for empty private text', () => {
        expect(extractPrivateTerms('', 'anything')).toEqual([]);
    });
});
