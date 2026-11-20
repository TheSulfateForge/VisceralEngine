// v1.61 — birth: engine delivery at the due week, the child, effects on the
// mother, NPC records, trait application, OOC corrections, persistence.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
    ReproductionSystem,
    processBirths,
    syncPregnancyRegisters,
    applyChildTraits,
    applyChildCorrections,
    parseChildCorrections,
    parseChildTraits,
    parentInfo,
    describeAge,
    describePostpartum,
    buildChildRecordsBlock,
    MINUTES_PER_WEEK,
    POSTPARTUM_CONDITION,
    LACTATING_CONDITION,
    DUE_WEEK_MIN,
    DUE_WEEK_MAX,
} from '../utils/reproductionSystem';
import { _buildChildTraitPrompt } from '../services/childService';
import { OOC_RESPONSE_SCHEMA } from '../schemas/oocSchema';
import { absorbGameSave, projectGameSave } from '../db/projection';
import { vdb } from '../db/schema';
import { initialHistory, initialWorld, EMPTY_CHARACTER } from '../slices/gameSlice';
import type { Character, GameSave, KnownEntity, Pregnancy, SaveId } from '../types';

const DAY = 24 * 60;
const pcF = { ...EMPTY_CHARACTER, name: 'Mara Voss', gender: 'Female', race: 'Human', appearance: 'Black hair, grey eyes.', conditions: [], bio: { metabolism: { calories: 80, hydration: 80, stamina: 90, libido: 5 }, pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0 }, timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0 }, modifiers: { calories: 1, hydration: 1, stamina: 1, lactation: 1 } } } as unknown as Character;
const pcM = { ...pcF, name: 'Aric Dane', gender: 'Male' } as Character;
const npc = (name: string, extra: Partial<KnownEntity> = {}): KnownEntity => ({
    id: name.toLowerCase().replace(/\s+/g, '-'), name, role: 'elf herbalist', location: 'Mill House', impression: '',
    relationship_level: 'WARM', leverage: '', ledger: [], status: 'distant', appearance: 'Silver hair, green eyes.', ...extra,
});
const preg = (mother: string, father: string, dueWeek = 39): Pregnancy => ({
    id: 'p1', motherName: mother, fatherName: father, conceptionTurn: 1, conceptionTime: 0,
    currentWeek: 0, isVisible: false, status: 'gestating', dueWeek,
});
let n = 0;
const ids = () => `child-${++n}`;

describe('v1.61 due week', () => {
    it('is rolled 37-42 at conception', () => {
        expect(ReproductionSystem.initiatePregnancy(pcF, 1, 0, 'T', () => 0).dueWeek).toBe(DUE_WEEK_MIN);
        expect(ReproductionSystem.initiatePregnancy(pcF, 1, 0, 'T', () => 0.9999).dueWeek).toBe(DUE_WEEK_MAX);
    });
});

describe('v1.61 processBirths', () => {
    it('does nothing before the due week', () => {
        const r = processBirths({ character: pcF, entities: [], pregnancies: [preg('Mara Voss', 'Tomas')], now: 38 * MINUTES_PER_WEEK, turn: 50, location: 'Inn' });
        expect(r.bornIds).toHaveLength(0);
        expect(r.pregnancies[0].status).toBe('gestating');
    });

    it('delivers a female PC: child created, postpartum, lactation, stamina, stretch, birth count', () => {
        const r = processBirths({ character: pcF, entities: [], pregnancies: [preg('Mara Voss', 'Tomas')], now: 39 * MINUTES_PER_WEEK, turn: 50, location: 'Inn', rand: () => 0.1, newId: ids });
        expect(r.bornIds).toHaveLength(1);
        const child = r.entities.find(e => e.id === r.bornIds[0])!;
        expect(child.child).toMatchObject({ gender: 'female', motherName: 'Mara Voss', fatherName: 'Tomas', traitsPending: true, birthTurn: 50 });
        expect(child.status).toBe('present');
        expect(child.location).toBe('Inn');
        expect(r.pregnancies[0]).toMatchObject({ status: 'birth', birthTurn: 50, childId: child.id });
        expect(r.character.conditions).toEqual(expect.arrayContaining([POSTPARTUM_CONDITION, LACTATING_CONDITION]));
        expect(r.character.bio.metabolism.stamina).toBe(30);
        expect(r.character.bodyState).toMatchObject({ vaginalStretch: 3, birthsGiven: 1 });
    });

    it('gender is the roll: rand >= 0.5 gives a boy', () => {
        const r = processBirths({ character: pcF, entities: [], pregnancies: [preg('Mara Voss', 'Tomas')], now: 39 * MINUTES_PER_WEEK, turn: 50, location: 'Inn', rand: () => 0.7, newId: ids });
        expect(r.entities[0].child!.gender).toBe('male');
        expect(r.entities[0].name).toBe('Newborn son of Mara Voss');
    });

    it('a male PC\'s NPC partner delivers: her body changes, the child goes where she is', () => {
        const ilse = npc('Ilse Brandt');
        const r = processBirths({ character: pcM, entities: [ilse], pregnancies: [preg('Ilse', 'Aric Dane')], now: 40 * MINUTES_PER_WEEK, turn: 60, location: 'Inn', rand: () => 0.2, newId: ids });
        const mother = r.entities.find(e => e.name === 'Ilse Brandt')!;
        expect(mother.bodyState).toMatchObject({ vaginalStretch: 3, birthsGiven: 1 });
        const child = r.entities.find(e => e.child)!;
        expect(child.location).toBe('Mill House');
        expect(child.status).toBe('distant');
        expect(r.character.conditions).not.toContain(POSTPARTUM_CONDITION);
    });

    it('ends the PC\'s postpartum condition after six weeks', () => {
        const born = processBirths({ character: pcF, entities: [], pregnancies: [preg('Mara Voss', 'Tomas')], now: 39 * MINUTES_PER_WEEK, turn: 50, location: 'Inn', newId: ids });
        const later = processBirths({ character: born.character, entities: born.entities, pregnancies: born.pregnancies, now: 45 * MINUTES_PER_WEEK + DAY, turn: 90, location: 'Inn' });
        expect(later.character.conditions).not.toContain(POSTPARTUM_CONDITION);
        expect(later.character.conditions).toContain(LACTATING_CONDITION);
    });
});

