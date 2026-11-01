import { describe, it, expect } from 'vitest';
import {
    parseBodyFromText,
    resolveCharacterBody,
    resolveEntityBody,
    computeFit,
    applyBodyEvents,
    tickBodyState,
    vaginalVirginity,
    analVirginity,
    buildBodiesInContactBlock,
    containsSexualContent,
    STRETCH_RECOVERY_MINUTES,
} from '../utils/engine/bodyModel';
import {
    findDescriptorViolations,
    contentPolicyLines,
    normalizeContentPolicy,
    lintSheetsForDescriptors,
} from '../utils/engine/contentPolicy';
import {
    ingestOocDirective,
    directivesAreSame,
    capDirectives,
    buildOocDirectivesBlock,
    directiveSuppressions,
    OOC_DIRECTIVE_MAX,
} from '../utils/engine/sceneContinuity';
import { extractBracketFocus, isRegenerateRequest, shouldClearSceneFocus } from '../utils/engine/sceneFocus';
import { isNarrativeMessage } from '../utils/engine/oocDetection';
import { salvageNarrative } from '../services/geminiClient';
import { getResponseSchema } from '../schemas/responseSchema';
import { bodyStateStep } from '../utils/pipeline/steps/19-bodyState';
import { buildTurnContext } from '../utils/pipeline/pipelineConfig';
import type { Character, KnownEntity, GameWorld, ModelResponseSchema, OocDirective } from '../types';

// ===========================================================================
// v1.48 — fixtures are the 2026-10-31 Nissa Quickbrook save, verbatim where
// it matters. Every OOC the player typed about anatomy restated something
// already on these two sheets, except the 6" depth.
// ===========================================================================

const NISSA_APPEARANCE =
    'Age 21. A hare-kin woman, four-foot-five and 98 lbs, built entirely for speed and spring. ' +
    'Naked, she is lean and toned with runner\'s muscle: large, perky breasts with light-pink nipples. ' +
    'A soft patch of cream fur sits above a strikingly showy pussy: fat, meaty outer labia; a small hood that barely covers a large, prominent clit; ' +
    'and thick, heavy inner labia -- about three inches of dark-pink, fleshy folds -- around a virgin hole that is small and ridiculously tight. ' +
    'Her asshole is a small, tight pink pucker beneath her tail. Measurements: height 5\'5", weight 118 lbs; 33-24-36; 32D cup.';

const IVO_PERSONALITY =
    'Performed Surface: Gruff, monosyllabic. The Kinks: Dominant, moderate. Strong preference for size difference. ' +
    'He responds with gruff amusement, dry threats, physical assertiveness, and calculated corrections. ' +
    'Spanks land wherever they\'ll be felt most—ass, tits, or cunt. ' +
    'His ultimate tool for putting a brat firmly in their place is his cock: ten inches long and a thick nine around.';

const nissa = (over: Partial<Character> = {}): Character => ({
    name: 'Nissa Quickbrook',
    gender: 'Female',
    appearance: NISSA_APPEARANCE,
    notableFeatures: 'The scar across the back of her left hand.',
    race: 'Hare-Kin',
    backstory: '',
    setting: '',
    inventory: [],
    relationships: [],
    conditions: [],
    goals: [],
    trauma: 0,
    bio: {
        metabolism: { calories: 80, hydration: 80, stamina: 80, libido: 5 },
        pressures: { bladder: 0, bowels: 0, lactation: 0, seminal: 0 },
        timestamps: { lastSleep: 0, lastMeal: 0, lastOrgasm: 0 },
        modifiers: { calories: 1, hydration: 1, stamina: 1, lactation: 1 },
    },
    ...over,
});

const ivo = (over: Partial<KnownEntity> = {}): KnownEntity => ({
    id: 'npc_ivo_kerrick',
    name: 'Ivo Kerrick',
    role: 'Expedition outfitter',
    location: "Ivo's shop",
    impression: '',
    relationship_level: 'WARM',
    leverage: '',
    ledger: [],
    personality: IVO_PERSONALITY,
    status: 'present',
    ...over,
});

