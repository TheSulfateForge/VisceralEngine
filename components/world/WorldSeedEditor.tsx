import React, { useEffect, useMemo, useState } from 'react';
import type {
  WorldSeed,
  WorldSeedFaction,
  WorldSeedLocation,
  WorldSeedLore,
  WorldSeedNPC,
  WorldSeedRule,
} from '../../types';

/**
 * Fine-grained editor for a saved WorldSeed.
 *
 * Lets the operator inspect everything the RAG decomposer parsed out of a
 * world description and surgically add / edit / remove individual rows on
 * each entity type, plus the free-form tag list. The editor is local-state
 * only — it pushes a fully-formed seed payload back through `onSave` so
 * `useWorldSeeds.saveWorldSeed` can persist the whole record at once.
 */

type Tab = 'overview' | 'locations' | 'factions' | 'npcs' | 'lore' | 'rules' | 'tags';

interface WorldSeedEditorProps {
  show: boolean;
  seed: WorldSeed | undefined;
  onClose: () => void;
  onSave: (
    seed: Omit<WorldSeed, 'id' | 'timestamp' | 'lastModified'> & { id: WorldSeed['id'] }
  ) => Promise<void>;
}

// ---------- Styling helpers (kept inline to match the rest of the app) ----------

const tabBtn = (active: boolean) =>
  `px-3 py-2 text-[10px] font-bold uppercase tracking-widest transition-all rounded ${
    active
      ? 'bg-red-900 text-white'
      : 'bg-gray-900/40 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600'
  }`;

const fieldLabel = 'text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1';
const inputCls =
  'w-full bg-black border border-gray-800 text-white px-3 py-2 text-xs focus:border-red-900 focus:outline-none rounded';
const textareaCls =
  'w-full bg-black border border-gray-800 text-white px-3 py-2 text-xs focus:border-red-900 focus:outline-none rounded resize-y';
const sectionCard = 'border border-gray-800 bg-gray-900/30 rounded p-4 space-y-3';
const ghostBtn =
  'px-3 py-1 text-[9px] font-bold uppercase tracking-widest border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-all rounded';
const dangerBtn =
  'px-3 py-1 text-[9px] font-bold uppercase tracking-widest border border-red-900/40 text-red-400 hover:bg-red-900 hover:text-white transition-all rounded';
const primaryBtn =
  'px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-red-900 text-white hover:bg-red-800 transition-all rounded';

// ---------- Empty record factories ----------

const emptyLocation = (): WorldSeedLocation => ({
  name: '',
  description: '',
  tags: [],
  connections: [],
  controllingFaction: '',
});

const emptyFaction = (): WorldSeedFaction => ({
  name: '',
  description: '',
  territory: [],
  influence: 50,
  resources: [],
  dispositions: {},
  leader: '',
  keyMembers: [],
});

const emptyNPC = (): WorldSeedNPC => ({
  name: '',
  role: '',
  location: '',
  faction: '',
  description: '',
  personality: '',
  goals: [],
});

const emptyLore = (): WorldSeedLore => ({
  keyword: '',
  content: '',
  category: '',
});

const emptyRule = (): WorldSeedRule => ({
  name: '',
  description: '',
});

// ---------- CSV-style list helpers ----------

const listToCsv = (xs: string[]) => xs.join(', ');
const csvToList = (s: string) =>
  s
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

// ---------- Generic chip / tag editor ----------

const TagChips: React.FC<{
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}> = ({ values, onChange, placeholder }) => {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) {
      setDraft('');
      return;
    }
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            className="text-[10px] bg-red-900/20 text-red-300 border border-red-900/30 px-2 py-1 rounded inline-flex items-center gap-2"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              className="text-red-400 hover:text-white"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-[10px] text-gray-600 italic">No entries.</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder={placeholder || 'Add entry and press Enter…'}
          className={inputCls}
        />
        <button type="button" onClick={commit} className={ghostBtn}>
          Add
        </button>
      </div>
    </div>
  );
};

