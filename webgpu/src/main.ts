import "./style.css";

import { bytesEqual, bytesToHex } from "./bytes";
import {
  benchmarkGpu,
  createGpuContext,
  crossCheckGpu,
  DEFAULT_BATCH,
  formatAdapterLabel,
  runFilterBatch,
  WORKGROUP_SIZE,
  type GpuContext,
} from "./gpu";
import {
  expectedTrials,
  parseVanityParams,
  type VanityParams,
} from "./params";
import { searchVanity } from "./search";
import { EXPECTED_GENERATOR_COMPRESSED, generatorCompressed } from "./verify";

const form = document.querySelector<HTMLFormElement>("#search-form")!;
const prefixInput = document.querySelector<HTMLInputElement>("#prefix")!;
const suffixInput = document.querySelector<HTMLInputElement>("#suffix")!;
const hrpSelect = document.querySelector<HTMLSelectElement>("#hrp")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start-btn")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn")!;
const selftestBtn = document.querySelector<HTMLButtonElement>("#selftest-btn")!;
const benchmarkBtn = document.querySelector<HTMLButtonElement>("#benchmark-btn")!;
const formError = document.querySelector<HTMLParagraphElement>("#form-error")!;
const gpuStatus = document.querySelector<HTMLParagraphElement>("#gpu-status")!;
const keysTriedEl = document.querySelector<HTMLElement>("#keys-tried")!;
const keysPerSecEl = document.querySelector<HTMLElement>("#keys-per-sec")!;
const expectedEl = document.querySelector<HTMLElement>("#expected-trials")!;
const etaEl = document.querySelector<HTMLElement>("#eta")!;
const resultEmpty = document.querySelector<HTMLElement>("#result-empty")!;
const resultEl = document.querySelector<HTMLElement>("#result")!;
const resultAddress = document.querySelector<HTMLElement>("#result-address")!;
const resultSk = document.querySelector<HTMLElement>("#result-sk")!;
const resultIndex = document.querySelector<HTMLElement>("#result-index")!;

let ctxPromise: Promise<GpuContext> | null = null;
let searchAbort: AbortController | null = null;
let searching = false;

function gpuContext(): Promise<GpuContext> {
  if (!ctxPromise) {
    ctxPromise = createGpuContext();
  }
  return ctxPromise;
}

function setCliResult(
  ok: boolean,
  extra: Record<string, string | number | boolean> = {},
): void {
  document.documentElement.dataset.cli = JSON.stringify({
    ok,
    gpu: gpuStatus.textContent ?? "",
    error: formError.hidden ? "" : (formError.textContent ?? ""),
    ...extra,
  });
}

function setError(message: string | null): void {
  if (message === null) {
    formError.hidden = true;
    formError.textContent = "";
    return;
  }
  formError.hidden = false;
  formError.textContent = message;
}

