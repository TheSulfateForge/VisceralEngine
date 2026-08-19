import { describe, it, expect } from 'vitest';
import { parseOocInput, isNarrativeMessage, formatOocForDisplay } from '../utils/engine/oocDetection';

describe('parseOocInput — markers', () => {
    it('accepts the explicit OOC: prefix, case-insensitively', () => {
        for (const raw of ['OOC: stop repeating yourself', 'ooc: stop repeating yourself', 'Ooc - stop repeating yourself', '[OOC] stop repeating yourself']) {
            const r = parseOocInput(raw);
            expect(r.isOoc, raw).toBe(true);
            expect(r.body).toBe('stop repeating yourself');
        }
    });

    it('accepts the // fast form', () => {
        const r = parseOocInput('// stop repeating yourself');
        expect(r.isOoc).toBe(true);
        expect(r.body).toBe('stop repeating yourself');
        expect(r.marker).toBe('slash');
    });

    it('accepts the ((double paren)) convention', () => {
        const r = parseOocInput('((stop repeating yourself))');
        expect(r.isOoc).toBe(true);
        expect(r.body).toBe('stop repeating yourself');
        expect(r.marker).toBe('parens');
    });

    it('handles a multi-line OOC body', () => {
        const r = parseOocInput('OOC: two things.\nfirst, stop repeating.\nsecond, slow down.');
        expect(r.isOoc).toBe(true);
        expect(r.body).toContain('second, slow down.');
    });

    it('handles multi-line inside double parens', () => {
        const r = parseOocInput('((line one\nline two))');
        expect(r.isOoc).toBe(true);
        expect(r.body).toBe('line one\nline two');
    });
});

describe('parseOocInput — negatives', () => {
    it('leaves ordinary in-character input alone', () => {
        const raw = 'I draw my sword and step between them.';
        const r = parseOocInput(raw);
        expect(r.isOoc).toBe(false);
        expect(r.body).toBe(raw);
        expect(r.marker).toBeNull();
    });

    it('does not fire on a mid-sentence parenthetical', () => {
        const r = parseOocInput('I check the door ((quietly)) and listen.');
        expect(r.isOoc).toBe(false);
    });

    it('does not fire on a word merely starting with "ooc"', () => {
        const r = parseOocInput('Oocar nods at me from the doorway.');
        expect(r.isOoc).toBe(false);
    });

    it('does not fire on a single slash', () => {
        expect(parseOocInput('/ me shrugs').isOoc).toBe(false);
    });

    it('treats a marker with no body as NOT ooc — the player mistyped', () => {
        expect(parseOocInput('//').isOoc).toBe(false);
        expect(parseOocInput('(( ))').isOoc).toBe(false);
        expect(parseOocInput('OOC:').isOoc).toBe(false);
    });

    it('is total on empty / null / undefined', () => {
        expect(parseOocInput(undefined).isOoc).toBe(false);
        expect(parseOocInput(null).isOoc).toBe(false);
        expect(parseOocInput('').isOoc).toBe(false);
        expect(parseOocInput('   ').isOoc).toBe(false);
    });

    it('reproduces the input that started this: an OOC complaint typed into the fiction', () => {
        // In the reviewed save this exact class of input consumed a full turn.
        const r = parseOocInput('OOC: you repeated yourself near verbatim');
        expect(r.isOoc).toBe(true);
        expect(r.body).toBe('you repeated yourself near verbatim');
    });
});

describe('isNarrativeMessage', () => {
    it('excludes OOC messages and includes everything else', () => {
        expect(isNarrativeMessage({ ooc: true })).toBe(false);
        expect(isNarrativeMessage({ ooc: false })).toBe(true);
        expect(isNarrativeMessage({})).toBe(true);
    });
});

describe('formatOocForDisplay', () => {
    it('round-trips back through the parser', () => {
        const body = 'the armor keeps me warm';
        expect(parseOocInput(formatOocForDisplay(body)).body).toBe(body);
    });
});
