import React from 'react';
import type { BodyProfile, BodyState } from '../../types';
import { stretchLabel, vaginalVirginity, analVirginity } from '../../utils/engine/bodyModel';

/**
 * v1.48: structured body facts. Every field is optional; an empty field falls
 * back to whatever the engine can read out of the prose sheet, shown here as
 * the placeholder so the player can see what it is already using.
 */
interface BodyEditorProps {
    value: BodyProfile | undefined;
    onChange: (next: BodyProfile | undefined) => void;
    /** What the engine reads from the prose sheet when a field is empty. */
    parsed?: BodyProfile;
    /** Contradictions found in the prose sheet. */
    conflicts?: string[];
    compact?: boolean;
}

const label = 'text-[8px] font-bold text-gray-500 uppercase tracking-widest block mb-1';
const input = 'w-full bg-black border border-gray-800 focus:border-red-900/60 text-gray-200 text-xs px-2 py-1.5 focus:outline-none';

const num = (v: string): number | undefined => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
};

const clean = (p: BodyProfile): BodyProfile | undefined => {
    const out: BodyProfile = {};
    for (const [k, v] of Object.entries(p) as [keyof BodyProfile, unknown][]) {
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && !v.trim()) continue;
        (out as Record<string, unknown>)[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
};

const fmtHeight = (inches?: number) => inches === undefined ? '' : `${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;

export const BodyEditor: React.FC<BodyEditorProps> = ({ value, onChange, parsed, conflicts = [], compact }) => {
    const v = value ?? {};
    const set = (patch: Partial<BodyProfile>) => onChange(clean({ ...v, ...patch }));
    const ph = (k: keyof BodyProfile, fallback = '') => {
        const p = parsed?.[k];
        if (p === undefined || p === null || p === '') return fallback;
        if (k === 'heightIn') return `${p} (${fmtHeight(p as number)}) from sheet`;
        return `${String(p).slice(0, 60)} (from sheet)`;
    };
    const ft = v.heightIn !== undefined ? Math.floor(v.heightIn / 12) : '';
    const inch = v.heightIn !== undefined ? Math.round(v.heightIn % 12) : '';
    const triState = (b: boolean | undefined) => (b === true ? 'yes' : b === false ? 'no' : '');
    const fromTri = (s: string): boolean | undefined => (s === 'yes' ? true : s === 'no' ? false : undefined);

    const fillFromSheet = () => {
        if (!parsed) return;
        const merged: BodyProfile = { ...parsed, ...clean(v) };
        onChange(clean(merged));
    };

    return (
        <div className="space-y-3">
            {conflicts.length > 0 && (
                <div className="text-[9px] text-yellow-500 font-mono border border-yellow-900/40 bg-yellow-950/10 p-2">
                    {conflicts.map((c, i) => <div key={i}>⚠ The prose sheet gives {c}. Set the field below to settle it.</div>)}
                </div>
            )}
            <div className={`grid gap-2 ${compact ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-4'}`}>
                <div>
                    <label className={label}>Height ft / in</label>
                    <div className="flex gap-1">
                        <input className={input} type="number" min={0} value={ft} placeholder={parsed?.heightIn !== undefined ? String(Math.floor(parsed.heightIn / 12)) : 'ft'}
                            onChange={e => {
                                const f = num(e.target.value);
                                set({ heightIn: f === undefined ? undefined : f * 12 + (typeof inch === 'number' ? inch : 0) });
                            }} />
                        <input className={input} type="number" min={0} max={11} value={inch} placeholder={parsed?.heightIn !== undefined ? String(Math.round(parsed.heightIn % 12)) : 'in'}
                            onChange={e => {
                                const i = parseFloat(e.target.value);
                                const f = typeof ft === 'number' ? ft : 0;
                                set({ heightIn: Number.isFinite(i) ? f * 12 + i : (f ? f * 12 : undefined) });
                            }} />
                    </div>
                </div>
                <div>
                    <label className={label}>Weight (lb)</label>
                    <input className={input} type="number" min={0} value={v.weightLb ?? ''} placeholder={ph('weightLb')} onChange={e => set({ weightLb: num(e.target.value) })} />
                </div>
                <div className={compact ? 'col-span-2' : 'col-span-2'}>
                    <label className={label}>Build</label>
                    <input className={input} value={v.build ?? ''} placeholder={ph('build', 'lean, heavyset…')} onChange={e => set({ build: e.target.value })} />
                </div>
                <div>
                    <label className={label}>Penis length (in)</label>
                    <input className={input} type="number" min={0} step={0.5} value={v.penisLengthIn ?? ''} placeholder={ph('penisLengthIn')} onChange={e => set({ penisLengthIn: num(e.target.value) })} />
                </div>
                <div>
                    <label className={label}>Penis girth — around (in)</label>
                    <input className={input} type="number" min={0} step={0.5} value={v.penisGirthIn ?? ''} placeholder={ph('penisGirthIn')} onChange={e => set({ penisGirthIn: num(e.target.value) })} />
                </div>
                <div>
                    <label className={label}>Vaginal depth to cervix (in)</label>
                    <input className={input} type="number" min={0} step={0.5} value={v.vaginalDepthIn ?? ''} placeholder={ph('vaginalDepthIn')} onChange={e => set({ vaginalDepthIn: num(e.target.value) })} />
                </div>
                <div>
                    <label className={label}>Breasts</label>
                    <input className={input} value={v.breasts ?? ''} placeholder={ph('breasts', '32D, flat…')} onChange={e => set({ breasts: e.target.value })} />
                </div>
                <div>
                    <label className={label}>Vaginal tightness</label>
                    <input className={input} value={v.vaginalTightness ?? ''} placeholder="virgin-tight, average…" onChange={e => set({ vaginalTightness: e.target.value })} />
                </div>
                <div>
                    <label className={label}>Anal tightness</label>
                    <input className={input} value={v.analTightness ?? ''} placeholder="tight, average…" onChange={e => set({ analTightness: e.target.value })} />
                </div>
                <div>
                    <label className={label}>Vaginal virgin (start)</label>
                    <select className={input} value={triState(v.vaginalVirgin)} onChange={e => set({ vaginalVirgin: fromTri(e.target.value) })}>
                        <option value="">{parsed?.vaginalVirgin !== undefined ? `— (sheet: ${parsed.vaginalVirgin ? 'yes' : 'no'})` : '— not set'}</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                    </select>
                </div>
                <div>
                    <label className={label}>Anal virgin (start)</label>
                    <select className={input} value={triState(v.analVirgin)} onChange={e => set({ analVirgin: fromTri(e.target.value) })}>
                        <option value="">{parsed?.analVirgin !== undefined ? `— (sheet: ${parsed.analVirgin ? 'yes' : 'no'})` : '— not set'}</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                    </select>
                </div>
            </div>
            <div>
                <label className={label}>Genitals (your words — sent verbatim)</label>
                <textarea className={input} rows={compact ? 2 : 3} value={v.genitals ?? ''} placeholder={parsed?.genitals ? `${parsed.genitals.slice(0, 140)}… (from sheet)` : ''} onChange={e => set({ genitals: e.target.value })} />
            </div>
            <div>
                <label className={label}>Other physical notes</label>
                <textarea className={input} rows={2} value={v.notes ?? ''} onChange={e => set({ notes: e.target.value })} />
            </div>
            {parsed && (
                <button type="button" onClick={fillFromSheet} className="text-[8px] font-bold uppercase tracking-widest px-3 py-1.5 border border-gray-800 text-gray-500 hover:text-gray-200 hover:border-gray-600">
                    Fill empty fields from sheet
                </button>
            )}
        </div>
    );
};