// ---------- Per-entity edit forms ----------

const LocationForm: React.FC<{
  value: WorldSeedLocation;
  onChange: (v: WorldSeedLocation) => void;
}> = ({ value, onChange }) => (
  <div className="space-y-3">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className={fieldLabel}>Name</label>
        <input
          className={inputCls}
          value={value.name}
          onChange={e => onChange({ ...value, name: e.target.value })}
        />
      </div>
      <div>
        <label className={fieldLabel}>Controlling Faction</label>
        <input
          className={inputCls}
          value={value.controllingFaction || ''}
          onChange={e => onChange({ ...value, controllingFaction: e.target.value })}
          placeholder="Optional"
        />
      </div>
    </div>
    <div>
      <label className={fieldLabel}>Description</label>
      <textarea
        className={textareaCls}
        rows={3}
        value={value.description}
        onChange={e => onChange({ ...value, description: e.target.value })}
      />
    </div>
    <div>
      <label className={fieldLabel}>Tags</label>
      <TagChips
        values={value.tags}
        onChange={tags => onChange({ ...value, tags })}
        placeholder="e.g. capital, harbor, ruins"
      />
    </div>
    <div>
      <label className={fieldLabel}>Connections</label>
      <div className="space-y-2">
        {value.connections.map((c, i) => (
          <div
            key={i}
            className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center bg-black/40 border border-gray-800 rounded p-2"
          >
            <input
              className={`${inputCls} md:col-span-5`}
              placeholder="Destination location"
              value={c.to}
              onChange={e => {
                const next = [...value.connections];
                next[i] = { ...c, to: e.target.value };
                onChange({ ...value, connections: next });
              }}
            />
            <input
              type="number"
              min={0}
              className={`${inputCls} md:col-span-3`}
              placeholder="Travel min"
              value={Number.isFinite(c.travelTimeMinutes) ? c.travelTimeMinutes : 0}
              onChange={e => {
                const next = [...value.connections];
                next[i] = { ...c, travelTimeMinutes: Number(e.target.value) || 0 };
                onChange({ ...value, connections: next });
              }}
            />
            <input
              className={`${inputCls} md:col-span-3`}
              placeholder="Mode (foot, horse…)"
              value={c.mode || ''}
              onChange={e => {
                const next = [...value.connections];
                next[i] = { ...c, mode: e.target.value };
                onChange({ ...value, connections: next });
              }}
            />
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  connections: value.connections.filter((_, j) => j !== i),
                })
              }
              className={`${dangerBtn} md:col-span-1`}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className={ghostBtn}
          onClick={() =>
            onChange({
              ...value,
              connections: [...value.connections, { to: '', travelTimeMinutes: 0, mode: '' }],
            })
          }
        >
          + Add connection
        </button>
      </div>
    </div>
  </div>
);

