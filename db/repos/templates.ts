// db/repos/templates.ts
// Wraps character_templates table.

import { vdb, CharacterTemplateRow } from '../schema';
import { CharacterTemplate, TemplateId } from '../../types';
import { generateTemplateId } from '../../idUtils';

const fromRow = (r: CharacterTemplateRow): CharacterTemplate => ({
  id: r.id,
  name: r.name,
  timestamp: r.timestamp,
  character: r.payload,
});

const toRow = (t: CharacterTemplate): CharacterTemplateRow => ({
  id: t.id,
  name: t.name,
  timestamp: t.timestamp,
  payload: t.character,
});

export const templatesRepo = {
  /**
   * Save a template. If one already exists with the same `name`, that row's
   * id is preserved (matches legacy upsert-by-name semantics).
   */
  async upsert(template: CharacterTemplate): Promise<void> {
    const existing = await vdb.character_templates.where('name').equals(template.name).first();
    const final: CharacterTemplate = existing
      ? { ...template, id: existing.id }
      : { ...template, id: template.id ?? generateTemplateId() };
    await vdb.character_templates.put(toRow(final));
  },

  async getByName(name: string): Promise<CharacterTemplate | undefined> {
    const r = await vdb.character_templates.where('name').equals(name).first();
    return r ? fromRow(r) : undefined;
  },

  async getById(id: TemplateId): Promise<CharacterTemplate | undefined> {
    const r = await vdb.character_templates.get(id);
    return r ? fromRow(r) : undefined;
  },

  async listAll(): Promise<CharacterTemplate[]> {
    const rows = await vdb.character_templates.toArray();
    return rows
      .map(fromRow)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  },

  async deleteById(id: TemplateId): Promise<void> {
    await vdb.character_templates.delete(id);
  },
};
