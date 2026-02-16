# Visceral Realism Engine

### *An Uncompromising Sandbox Simulation*

**Grounded Realism · Mature Themes · Biological Consequences**

[![Live Demo](https://img.shields.io/badge/Play_Now-Live_Demo-critical?style=for-the-badge)](https://thesulfateforge.github.io/VisceralEngine/)
[![PWA](https://img.shields.io/badge/PWA-Installable-blue?style=for-the-badge)](https://thesulfateforge.github.io/VisceralEngine/)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

## What is VRE?

**Visceral Realism Engine** is an AI-powered sandbox simulation that acts as an uncompromising game master. Every action carries weight, every decision has consequences, and the world responds with brutal honesty. Powered by Google's Gemini AI, VRE delivers dynamic, contextually aware storytelling that remembers your entire journey and adapts to your choices in real time.

Unlike traditional RPG systems that abstract away the messy reality of existence, VRE models the full spectrum of human experience — from the mundane grind of hunger and fatigue to the psychological aftermath of violence and survival. Death is permanent, scars are real, and the world doesn't wait for you to be ready.

---

## Setting Agnostic Design

VRE is not locked to any genre, world, or time period. The engine adapts to whatever fiction you bring to it. Play a scarred mercenary navigating a medieval civil war, a deep-space salvage operator on a derelict station, a noir detective in 1940s Los Angeles, or anything else you can describe. The simulation systems — biology, trauma, relationships, time — work the same regardless of setting. During character creation you define your own setting, and the AI builds a living world around it.

---

## Core Systems

### AI Game Master

At the heart of VRE is a Gemini-powered narrative engine that functions as a physics and psychology simulator rather than a traditional game master. It controls all NPCs, the environment, and the consequences of your actions. The AI maintains contextual awareness across your entire session, tracking everything from NPC grudges to the contents of your pockets. Multiple Gemini models are supported, with automatic fallback if one is unavailable.

### Dice Rolling

VRE uses a d20-based roll system that only triggers when the outcome is genuinely uncertain and failure carries meaningful consequences. Routine actions like walking, eating, resting, or looking around never require rolls. When a roll is called for, the system presents the challenge, any applicable modifiers, and whether advantage or disadvantage applies. After you roll, the AI narrates the consequences and moves forward — no sequential roll chains. A full roll statistics tracker records your history of critical successes, critical failures, average rolls, and outcome distribution across your entire campaign.

### The Devil's Bargain

When a roll is exceptionally dangerous — the kind where failure means death or permanent loss — the engine may offer a Devil's Bargain alongside the dice. This is a guaranteed success with a known, specific cost. You choose: roll the dice and risk everything, or accept the bargain and pay the price.

Bargains are rare by design, appearing only once or twice per major story arc during dramatically significant moments. The costs are always specific and permanent — a fractured shield arm that takes weeks to heal, a guard who remembers your face and reports you, a debt that will come due at the worst possible time. They are never vague, never trivial, and never inevitable. The UI presents bargains as a distinct interactive card where you can accept the sacrifice or reject it and take your chances.

### Time Keeping (CHRONOS)

VRE tracks time continuously down to the minute. Every action advances the clock contextually: routine tasks take 15–45 minutes, crossing a city district takes 30 minutes, a full night's sleep advances 7–8 hours. The system enforces strict double-count prevention so waking up after a sleep scene doesn't burn another night. Time caps prevent the AI from accidentally skipping unreasonable amounts — combat is capped at 30-minute jumps, normal activity at 2 hours, and sleep at 9 hours. The current day, hour, and minute are always tracked and displayed.

### Biological Simulation

The engine models your character's biological state in real time. Calories, hydration, and stamina all deplete naturally as time passes, with rates influenced by activity level and scene tension. Consumption is tracked automatically — the AI detects when you eat or drink in the narrative and updates your biological state accordingly. When values drop below critical thresholds, conditions like "Hungry," "Severe Dehydration," or "Exhausted" are applied automatically, and prolonged deprivation accumulates psychological trauma. Biological modifiers allow the system to adjust burn rates contextually — stimulants, racial traits, cybernetic augmentations, or supernatural conditions can all speed up or slow down biological needs. Setting a modifier to zero disables a need entirely, useful for characters like androids that don't require food.

### Psychological Trauma

Trauma is tracked on a 0–100 scale representing psychological destabilization. Horrific violence, near-death experiences, personal violations, and loss of loved ones increase it. Rest, comfort, and meaningful human connection reduce it. The character sheet displays your current psychological integrity with descriptive indicators ranging from "Stable" through "Shaken" and "Unstable" all the way to full destabilization, where hallucinations and breakdown become possible. Trauma is not just a number — it influences how the AI describes your character's mental state and can affect narrative outcomes.

### People and Relationship Tracking

Every named NPC is a fully autonomous agent with their own goals, methods, and moral flexibility. They act with or without your involvement — the world moves even when you aren't looking. NPCs hold grudges, remember kindness, gossip about you to other NPCs, and form opinions they voice unprompted. They lie, manipulate, scheme, and occasionally sacrifice for you depending on their relationship level.

Relationships are tracked on a seven-tier ladder: Nemesis, Hostile, Cold, Neutral, Warm, Allied, and Devoted. Each NPC has a persistent ledger of every significant interaction with you. When an NPC speaks, the system checks their ledger and references relevant history. NPCs also have relationships with each other that you may not know about, and these affect how they behave around you. A devoted NPC may become possessive or jealous. An allied NPC may call in favors. A hostile NPC may set traps or spread rumors.

The system tracks NPC dialogue with psychological depth: what they say, what they actually mean (subtext), and biological tells like dilated pupils, voice cracks, or visible sweating that betray their true state.

### Combat AI

Combat does not use health bars. Instead, enemies have a "Will to Violence" determined by archetype. Amateurs like street thugs break after significant pain or shock. Professionals like soldiers break only when the situation is tactically hopeless. Fanatics like cultists never break and become more dangerous when wounded. The AI follows an OODA (Observe-Orient-Decide-Act) loop for enemy tactics, adjusting behavior based on conditions — darkness causes enemies to spray blindly, hard cover triggers suppression, and a wounded player provokes flanking from professionals but hesitation from amateurs.

### Image Generation

VRE generates cinematic scene visualizations using Gemini's image generation capabilities. You can generate character portraits during creation, and scene images during gameplay that reflect your current narrative context. All generated images are stored locally in an indexed gallery with a carousel viewer. The visual style defaults to gritty, high-contrast cinematography with 35mm film grain and dark atmosphere to match the engine's tone.

### Character Creation with AI Assistance

Character creation supports two modes. In manual mode, you fill in every field yourself — name, gender, race, appearance, notable features, backstory, setting, inventory, relationships, conditions, and goals. In neural synthesis mode, you provide a concept in plain language (anything from "grizzled WW2 medic" to "disgraced elven diplomat") and the AI generates a complete, detailed character with a specific backstory, cinematically detailed appearance, realistic inventory, and relationships designed to create dramatic tension.

Both modes can be mixed. You can generate a full character with AI and then manually edit any field, or fill in most fields yourself and use the per-field AI assist button to generate just the ones you're stuck on. Completed characters can be saved as reusable templates and loaded into future sessions. During creation you can also generate a visual portrait of your character and have the AI produce three tailored starting scenarios — a mundane hook, a violent hook, and a mature/social hook — based on your character's specifics.

### Lore and Memory System

The engine maintains two persistent knowledge stores. **Memory Fragments** record major life events — kills, intimacies, achievements, betrayals, and permanent changes — as permanent facts that persist across the entire campaign. **World Lore** captures discovered information about the setting, creatures, factions, and locations, organized by keyword for retrieval. A RAG (Retrieval Augmented Generation) system ensures that only contextually relevant memories and lore are injected into each prompt, keeping the AI focused without losing track of important history.

### Scene Modes

The simulation operates in four distinct modes that govern pacing and AI behavior. **Narrative** mode handles exploration, introspection, and mundane activity. **Social** mode activates during active conversations, with deep focus on dialogue subtext and NPC tells. **Tension** mode signals imminent danger without active violence. **Combat** mode engages full tactical simulation. The AI enforces pacing discipline — after high-stakes scenes, 2–3 mundane scenes are required before the next threat, and downtime is never interrupted by random attacks.

---

## Save System

VRE provides multiple layers of persistence. **Auto-save** fires on a debounced timer after meaningful state changes, ensuring you never lose progress to a crash. **Manual checkpoints** let you save named snapshots to IndexedDB at any point. **Export/Import** lets you download your entire game state as a portable JSON file and reload it later or on a different device. Save files include the full game history, world state, character data, and a thumbnail of your last generated image.

---

## Privacy and Data

VRE is local-first. Your API key is stored in your browser's local storage and is never transmitted to any server except Google's AI services. All game data — saves, generated images, character templates — lives in IndexedDB on your device. There is no server-side tracking, no analytics, no data collection, and no accounts. You own your data entirely.

---

## Getting Started

### Play Online

Visit **[thesulfateforge.github.io/VisceralEngine](https://thesulfateforge.github.io/VisceralEngine/)** and start playing. The app can be installed as a Progressive Web App on desktop and mobile for a native app experience.

### Required: Google AI Studio API Key

VRE requires a free Google AI Studio API key to function.

1. Visit [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Create an API key (takes 30 seconds)
4. Paste it into VRE when prompted

Your API key is stored locally on your device only. It never leaves your browser except when making requests to Google's AI services.

### Run Locally (For Developers)

**Prerequisites:** Node.js 18+ and npm

```bash
# Clone the repository
git clone https://github.com/TheSulfateForge/VisceralEngine.git
cd VisceralEngine

# Install dependencies
npm install

# Run development server
npm run dev
```

The app will be available at `http://localhost:3000`.

**Build for production:**
```bash
npm run build
npm run preview
```

---

## Tech Stack

VRE is built with React 19 and TypeScript, bundled with Vite 7, and styled with Tailwind CSS. State management is handled by Zustand. Local persistence uses IndexedDB. The PWA layer is powered by VitePWA with Workbox for service worker caching. AI services are provided by the Google Gemini API via the `@google/genai` SDK. Deployment is automated to GitHub Pages via GitHub Actions.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` | Save checkpoint |
| `Ctrl+L` | Load checkpoint |
| `Ctrl+E` | Export game state |
| `Ctrl+R` | Generate scene visual |
| `Ctrl+Z` | Undo last action |
| `Ctrl+/` | Toggle debug console |
| `Escape` | Close modals |

---

## Content Warning

VRE simulates mature themes including violence, injury, psychological trauma, survival scenarios, and explicit content. It is intended for adult audiences. The AI operates without content filters to deliver an unrestricted narrative experience.

---

## Contributing

Contributions are welcome. This project is in active development. Please open an issue first to discuss major changes.

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

Built with [Google AI Studio](https://ai.studio/) and powered by [Gemini AI](https://deepmind.google/technologies/gemini/).

---

**[Play Now](https://thesulfateforge.github.io/VisceralEngine/)** · **[Report Bug](https://github.com/TheSulfateForge/VisceralEngine/issues)** · **[Request Feature](https://github.com/TheSulfateForge/VisceralEngine/discussions)**