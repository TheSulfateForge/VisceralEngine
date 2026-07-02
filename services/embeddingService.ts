// ============================================================================
// services/embeddingService.ts
//
// Main-thread singleton wrapping the embedding worker. Provides:
//
//   await embeddingService.init()          // warm the model
//   await embeddingService.encode(text)    // → Float32Array
//   await embeddingService.encodeBatch([]) // → Float32Array[]
//
// Falls back to direct (in-thread) execution when Worker is unavailable
// (SSR, tests, very old browsers). The model is fetched from the Hugging
// Face CDN on first use; the browser caches the weights.
// ============================================================================
import { generateUUID } from '../idUtils';

// Default to bge-small-en-v1.5: 384-dim, ~34MB quantized, retrieval-tuned.
// Unlike MiniLM (a symmetric similarity model), bge is trained for
// asymmetric short-query → passage retrieval — exactly the "player phrases
// it differently than the lore keyword" case. Same dim as MiniLM so the
// schema is unchanged; the backfill re-embeds automatically because stored
// rows carry model_id and it no longer matches.
// Override via embeddingService.setModel() if you want a different model.
export const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const DEFAULT_EMBEDDING_DIM = 384;

// BGE-family models want this instruction prepended to QUERIES ONLY
// (documents are embedded bare). Other models get no prefix.
const QUERY_PREFIXES: Record<string, string> = {
  'Xenova/bge-small-en-v1.5':
    'Represent this sentence for searching relevant passages: ',
};

export interface EmbeddingProgressEvent {
  status?: string;          // 'downloading' | 'progress' | 'done' | ...
  name?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;        // 0..100 (transformers.js field)
}

type ProgressListener = (ev: EmbeddingProgressEvent) => void;

interface PendingResolver {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

class EmbeddingService {
  private worker: Worker | null = null;
  private workerFailed = false;
  private inThreadExtractor: ((text: string | string[], opts?: unknown) => Promise<{ data: Float32Array }>) | null = null;
  private inThreadModel = '';
  private model = DEFAULT_EMBEDDING_MODEL;
  private dim = DEFAULT_EMBEDDING_DIM;
  private pending = new Map<string, PendingResolver>();
  private progressListeners = new Set<ProgressListener>();
  private initPromise: Promise<void> | null = null;

  /** Override the embedder. Triggers a re-init on next encode. */
  setModel(modelId: string, dim: number): void {
    if (modelId === this.model) return;
    this.model = modelId;
    this.dim = dim;
    this.initPromise = null;
    this.inThreadExtractor = null;
    this.inThreadModel = '';
    if (this.worker) {
      // Tear down so we re-init with the new model on next call.
      this.worker.terminate();
      this.worker = null;
    }
  }

  getModelId(): string { return this.model; }
  getDim(): number { return this.dim; }

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  /**
   * Pre-warm the model. Optional — encode() will lazy-init too. Useful when
   * you want to show a "loading model…" spinner before the first encode.
   */
  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.initInternal();
    return this.initPromise;
  }

  private async initInternal(): Promise<void> {
    if (typeof Worker === 'undefined' || this.workerFailed) {
      await this.loadInThread();
      return;
    }
    try {
      await this.startWorker();
      await this.callWorker<{ ready: true }>('init', { model: this.model });
    } catch (err) {
      console.warn('[embeddingService] worker path failed, falling back to in-thread:', err);
      this.workerFailed = true;
      this.worker?.terminate();
      this.worker = null;
      await this.loadInThread();
    }
  }

  private async startWorker(): Promise<void> {
    // Vite's worker import. The query param tells Vite to bundle the file
    // as a Worker module with its own entry chunk.
    const mod = await import(
      /* @vite-ignore */ './embeddingWorker.ts?worker'
    ) as { default: new () => Worker };
    const w = new mod.default();
    this.worker = w;

    w.addEventListener('message', (ev: MessageEvent) => {
      const msg = ev.data as {
        type: string;
        id?: string;
        vector?: Float32Array;
        vectors?: Float32Array[];
        message?: string;
        progress?: EmbeddingProgressEvent;
      };
      if (msg.type === 'progress' && msg.progress) {
        for (const l of this.progressListeners) l(msg.progress);
        return;
      }
      if (msg.type === 'hello') return;
      if (!msg.id) return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.type === 'error') pending.reject(new Error(msg.message ?? 'embedding worker error'));
      else if (msg.type === 'encoded') pending.resolve(msg.vector);
      else if (msg.type === 'encoded_batch') pending.resolve(msg.vectors);
      else if (msg.type === 'ready') pending.resolve({ ready: true });
      else if (msg.type === 'pong') pending.resolve({ pong: true });
    });

    w.addEventListener('error', (ev: ErrorEvent) => {
      console.error('[embeddingService] worker error:', ev.message);
      // Reject every pending request and fall back.
      for (const [, p] of this.pending) p.reject(new Error(ev.message || 'worker error'));
      this.pending.clear();
      this.workerFailed = true;
    });
  }

  private callWorker<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!this.worker) return Promise.reject(new Error('worker not started'));
    const id = generateUUID();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker!.postMessage({ type, id, model: this.model, ...payload });
    });
  }

  private async loadInThread(): Promise<void> {
    if (this.inThreadExtractor && this.inThreadModel === this.model) return;
    const tx = await import('@huggingface/transformers');
    tx.env.allowLocalModels = false;
    tx.env.allowRemoteModels = true;
    const pipe = await tx.pipeline('feature-extraction', this.model, {
      progress_callback: (progress: unknown) => {
        for (const l of this.progressListeners) l(progress as EmbeddingProgressEvent);
      },
    });
    this.inThreadExtractor = pipe as unknown as typeof this.inThreadExtractor;
    this.inThreadModel = this.model;
  }

  /**
   * Encode a retrieval QUERY (user input / recent history). Prepends the
   * model's query instruction when one is defined (bge family). Documents
   * must go through encode()/encodeBatch() — never this method — or the
   * query/passage asymmetry is lost.
   */
  async encodeQuery(text: string): Promise<Float32Array> {
    const prefix = QUERY_PREFIXES[this.model] ?? '';
    return this.encode(prefix + text);
  }

  async encode(text: string): Promise<Float32Array> {
    await this.init();
    if (this.worker && !this.workerFailed) {
      return this.callWorker<Float32Array>('encode', { text });
    }
    if (!this.inThreadExtractor) await this.loadInThread();
    const out = await this.inThreadExtractor!(text, { pooling: 'mean', normalize: true });
    return new Float32Array(out.data);
  }

  async encodeBatch(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.init();
    if (this.worker && !this.workerFailed) {
      return this.callWorker<Float32Array[]>('encode_batch', { texts });
    }
    if (!this.inThreadExtractor) await this.loadInThread();
    const out = await this.inThreadExtractor!(texts, { pooling: 'mean', normalize: true });
    const data = out.data as Float32Array;
    const dim = data.length / texts.length;
    const result: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      result.push(new Float32Array(data.subarray(i * dim, (i + 1) * dim)));
    }
    return result;
  }

  /**
   * Tear down the worker (e.g. for memory pressure). Next encode() re-inits.
   */
  shutdown(): void {
    this.worker?.terminate();
    this.worker = null;
    this.initPromise = null;
    this.inThreadExtractor = null;
    this.inThreadModel = '';
  }
}

export const embeddingService = new EmbeddingService();
