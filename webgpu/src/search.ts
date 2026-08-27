import { DEFAULT_BATCH, createGpuContext, runFilterBatch, verifyAndSelectHit, type GpuContext } from "./gpu";
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

  while (!options.signal?.aborted) {
    const hits = await runFilterBatch(ctx, intermediateSk, startIndex, batchSize, params);
    keys += batchSize;
    startIndex = (startIndex + batchSize) >>> 0;
    const elapsedSec = (performance.now() - started) / 1000;
    const keysPerSec = elapsedSec > 0 ? keys / elapsedSec : 0;
    options.onProgress?.({
      keysChecked: keys,
      keysPerSec,
      elapsedSec,
      expectedTrials: expected,
      etaSec: keysPerSec > 0 ? Math.max(0, expected - keys) / keysPerSec : null,
    });
    const verified = verifyAndSelectHit(intermediateSk, hits, params);
    if (verified) {
      return verified;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new DOMException("Search aborted", "AbortError");
}