describe('v1.61 NPC mother living record', () => {
    it('pregnancy → postpartum → children, and the pregnancy key is removed after birth', () => {
        const ilse = npc('Ilse Brandt');
        let ents = syncPregnancyRegisters([ilse], [preg('Ilse', 'Aric Dane')], 'Aric Dane', 20 * MINUTES_PER_WEEK, 30);
        expect(ents[0].register!.state.map(s => s.key)).toEqual(['pregnancy']);
        const born = processBirths({ character: pcM, entities: ents, pregnancies: [preg('Ilse', 'Aric Dane')], now: 39 * MINUTES_PER_WEEK, turn: 60, location: 'Inn', rand: () => 0.2, newId: ids });
        ents = syncPregnancyRegisters(born.entities, born.pregnancies, 'Aric Dane', 39 * MINUTES_PER_WEEK + DAY, 61);
        const keys = ents[0].register!.state.map(s => s.key).sort();
        expect(keys).toEqual(['children', 'postpartum']);
        const later = syncPregnancyRegisters(ents, born.pregnancies, 'Aric Dane', 50 * MINUTES_PER_WEEK, 90);
        expect(later[0].register!.state.map(s => s.key)).toEqual(['children']);
        expect(later[0].register!.state[0].value).toMatch(/girl, 2 months old, father Aric Dane/);
    });
});

describe('v1.61 traits and OOC corrections', () => {
    const born = () => processBirths({ character: pcF, entities: [npc('Tomas Reyes', { role: 'orc smith', appearance: 'Green skin, red eyes, black hair.' })], pregnancies: [preg('Mara Voss', 'Tomas')], now: 39 * MINUTES_PER_WEEK, turn: 50, location: 'Inn', rand: () => 0.1, newId: ids });

    it('applies traits, names the child and clears pending', () => {
        const b = born();
        const id = b.bornIds[0];
        const r = applyChildTraits(b.entities, id, { name: 'Senna Voss', race: 'half-orc', hair: 'black', eyes: 'grey' });
        const c = r.entities.find(e => e.id === id)!;
        expect(c.name).toBe('Senna Voss');
        expect(c.child).toMatchObject({ race: 'half-orc', hair: 'black', eyes: 'grey', traitsPending: false, gender: 'female' });
        expect(c.appearance).toBe('Girl, half-orc, black hair, grey eyes.');
    });

    it('OOC corrections change the record; unknown children and bad genders are refused', () => {
        const b = born();
        const named = applyChildTraits(b.entities, b.bornIds[0], { name: 'Senna Voss', race: 'half-orc', hair: 'pink', eyes: 'grey' }).entities;
        const fixes = parseChildCorrections([
            { child: 'Senna', field: 'hair', value: 'black' },
            { child: 'Senna Voss', field: 'race', value: 'full orc' },
            { child: 'Senna Voss', field: 'gender', value: 'boy' },
            { child: 'Nobody', field: 'hair', value: 'red' },
            { child: 'Senna Voss', field: 'gender', value: 'sometimes' },
            { child: 'Senna Voss', field: 'height', value: 'tall' },
        ]);
        expect(fixes).toHaveLength(5); // 'height' is not a correctable field
        const r = applyChildCorrections(named, fixes);
        const c = r.entities.find(e => e.child)!;
        expect(c.child).toMatchObject({ hair: 'black', race: 'full orc', gender: 'male' });
        expect(c.role).toMatch(/son of Mara Voss/);
        expect(r.logs.filter(l => /not applied/.test(l))).toHaveLength(2);
        // A correction never touches an adult.
        expect(r.entities.find(e => e.name === 'Tomas Reyes')!.appearance).toBe('Green skin, red eyes, black hair.');
    });

    it('parentInfo reads the PC and the NPC; the prompt carries rules, fixed gender and both parents', () => {
        const b = born();
        const child = b.entities.find(e => e.child)!;
        const mother = parentInfo('Mara Voss', pcF, b.entities);
        const father = parentInfo('Tomas', pcF, b.entities);
        expect(mother).toMatchObject({ race: 'Human', appearance: 'Black hair, grey eyes.' });
        expect(father.notes).toMatch(/orc smith/);
        const prompt = _buildChildTraitPrompt({ child, mother, father, rules: 'An orc parent always yields a full orc.' });
        expect(prompt).toMatch(/is a girl\. That is fixed/);
        expect(prompt).toMatch(/An orc parent always yields a full orc/);
        expect(prompt).toMatch(/Green skin, red eyes, black hair/);
        expect(parseChildTraits({ name: ' ', race: '' })).toBeNull();
    });

    it('the OOC schema requires child_corrections; the records block lists children', () => {
        expect((OOC_RESPONSE_SCHEMA as any).required).toContain('child_corrections');
        const b = born();
        expect(buildChildRecordsBlock(b.entities, 39 * MINUTES_PER_WEEK + 3 * DAY)).toMatch(/Newborn daughter of Mara Voss: female, 3 days old; race \(not set\)/);
    });
});

