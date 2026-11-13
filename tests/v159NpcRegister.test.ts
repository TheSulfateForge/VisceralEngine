import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
    createRegister, parseRegisterDiffs, applyRegisterDiff, openRegisters, syncRecordFacts,
    renderRegisterForPrompt, matchRegisterNpc, registerBrief, REGISTER_CAPS,
} from '../utils/engine/npcRegister';
import { RegisterService, _buildRegisterPrompt } from '../services/registerService';
import { _registerPanelInternals } from '../components/sidebar/NpcRegisterPanel';
import { absorbGameSave, projectGameSave } from '../db/projection';
import { vdb } from '../db/schema';
import { initialHistory, initialWorld, EMPTY_CHARACTER } from '../slices/gameSlice';
import type { GameSave, KnownEntity, SaveId } from '../types';

const ent = (name: string, extra: Partial<KnownEntity> = {}): KnownEntity => ({
    id: name.toLowerCase().replace(/\W+/g, '_'), name, role: 'noble', location: 'Westcross Townhouse, Library',
    impression: '', relationship_level: 'WARM', leverage: '', ledger: [], status: 'present', lastSeenTurn: 1, ...extra,
} as KnownEntity);

describe('v1.59 — register diffs are validated', () => {
    it('keeps well-formed entries, drops junk, applies per-turn limits', () => {
        const diffs = parseRegisterDiffs({
            updates: [
                {
                    npc: 'Liora Calder (Duchess Westcross)',
                    knowledge: [{ text: 'Ryan carries a gloamsteel knife he found as a bare blade in a ruin.', source: 'told', from: 'Ryan' },
                        { text: '' }, { text: 'a', source: 'nonsense' }, { text: 'b' }, { text: 'c' }, { text: 'd' }],
                    state: [{ key: 'Title', value: 'Duchess Westcross' }, { key: '', value: 'x' }],
                    intimacy: { acts: ['Kiss', 'milking.'], wants: [{ text: 'go slow the first time', kind: 'want' }, { text: 'sex', kind: 'whatever' }] },
                    development: { text: 'Leans into being directed in private.', turns: [63, 75, 'x'] },
                },
                { npc: '' }, 'garbage', { npc: 'Nobody' },
            ],
        });
        expect(diffs).toHaveLength(1);
        const d = diffs[0];
        expect(d.knowledge).toHaveLength(4);
        expect(d.knowledge![1].source).toBe('witnessed'); // unknown source → witnessed
        expect(d.state).toEqual([{ key: 'title', value: 'Duchess Westcross' }]);
        expect(d.intimacy!.acts).toEqual(['kiss', 'milking']);
        expect(d.intimacy!.wants![1].kind).toBe('want');
        expect(d.development!.turns).toEqual([63, 75]);
    });
});

