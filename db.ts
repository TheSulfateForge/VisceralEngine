// ============================================================================
// db.ts — Cutover stub.
//
// As of v0.12.0 the real implementation lives under db/. The legacy
// `Database` class was retired in favour of a normalized Dexie schema with
// projection (db/projection.ts) + repos (db/repos/*). This file remains so
// that every existing `import { db } from '../db'` keeps working unchanged.
//
// To roll back: restore the previous body of this file from git history.
// The legacy IndexedDB store ('VisceralEngineDB') is never touched by the
// new code — old data is safe.
// ============================================================================
export * from './db/index';