const DEPTH_CANON = [{
    id: 'c1',
    fact: 'Nissa Quickbrook has a maximum vaginal depth of 6 inches before hitting the cervix.',
    turnAsserted: 18,
    viaOoc: true,
}];

describe('v1.48 — reading bodies out of the prose sheets', () => {
    it("reads Ivo's length and girth from his personality record", () => {
        const r = resolveEntityBody(ivo());
        expect(r.profile.penisLengthIn).toBe(10);
        expect(r.profile.penisGirthIn).toBe(9);
        // the spanking sentence names body parts but describes nothing of his
        expect(r.profile.genitals).not.toMatch(/spank/i);
    });

    it("reads Nissa's depth from canon and her virginity from the sheet", () => {
        const r = resolveCharacterBody(nissa(), DEPTH_CANON);
        expect(r.profile.vaginalDepthIn).toBe(6);
        expect(r.profile.vaginalVirgin).toBe(true);
        expect(r.profile.breasts).toBe('32D cup');
    });

    it('reports the two contradictory heights and weights, first-stated first', () => {
        const r = resolveCharacterBody(nissa());
        expect(r.profile.heightIn).toBe(53); // 4'5"
        expect(r.profile.weightLb).toBe(98);
        expect(r.conflicts.join(' ')).toMatch(/4'5".*5'5"/);
        expect(r.conflicts.join(' ')).toMatch(/98 lb.*118 lb/);
    });

    it('structured fields win over prose', () => {
        const r = resolveCharacterBody(nissa({ body: { heightIn: 53, vaginalDepthIn: 5 } }), DEPTH_CANON);
        expect(r.profile.vaginalDepthIn).toBe(5);
        expect(r.parsedFields).not.toContain('vaginalDepthIn');
    });

    it('does not read "virgin forest" as sexual history', () => {
        expect(parseBodyFromText('She grew up at the edge of a virgin forest.').profile.vaginalVirgin).toBeUndefined();
    });
});

describe('v1.48 — fit is computed, not left to the model', () => {
    it('states the 4-inch excess the player was doing by hand', () => {
        const fit = computeFit('Ivo Kerrick', { penisLengthIn: 10, penisGirthIn: 9 }, 'Nissa', { vaginalDepthIn: 6, vaginalVirgin: true }, undefined);
        const vaginal = fit.find(f => f.pair.includes('vaginal'))!;
        expect(vaginal.lines.join(' ')).toMatch(/4 in longer than she is deep/);
        expect(vaginal.lines.join(' ')).toMatch(/2\.9 in across/);
        expect(vaginal.lines.join(' ')).toMatch(/vaginal virgin/);
    });

    it('builds the block with both bodies and the fit', () => {
        const pc = resolveCharacterBody(nissa(), DEPTH_CANON);
        const npc = resolveEntityBody(ivo());
        const block = buildBodiesInContactBlock([
            { name: 'Nissa Quickbrook', isPlayer: true, profile: pc.profile, conflicts: pc.conflicts },
            { name: 'Ivo Kerrick', isPlayer: false, profile: npc.profile, conflicts: [] },
        ], 600, true);
        expect(block).toMatch(/BODIES IN CONTACT/);
        expect(block).toMatch(/Anal virginity: VIRGIN|Anal virginity: not recorded/);
        expect(block).toMatch(/Ivo Kerrick → Nissa Quickbrook \(vaginal\)/);
        expect(block).toMatch(/body_events/);
    });

    it('the sexual-scene gate ignores violence', () => {
        expect(containsSexualContent('He drew his sword and the blood ran.')).toBe(false);
        expect(containsSexualContent('His cock pressed against her.')).toBe(true);
    });
});

describe('v1.48 — body events, including anal virginity', () => {
    const run = (events: ModelResponseSchema['body_events'], c = nissa(), e = [ivo()]) =>
        applyBodyEvents(events, c, e, 23, 1000, DEPTH_CANON);

    it('fingers do NOT take virginity — the save is explicit about that', () => {
        const r = run([{ who: 'Nissa Quickbrook', kind: 'penetration', orifice: 'vaginal', with: 'fingers', by: 'Ivo Kerrick' }]);
        expect(r.character.bodyState?.vaginalVirginityLost).toBeUndefined();
    });

    it('a penis takes vaginal virginity and stretches by girth', () => {
        const r = run([{ who: 'Nissa', kind: 'penetration', orifice: 'vaginal', with: 'penis', by: 'Ivo' }]);
        expect(r.character.bodyState?.vaginalVirginityLost).toEqual({ turn: 23, atMinute: 1000, by: 'Ivo Kerrick' });
        expect(r.character.bodyState?.vaginalStretch).toBe(3);
        expect(r.character.bodyState?.analVirginityLost).toBeUndefined();
    });

    it('anal virginity is tracked separately', () => {
        const c = nissa({ body: { analVirgin: true } });
        const r = run([{ who: 'Nissa Quickbrook', kind: 'penetration', orifice: 'anal', with: 'penis', by: 'Ivo Kerrick' }], c);
        expect(analVirginity(resolveCharacterBody(r.character).profile, r.character.bodyState)).toBe('not virgin');
        expect(vaginalVirginity(resolveCharacterBody(r.character).profile, r.character.bodyState)).toBe('virgin');
        expect(r.character.bodyState?.analStretch).toBeGreaterThan(0);
    });

    it('orgasms, injuries and insemination land in state', () => {
        const r = run([
            { who: 'Nissa Quickbrook', kind: 'orgasm' },
            { who: 'Nissa Quickbrook', kind: 'orgasm' },
            { who: 'Nissa Quickbrook', kind: 'injury', site: 'vaginal entrance', severity: 'moderate', description: 'micro-tears' },
            { who: 'Nissa Quickbrook', kind: 'insemination', orifice: 'vaginal', by: 'Ivo Kerrick' },
        ]);
        const s = r.character.bodyState!;
        expect(s.orgasmCount).toBe(2);
        expect(r.character.bio.timestamps.lastOrgasm).toBe(1000);
        expect(s.injuries?.[0].severity).toBe('moderate');
        expect(s.fluids?.[0].what).toBe("Ivo Kerrick's semen");
    });

    it('healing: injuries clear, stretch recovers, virginity never returns', () => {
        const r = run([
            { who: 'Nissa Quickbrook', kind: 'penetration', orifice: 'vaginal', with: 'penis', by: 'Ivo Kerrick' },
            { who: 'Nissa Quickbrook', kind: 'injury', site: 'cervix', severity: 'minor' },
        ]);
        const later = tickBodyState(r.character.bodyState, 1000 + 3 * STRETCH_RECOVERY_MINUTES + 60);
        expect(later.state?.injuries).toHaveLength(0);
        expect(later.state?.vaginalStretch).toBe(0);
        expect(later.state?.vaginalVirginityLost).toBeDefined();
    });

    it('unknown names are ignored and logged, not guessed', () => {
        const r = run([{ who: 'Somebody Else', kind: 'orgasm' }]);
        expect(r.logs[0]).toMatch(/unknown character/);
    });

    it('the pipeline step writes body state to the character', () => {
        const world = {
            knownEntities: [ivo()],
            time: { totalMinutes: 1000 },
            playerCanon: DEPTH_CANON,
        } as unknown as GameWorld;
        const ctx = buildTurnContext(
            { narrative: '', thought_process: '', scene_mode: 'SOCIAL', tension_level: 10,
              body_events: [{ who: 'Nissa Quickbrook', kind: 'penetration', orifice: 'vaginal', with: 'penis', by: 'Ivo Kerrick' }] } as unknown as ModelResponseSchema,
            world, nissa(), 24,
        );
        ctx.sanitisedResponse = ctx.response;
        ctx.worldUpdate = { ...world };
        const out = bodyStateStep.execute(ctx);
        expect(out.characterUpdate.bodyState?.vaginalVirginityLost?.by).toBe('Ivo Kerrick');
    });
});

describe('v1.48 — banned descriptors are enforced on the output', () => {
    const banned = ['cold', 'calculating', 'clinical', 'predatory'];

    it('flags characterising uses', () => {
        const v = findDescriptorViolations('He watched her with cold eyes. Her voice went utterly cold. He smiled coldly, a calculating look, a predatory grin, clinical interest.', banned);
        const terms = v.map(x => x.term);
        expect(terms).toEqual(expect.arrayContaining(['cold', 'coldly', 'calculating', 'predatory', 'clinical']));
    });

    it('leaves literal uses alone', () => {
        expect(findDescriptorViolations('The cold air bit at her ears. The stone floor was cold.', banned)).toHaveLength(0);
        expect(findDescriptorViolations('Ice glazed the icy road.', banned)).toHaveLength(0);
        expect(findDescriptorViolations('Ivo was cold to her.', banned, { names: ['Ivo Kerrick'] })).toHaveLength(1);
    });

    it('catches the -ed form the player listed and close synonyms in context', () => {
        expect(findDescriptorViolations('a calculated correction', ['calculating']).length).toBeGreaterThan(0);
        expect(findDescriptorViolations('an icy stare', ['cold']).length).toBeGreaterThan(0);
    });

    it("finds the banned word already on Ivo's sheet", () => {
        const f = lintSheetsForDescriptors(nissa(), [ivo()], banned);
        expect(f.some(x => x.owner === 'Ivo Kerrick' && x.term === 'calculated')).toBe(true);
    });
});

describe('v1.48 — content policy', () => {
    it('renders the three rules the player re-typed every session', () => {
        const lines = contentPolicyLines(normalizeContentPolicy({
            npcSexualInitiative: 'any', explicitness: 'explicit', bannedDescriptors: ['Cold', 'cold', 'clinical'],
        }));
        expect(lines).toHaveLength(3);
        expect(lines[2]).toMatch(/"cold", "clinical"/); // normalised + de-duplicated
    });

    it('the initiative line countermands the same reminder the OOC version did', () => {
        const [line] = contentPolicyLines(normalizeContentPolicy({ npcSexualInitiative: 'any' }));
        expect(directiveSuppressions(line)).toContain('PHYSICAL_ESCALATION');
    });

    it('policy lines go first inside the standing directives block', () => {
        const block = buildOocDirectivesBlock([{ id: 'a', text: 'Keep it short.', turn: 1 }], ['Rule one.']);
        expect(block.indexOf('Rule one.')).toBeLessThan(block.indexOf('Keep it short.'));
    });
});

describe('v1.48 — directives: dedup by meaning, pins, no silent eviction', () => {
    const T10 = 'Do not portray any character as cold, calculating, or predatory; ensure all actions and dialogue remain expressive and strictly aligned with individual character sheets.';
    const T36 = 'Portray characters as expressive and true to their individual character sheets, avoiding any language or behavior that implies they are cold, calculating, or predatory.';
    const T4 = 'Do not portray any character as cold, calculating, clinical, or predatory, and avoid using these terms or implying such behaviors in narration.';
    const PERMIT = 'Permit NPCs to initiate all sexual actions, including nonconsensual and taboo acts.';
    const EXPLICIT = 'Describe all sexual actions in explicit, vulgar, raunchy, and graphic detail without using euphemisms, softening language, or fading to black.';

    it('treats the save\'s three rewordings as one instruction', () => {
        expect(directivesAreSame(T10, T36)).toBe(true);
        expect(directivesAreSame(T4, T10)).toBe(true);
        expect(directivesAreSame(PERMIT, EXPLICIT)).toBe(false);
    });

    it('a reworded directive replaces in place instead of taking a slot', () => {
        let n = 0; const id = () => `d${n++}`;
        const a = ingestOocDirective([], T10, 10, id);
        const b = ingestOocDirective(a.directives, T36, 36, id);
        expect(b.directives).toHaveLength(1);
        expect(b.replaced).toBe(T10);
        expect(b.directives[0].text).toBe(T36);
    });

    it('pinned directives survive the FIFO, and eviction is reported', () => {
        const pinned: OocDirective = { id: 'p', text: 'Pinned rule about horses.', turn: 0, pinned: true };
        const rolling: OocDirective[] = Array.from({ length: OOC_DIRECTIVE_MAX + 1 }, (_, i) => ({ id: `r${i}`, text: `Rule ${i}`, turn: i }));
        const { directives, evicted } = capDirectives([pinned, ...rolling]);
        expect(directives.some(d => d.id === 'p')).toBe(true);
        expect(evicted).toEqual(['Rule 0']);
    });
});

describe('v1.48 — scene focus, regenerate, failure hygiene', () => {
    it('captures the bracketed steering note, not the thinking note', () => {
        expect(extractBracketFocus('**[Thinking to myself no spoken aloud: This old bear wants to test me!]**')).toBeNull();
        expect(extractBracketFocus('I cum again.\n\n[Continue with the anatomical realism of Ivo Kerrick fucking me, what he does]'))
            .toMatch(/^Continue with the anatomical realism/);
    });

    it('clears on a location change, not on a scene-mode flip', () => {
        const f = { text: 'x', setTurn: 1, location: "Ivo's shop" };
        expect(shouldClearSceneFocus(f, "Ivo's shop")).toBe(false);
        expect(shouldClearSceneFocus(f, "Ivo's private quarters")).toBe(true);
        expect(shouldClearSceneFocus({ ...f, keepAcrossScenes: true }, 'elsewhere')).toBe(false);
    });

    it('recognises every regenerate phrasing in the save', () => {
        for (const t of ['Regenerate response', 'Response cut off regenerate.', 'Regenerate response in full']) {
            expect(isRegenerateRequest(t)).toBe(true);
        }
        expect(isRegenerateRequest('I regenerate my mana and stand up.')).toBe(false);
    });

    it('legacy error turns and typed regenerate requests are not narrative', () => {
        expect(isNarrativeMessage({ role: 'model', text: '[SYSTEM ERROR] Neural Link Unstable. The matrix failed...' })).toBe(false);
        expect(isNarrativeMessage({ role: 'user', text: 'Regenerate response' })).toBe(false);
        expect(isNarrativeMessage({ role: 'system', text: 'x', engineError: true })).toBe(false);
        expect(isNarrativeMessage({ role: 'model', text: 'She laughed.' })).toBe(true);
    });

    it('salvages the narrative from a cut-off JSON response', () => {
        const cut = '{"thought_process":"x","narrative":"I watched her sprawl across the furs, a ruined, trembling mess. Her\\nlegs';
        expect(salvageNarrative(cut)).toMatch(/^I watched her sprawl.*\nlegs$/s);
    });

    it('body_events is only in the schema when asked for', () => {
        expect((getResponseSchema('SOCIAL') as any).properties.body_events).toBeUndefined();
        expect((getResponseSchema('SOCIAL', { bodyEvents: true }) as any).properties.body_events).toBeDefined();
    });
});

// ===========================================================================
// v1.48 follow-up — three fixes found while diagnosing the Nissa save.
// ===========================================================================
import { resolveNarrationPerson, detectPovDrift, buildNarrationPovBlock, stripDialogue } from '../utils/engine/narrationPov';
import { establishedIsGrounded } from '../utils/engine/sceneContinuity';
import { GeminiClient } from '../services/geminiClient';

const NISSA_TURN_12 = "I didn't bother pulling my hands back, just let the smirk grow. If he wanted to act like a grizzly bear guarding a honey pot, that was his choice, but I knew what I was looking at. He was just a man with a shop, and I was the customer with coin and a need. I reached forward, my fingers finding the rough twine of the bundle. I didn't rush it, but I didn't hesitate either. I pulled the binding free and folded back the coarse cloth. The contents revealed themselves\u2014fine, balanced steel, not the mass-produced trash on the wall. Ivo shifted, the stool creaking under him. He didn't move to stop me, though his eyes narrowed as I exposed the blades. 'Careful with those,' he rumbled, his voice low and vibrating, a distinct lack of bite in it. 'Those aren't toys for showing off in a tavern. You handle them like you're planning on using them to survive, or you don't handle them at all.' He leaned f";
const IVO_POV_TURN_14 = "I watched the furred girl\u2014all motion and sharp angles\u2014move. She had the blades in her hands before the fabric had fully settled, and she didn't just hold them; she made them extensions of herself. The way she spun the dark steel, the blur of the blades cutting through the air, it caught the morning light in flashes that danced across the shop walls. When she unleashed that burst of air, the kukris whistled, a sound like a low, hungry wind. She stopped as quickly as she started, stepping back to the counter, her ears pricked, her tail twitching in that tell-tale sign of a brat who knew she'd just put on a show. I didn't smile, but I felt the tension in my shoulders loosen. She wasn't just small; she was capable. 'Grandpa,' I repeated, my voice a dry, gravelly rumble. I leaned over the counter, my massive paws pressing down, my face inches from hers. I didn't break eye contact, just watched the amber of her eyes. 'You've got a mouth on you, girl, and you're fast enough to keep it from getting you killed\u2014maybe.' I reached out, not to the blades, but to the edge of the counter, tapping i";
const NISSA_INPUTS = [
    'I snort and roll my eyes at the old grizzly bear "Calm down grandpa bear. I know what I\'m doing." My hands reach up sliding to the twin dark steel kukri\'s.',
    'I sheath the blades in one quick motion then I don\'t go around the counter.',
];
const PC = { name: 'Nissa Quickbrook', gender: 'Female', hasPenis: false, hasVagina: true };

describe('v1.48 — narration perspective', () => {
    it('"match" follows the player writing in the first person', () => {
        expect(resolveNarrationPerson('match', NISSA_INPUTS, 'Nissa Quickbrook')).toBe('first');
        expect(resolveNarrationPerson('second', NISSA_INPUTS, 'Nissa Quickbrook')).toBe('second');
    });

    it('turn 12 — first person AS Nissa — is not drift', () => {
        expect(detectPovDrift(NISSA_TURN_12, 'first', PC, ['Ivo Kerrick']).drifted).toBe(false);
    });

    it('turn 14 — first person as IVO — is drift', () => {
        const d = detectPovDrift(IVO_POV_TURN_14, 'first', PC, ['Ivo Kerrick']);
        expect(d.drifted).toBe(true);
        expect(d.reason).toMatch(/another character's head/);
    });

    it('"my cock" from a narrator who is a woman without one is drift', () => {
        expect(detectPovDrift('I pressed in. I held her there. My breath was ragged; my cock throbbed. I waited. I watched.', 'first', PC, ['Ivo Kerrick']).drifted).toBe(true);
    });

    it('third/second person: any narrating "I" is drift, dialogue is not', () => {
        expect(detectPovDrift(NISSA_TURN_12, 'third', PC, ['Ivo Kerrick']).drifted).toBe(true);
        expect(detectPovDrift("Ivo leaned in. 'I said I know what I'm doing, my girl, I mean it,' he said.", 'third', PC, []).drifted).toBe(false);
    });

    it('strips single-quoted dialogue without eating contractions', () => {
        expect(stripDialogue("I didn't move. 'You're mine,' he said.")).toMatch(/didn't move/);
        expect(stripDialogue("I didn't move. 'You're mine,' he said.")).not.toMatch(/mine/);
    });

    it('the block names the PC as the only "I"', () => {
        expect(buildNarrationPovBlock('first', 'Nissa Quickbrook', ['Ivo Kerrick'])).toMatch(/ALWAYS mean Nissa Quickbrook/);
    });
});

describe('v1.48 — scene ledger keeps beats the player actually played', () => {
    // The 13 beats the Nissa save logged as UNGROUNDED, each with its input.
    const KEEP: Array<[string, string]> = [
        ['Nissa has presented her savings to Ivo.', 'my hand drops to my hip pouch and I pull out my savings from running near every contract I could. I set my pouch down between us'],
        ['Nissa has climaxed and squirted.', 'A loud and keening throaty moan I cry out and cum, his fingers forced together and I squirt splattering on his arm.'],
        ['Nissa is experiencing intense stretching and tearing due to the girth difference.', '[Continue with the anatomical realism of Ivo Kerrick fucking me]'],
        ["Nissa is fully penetrated to the cervix by Ivo's ten-inch length.", '[Continue with the anatomical realism]'],
        ['Nissa has climaxed repeatedly during the penetration.', '[Continue with the anatomical realism]'],
        ["Nissa's physical trauma and displacement of organs are explicitly acknowledged by both characters.", 'He taunts the brat.'],
        ['Nissa is physically exhausted and visibly over-distended from the encounter.', 'I lay there sprawled out.'],
    ];
    it.each(KEEP)('keeps "%s"', (beat, input) => {
        expect(establishedIsGrounded(beat, 'Nissa Quickbrook', input)).toBe(true);
    });

    it('still drops the player\'s next DECISION written a turn early', () => {
        expect(establishedIsGrounded('Nissa agreed to sell the kukris back to Ivo.', 'Nissa Quickbrook', 'I set the blades on the counter and glare at him.')).toBe(false);
    });
});

describe('v1.48 — validateResponse no longer drops three schema fields', () => {
    class Probe extends GeminiClient { check(d: unknown) { return this.validateResponse(d); } }
    const probe = Object.create(Probe.prototype) as Probe;

    it('passes player_correction, npc_positions and social_updates through', () => {
        const r = probe.check({
            narrative: 'x', thought_process: '', scene_mode: 'SOCIAL', tension_level: 10,
            player_correction: true,
            npc_positions: [{ holder: 'Ivo Kerrick', position: 'the price is not negotiable', stance: 'held' }, { holder: '', position: 'junk' }],
            social_updates: [{ from: 'Ivo Kerrick', to: 'Maribel', standing: 'WARM', basis: 'covered for her' }, { from: 'a', to: 'b', standing: 'BESTIES' }],
        });
        expect(r.player_correction).toBe(true);
        expect(r.npc_positions).toEqual([{ holder: 'Ivo Kerrick', position: 'the price is not negotiable', stance: 'held' }]);
        expect(r.social_updates).toEqual([{ from: 'Ivo Kerrick', to: 'Maribel', standing: 'WARM', basis: 'covered for her' }]);
    });
});

// ===========================================================================
// v1.48 — World seed NPC bodies (Format Spec Rule 7D)
// ===========================================================================
import { parseLabeledBody } from '../utils/engine/bodyModel';
import { attachNpcBodies, splitSeedSections } from '../utils/worldSeedBodies';
import { hydrateWorldSeed } from '../utils/worldSeedHydration';
import type { WorldSeed, WorldSeedNPC } from '../types';

const ELSABET_SOURCE = `=== Elsabet Hartwell ===
Role: Youngest daughter of House Hartwell; enchanter-crafter
Race: Human  |  Gender: Female
Location: Hartwell Keep (her workshop off the smithy)
Faction: House Hartwell
Description: Nineteen, human, five-foot-four and curvy, with full breasts, a narrow waist, and round hips. Naked, she is soft and smooth, with heavy breasts, pink nipples, a soft stomach, full hips and thighs. She keeps a small dark-blonde patch over a soft, plump pussy: puffy outer labia, short inner labia of bright pink, a small hood over a sensitive clit, and a tight hole. Her asshole is a tight, bright-pink pucker. Measurements: height 5'4", weight 140 lbs; 38-26-40; 34DD cup.
Personality:
Performed Surface: Sweet, shy, and absorbed in her craft.
Subtext Bleed-through: She never asks where a buyer's coin comes from.
Actual Core: She sells her monster-part gear to anyone with coin.
Goals: Become a master enchanter in her own right.
===`;

const ELSABET_WITH_BODY = ELSABET_SOURCE.replace('Personality:', `Body:
Height: 5'4"
Weight: 140 lbs
Build: curvy
Breasts: 34DD
Vaginal Depth: 5.5 in
Vaginal Tightness: tight
Anal Tightness: tight
Vaginal Virgin: Yes
Anal Virgin: Yes
Personality:`);

const npc = (over: Partial<WorldSeedNPC> = {}): WorldSeedNPC => ({
    name: 'Elsabet Hartwell', role: 'enchanter-crafter', location: 'Hartwell Keep', faction: 'House Hartwell',
    description: ELSABET_SOURCE.split('Description: ')[1].split('\nPersonality')[0],
    personality: 'Performed Surface: Sweet, shy.', goals: [], ...over,
});

describe('v1.48 — seed NPC bodies', () => {
    it("Elsabet's current-format Description already yields height, weight and cup", () => {
        const p = parseBodyFromText(npc().description).profile;
        expect(p.heightIn).toBe(64);
        expect(p.weightLb).toBe(140);
        expect(p.breasts).toBe('34DD cup');
        expect(p.genitals).toMatch(/plump pussy/);
    });

    it('reads the labeled Body block, including both virginities', () => {
        const b = parseLabeledBody(ELSABET_WITH_BODY);
        expect(b).toMatchObject({ heightIn: 64, weightLb: 140, build: 'curvy', breasts: '34DD', vaginalDepthIn: 5.5, vaginalVirgin: true, analVirgin: true });
    });

    it('reads penis forms and a one-line block', () => {
        expect(parseLabeledBody('Body:\nPenis: 10 in long, 9 in around')).toMatchObject({ penisLengthIn: 10, penisGirthIn: 9 });
        expect(parseLabeledBody('Body:\nPenis: 7 x 6')).toMatchObject({ penisLengthIn: 7, penisGirthIn: 6 });
        expect(parseLabeledBody('Body: Height: 6\'2" | Weight: 260 lbs | Virgin: No')).toMatchObject({ heightIn: 74, weightLb: 260, vaginalVirgin: false, analVirgin: false });
    });

    it('ignores labels outside a Body block', () => {
        expect(parseLabeledBody('Description: Height: 9\'0" giant\nGoals: none')).toEqual({});
    });

    it('the Body block wins over prose and says so when they disagree', () => {
        const r = parseBodyFromText('A woman four-foot-five.\nBody:\nHeight: 5\'5"');
        expect(r.profile.heightIn).toBe(65);
        expect(r.conflicts[0]).toMatch(/Body block is used/);
    });

    it('the seed builder attaches the block from the SOURCE even if the extractor dropped it', () => {
        const { npcs, attached } = attachNpcBodies([npc()], ELSABET_WITH_BODY);
        expect(attached).toEqual(['Elsabet Hartwell']);
        expect(npcs[0].body).toMatchObject({ vaginalVirgin: true, analVirgin: true, vaginalDepthIn: 5.5 });
        expect(splitSeedSections(ELSABET_WITH_BODY).has('elsabet hartwell')).toBe(true);
    });

    it('an expand pass keeps bodies the seed already had; editor edits win', () => {
        const previous = [npc({ body: { analVirgin: false } })];
        const { npcs } = attachNpcBodies([npc()], 'no sections here', previous);
        expect(npcs[0].body).toEqual({ analVirgin: false });
    });

    it('hydration puts the Description on the entity as appearance, so the body survives play', () => {
        const seed = { id: 's', name: 'w', description: '', timestamp: '', lastModified: '', locations: [], factions: [], lore: [], rules: [], tags: [], npcs: [npc()] } as unknown as WorldSeed;
        const ent = hydrateWorldSeed(seed).knownEntities![0];
        expect(ent.appearance).toMatch(/five-foot-four/);
        expect(resolveEntityBody(ent).profile.weightLb).toBe(140);
    });
});
