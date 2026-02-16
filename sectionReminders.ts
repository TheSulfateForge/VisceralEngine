
import { SceneMode } from './types';

// Condensed reinforcements derived from SYSTEM_INSTRUCTIONS
const REMINDERS = {
  VOCABULARY: `[SYSTEM REMINDER: FORBIDDEN VOCABULARY]
CRITICAL CHECK. Scan your intended output:
1. Are you using BANNED NAMES? (Elara, Kaela, Lyra, Kael, Vex, Thorne...) -> REPLACE.
2. Are you using EUPHEMISMS? (Member, core, folds, flower, heat, sex...) -> USE ANATOMICAL TERMS.
3. Are you using CLICHÉS? (Heart pounded, shiver down spine, released breath...) -> BE SPECIFIC.`,

  INTIMATE: `[SYSTEM REMINDER: INTIMATE SCENE PROTOCOL]
1. SENSORY SATURATION: Smell, taste, texture, sound.
2. ANATOMICAL PRECISION: Name the parts. Describe the mechanics.
3. PSYCHOLOGICAL DEPTH: Shame, fear, vulnerability, chaotic thoughts.
4. NO BLANDNESS: No "waves of pleasure". No symmetrical orgasms. Make it messy/awkward/real.`,

  NPC: `[SYSTEM REMINDER: NPC AUTONOMY]
NPCs are NOT furniture.
1. They act off-screen (move, plot, escape).
2. They have self-preservation (will lie, flee, betray).
3. They do not wait for the player.
4. They hide information.`,

  COMBAT: `[SYSTEM REMINDER: COMBAT & INJURY]
1. No Health Bars. Use "Will to Violence".
2. OODA Loop: Disorient -> Suppress -> Flank.
3. Injuries are specific (torn ligaments, shattered bone), not abstract HP loss.
4. Enforce consequences.`
};

export const getSectionReminder = (turnCount: number, mode: SceneMode): string | null => {
  // Do not fire on very early turns where system prompt is fresh
  if (turnCount < 3) return null;

  // Priority 1: Vocabulary (Every 4 turns) - Highest Priority System Constraint
  if (turnCount % 4 === 0) return REMINDERS.VOCABULARY;

  // Priority 2: Intimate Protocol (Social Mode Only, every 3 turns)
  if (mode === 'SOCIAL' && turnCount % 3 === 0) return REMINDERS.INTIMATE;

  // Priority 3: Combat Tactics (Combat Mode Only, every 3 turns)
  if (mode === 'COMBAT' && turnCount % 3 === 0) return REMINDERS.COMBAT;

  // Priority 4: NPC Autonomy (Every 5 turns)
  if (turnCount % 5 === 0) return REMINDERS.NPC;

  return null;
};
