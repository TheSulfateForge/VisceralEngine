import { describe, it, expect } from 'vitest';
import { processThreatSeeds } from '../utils/engine/threatPipelineCore';
import type { DebugLogEntry, WorldTickEvent } from '../types';

/**
 * v1.28 — replay of the exact threat sequence from the reported save
 * (Callan Drevast, turns 26-43). Under the pre-v1.28 pipeline the Origin Gate
 * deleted every one of these, world.emergingThreats stayed [], and because
 * processThreatSeeds could never find an `existing` record the model was free
 * to re-word and re-number the arc every turn. The raw sequence below re-aims
 * six times in seven turns while its ETA wanders 3,3,3,2,2,2,3,3,2,2,1.
 */

const RAW_TICKS: WorldTickEvent[][] = [
  [
    {
      "description": "The Blackmoor brothers are actively testing the social and legal boundaries of the Merchant District to harass nobility they deem 'stock'.",
      "turns_until_impact": 1,
      "playerActionCause": "Callan Drevast observed Veyric and Nicor Blackmoor harassing Mirabel and Liora Calder at Merchant District on turn 26"
    }
  ],
  [
    {
      "description": "The Blackmoor brothers are actively testing the social and legal boundaries of the Merchant District",
      "playerActionCause": "Veyric Blackmoor observed Callan Drevast at Merchant District on turn 26"
    }
  ],
  [
    {
      "description": "The Blackmoor brothers are actively escalating their response to Callan's provocation, shifting from harassment to a targeted threat against his person.",
      "turns_until_impact": 1,
      "playerActionCause": "Callan Drevast observed insulting the Blackmoor brothers at Merchant District on turn 26"
    }
  ],
  [
    {
      "description": "The Blackmoor brothers, now publicly humiliated by the Crown Prince, will attempt to leverage their connections to the Quiet Hand or political allies to undermine the Drevast reputation, seeking vengeance.",
      "turns_until_impact": 3,
      "playerActionCause": "Callan Drevast revealed his identity and humiliated the Blackmoor heirs at the Merchant District on turn 28."
    }
  ],
  [
    {
      "description": "The Blackmoor brothers are now publicly humiliated and desperate; they are likely to initiate a covert campaign to discredit Callan or damage his reputation to bury this event.",
      "turns_until_impact": 3,
      "playerActionCause": "Callan Drevast observed Veyric and Nicor Blackmoor at Merchant District on turn 29"
    }
  ],
  [
    {
      "description": "House Blackmoor will likely mobilize legal and political assets to mitigate the damage of the public record.",
      "turns_until_impact": 3,
      "playerActionCause": "Callan Drevast observed Veyric and Nicor Blackmoor harassing House Calder and publicly exposed them on turn 30."
    }
  ],
  [
    {
      "description": "House Blackmoor will likely mobilize legal and political resources to mitigate the damage to their reputation and the potential treason investigation.",
      "turns_until_impact": 3
    }
  ],
  [
    {
      "description": "House Blackmoor will likely launch a high-stakes legal and political counter-offensive to contain the damage of the public exposure.",
      "turns_until_impact": 3
    }
  ],
  [
    {
      "description": "The Blackmoor family will likely move to use their significant patronage to pressure witnesses in the coming days.",
      "turns_until_impact": 2
    }
  ],
  [
    {
      "description": "The Blackmoor house is likely mobilizing legal and political countermeasures in response to the public exposure.",
      "turns_until_impact": 2,
      "dormantHookId": "hook_anwen_secret_exposure"
    }
  ],
  [
    {
      "description": "The Blackmoor House will likely attempt to exert political pressure or legal maneuvering to minimize the fallout of the public exposure.",
      "turns_until_impact": 2
    }
  ],
  [
    {
      "description": "House Blackmoor is preparing a legal and political counter-offensive to suppress the public record of the incident.",
      "turns_until_impact": 2
    }
  ],
  [
    {
      "description": "House Blackmoor will likely attempt to spin or retaliate against the Crown's intervention, potentially leaking Callan's commoner activities to discredit him.",
      "turns_until_impact": 3,
      "dormantHookId": "hook_anwen_secret_exposure"
    }
  ],
  [
    {
      "description": "House Blackmoor is mobilizing legal counsel to challenge the Crown Prince's testimony and the validity of the public record.",
      "turns_until_impact": 3,
      "dormantHookId": "hook_twin_protection_dilemma"
    }
  ],
  [
    {
      "description": "House Blackmoor's legal counsel is mobilizing to aggressively dismantle the witness testimonies and discredit Callan's narrative.",
      "turns_until_impact": 2,
      "playerActionCause": "Callan Drevast observed the harassment and forced a public record at Merchant District on turn 33"
    }
  ],
  [
    {
      "description": "Duke Corrith Blackmoor begins mobilizing political leverage to suppress the public record of his sons' harassment of the Calder ladies.",
      "turns_until_impact": 2,
      "dormantHookId": "hook_twin_protection_dilemma"
    }
  ],
  [
    {
      "description": "House Blackmoor is actively lobbying to categorize the incident as a minor social infraction, risking the erasure of the 'menacing' and 'treason' aspects of the report.",
      "turns_until_impact": 2,
      "dormantHookId": "hook_succession_duty_conflict"
    }
  ],
  [
    {
      "description": "Duke Corrith Blackmoor is currently at the gates, seeking to manage the fallout of his sons' actions before the legal process gains momentum.",
      "turns_until_impact": 1,
      "playerActionCause": "Callan Drevast observed the Blackmoor brothers' public harassment and ensured it was formally recorded by the Watch on turn 31."
    }
  ]
];

