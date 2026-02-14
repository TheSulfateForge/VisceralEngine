
// ============================================================================
// DB.TS - IndexedDB Wrapper
// ============================================================================

import { GameSave, SaveMetadata } from "./types";
import { generateSaveId, generateUUID } from "./idUtils";

const DB_NAME = 'VisceralEngineDB';
const DB_VERSION = 3; 
const STORE_SAVES = 'saves';
const STORE_IMAGES = 'images';

export class Database {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        this.initPromise = null;
        reject(new Error(`IndexedDB error: ${request.error?.message}`));
      };
      
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Saves Store
        if (!db.objectStoreNames.contains(STORE_SAVES)) {
             const store = db.createObjectStore(STORE_SAVES, { keyPath: 'id' });
             store.createIndex('name', 'name', { unique: true });
        } else {
             const store = (event.target as IDBOpenDBRequest).transaction!.objectStore(STORE_SAVES);
             if (!store.indexNames.contains('name')) {
                 store.createIndex('name', 'name', { unique: true });
             }
        }

        // Images Store
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
            db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
        }
      };
    });

    return this.initPromise;
  }

  // --- Image Handling ---

  async saveImage(base64Data: string): Promise<string> {
      await this.init();
      if (!this.db) throw new Error("DB not initialized");

      // Modern approach: Fetch the data URI to get the blob directly.
      const res = await fetch(base64Data);
      const blob = await res.blob();
            
      // Use standard UUIDs for image IDs as well
      const id = `img_${generateUUID()}`;

      return new Promise((resolve, reject) => {
          const transaction = this.db!.transaction([STORE_IMAGES], 'readwrite');
          const store = transaction.objectStore(STORE_IMAGES);
          const request = store.put({ id, blob });

          request.onsuccess = () => resolve(id);
          request.onerror = () => reject(request.error);
      });
  }

  // Returns the raw Blob. The CONSUMER is responsible for creating/revoking object URLs.
  async getImage(id: string): Promise<Blob | null> {
      await this.init();
      if (!this.db) throw new Error("DB not initialized");

      return new Promise((resolve, reject) => {
          const transaction = this.db!.transaction([STORE_IMAGES], 'readonly');
          const store = transaction.objectStore(STORE_IMAGES);
          const request = store.get(id);

          request.onsuccess = () => {
              const result = request.result;
              if (result && result.blob) {
                  resolve(result.blob);
              } else {
                  resolve(null);
              }
          };
          request.onerror = () => reject(request.error);
      });
  }

  // --- Save Handling ---

  async saveGame(save: GameSave): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_SAVES], 'readwrite');
      const store = transaction.objectStore(STORE_SAVES);
      const index = store.index('name');

      const checkRequest = index.get(save.name);

      checkRequest.onsuccess = () => {
        const existing = checkRequest.result as GameSave;
        if (existing) {
          save.id = existing.id;
        } else if (!save.id) {
            save.id = generateSaveId();
        }

        const putRequest = store.put(save);
        putRequest.onerror = () => reject(putRequest.error);
        putRequest.onsuccess = () => resolve();
      };

      checkRequest.onerror = () => reject(checkRequest.error);
    });
  }

  async loadGame(name: string): Promise<GameSave | undefined> {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_SAVES], 'readonly');
      const store = transaction.objectStore(STORE_SAVES);
      const index = store.index('name');
      
      const request = index.get(name);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getAllSavesMetadata(): Promise<SaveMetadata[]> {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_SAVES], 'readonly');
      const store = transaction.objectStore(STORE_SAVES);
      
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const results = request.result as GameSave[];
        // Sort by timestamp descending (newest first)
        const metadata = results.map(s => ({
            name: s.name,
            timestamp: s.timestamp,
            id: s.id
        })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        
        resolve(metadata);
      };
    });
  }

  async deleteGame(name: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_SAVES], 'readwrite');
      const store = transaction.objectStore(STORE_SAVES);
      const index = store.index('name');

      const keyRequest = index.getKey(name);

      keyRequest.onsuccess = () => {
        const id = keyRequest.result;
        if (id) {
            const delRequest = store.delete(id);
            delRequest.onsuccess = () => resolve();
            delRequest.onerror = () => reject(delRequest.error);
        } else {
            resolve();
        }
      };
      
      keyRequest.onerror = () => reject(keyRequest.error);
    });
  }
}

export const db = new Database();