describe('v1.61 descriptions', () => {
    it('ages and the just-born note', () => {
        expect(describeAge(0, 30)).toBe('newborn');
        expect(describeAge(0, 5 * DAY)).toBe('5 days old');
        expect(describeAge(0, 20 * 7 * DAY)).toBe('4 months old');
        expect(describeAge(0, 800 * DAY)).toBe('2 years old');
        const p = { ...preg('Mara Voss', 'Tomas'), status: 'birth' as const, birthTime: 0, birthTurn: 50 };
        expect(describePostpartum(p, undefined, 60, 50)).toMatch(/just happened/);
        expect(describePostpartum(p, undefined, 3 * DAY, 51)).not.toMatch(/just happened/);
    });
});

describe('v1.61 persistence', () => {
    it('round-trips the child record, pregnancy birth fields and inheritance rules', async () => {
        if (!vdb.isOpen()) await vdb.open();
        const b = processBirths({ character: pcF, entities: [], pregnancies: [preg('Mara Voss', 'Tomas')], now: 39 * MINUTES_PER_WEEK, turn: 50, location: 'Inn', rand: () => 0.1, newId: ids });
        const save = {
            id: 'v161-roundtrip' as SaveId, name: 't', timestamp: new Date().toISOString(),
            gameState: { history: initialHistory, world: { ...initialWorld, knownEntities: b.entities, pregnancies: b.pregnancies, inheritanceRules: 'Elves breed true.' } },
            character: EMPTY_CHARACTER,
        } as unknown as GameSave;
        await absorbGameSave(save);
        const out = await projectGameSave(save.id);
        const w = out!.gameState.world;
        expect(w.knownEntities.find(e => e.child)!.child).toEqual(b.entities[0].child);
        expect(w.pregnancies[0]).toMatchObject({ status: 'birth', dueWeek: 39, birthTurn: 50, childId: b.bornIds[0] });
        expect(w.inheritanceRules).toBe('Elves breed true.');
    });
});

import { birthStep } from '../utils/pipeline/steps/20-birth';
import { DEFAULT_PIPELINE, buildPipeline } from '../utils/pipeline/pipelineConfig';
import type { TurnContext } from '../utils/pipeline/types';
import type { GameWorld } from '../types';

describe('v1.61 pipeline step 20', () => {
    it('runs after 19-bodyState in every time mode', () => {
        const names = DEFAULT_PIPELINE.map(s => s.name);
        expect(names.indexOf('20-birth')).toBe(names.indexOf('19-bodyState') + 1);
        for (const mode of ['TICK', 'SCENE', 'ACTIVITY', 'REST', 'MONTAGE'] as const) {
            expect(buildPipeline(mode).map(s => s.name)).toContain('20-birth');
        }
    });

    it('delivers on a real turn context and writes the world', () => {
        const world = { turnCount: 70, location: 'Inn', knownEntities: [], pregnancies: [preg('Mara Voss', 'Tomas')], time: { totalMinutes: 0 } } as unknown as GameWorld;
        const ctx = birthStep.execute({
            previousWorld: world,
            previousCharacter: pcF,
            worldUpdate: { ...world },
            characterUpdate: pcF,
            newTime: { totalMinutes: 39 * MINUTES_PER_WEEK },
            currentTurn: 70,
            debugLogs: [],
            sanitisedResponse: {},
        } as unknown as TurnContext);
        expect(ctx.worldUpdate.knownEntities!.some(e => e.child)).toBe(true);
        expect(ctx.worldUpdate.pregnancies![0].status).toBe('birth');
        expect(ctx.characterUpdate.conditions).toContain(POSTPARTUM_CONDITION);
        expect(ctx.debugLogs.some(l => /\[BIRTH\]/.test(l.message))).toBe(true);
    });
});
