import { describe, it, expect } from 'vitest';
import { detectSelfRepetition, buildRepetitionReminder } from '../utils/driftDetector';

// ---------------------------------------------------------------------------
// Fixtures are the ACTUAL model turns from the save that surfaced this bug
// (Codi Whitmore, 2026-08-19). Measured 8-gram overlap against the previous
// model turn:
//
//   turn at idx 10 vs idx  8 → 0.627   (duplicate — 104-char verbatim opening,
//                                       592-char verbatim ending)
//   turn at idx 37 vs idx 35 → 0.445   (duplicate — whole middle + closing para)
//   turn at idx 10 vs idx  4 → 0.078   (legitimate — same footpath re-described)
//   everything else          → 0.000
//
// The 0.15 threshold therefore sits with a 2x margin on both sides. These
// tests exist to keep it there.
// ---------------------------------------------------------------------------

const TURN_04 = "The path is packed with fine, pale dust that clings to your boots. As you walk, the air grows warmer, thick with the smell of churned earth and drying hay. You pull back the hood, the cool morning air hitting your cheeks and the nape of your neck, and raise a hand in a wave. The response is immediate. The Matron, Maevis, stops and her amber eyes brighten, a slow, genuine smile spreading across her face. She doesn't squint or look for weapons; she simply looks at your silhouette, then at your face, and her expression shifts from curiosity to a settled, easy familiarity. She doesn't seem to register your missing horns or ears as a warning—to her, you are just a girl who has had a hard time of it. She quickens her pace, her heavy step sure and rhythmic. Behind her, the younger woman, Brenna, practically beams, her hands resting comfortably on her hips. They stop a few paces away, radiating an unforced, open hospitality that feels almost heavy in the air. Maevis lifts a hand, her gesture broad and welcoming, the silver-capped horn catching the morning light. 'You're a long way from the vein, little one,' she says, her voice a low, melodic rumble, 'and you've got the look of someone who's been walking since the sun was low. Come, you're shaking like a leaf. There's tea and warm bread inside, and a dry seat out of this wind.'";

const TURN_06 = "Maevis reaches you before you even close the distance, her large hand settling firmly and warmly on your shoulder—not in a grab, but with the steady, grounding weight of a parent checking a child. Her grip is warm, the skin slightly rough, and she gives you a squeeze that feels as solid as stone. Brenna steps up on your other side, her expression softening into a bright, almost relieved sympathy. She reaches out to take the sleeve of your cloak, her fingers brushing against your arm, her touch casual and entirely unhesitant. 'Running? Oh, you poor thing,' Brenna says, her voice echoing Maevis's calm cadence. She doesn't ask what you were running from; to them, 'the scar lands' is a sufficient answer, the only answer that matters. Maevis turns you gently, steering you toward the path that leads into the heart of the steading. 'We've got the space, and we've got the warmth,' Maevis says, her amber eyes scanning your face with a concern that feels absolute and unfeigned. 'Don't you worry about the 'why' of it right now. You're inside the line. You're safe. Let's get you sat down and get something hot in you before you fall over.' The air here is cleaner, sharp with the smell of drying hay and the deep, musky scent of animals that aren't monsters, just livestock. Ahead, the low stone buildings of the steading sit tucked against the slope, protected by high, shimmering ward-walls that hum with a low, constant vibration.";

const TURN_08 = "Maevis doesn't let go of your shoulder, her hand remaining a heavy, reassuring weight as she walks. She guides you with a firm, steadying pressure that keeps you moving toward the cluster of stone buildings. You are on the Thornhale Steading grounds, the soil here darker and softer than the hard-packed trail of the Scar. To your left, a low stone wall holds back a garden where pale, hardy greens are already pushing through the soil, and beyond it, the pasture stretches out, dotted with grazing stock. Brenna keeps pace on your other side, her gaze lingering on your face with an open, un-filtered concern that feels like a soft warmth. 'You've reached the Thornhale, little one,' Maevis says, her voice a low, gravelly hum that vibrates in your chest. She doesn't stop walking, steering you past a shed where the smell of woodsmoke and curing leather is sharp and clean. 'You're in the reach of the River towns, but you're a long walk from the nearest mark on any map that counts. Safe, though. That's the part that matters.' She glances at you, her amber eyes crinkling at the corners. 'You look like you've been running on air and bad luck. That stops now. We have a saying: inside the wall, the world waits. You're inside.'";

