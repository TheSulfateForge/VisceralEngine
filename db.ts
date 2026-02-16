// ============================================================================
// DB.TS - IndexedDB Wrapper
// ============================================================================

import { GameSave, SaveMetadata, CharacterTemplate } from "./types";
import { generateSaveId, generateUUID } from "./idUtils";

const DB_NAME = 'VisceralEngineDB';
const DB_VERSION = 4; 
const STORE_SAVES = 'saves';
const STORE_IMAGES = 'images';
const STORE_TEMPLATES = 'templates';

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

        // Templates Store (NEW)
        if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
            const store = db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
            store.createIndex('name', 'name', { unique: true });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Generic transaction helper to reduce boilerplate.
   * Handles opening transaction, executing a single request, and wrapping in Promise.
   */
  private async tx<T>(
    storeName: string, 
    mode: IDBTransactionMode, 
    fn: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], mode);
      const store = transaction.objectStore(storeName);
      
      const request = fn(store);
      
      transaction.onerror = () => reject(transaction.error);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // --- Image Handling ---

  async saveImage(base64Data: string): Promise<string> {
      // Optimization: Zero-network conversion using synchronous buffer operations
      // Avoids overhead of fetch() for Data URIs
      const parts = base64Data.split(',');
      const header = parts[0];
      const base64 = parts[1];
      const mimeMatch = header.match(/:(.*?);/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
          bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const id = `img_${generateUUID()}`;

      // Returns the key (id)
      await this.tx(STORE_IMAGES, 'readwrite', store => store.put({ id, blob }));
      return id;
  }

  async getImage(id: string): Promise<Blob | null> {
      const result = await this.tx(STORE_IMAGES, 'readonly', store => store.get(id));
      return result?.blob || null;
  }

  async cleanupOrphanedImages(activeImageIds: string[]): Promise<number> {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");

    const activeSet = new Set(activeImageIds);
    let deletedCount = 0;

    return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([STORE_IMAGES], 'readwrite');
        const store = transaction.objectStore(STORE_IMAGES);
        const request = store.openCursor();

        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                if (!activeSet.has(cursor.key as string)) {
                    cursor.delete();
                    deletedCount++;
                }
                cursor.continue();
            }
        };

        transaction.oncomplete = () => resolve(deletedCount);
        transaction.onerror = () => reject(transaction.error);
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
    return this.tx(STORE_SAVES, 'readonly', store => store.index('name').get(name));
  }

  async getAllSavesMetadata(): Promise<SaveMetadata[]> {
    const results = await this.tx<GameSave[]>(STORE_SAVES, 'readonly', store => store.getAll());
    return results.map(s => ({
        name: s.name,
        timestamp: s.timestamp,
        id: s.id
    })).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
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

  // --- Template Handling ---

  async saveTemplate(template: CharacterTemplate): Promise<void> {
    await this.init();
    if (!this.db) throw new Error("DB not initialized");

    return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([STORE_TEMPLATES], 'readwrite');
        const store = transaction.objectStore(STORE_TEMPLATES);
        const index = store.index('name');

        const checkRequest = index.get(template.name);

        checkRequest.onsuccess = () => {
            const existing = checkRequest.result as CharacterTemplate;
            if (existing) {
                template.id = existing.id;
            }
            const putRequest = store.put(template);
            putRequest.onerror = () => reject(putRequest.error);
            putRequest.onsuccess = () => resolve();
        };

        checkRequest.onerror = () => reject(checkRequest.error);
    });
  }

  async loadTemplate(name: string): Promise<CharacterTemplate | undefined> {
    return this.tx(STORE_TEMPLATES, 'readonly', store => store.index('name').get(name));
  }

  async getAllTemplates(): Promise<CharacterTemplate[]> {
    const results = await this.tx<CharacterTemplate[]>(STORE_TEMPLATES, 'readonly', store => store.getAll());
    return results.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.tx(STORE_TEMPLATES, 'readwrite', store => store.delete(id));
  }
}

export const db = new Database();