/** Read-only view of what has happened to a body. */
export const BodyStateView: React.FC<{ profile: BodyProfile; state?: BodyState; onReset?: () => void }> = ({ profile, state, onReset }) => {
    const v = vaginalVirginity(profile, state);
    const a = analVirginity(profile, state);
    const rows: string[] = [
        `Vaginal virginity: ${v}${state?.vaginalVirginityLost ? ` — taken by ${state.vaginalVirginityLost.by}, turn ${state.vaginalVirginityLost.turn}` : ''}`,
        `Anal virginity: ${a}${state?.analVirginityLost ? ` — taken by ${state.analVirginityLost.by}, turn ${state.analVirginityLost.turn}` : ''}`,
    ];
    if (state?.vaginalStretch) rows.push(`Vagina: ${stretchLabel(state.vaginalStretch)}`);
    if (state?.analStretch) rows.push(`Anus: ${stretchLabel(state.analStretch)}`);
    for (const i of state?.injuries ?? []) rows.push(`${i.severity} injury — ${i.site}: ${i.description}`);
    for (const f of state?.fluids ?? []) rows.push(`${f.what} in ${f.where}`);
    if (state?.orgasmCount) rows.push(`Orgasms: ${state.orgasmCount}`);
    return (
        <div className="space-y-1">
            {rows.map((r, i) => <div key={i} className="text-[9px] text-gray-400 font-mono">{r}</div>)}
            {onReset && state && (
                <button type="button" onClick={onReset} className="mt-1 text-[8px] uppercase tracking-widest text-gray-600 hover:text-red-400 underline underline-offset-2">
                    Reset tracked body state
                </button>
            )}
        </div>
    );
};