function formatCount(n: number): string {
  return Math.round(n).toLocaleString();
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}h${String(m).padStart(2, "0")}m${String(rem).padStart(2, "0")}s`;
  }
  if (m > 0) {
    return `${m}m${String(rem).padStart(2, "0")}s`;
  }
  return `${rem}s`;
}

function showResult(address: string, secretKey: Uint8Array, index: number): void {
  resultEmpty.hidden = true;
  resultEl.hidden = false;
  resultAddress.textContent = address;
  resultSk.textContent = `0x${bytesToHex(secretKey)}`;
  resultIndex.textContent = String(index);
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

document.querySelector("#copy-address")?.addEventListener("click", () => {
  void copyText(resultAddress.textContent ?? "");
});
document.querySelector("#copy-sk")?.addEventListener("click", () => {
  void copyText(resultSk.textContent ?? "");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (searching) {
    return;
  }
  try {
    const params = parseVanityParams(prefixInput.value, suffixInput.value, hrpSelect.value);
    setError(null);
    void runSearch(params);
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
});

stopBtn.addEventListener("click", () => {
  searchAbort?.abort();
});

selftestBtn.addEventListener("click", () => {
  void runSelfTest();
});

benchmarkBtn.addEventListener("click", () => {
  void runBenchmark();
});

async function runSelfTest(): Promise<void> {
  setError(null);
  gpuStatus.textContent = "Running self-test…";
  startBtn.disabled = true;
  benchmarkBtn.disabled = true;
  try {
    const gen = generatorCompressed();
    if (!bytesEqual(gen, EXPECTED_GENERATOR_COMPRESSED)) {
      throw new Error("CPU generator compression mismatch");
    }
    const dummy = await createGpuContext({ entryPoint: "dummy_kernel" });
    const dummyHits = await runFilterBatch(
      dummy,
      new Uint8Array(32).fill(0x11),
      0,
      1,
      { prefix: null, suffix: null, hrp: "xch" },
      true,
    );
    if (dummyHits.length !== 1) {
      throw new Error(`dummy kernel expected 1 hash, got ${dummyHits.length}`);
    }
    const ctx = await createGpuContext({ entryPoint: "hash_kernel" });
    ctxPromise = Promise.resolve(ctx);
    await crossCheckGpu(ctx, 4);
    gpuStatus.textContent = `Self-test passed on ${formatAdapterLabel(ctx.adapter)} (GPU vs JS puzzle hashes).`;
    setCliResult(true, { kind: "selftest", adapter: formatAdapterLabel(ctx.adapter) });
  } catch (err) {
    gpuStatus.textContent = "Self-test failed.";
    setError(err instanceof Error ? err.message : String(err));
    setCliResult(false, { kind: "selftest" });
  } finally {
    startBtn.disabled = false;
    benchmarkBtn.disabled = false;
  }
}

async function runBenchmark(samples = 10_000): Promise<void> {
  setError(null);
  gpuStatus.textContent = "Benchmarking WebGPU…";
  searching = true;
  startBtn.disabled = true;
  selftestBtn.disabled = true;
  benchmarkBtn.disabled = true;
  try {
    const ctx = await gpuContext();
    const result = await benchmarkGpu(ctx, samples);
    gpuStatus.textContent = `${formatAdapterLabel(result.adapter)}: ${formatCount(result.keysPerSec)} keys/sec (${result.samples} keys in ${result.elapsedSec.toFixed(1)}s)`;
    keysTriedEl.textContent = formatCount(result.samples);
    keysPerSecEl.textContent = formatCount(result.keysPerSec);
    expectedEl.textContent = "—";
    etaEl.textContent = "—";
    setCliResult(true, {
      kind: "benchmark",
      adapter: formatAdapterLabel(result.adapter),
      keysPerSec: result.keysPerSec,
      samples: result.samples,
      elapsedSec: result.elapsedSec,
      batch: ctx.maxBatch,
      workgroup: ctx.workgroupSize,
    });
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    gpuStatus.textContent = "Benchmark failed.";
    setCliResult(false, { kind: "benchmark" });
  } finally {
    searching = false;
    startBtn.disabled = false;
    selftestBtn.disabled = false;
    benchmarkBtn.disabled = false;
  }
}

async function runSearch(params: VanityParams): Promise<void> {
  searching = true;
  searchAbort = new AbortController();
  startBtn.disabled = true;
  stopBtn.disabled = false;
  selftestBtn.disabled = true;
  benchmarkBtn.disabled = true;
  resultEl.hidden = true;
  resultEmpty.hidden = false;
  const expected = expectedTrials(params);
  expectedEl.textContent = formatCount(expected);
  let keys = 0;

  try {
    const ctx = await gpuContext();
    gpuStatus.textContent = "Searching on WebGPU…";
    const verified = await searchVanity({
      params,
      ctx,
      batchSize: ctx.maxBatch,
      signal: searchAbort.signal,
      onProgress: (progress) => {
        keys = progress.keysChecked;
        keysTriedEl.textContent = formatCount(progress.keysChecked);
        keysPerSecEl.textContent = formatCount(progress.keysPerSec);
        etaEl.textContent =
          progress.etaSec != null ? formatDuration(progress.etaSec) : "—";
      },
    });
    showResult(verified.address, verified.secretKey, verified.index);
    gpuStatus.textContent = "Match found.";
    setCliResult(true, {
      kind: "search",
      address: verified.address,
      keys,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      gpuStatus.textContent = "Stopped.";
      setCliResult(false, { kind: "search", stopped: true, keys });
    } else {
      setError(err instanceof Error ? err.message : String(err));
      gpuStatus.textContent = "Search failed.";
      setCliResult(false, { kind: "search" });
    }
  } finally {
    searching = false;
    searchAbort = null;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    selftestBtn.disabled = false;
    benchmarkBtn.disabled = false;
  }
}

void (async () => {
  const query = new URLSearchParams(location.search);
  const selftest = query.has("selftest");
  const smoke = query.has("smoke");
  const benchmark = query.has("benchmark");
  try {
    if (selftest) {
      await runSelfTest();
      const failed = !formError.hidden;
      document.title = failed ? "SELFTEST_FAIL" : "SELFTEST_OK";
      document.documentElement.dataset.selftest = failed ? "fail" : "pass";
      return;
    }
    if (benchmark) {
      const samples = Math.max(1, Number(query.get("samples") || 10_000) || 10_000);
      const batch = Math.max(1, Number(query.get("batch") || DEFAULT_BATCH) || DEFAULT_BATCH);
      const workgroup = Math.max(1, Number(query.get("workgroup") || WORKGROUP_SIZE) || WORKGROUP_SIZE);
      ctxPromise = createGpuContext({ batchSize: batch, workgroupSize: workgroup });
      await runBenchmark(samples);
      return;
    }
    const ctx = await gpuContext();
    gpuStatus.textContent = `WebGPU ready (${formatAdapterLabel(ctx.adapter)}).`;
    if (smoke) {
      prefixInput.value = query.get("prefix") || "q";
      suffixInput.value = query.get("suffix") || "";
      const params = parseVanityParams(prefixInput.value, suffixInput.value, hrpSelect.value);
      await runSearch(params);
      const failed = resultEl.hidden;
      document.title = failed ? "SELFTEST_FAIL" : "SELFTEST_OK";
      document.documentElement.dataset.selftest = failed ? "fail" : "pass";
    }
  } catch (err) {
    gpuStatus.textContent = err instanceof Error ? err.message : String(err);
    setCliResult(false, { kind: selftest ? "selftest" : smoke ? "search" : benchmark ? "benchmark" : "init" });
    if (selftest || smoke) {
      document.title = "SELFTEST_FAIL";
      document.documentElement.dataset.selftest = "fail";
    }
  }
})();