const TURN_10 = "Maevis doesn't let go of your shoulder, her hand remaining a heavy, reassuring weight as she walks. She steers you with a firm, steadying pressure that keeps you moving toward the cluster of stone buildings. The path is packed with fine, pale dust that clings to your boots. As you walk, the air grows warmer, thick with the smell of churned earth, drying hay, and the sweet, heavy scent of grass. To your left, a low stone wall holds back a garden where pale, hardy greens are already pushing through the soil, and beyond it, the pasture stretches out, dotted with grazing stock—calm animals that look up as you pass, their eyes mild. Brenna keeps pace on your other side, her gaze lingering on your face with an open, un-filtered concern that feels like a soft warmth. She reaches out and brushes a stray lock of hair from your forehead, her touch casual and entirely unhesitant. 'You've reached the Thornhale, little one,' Maevis says, her voice a low, gravelly hum that vibrates in your chest. She doesn't stop walking, steering you past a shed where the smell of woodsmoke and curing leather is sharp and clean. 'You're in the reach of the River towns, but you're a long walk from the nearest mark on any map that counts. Safe, though. That's the part that matters.' She glances at you, her amber eyes crinkling at the corners. 'You look like you've been running on air and bad luck. That stops now. We have a saying: inside the wall, the world waits. You're inside.'";

const TURN_33 = "Brenna watches the matte black fluid ripple over your skin, her eyes wide with a fascination that is entirely devoid of shame or judgment. She reaches out as the armor retracts, her fingers brushing the bare, smooth skin of your shoulder where the collar ends, checking the heat and the texture with the easy familiarity of a midwife. When you explain the shredding and the rotting—the sheer, frustrating waste of good cloth—she doesn't recoil or look away. Instead, she hums a low, thoughtful note, her tail twitching once behind her. She looks at the collar, then back to your face, her expression shifting from curiosity to that signature Hucow practicality. 'Rotting? That's not normal, Codi,' she says, her voice loud and clear in the small room. She doesn't seem to think you're lying; she seems to be cataloging the problem as if it were a spoiled batch of grain. She leans down, peering at the skin beneath your collar where the black metal sits, her touch light and professional. 'If it's biting into you, or if it's eating the weave, that's a resonance mismatch—or a curse. And if it's the armor doing it, well, at least the armor stays. We've got plenty of cloaks, and we've got leather-workers who know how to stitch for a frame like yours. If we can't stop the rot, we'll just have to build you something that doesn't need to be washed, won't we?' She grins, a bright, infectious expression, and claps a heavy hand on your bare arm, her palm warm and rough against your soft skin.";

const TURN_35 = "Brenna nods along with your explanation, her head tilted to the side as she absorbs the technical realities of your armor as if you were describing a difficult weave or a stubborn gate-latch. She doesn't seem to find the idea of 'rot' or 'tearing' scandalous—she finds it inefficient, a problem to be solved with the right tools. She reaches out, her hand resting warmly on the bare curve of your shoulder again, her thumb tracing the edge of the matte black collar with a light, thoughtful pressure. 'If it wants the skin, it's going to have it,' she says, her tone matter-of-fact and devoid of pity. 'But we can work around that. Leather is just hide, and hide can be treated. If we stitch you a set of under-shifts from the thickest cured-goat—the stuff we use for the high-warding work—it'll take more than a day to gnaw through. And it'll keep you from freezing when you're standing in the wind.' She looks down at the nipple rings as you mention them, her gaze dropping to your chest with the same open, clinical interest as if she were checking the status of a herd-beast. She doesn't flush, and she doesn't linger; she simply acknowledges the information. 'Rings are hard to dress for, I expect. But we've got plenty of linen, and we've got hands that know how to handle delicate work. Once you've had your porridge, you and me are going to the workshop. We'll find a way to make you comfortable without you having to live in a state of nature, Codi. Nobody here needs to be cold just because their gear is a bit... spirited.' She smiles, bright and broad, and gives your shoulder one last firm, grounding pat before she turns toward the door, her tail flicking with a content, rhythmic beat.";

const TURN_37 = "Brenna doesn't seem to think the armor's thermal quirk is magic; she listens as if you're explaining a fault in a loom or a quirk in the irrigation pump. Her expression remains bright, entirely unbothered by the fact that you are standing there in the dim, sage-scented room without a stitch of cloth between you and the world. She reaches out, her hand resting warmly on the bare curve of your shoulder again—the contact is steady, grounding, and devoid of any lingering heat beyond the warmth of her own living skin. Her thumb traces the edge of the matte black collar with a light, thoughtful pressure, her eyes fixed on the metal with the clinical, unhurried focus of someone who has spent her life looking at the gear that keeps a herd moving. 'If it wants the skin, it's going to have it,' she says, her tone matter-of-fact, a simple acknowledgment of a fact she's already accepted. She doesn't pity you; she doesn't flinch. She leans down, peering at the skin beneath your collar where the black metal sits, her touch light and professional, as if checking for a harness rub or a poorly fitted cinch. 'But we can work around that. Leather is just hide, and hide can be treated. If we stitch you a set of under-shifts from the thickest cured-goat—the stuff we use for the high-warding work—it'll take more than a day to gnaw through. And it'll keep you from freezing when you're standing in the wind.' She looks down at the rings as you mention them, her gaze dropping to your chest with the same open, unselfconscious interest she would give a fresh birth or a split hoof. She doesn't flush, and she doesn't linger; she simply acknowledges the information like a ledger entry. 'Rings are hard to dress for, I expect. But we've got plenty of linen, and we've got hands that know how to handle delicate work. Once you've had your porridge, you and me are going to the workshop. We'll find a way to make you comfortable without you having to live in a state of nature, Codi. Nobody here needs to be cold just because their gear is a bit... spirited.' She smiles, bright and broad, and gives your shoulder one last firm, grounding pat before she turns toward the door, her tail flicking with a content, rhythmic beat, signaling for you to follow when you're ready.";