describe('v1.59 — applying diffs', () => {
    it('state replaces by key; feelings replace by person', () => {
        let r = createRegister(1);
        r = applyRegisterDiff(r, { npc: 'L', state: [{ key: 'title', value: 'Lady Liora Calder' }] }, 1).register;
        r = applyRegisterDiff(r, { npc: 'L', state: [{ key: 'title', value: 'Duchess Westcross' }], feelings: [{ toward: 'Ryan', text: 'wary' }] }, 2).register;
        r = applyRegisterDiff(r, { npc: 'L', feelings: [{ toward: 'ryan', text: 'trusts him to tell the truth' }] }, 3).register;
        expect(r.state).toEqual([{ key: 'title', value: 'Duchess Westcross', turn: 2 }]);
        expect(r.feelings).toHaveLength(1);
        expect(r.feelings[0].text).toBe('trusts him to tell the truth');
    });

    it('acts record the first time, count up, once per turn', () => {
        let r = createRegister(1);
        r = applyRegisterDiff(r, { npc: 'L', intimacy: { acts: ['kiss'] } }, 30).register;
        r = applyRegisterDiff(r, { npc: 'L', intimacy: { acts: ['kiss'] } }, 30).register; // same turn — no double count
        r = applyRegisterDiff(r, { npc: 'L', intimacy: { acts: ['kiss', 'milking'] } }, 34).register;
        expect(r.intimacy.acts).toEqual([{ act: 'kiss', count: 2, lastTurn: 34 }, { act: 'milking', count: 1, lastTurn: 34 }]);
        expect(r.intimacy.firsts).toEqual([{ act: 'kiss', turn: 30 }, { act: 'milking', turn: 34 }]);
    });

    it('knowledge de-duplicates; what was seen is never downgraded to a rumour', () => {
        let r = createRegister(1);
        r = applyRegisterDiff(r, { npc: 'L', knowledge: [{ text: 'Ryan carries a gloamsteel knife.', source: 'witnessed' }] }, 5).register;
        const { register, changes } = applyRegisterDiff(r, { npc: 'L', knowledge: [{ text: 'Ryan carries a gloamsteel knife', source: 'rumor' }] }, 6);
        expect(register.knowledge).toHaveLength(1);
        expect(register.knowledge[0].source).toBe('witnessed');
        expect(changes).toEqual([]);
    });

    it('a promise is recorded once and its status can change', () => {
        let r = createRegister(1);
        r = applyRegisterDiff(r, { npc: 'L', promises: [{ text: 'She will never need a breast pump again while he is there.', by: 'player' }] }, 40).register;
        const out = applyRegisterDiff(r, { npc: 'L', promises: [{ text: 'She will never need a breast pump again while he is there', by: 'player', status: 'kept' }] }, 41);
        expect(out.register.promises).toHaveLength(1);
        expect(out.register.promises[0].status).toBe('kept');
        expect(out.changes[0]).toMatch(/promise kept/);
    });

    it('caps: knowledge drops oldest "record" entries first', () => {
        let r = createRegister(1);
        r = syncRecordFacts(r, Array.from({ length: REGISTER_CAPS.knowledge }, (_, i) => `recordfact${i} alpha${i} beta${i}`), 1);
        r = applyRegisterDiff(r, { npc: 'L', knowledge: [{ text: 'Ryan wants many children with her.', source: 'told', from: 'Ryan' }] }, 9).register;
        expect(r.knowledge.length).toBe(REGISTER_CAPS.knowledge);
        expect(r.knowledge[r.knowledge.length - 1].text).toBe('Ryan wants many children with her.');
        expect(r.knowledge.some(k => k.text.startsWith('recordfact0 '))).toBe(false);
    });
});

describe('v1.59 — opening registers', () => {
    it('only for named NPCs in a direct scene this turn', () => {
        const { entities, opened } = openRegisters(
            [ent('Liora Calder (Duchess Westcross)', { witnessed: ['Liora signed her own sworn complaint.'] }), ent('Lady Mirabel Calder', { status: 'distant' }), ent('a guard'), ent('Miri')],
            'I look to Liora.', 'Miri set the tray down.', 10, false,
        );
        expect(opened).toEqual(['Liora Calder (Duchess Westcross)', 'Miri']);
        expect(entities[0].register!.knowledge[0]).toMatchObject({ text: 'Liora signed her own sworn complaint.', source: 'record' });
        expect(entities[1].register).toBeUndefined();
    });
    it('older saves: once, for NPCs whose ledger shows past scenes', () => {
        const { opened } = openRegisters([ent('Lord Prosper Calder', { status: 'distant', ledger: ['Backed Ryan at court.'] }), ent('Captain Orla', { status: 'distant' })], '', '', 68, true);
        expect(opened).toEqual(['Lord Prosper Calder']);
    });
    it('matches the name the pass used', () => {
        const ents = [ent('Liora Calder (Duchess Westcross)'), ent('Lady Mirabel Calder'), ent('Lord Prosper Calder')];
        expect(matchRegisterNpc(ents, 'Liora Calder (Duchess Westcross)')).toBe(0);
        expect(matchRegisterNpc(ents, 'Liora')).toBe(0);
        expect(matchRegisterNpc(ents, 'Mirabel')).toBe(1);
        expect(matchRegisterNpc(ents, 'Calder')).toBe(-1);
    });
});

describe('v1.59 — in the prompt', () => {
    let r = createRegister(1);
    r = applyRegisterDiff(r, {
        npc: 'L',
        knowledge: [{ text: 'Ryan carries a gloamsteel knife he found as a bare blade in a ruin.', source: 'told', from: 'Ryan' }],
        state: [{ key: 'title', value: 'Duchess Westcross' }],
        promises: [{ text: 'Teach her knife fighting and correct her bluntly.', by: 'player' }],
        intimacy: { wants: [{ text: 'sex', kind: 'not_yet' }] },
    }, 57).register;
    it('the knife is something she already knows, with its source', () => {
        const block = renderRegisterForPrompt(r, 'I show her my gloamsteel knife');
        expect(block).toMatch(/register wins/);
        expect(block).toMatch(/gloamsteel knife .*\(told by Ryan, t57 — believes it\)/);
        expect(block).toMatch(/Current: title: Duchess Westcross/);
        expect(block).toMatch(/Open promises: • player → them: Teach her knife fighting/);
        expect(block).toMatch(/their stated terms \(honour these\): not yet: sex/);
    });
    it('never asserts that nothing intimate has happened (older saves start empty)', () => {
        expect(renderRegisterForPrompt(createRegister(1), 'x')).toBe('');
        expect(renderRegisterForPrompt(undefined, 'x')).toBe('');
    });
});

