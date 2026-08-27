import {
  DEFAULT_BATCH,
  collectFilterBatch,
  createGpuContext,
  enqueueFilterBatch,
  verifyAndSelectHit,
  type GpuContext,
  type PendingBatch,
} from "./gpu";
import { expectedTrials, type VanityParams } from "./params";
import type { VerifiedHit } from "./verify";

export interface SearchProgress {
  keysChecked: number;
  keysPerSec: number;
  elapsedSec: number;
  expectedTrials: number;
  etaSec: number | null;
}

export interface SearchOptions {
  params: VanityParams;
  ctx?: GpuContext;
  batchSize?: number;
  signal?: AbortSignal;
  onProgress?: (progress: SearchProgress) => void;
}

export async function searchVanity(options: SearchOptions): Promise<VerifiedHit> {
  const params = options.params;
  const ctx = options.ctx ?? (await createGpuContext());
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const intermediateSk = crypto.getRandomValues(new Uint8Array(32));
  const expected = expectedTrials(params);
  const started = performance.now();
  let keys = 0;
  let startIndex = 0;
  let slot = 0;
  let pending: PendingBatch | null = null;

  while (!options.signal?.aborted) {
    const next = enqueueFilterBatch(ctx, slot, intermediateSk, startIndex, batchSize, params);
    keys += batchSize;
    startIndex = (startIndex + batchSize) >>> 0;
    slot ^= 1;
    const hits = pending ? await collectFilterBatch(ctx, pending) : [];
    pending = next;
    const elapsedSec = (performance.now() - started) / 1000;
    const keysPerSec = elapsedSec > 0 ? keys / elapsedSec : 0;
    options.onProgress?.({
      keysChecked: keys,
      keysPerSec,
      elapsedSec,
      expectedTrials: expected,
      etaSec: keysPerSec > 0 ? Math.max(0, expected - keys) / keysPerSec : null,
    });
    if (hits.length > 0) {
      const verified = verifyAndSelectHit(intermediateSk, hits, params);
      if (verified) {
        return verified;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (pending) {
    const hits = await collectFilterBatch(ctx, pending);
    const verified = verifyAndSelectHit(intermediateSk, hits, params);
    if (verified) {
      return verified;
    }
  }

  throw new DOMException("Search aborted", "AbortError");
}