describe('detectSelfRepetition', () => {
  it('returns not-repeated for empty / null / short input', () => {
    expect(detectSelfRepetition(undefined, [TURN_08]).repeated).toBe(false);
    expect(detectSelfRepetition(null, [TURN_08]).repeated).toBe(false);
    expect(detectSelfRepetition('', [TURN_08]).repeated).toBe(false);
    expect(detectSelfRepetition('She nods.', [TURN_08]).repeated).toBe(false);
  });

  it('returns not-repeated when there is no history to compare against', () => {
    expect(detectSelfRepetition(TURN_10, []).repeated).toBe(false);
  });

  it('catches the idx-8 → idx-10 duplicate (0.627 overlap, verbatim prefix and suffix)', () => {
    const r = detectSelfRepetition(TURN_10, [TURN_04, TURN_06, TURN_08]);
    expect(r.repeated).toBe(true);
    expect(r.overlap).toBeGreaterThan(0.5);
    expect(r.distance).toBe(1);
    // Both the shingle test and the exact-run tests should fire on this one.
    expect(r.matches.join(' ')).toMatch(/verbatim opening/);
    expect(r.matches.join(' ')).toMatch(/verbatim ending/);
  });

  it('catches the idx-35 → idx-37 duplicate (0.445 overlap, no shared opening)', () => {
    const r = detectSelfRepetition(TURN_37, [TURN_33, TURN_35]);
    expect(r.repeated).toBe(true);
    expect(r.overlap).toBeGreaterThan(0.3);
    expect(r.distance).toBe(1);
  });

  it('does NOT fire on legitimate re-description of the same location (0.078)', () => {
    // idx 10 genuinely re-describes the footpath first described at idx 4.
    // That is continuity, not repetition, and must stay under the threshold.
    const r = detectSelfRepetition(TURN_10, [TURN_04]);
    expect(r.repeated).toBe(false);
    expect(r.overlap).toBeLessThan(0.15);
  });

  it('does not fire on ordinary consecutive turns', () => {
    expect(detectSelfRepetition(TURN_06, [TURN_04]).repeated).toBe(false);
    expect(detectSelfRepetition(TURN_08, [TURN_04, TURN_06]).repeated).toBe(false);
    expect(detectSelfRepetition(TURN_33, [TURN_10]).repeated).toBe(false);
    expect(detectSelfRepetition(TURN_35, [TURN_10, TURN_33]).repeated).toBe(false);
  });

  it('honours the lookback window — only the last 3 model turns are compared', () => {
    // TURN_08 is 4 back in this list, so its duplicate must not be found.
    const r = detectSelfRepetition(TURN_10, [TURN_08, TURN_33, TURN_35, TURN_37]);
    expect(r.repeated).toBe(false);
  });

  it('reports distance correctly for a match further back', () => {
    const r = detectSelfRepetition(TURN_10, [TURN_08, TURN_33, TURN_35]);
    expect(r.repeated).toBe(true);
    expect(r.distance).toBe(3);
  });

  it('respects a caller-supplied threshold', () => {
    expect(detectSelfRepetition(TURN_10, [TURN_04], 0.05).repeated).toBe(true);
    expect(detectSelfRepetition(TURN_10, [TURN_08], 0.99).repeated).toBe(true); // exact-run test still fires
  });
});

describe('buildRepetitionReminder', () => {
  it('quotes the echoed fragment so the resample prompt differs from the original', () => {
    const r = detectSelfRepetition(TURN_10, [TURN_08]);
    const reminder = buildRepetitionReminder(r);
    expect(reminder).toContain('THIS BEAT MUST ADVANCE');
    expect(reminder.length).toBeGreaterThan(200);
    // The reminder must carry actual echoed text, not a placeholder.
    expect(r.echoedFragment.length).toBeGreaterThan(50);
    expect(reminder).toContain(r.echoedFragment.slice(0, 50));
  });
});