const FactionForm: React.FC<{
  value: WorldSeedFaction;
  onChange: (v: WorldSeedFaction) => void;
}> = ({ value, onChange }) => {
  const [dispKey, setDispKey] = useState('');
  const [dispVal, setDispVal] = useState('neutral');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>Name</label>
          <input
            className={inputCls}
            value={value.name}
            onChange={e => onChange({ ...value, name: e.target.value })}
          />
        </div>
        <div>
          <label className={fieldLabel}>Leader</label>
          <input
            className={inputCls}
            value={value.leader || ''}
            onChange={e => onChange({ ...value, leader: e.target.value })}
            placeholder="Optional"
          />
        </div>
      </div>
      <div>
        <label className={fieldLabel}>Description</label>
        <textarea
          className={textareaCls}
          rows={3}
          value={value.description}
          onChange={e => onChange({ ...value, description: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>Influence (0–100)</label>
          <input
            type="number"
            min={0}
            max={100}
            className={inputCls}
            value={value.influence}
            onChange={e =>
              onChange({ ...value, influence: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
            }
          />
        </div>
        <div>
          <label className={fieldLabel}>Territory</label>
          <TagChips
            values={value.territory}
            onChange={territory => onChange({ ...value, territory })}
            placeholder="Add a region…"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>Resources</label>
          <TagChips
            values={value.resources}
            onChange={resources => onChange({ ...value, resources })}
            placeholder="Add a resource…"
          />
        </div>
        <div>
          <label className={fieldLabel}>Key Members</label>
          <TagChips
            values={value.keyMembers}
            onChange={keyMembers => onChange({ ...value, keyMembers })}
            placeholder="Add a member…"
          />
        </div>
      </div>
      <div>
        <label className={fieldLabel}>Dispositions (other faction → stance)</label>
        <div className="space-y-2">
          {Object.entries(value.dispositions).map(([k, v]) => (
            <div key={k} className="flex gap-2 items-center">
              <input className={inputCls} value={k} readOnly />
              <input
                className={inputCls}
                value={v}
                onChange={e =>
                  onChange({
                    ...value,
                    dispositions: { ...value.dispositions, [k]: e.target.value },
                  })
                }
              />
              <button
                type="button"
                className={dangerBtn}
                onClick={() => {
                  const next = { ...value.dispositions };
                  delete next[k];
                  onChange({ ...value, dispositions: next });
                }}
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex gap-2 items-center">
            <input
              className={inputCls}
              placeholder="Faction name"
              value={dispKey}
              onChange={e => setDispKey(e.target.value)}
            />
            <input
              className={inputCls}
              placeholder="allied / neutral / rival / war"
              value={dispVal}
              onChange={e => setDispVal(e.target.value)}
            />
            <button
              type="button"
              className={ghostBtn}
              onClick={() => {
                const k = dispKey.trim();
                if (!k) return;
                onChange({
                  ...value,
                  dispositions: { ...value.dispositions, [k]: dispVal.trim() || 'neutral' },
                });
                setDispKey('');
                setDispVal('neutral');
              }}
            >
              + Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const NPCForm: React.FC<{ value: WorldSeedNPC; onChange: (v: WorldSeedNPC) => void }> = ({
  value,
  onChange,
}) => (
  <div className="space-y-3">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className={fieldLabel}>Name</label>
        <input
          className={inputCls}
          value={value.name}
          onChange={e => onChange({ ...value, name: e.target.value })}
        />
      </div>
      <div>
        <label className={fieldLabel}>Role</label>
        <input
          className={inputCls}
          value={value.role}
          onChange={e => onChange({ ...value, role: e.target.value })}
        />
      </div>
      <div>
        <label className={fieldLabel}>Location</label>
        <input
          className={inputCls}
          value={value.location}
          onChange={e => onChange({ ...value, location: e.target.value })}
        />
      </div>
      <div>
        <label className={fieldLabel}>Faction</label>
        <input
          className={inputCls}
          value={value.faction || ''}
          onChange={e => onChange({ ...value, faction: e.target.value })}
          placeholder="Optional"
        />
      </div>
    </div>
    <div>
      <label className={fieldLabel}>Description</label>
      <textarea
        className={textareaCls}
        rows={3}
        value={value.description}
        onChange={e => onChange({ ...value, description: e.target.value })}
      />
    </div>
    <div>
      <label className={fieldLabel}>Personality</label>
      <textarea
        className={textareaCls}
        rows={2}
        value={value.personality}
        onChange={e => onChange({ ...value, personality: e.target.value })}
      />
    </div>
    <div>
      <label className={fieldLabel}>Goals</label>
      <TagChips
        values={value.goals}
        onChange={goals => onChange({ ...value, goals })}
        placeholder="Add a goal…"
      />
    </div>
  </div>
);

const LoreForm: React.FC<{ value: WorldSeedLore; onChange: (v: WorldSeedLore) => void }> = ({
  value,
  onChange,
}) => (
  <div className="space-y-3">
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <div>
        <label className={fieldLabel}>Keyword</label>
        <input
          className={inputCls}
          value={value.keyword}
          onChange={e => onChange({ ...value, keyword: e.target.value })}
        />
      </div>
      <div>
        <label className={fieldLabel}>Category</label>
        <input
          className={inputCls}
          value={value.category}
          onChange={e => onChange({ ...value, category: e.target.value })}
          placeholder="e.g. history, religion, magic"
        />
      </div>
    </div>
    <div>
      <label className={fieldLabel}>Content</label>
      <textarea
        className={textareaCls}
        rows={4}
        value={value.content}
        onChange={e => onChange({ ...value, content: e.target.value })}
      />
    </div>
  </div>
);

const RuleForm: React.FC<{ value: WorldSeedRule; onChange: (v: WorldSeedRule) => void }> = ({
  value,
  onChange,
}) => (
  <div className="space-y-3">
    <div>
      <label className={fieldLabel}>Name</label>
      <input
        className={inputCls}
        value={value.name}
        onChange={e => onChange({ ...value, name: e.target.value })}
      />
    </div>
    <div>
      <label className={fieldLabel}>Description</label>
      <textarea
        className={textareaCls}
        rows={3}
        value={value.description}
        onChange={e => onChange({ ...value, description: e.target.value })}
      />
    </div>
  </div>
);

// ---------- Generic list section with expand-to-edit rows ----------

interface ItemSectionProps<T> {
  title: string;
  items: T[];
  setItems: (next: T[]) => void;
  factory: () => T;
  renderSummary: (item: T) => React.ReactNode;
  renderForm: (item: T, onChange: (v: T) => void) => React.ReactNode;
}

function ItemSection<T>({
  title,
  items,
  setItems,
  factory,
  renderSummary,
  renderForm,
}: ItemSectionProps<T>) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const add = () => {
    const next = [...items, factory()];
    setItems(next);
    setOpenIndex(next.length - 1);
  };
  const remove = (i: number) => {
    if (!confirm('Remove this entry?')) return;
    setItems(items.filter((_, j) => j !== i));
    setOpenIndex(o => (o === i ? null : o !== null && o > i ? o - 1 : o));
  };
  const update = (i: number, v: T) => {
    const next = [...items];
    next[i] = v;
    setItems(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          {title}{' '}
          <span className="text-gray-500 font-normal text-xs">({items.length})</span>
        </h3>
        <button type="button" onClick={add} className={primaryBtn}>
          + Add
        </button>
      </div>
      {items.length === 0 && (
        <p className="text-xs text-gray-500 italic">No entries yet. Click "+ Add" to create one.</p>
      )}
      <div className="space-y-2">
        {items.map((item, i) => {
          const open = openIndex === i;
          return (
            <div key={i} className={sectionCard}>
              <div className="flex justify-between items-start gap-3">
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? null : i)}
                  className="flex-1 text-left"
                >
                  {renderSummary(item)}
                </button>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenIndex(open ? null : i)}
                    className={ghostBtn}
                  >
                    {open ? 'Close' : 'Edit'}
                  </button>
                  <button type="button" onClick={() => remove(i)} className={dangerBtn}>
                    Delete
                  </button>
                </div>
              </div>
              {open && (
                <div className="pt-3 border-t border-gray-800">
                  {renderForm(item, v => update(i, v))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Main editor ----------

export const WorldSeedEditor: React.FC<WorldSeedEditorProps> = ({
  show,
  seed,
  onClose,
  onSave,
}) => {
  const [tab, setTab] = useState<Tab>('overview');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [locations, setLocations] = useState<WorldSeedLocation[]>([]);
  const [factions, setFactions] = useState<WorldSeedFaction[]>([]);
  const [npcs, setNpcs] = useState<WorldSeedNPC[]>([]);
  const [lore, setLore] = useState<WorldSeedLore[]>([]);
  const [rules, setRules] = useState<WorldSeedRule[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Hydrate local state every time a different seed is opened.
  useEffect(() => {
    if (!seed) return;
    setName(seed.name);
    setDescription(seed.description);
    setLocations(seed.locations || []);
    setFactions(seed.factions || []);
    setNpcs(seed.npcs || []);
    setLore(seed.lore || []);
    setRules(seed.rules || []);
    setTags(seed.tags || []);
    setTab('overview');
  }, [seed?.id, show]);

  const counts = useMemo(
    () => ({
      locations: locations.length,
      factions: factions.length,
      npcs: npcs.length,
      lore: lore.length,
      rules: rules.length,
      tags: tags.length,
    }),
    [locations, factions, npcs, lore, rules, tags]
  );

  if (!show || !seed) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({
        id: seed.id,
        name: name.trim() || 'Unnamed World',
        description,
        locations,
        factions,
        lore,
        npcs,
        rules,
        tags,
        thumbnail: seed.thumbnail,
      });
      onClose();
    } catch (e) {
      console.error('[WorldSeedEditor] Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-gray-800 max-w-5xl w-full max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-white uppercase tracking-wider">Seed Editor</h2>
            <p className="text-[10px] text-gray-500 mt-1">
              Inspect and tune the parsed RAG contents of "{seed.name}".
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Tab strip */}
        <div className="flex flex-wrap gap-2 px-6 py-3 border-b border-gray-800 bg-black/40">
          <button onClick={() => setTab('overview')} className={tabBtn(tab === 'overview')}>
            Overview
          </button>
          <button onClick={() => setTab('locations')} className={tabBtn(tab === 'locations')}>
            Locations · {counts.locations}
          </button>
          <button onClick={() => setTab('factions')} className={tabBtn(tab === 'factions')}>
            Factions · {counts.factions}
          </button>
          <button onClick={() => setTab('npcs')} className={tabBtn(tab === 'npcs')}>
            NPCs · {counts.npcs}
          </button>
          <button onClick={() => setTab('lore')} className={tabBtn(tab === 'lore')}>
            Lore · {counts.lore}
          </button>
          <button onClick={() => setTab('rules')} className={tabBtn(tab === 'rules')}>
            Rules · {counts.rules}
          </button>
          <button onClick={() => setTab('tags')} className={tabBtn(tab === 'tags')}>
            Tags · {counts.tags}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {tab === 'overview' && (
            <div className="space-y-4">
              <div>
                <label className={fieldLabel}>World Name</label>
                <input
                  className={inputCls}
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
              <div>
                <label className={fieldLabel}>Original Description (seed prompt)</label>
                <textarea
                  className={textareaCls}
                  rows={8}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
                <p className="text-[10px] text-gray-600 mt-1">
                  This is the raw text the world was decomposed from. Edits here do NOT
                  re-decompose — use Expand from the selector to add more parsed entities.
                </p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[10px]">
                {(
                  [
                    ['Locations', counts.locations],
                    ['Factions', counts.factions],
                    ['NPCs', counts.npcs],
                    ['Lore', counts.lore],
                    ['Rules', counts.rules],
                    ['Tags', counts.tags],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label} className="bg-gray-900/40 p-3 rounded text-center">
                    <span className="text-gray-500 block">{label}</span>
                    <span className="text-red-400 font-bold text-base">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'locations' && (
            <ItemSection<WorldSeedLocation>
              title="Locations"
              items={locations}
              setItems={setLocations}
              factory={emptyLocation}
              renderSummary={l => (
                <div>
                  <div className="text-white text-sm font-bold">
                    {l.name || <span className="text-gray-600 italic">unnamed location</span>}
                  </div>
                  <div className="text-gray-500 text-[10px] line-clamp-1">{l.description}</div>
                  <div className="text-[9px] text-gray-600 mt-1">
                    {l.tags.length} tags · {l.connections.length} connections
                    {l.controllingFaction ? ` · ${l.controllingFaction}` : ''}
                  </div>
                </div>
              )}
              renderForm={(l, onChange) => <LocationForm value={l} onChange={onChange} />}
            />
          )}

          {tab === 'factions' && (
            <ItemSection<WorldSeedFaction>
              title="Factions"
              items={factions}
              setItems={setFactions}
              factory={emptyFaction}
              renderSummary={f => (
                <div>
                  <div className="text-white text-sm font-bold">
                    {f.name || <span className="text-gray-600 italic">unnamed faction</span>}
                  </div>
                  <div className="text-gray-500 text-[10px] line-clamp-1">{f.description}</div>
                  <div className="text-[9px] text-gray-600 mt-1">
                    influence {f.influence} · {f.territory.length} territories ·{' '}
                    {Object.keys(f.dispositions).length} dispositions
                    {f.leader ? ` · led by ${f.leader}` : ''}
                  </div>
                </div>
              )}
              renderForm={(f, onChange) => <FactionForm value={f} onChange={onChange} />}
            />
          )}

          {tab === 'npcs' && (
            <ItemSection<WorldSeedNPC>
              title="NPCs"
              items={npcs}
              setItems={setNpcs}
              factory={emptyNPC}
              renderSummary={n => (
                <div>
                  <div className="text-white text-sm font-bold">
                    {n.name || <span className="text-gray-600 italic">unnamed npc</span>}
                    {n.role ? <span className="text-gray-400 font-normal"> · {n.role}</span> : null}
                  </div>
                  <div className="text-gray-500 text-[10px] line-clamp-1">{n.description}</div>
                  <div className="text-[9px] text-gray-600 mt-1">
                    {n.location || 'no location'}
                    {n.faction ? ` · ${n.faction}` : ''} · {n.goals.length} goals
                  </div>
                </div>
              )}
              renderForm={(n, onChange) => <NPCForm value={n} onChange={onChange} />}
            />
          )}

          {tab === 'lore' && (
            <ItemSection<WorldSeedLore>
              title="Lore Entries"
              items={lore}
              setItems={setLore}
              factory={emptyLore}
              renderSummary={l => (
                <div>
                  <div className="text-white text-sm font-bold">
                    {l.keyword || <span className="text-gray-600 italic">no keyword</span>}
                    {l.category ? (
                      <span className="text-gray-400 font-normal"> · {l.category}</span>
                    ) : null}
                  </div>
                  <div className="text-gray-500 text-[10px] line-clamp-2">{l.content}</div>
                </div>
              )}
              renderForm={(l, onChange) => <LoreForm value={l} onChange={onChange} />}
            />
          )}

          {tab === 'rules' && (
            <ItemSection<WorldSeedRule>
              title="Rules"
              items={rules}
              setItems={setRules}
              factory={emptyRule}
              renderSummary={r => (
                <div>
                  <div className="text-white text-sm font-bold">
                    {r.name || <span className="text-gray-600 italic">unnamed rule</span>}
                  </div>
                  <div className="text-gray-500 text-[10px] line-clamp-2">{r.description}</div>
                </div>
              )}
              renderForm={(r, onChange) => <RuleForm value={r} onChange={onChange} />}
            />
          )}

          {tab === 'tags' && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                World Tags <span className="text-gray-500 font-normal text-xs">({tags.length})</span>
              </h3>
              <p className="text-[11px] text-gray-500">
                Top-level tags are surfaced on the seed card and used by the RAG retriever
                to narrow context. Add or remove freely.
              </p>
              <TagChips
                values={tags}
                onChange={setTags}
                placeholder="Add a world tag and press Enter…"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 px-6 py-4 flex justify-between items-center bg-black/40">
          <div className="text-[10px] text-gray-500">
            Last modified {new Date(seed.lastModified).toLocaleString()}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className={ghostBtn} disabled={saving}>
              Cancel
            </button>
            <button onClick={handleSave} className={primaryBtn} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