const KNOWN_ENTITIES = [
  {
    "name": "Anwen Drevast",
    "location": "Drevast Palace Sanctum",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Brenna Kestrel",
    "location": "Caerveld",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Callan Drevast",
    "location": "Caerveld, Merchant District",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Cassian Verancourt",
    "location": "Caerveld (Verancourt townhouse) and Sablebrook Manor",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Count Aster Verancourt",
    "location": "Caerveld (Verancourt townhouse, Noble Quarter); seasonal residence at Sablebrook Manor",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Countess Lyrelle Verancourt",
    "location": "Caerveld (Verancourt townhouse); seasonal residence at Sablebrook Manor",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Cyran Fennara",
    "location": "Caerveld (spacious family townhouse and warehouse complex in the Rivergate Quarter)",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Dragomir Kamenova",
    "location": "Kamenova Hold",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Duchess Sania Blackmoor",
    "location": "Caerveld (Blackmoor townhouse) and Wolfsmere Estate",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Duke Corrith Blackmoor",
    "location": "Drevast Palace Sanctum",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Elowen Sarath",
    "location": "The Drevast Archive",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Faelina Row",
    "location": "Caerveld, Merchant District",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Guildmaster Halric Vance",
    "location": "Caerveld (Adventurers Guild headquarters above the dungeon entrance)",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Inquisitor-Captain Sevren Wynne",
    "location": "Tharnic Dominion's western trade-fortress (closest to the Compact border)",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Iskra Renne",
    "location": "Caerveld",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Kessandra Emberflight",
    "location": "Craftsman Row",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "King Osric Drevast",
    "location": "Drevast Palace Sanctum",
    "relationship_level": "WARM"
  },
  {
    "name": "Lady Mirabel Calder",
    "location": "Merchant District",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Liora Calder",
    "location": "Caerveld (Calder Townhouse)",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Lirien Verancourt",
    "location": "Caerveld (Verancourt townhouse, with frequent absences)",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Livia Frostvik",
    "location": "Kamenova Hold",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Lord Aldreth Blackmoor",
    "location": "Caerveld (Blackmoor townhouse); frequently at Wolfsmere",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Lord Nicor Blackmoor",
    "location": "Merchant District",
    "relationship_level": "HOSTILE"
  },
  {
    "name": "Lord Prosper Calder",
    "location": "Caerveld (Noble Quarter, a very modest, aging townhouse)",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Lord Veyric Blackmoor",
    "location": "Drevast Palace Sanctum",
    "relationship_level": "HOSTILE"
  },
  {
    "name": "Lyssara of the Long Branch",
    "location": "Caerveld (Diplomatic Quarter, small private house)",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Maela Fennara",
    "location": "Caerveld (family townhouse), Verdant Compact",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Maelin Fennara",
    "location": "Caerveld (family townhouse), Verdant Compact",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Marigold Underhill",
    "location": "Caerveld, Merchant District",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Dervla Quill",
    "location": "Caerveld",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Nettle Birch",
    "location": "Caerveld",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Odalys Hallenbrook",
    "location": "Craftsman Row",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Petra Nester",
    "location": "Drevast Palace Sanctum",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Pippa Thistledown",
    "location": "Caerveld, Merchant District",
    "relationship_level": "WARM"
  },
  {
    "name": "Queen Ondine Drevast",
    "location": "Drevast Palace Sanctum",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Rosalind Fairweather",
    "location": "Caerveld",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Stig Frostvik",
    "location": "Kamenova Hold",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Sura Ashwing",
    "location": "Caerveld",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Sylara Fennara",
    "location": "Caerveld (family townhouse and warehouse complex in the Rivergate Quarter)",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Theron Verancourt",
    "location": "Caerveld (Verancourt townhouse); occasional retreats to Sablebrook",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Tihana Kamenova",
    "location": "Kamenova Hold",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Vesna Kamenova",
    "location": "Kamenova Hold",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Wren Callahan",
    "location": "Craftsman Row",
    "relationship_level": "NEUTRAL"
  },
  {
    "name": "Yenna Wildrun",
    "location": "Caerveld",
    "relationship_level": "NEUTRAL"
  }
];