describe('v1.59 — the register pass', () => {
    it('names the PC and gives each NPC its register and Kinks list', () => {
        const liora = ent('Liora Calder (Duchess Westcross)', {
            personality: 'Performed Surface: curious, polite.\nActual Core: vigilant.\nThe Kinks: Role: submissive. Praise. Being kept.',
            register: createRegister(1),
        });
        const p = _buildRegisterPrompt({ pcName: 'Ryan Westcross', turn: 70, playerInput: 'I kiss her.', narrative: 'She kissed me back.', npcs: [liora] });
        expect(p).toMatch(/THE PLAYER CHARACTER IS Ryan Westcross/);
        expect(p).toMatch(/### Liora Calder \(Duchess Westcross\)/);
        expect(p).toMatch(/SHEET — THE KINKS[\s\S]*Being kept/);
        expect(p).toMatch(/THIS IS TURN 70/);
    });
    it('returns validated diffs, and null on failure', async () => {
        const ok = new RegisterService({ models: { generateContent: async () => ({ text: JSON.stringify({ updates: [{ npc: 'Liora', intimacy: { acts: ['kiss'] } }] }) }) } } as never, 'm');
        expect(await ok.extract({ pcName: 'R', turn: 1, playerInput: '', narrative: '', npcs: [ent('Liora')] })).toEqual([{ npc: 'Liora', intimacy: { acts: ['kiss'] } }]);
        const bad = new RegisterService({ models: { generateContent: async () => { throw new Error('boom'); } } } as never, 'm');
        expect(await bad.extract({ pcName: 'R', turn: 1, playerInput: '', narrative: '', npcs: [ent('Liora')] })).toBeNull();
        expect(await bad.extract({ pcName: 'R', turn: 1, playerInput: '', narrative: '', npcs: [] })).toEqual([]);
    });
});

describe('v1.59 — register panel edits', () => {
    const { rowsFor, withoutRow, withText } = _registerPanelInternals;
    let r = createRegister(1);
    r = applyRegisterDiff(r, { npc: 'L', knowledge: [{ text: 'wrong fact', source: 'witnessed' }], intimacy: { acts: ['kiss'] } }, 3).register;
    it('delete removes the entry (an act also removes its "first")', () => {
        expect(withoutRow(r, 'knowledge', 0).knowledge).toEqual([]);
        const noKiss = withoutRow(r, 'acts', 0);
        expect(noKiss.intimacy.acts).toEqual([]);
        expect(noKiss.intimacy.firsts).toEqual([]);
    });
    it('edit rewrites the text', () => {
        expect(withText(r, 'knowledge', 0, 'right fact').knowledge[0].text).toBe('right fact');
        expect(rowsFor(r).find(g => g.title === 'Knows')!.rows[0].text).toBe('wrong fact');
    });
});

describe('v1.59 — the save layer keeps NPC fields it used to drop', () => {
    it('ledger order, witnessed, register and canonical survive save → load', async () => {
        if (!vdb.isOpen()) await vdb.open();
        const reg = applyRegisterDiff(createRegister(1), { npc: 'L', knowledge: [{ text: 'Ryan carries a gloamsteel knife.', source: 'told', from: 'Ryan' }] }, 2).register;
        const liora = ent('Liora Calder', {
            ledger: ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'],
            witnessed: ['Liora signed her own complaint.'],
            register: reg,
            canonical: true,
        });
        const save = {
            id: 'v159-roundtrip' as SaveId, name: 't', timestamp: new Date().toISOString(),
            gameState: { history: initialHistory, world: { ...initialWorld, knownEntities: [liora] } },
            character: EMPTY_CHARACTER,
        } as unknown as GameSave;
        await absorbGameSave(save);
        const out = await projectGameSave(save.id);
        const back = out!.gameState.world.knownEntities.find(e => e.name === 'Liora Calder')!;
        expect(back.ledger).toEqual(liora.ledger);
        expect(back.witnessed).toEqual(liora.witnessed);
        expect(back.register).toEqual(reg);
        expect(back.canonical).toBe(true);
        expect(registerBrief(back.register!)).toMatch(/gloamsteel/);
    });
});
