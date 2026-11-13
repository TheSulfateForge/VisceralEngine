// v1.59: view, edit and delete an NPC's register. A wrong entry written by the
// register pass becomes canon until removed — this is where it gets removed.
import React, { useState } from 'react';
import type { KnownEntity, NpcRegister } from '../../types';

type Section = 'knowledge' | 'state' | 'promises' | 'feelings' | 'acts' | 'wants' | 'kinksShown' | 'developments';

interface Row { section: Section; index: number; label: string; text: string; editable: boolean }

const rowsFor = (r: NpcRegister): Array<{ title: string; rows: Row[] }> => [
    { title: 'Current state', rows: r.state.map((s, index) => ({ section: 'state' as const, index, label: s.key.replace(/_/g, ' '), text: s.value, editable: true })) },
    { title: 'Knows', rows: r.knowledge.map((k, index) => ({ section: 'knowledge' as const, index, label: k.source === 'told' ? `told${k.from ? ` by ${k.from}` : ''}` : k.source, text: k.text, editable: true })) },
    { title: 'Promises', rows: r.promises.map((p, index) => ({ section: 'promises' as const, index, label: `${p.by === 'player' ? 'you → them' : 'them → you'} · ${p.status}`, text: p.text, editable: true })) },
    { title: 'Feelings', rows: r.feelings.map((f, index) => ({ section: 'feelings' as const, index, label: `toward ${f.toward}`, text: f.text, editable: true })) },
    { title: 'Intimacy — acts', rows: r.intimacy.acts.map((a, index) => ({ section: 'acts' as const, index, label: `×${a.count} · first t${r.intimacy.firsts.find(f => f.act === a.act)?.turn ?? a.lastTurn}`, text: a.act, editable: false })) },
    { title: 'Intimacy — stated terms', rows: r.intimacy.wants.map((w, index) => ({ section: 'wants' as const, index, label: w.kind === 'not_yet' ? 'not yet' : w.kind, text: w.text, editable: true })) },
    { title: 'Kinks shown so far', rows: r.intimacy.kinksShown.map((k, index) => ({ section: 'kinksShown' as const, index, label: `t${k.turn}`, text: k.text, editable: false })) },
    { title: 'Has changed', rows: r.developments.map((d, index) => ({ section: 'developments' as const, index, label: d.turns.length ? `t${d.turns.join(', t')}` : `t${d.turn}`, text: d.text, editable: true })) },
];

const withoutRow = (r: NpcRegister, section: Section, index: number): NpcRegister => {
    const drop = <T,>(xs: T[]) => xs.filter((_, i) => i !== index);
    switch (section) {
        case 'knowledge': return { ...r, knowledge: drop(r.knowledge) };
        case 'state': return { ...r, state: drop(r.state) };
        case 'promises': return { ...r, promises: drop(r.promises) };
        case 'feelings': return { ...r, feelings: drop(r.feelings) };
        case 'developments': return { ...r, developments: drop(r.developments) };
        case 'wants': return { ...r, intimacy: { ...r.intimacy, wants: drop(r.intimacy.wants) } };
        case 'kinksShown': return { ...r, intimacy: { ...r.intimacy, kinksShown: drop(r.intimacy.kinksShown) } };
        case 'acts': {
            const act = r.intimacy.acts[index]?.act;
            return { ...r, intimacy: { ...r.intimacy, acts: drop(r.intimacy.acts), firsts: r.intimacy.firsts.filter(f => f.act !== act) } };
        }
    }
};