const ENTITY_NAMES = KNOWN_ENTITIES.map(e => e.name);
const PLAYER = 'Callan Drevast';

describe('v1.28 — reported save replay (Blackmoor arc, T26-T43)', () => {
    const run = () => {
        const debug: DebugLogEntry[] = [];
        let state: WorldTickEvent[] = [];
        const perTurn: { turn: number; live: WorldTickEvent[]; anchors: WorldTickEvent[] }[] = [];
        let turn = 26;
        for (const incoming of RAW_TICKS) {
            state = processThreatSeeds(
                incoming, state, turn, debug, [], {},
                ENTITY_NAMES, PLAYER, 'NARRATIVE', {}, [], [],
                KNOWN_ENTITIES, 'Drevast Palace Sanctum', undefined, 10,
            );
            perTurn.push({
                turn,
                live: state.filter(t => t.status !== 'unvalidated'),
                anchors: state.filter(t => t.status === 'unvalidated'),
            });
            turn++;
        }
        return { perTurn, debug };
    };

    it('never shows the player more than one live Blackmoor threat at a time', () => {
        for (const { turn, live } of run().perTurn) {
            expect(live.length, `turn ${turn}`).toBeLessThanOrEqual(1);
        }
    });

    it('never lets a live threat\'s ETA increase or jump downward', () => {
        const { perTurn } = run();
        const byId = new Map<string, number>();
        for (const { turn, live } of perTurn) {
            for (const t of live) {
                const prev = byId.get(t.id!);
                if (prev !== undefined && t.turnCreated !== turn) {
                    // Engine rules may push an ETA out (pivot penalty); nothing
                    // may pull it in by more than the one turn that elapsed.
                    expect(t.turns_until_impact!, `turn ${turn}`).toBeGreaterThanOrEqual(prev - 1);
                }
                byId.set(t.id!, t.turns_until_impact!);
            }
        }
    });

    it('holds one locked wording per arc instead of re-aiming each turn', () => {
        const { debug } = run();
        const locks = debug.filter(l => /ANCHOR DESCRIPTION LOCKED|DESCRIPTION LOCKED/.test(l.message));
        expect(locks.length).toBeGreaterThan(0);
    });

    it('penalises the model for re-aiming rather than accepting the pivot', () => {
        const { debug } = run();
        expect(debug.some(l => l.message.includes('[THREAT PIVOT DETECTED'))).toBe(true);
    });

    it('blocks the model pulling a threat forward (the "15 then 1" jump)', () => {
        const { debug } = run();
        expect(debug.some(l => l.message.includes('[THREAT ETA ACCELERATION BLOCKED]'))).toBe(true);
    });

    it('retires a churning arc instead of letting it run forever', () => {
        const { debug } = run();
        expect(debug.some(l => l.message.includes('[THREAT ANCHOR EXPIRED — v1.28]'))).toBe(true);
    });

    it('lets a legitimately-caused threat go live (the old gate passed almost none)', () => {
        const { perTurn } = run();
        const turnsWithLiveThreat = perTurn.filter(p => p.live.length > 0).length;
        expect(turnsWithLiveThreat).toBeGreaterThan(1);
    });
});
