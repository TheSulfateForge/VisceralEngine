// ============================================================================
// services/embeddingWorker.ts
//
// Web Worker that runs the local embedding model off the main thread.
//
// Imported by services/embeddingService.ts via Vite's `?worker` syntax:
//
//     import EmbeddingWorker from './embeddingWorker?worker';
//
// Message protocol (see EmbeddingWorkerRequest/Response in embeddingService.ts).
// ============================================================================
/// <reference lib="WebWorker" />
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

// We do NOT bundle the model into the build. transformers.js fetches the ONNX
// weights from the Hugging Face CDN on first load and the browser caches them.
env.allowLocalModels = false;
env.allowRemoteModels = true;

declare const self: DedicatedWorkerGlobalScope;

let extractor: FeatureExtractionPipeline | null = null;
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null;
let currentModel = '';

async function getExtractor(modelId: string): Promise<FeatureExtractionPipeline> {
  if (extractor && currentModel === modelId) return extractor;
  if (loadingPromise && currentModel === modelId) return loadingPromise;

  currentModel = modelId;
  loadingPromise = (async () => {
    const pipe = await pipeline('feature-extraction', modelId, {
      progress_callback: (progress: unknown) => {
        self.postMessage({ type: 'progress', progress });
      },
    });
    extractor = pipe as FeatureExtractionPipeline;
    return extractor;
  })();
  return loadingPromise;
}

interface InitReq { type: 'init'; id: string; model: string }
interface EncodeReq { type: 'encode'; id: string; model: string; text: string }
interface EncodeBatchReq { type: 'encode_batch'; id: string; model: string; texts: string[] }
interface PingReq { type: 'ping'; id: string }
type Req = InitReq | EncodeReq | EncodeBatchReq | PingReq;

self.addEventListener('message', async (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'ping') {
      self.postMessage({ type: 'pong', id: msg.id });
      return;
    }

    if (msg.type === 'init') {
      await getExtractor(msg.model);
      self.postMessage({ type: 'ready', id: msg.id, model: msg.model });
      return;
    }

    if (msg.type === 'encode') {
      const ext = await getExtractor(msg.model);
      const out = await ext(msg.text, { pooling: 'mean', normalize: true });
      const data = out.data as Float32Array;
      // Copy to a fresh Float32Array — `data` may be a view over the
      // tensor's backing buffer; transferring the buffer would invalidate
      // it for any subsequent use inside the worker.
      const vector = new Float32Array(data);
      self.postMessage(
        { type: 'encoded', id: msg.id, vector, dim: vector.length },
        [vector.buffer],
      );
      return;
    }

    if (msg.type === 'encode_batch') {
      const ext = await getExtractor(msg.model);
      // The pipeline supports arrays directly and returns a tensor whose
      // first dim is the batch size.
      const out = await ext(msg.texts, { pooling: 'mean', normalize: true });
      const data = out.data as Float32Array;
      const dim = data.length / msg.texts.length;
      const vectors: Float32Array[] = [];
      for (let i = 0; i < msg.texts.length; i++) {
        vectors.push(new Float32Array(data.subarray(i * dim, (i + 1) * dim)));
      }
      const transferList = vectors.map((v) => v.buffer);
      self.postMessage(
        { type: 'encoded_batch', id: msg.id, vectors, dim },
        transferList,
      );
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: (msg as { id?: string }).id ?? 'unknown',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

// Signal we're alive so the service knows construction worked.
self.postMessage({ type: 'hello' });