const withText = (r: NpcRegister, section: Section, index: number, text: string): NpcRegister => {
    const set = <T extends object>(xs: T[], key: keyof T) => xs.map((x, i) => (i === index ? { ...x, [key]: text } : x));
    switch (section) {
        case 'knowledge': return { ...r, knowledge: set(r.knowledge, 'text') };
        case 'state': return { ...r, state: set(r.state, 'value') };
        case 'promises': return { ...r, promises: set(r.promises, 'text') };
        case 'feelings': return { ...r, feelings: set(r.feelings, 'text') };
        case 'developments': return { ...r, developments: set(r.developments, 'text') };
        case 'wants': return { ...r, intimacy: { ...r.intimacy, wants: set(r.intimacy.wants, 'text') } };
        default: return r;
    }
};

export const NpcRegisterPanel: React.FC<{ entity: KnownEntity; onChange: (register: NpcRegister) => void }> = ({ entity, onChange }) => {
    const [editing, setEditing] = useState<string | null>(null);
    const [draft, setDraft] = useState('');
    const reg = entity.register;
    if (!reg) return null;
    const groups = rowsFor(reg).filter(g => g.rows.length > 0);
    if (groups.length === 0) return <p className="text-[8px] text-gray-500 italic">Register open since turn {reg.createdTurn} — nothing recorded yet.</p>;

    return (
        <div className="space-y-2">
            {groups.map(g => (
                <div key={g.title}>
                    <p className="text-[7px] font-bold text-gray-500 uppercase tracking-widest mb-1">{g.title}</p>
                    <ul className="space-y-1">
                        {g.rows.map(row => {
                            const id = `${row.section}:${row.index}`;
                            return (
                                <li key={id} className="text-[8px] text-gray-400 leading-tight border-l border-gray-700 pl-1.5 flex gap-1 items-start">
                                    <span className="text-gray-600 shrink-0">[{row.label}]</span>
                                    {editing === id ? (
                                        <input
                                            className="flex-1 bg-black border border-gray-700 text-gray-200 text-[8px] px-1"
                                            value={draft}
                                            autoFocus
                                            onChange={e => setDraft(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && draft.trim()) { onChange(withText(reg, row.section, row.index, draft.trim())); setEditing(null); }
                                                if (e.key === 'Escape') setEditing(null);
                                            }}
                                            onBlur={() => setEditing(null)}
                                        />
                                    ) : (
                                        <span className="flex-1">{row.text}</span>
                                    )}
                                    {row.editable && editing !== id && (
                                        <button className="text-gray-600 hover:text-gray-300" title="Edit" onClick={() => { setEditing(id); setDraft(row.text); }}>✎</button>
                                    )}
                                    <button className="text-gray-600 hover:text-red-400" title="Delete" onClick={() => onChange(withoutRow(reg, row.section, row.index))}>✕</button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
};

/** Sidebar section: every NPC with a register, whatever their status. */
export const NpcRegisterList: React.FC<{ entities: KnownEntity[]; onChange: (id: string, register: NpcRegister) => void }> = ({ entities, onChange }) => {
    const [open, setOpen] = useState<string | null>(null);
    const withRegister = entities.filter(e => e.register);
    if (withRegister.length === 0) return null;
    return (
        <div className="space-y-2 pt-2 border-t border-gray-900">
            <span className="text-[9px] font-bold text-blue-900/70 uppercase tracking-widest">NPC Registers</span>
            <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                {withRegister.map(e => (
                    <div key={e.id} className="bg-gray-900/30 border border-gray-800 rounded-sm">
                        <div className="px-2.5 py-1.5 cursor-pointer flex justify-between items-center" onClick={() => setOpen(p => (p === e.id ? null : e.id))}>
                            <span className="text-[9px] font-bold text-gray-300">{e.name}</span>
                            <span className="text-[7px] text-gray-500">{e.register!.knowledge.length} known · updated t{e.register!.updatedTurn}</span>
                        </div>
                        {open === e.id && (
                            <div className="px-2.5 pb-2.5 pt-1 border-t border-gray-800 bg-black/20">
                                <NpcRegisterPanel entity={e} onChange={reg => onChange(e.id, reg)} />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export const _registerPanelInternals = { rowsFor, withoutRow, withText }; // tests
