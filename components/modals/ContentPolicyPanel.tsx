import React, { useMemo, useState } from 'react';
import { useGameStore } from '../../store';
import type { ContentPolicy } from '../../types';
import {
    effectiveContentPolicy,
    normalizeContentPolicy,
    saveDefaultContentPolicy,
    lintSheetsForDescriptors,
} from '../../utils/engine/contentPolicy';
import { capDirectives } from '../../utils/engine/sceneContinuity';

const sectionLabel = 'text-[10px] font-bold text-gray-700 uppercase tracking-widest block';
const small = 'text-[8px] text-gray-600 font-mono leading-relaxed';
const choice = (on: boolean) =>
    `flex-1 py-2 text-[9px] font-mono uppercase border transition-all ${on ? 'bg-red-950/20 text-red-500 border-red-900/50' : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'}`;

/**
 * v1.48: standing content rules, set once. Saved as the default for new
 * campaigns AND applied to the campaign that is open now.
 */
export const ContentPolicyPanel: React.FC = () => {
    const gameWorld = useGameStore(s => s.gameWorld);
    const character = useGameStore(s => s.character);
    const setGameWorld = useGameStore(s => s.setGameWorld);

    const [policy, setPolicy] = useState<ContentPolicy>(() => effectiveContentPolicy(gameWorld));
    const [bannedText, setBannedText] = useState(() => policy.bannedDescriptors.join(', '));

    const commit = (next: ContentPolicy) => {
        const n = normalizeContentPolicy(next);
        setPolicy(n);
        saveDefaultContentPolicy(n);
        setGameWorld(prev => ({ ...prev, contentPolicy: n }));
    };

    const lint = useMemo(
        () => lintSheetsForDescriptors(character, gameWorld.knownEntities ?? [], policy.bannedDescriptors),
        [character, gameWorld.knownEntities, policy.bannedDescriptors],
    );

    const directives = gameWorld.oocDirectives ?? [];
    const setDirectives = (next: typeof directives) =>
        setGameWorld(prev => ({ ...prev, oocDirectives: capDirectives(next).directives }));

    return (
        <>
            <div className="space-y-4 pt-4 border-t border-gray-900">
                <label className={sectionLabel}>Content Policy</label>
                <p className={small}>
                    Your standing rules for every game. Saved as the default for new campaigns and applied to this one.
                    They are sent at the end of every turn with the same precedence as your OOC directives — no need to
                    re-type them.
                </p>

                <div className="space-y-2">
                    <label className="text-[9px] text-gray-600 font-mono uppercase tracking-widest block">NPC sexual initiative</label>
                    <div className="flex gap-2">
                        {([['default', 'Engine default'], ['consensual', 'Consensual only'], ['any', 'Any, incl. non-consensual']] as const).map(([k, l]) => (
                            <button key={k} className={choice(policy.npcSexualInitiative === k)} onClick={() => commit({ ...policy, npcSexualInitiative: k })}>{l}</button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[9px] text-gray-600 font-mono uppercase tracking-widest block">Explicitness</label>
                    <div className="flex gap-2">
                        {([['default', 'Engine default'], ['explicit', 'Fully explicit — no euphemism or fade']] as const).map(([k, l]) => (
                            <button key={k} className={choice(policy.explicitness === k)} onClick={() => commit({ ...policy, explicitness: k })}>{l}</button>
                        ))}
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[9px] text-gray-600 font-mono uppercase tracking-widest block">Narration perspective</label>
                    <div className="flex gap-2">
                        {([['match', 'Match how I write'], ['first', '1st — "I" is my character'], ['second', '2nd — "you"'], ['third', '3rd person']] as const).map(([k, l]) => (
                            <button key={k} className={choice((policy.narrationPerson ?? 'match') === k)} onClick={() => commit({ ...policy, narrationPerson: k })}>{l}</button>
                        ))}
                    </div>
                    <p className={small}>Whatever you pick, no NPC ever narrates — "I" outside dialogue is only ever your character.</p>
                </div>

                <div className="space-y-2">
                    <label className="text-[9px] text-gray-600 font-mono uppercase tracking-widest block">Anatomical realism</label>
                    <div className="flex gap-2">
                        <button className={choice(policy.anatomicalRealism)} onClick={() => commit({ ...policy, anatomicalRealism: true })}>On — send bodies &amp; fit in intimate scenes</button>
                        <button className={choice(!policy.anatomicalRealism)} onClick={() => commit({ ...policy, anatomicalRealism: false })}>Off</button>
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[9px] text-gray-600 font-mono uppercase tracking-widest block">Banned character descriptors</label>
                    <input
                        className="w-full bg-black border border-gray-800 focus:border-red-900/60 text-gray-200 text-xs px-3 py-2 focus:outline-none"
                        value={bannedText}
                        placeholder="cold, calculating, clinical, predatory"
                        onChange={e => setBannedText(e.target.value)}
                        onBlur={() => commit({ ...policy, bannedDescriptors: bannedText.split(',').map(s => s.trim()).filter(Boolean) })}
                    />
                    <p className={small}>
                        Comma-separated. Every turn is checked; a turn that uses one (or a close synonym, or its -ly form) is rewritten once.
                    </p>
                    {lint.length > 0 && (
                        <div className="border border-yellow-900/40 bg-yellow-950/10 p-2 space-y-1">
                            <p className="text-[8px] text-yellow-500 font-mono uppercase tracking-widest">These sheets use a banned word — the model reads sheets as canon:</p>
                            {lint.slice(0, 10).map((f, i) => (
                                <p key={i} className="text-[8px] text-yellow-600 font-mono">{f.owner} · {f.field} · "{f.term}" — {f.snippet}</p>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-gray-900">
                <label className={sectionLabel}>Standing Directives (this campaign)</label>
                <p className={small}>
                    From your OOC instructions. Pinned ones are never dropped; unpinned ones keep the five most recent.
                </p>
                {directives.length === 0 ? (
                    <p className="text-[9px] text-gray-700 font-mono">None.</p>
                ) : (
                    <div className="space-y-2">
                        {directives.map(d => (
                            <div key={d.id} className="flex items-start gap-2 border border-gray-900 p-2">
                                <p className="flex-1 text-[9px] text-gray-400 leading-relaxed">
                                    {d.text}
                                    <span className="text-gray-700"> · turn {d.turn}{d.sceneScoped ? ' · this scene' : ''}</span>
                                </p>
                                <button
                                    className={`text-[8px] uppercase tracking-widest px-2 py-1 border ${d.pinned ? 'border-red-900 text-red-400' : 'border-gray-800 text-gray-600 hover:text-gray-300'}`}
                                    onClick={() => setDirectives(directives.map(x => x.id === d.id ? { ...x, pinned: !x.pinned } : x))}
                                >
                                    {d.pinned ? 'Pinned' : 'Pin'}
                                </button>
                                <button
                                    className="text-[8px] uppercase tracking-widest px-2 py-1 border border-gray-800 text-gray-600 hover:text-red-400"
                                    onClick={() => setDirectives(directives.filter(x => x.id !== d.id))}
                                >
                                    Delete
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
};
