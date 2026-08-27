import "./style.css";

import { bytesEqual, bytesToHex } from "./bytes";
import {
  createGpuContext,
  crossCheckGpu,
  DEFAULT_BATCH,
  runFilterBatch,
  verifyAndSelectHit,
  type GpuContext,
} from "./gpu";
import {
  addressMatches,
  expectedTrials,
  parseVanityParams,
  type VanityParams,
} from "./params";
import { EXPECTED_GENERATOR_COMPRESSED, generatorCompressed } from "./verify";

const form = document.querySelector<HTMLFormElement>("#search-form")!;
const prefixInput = document.querySelector<HTMLInputElement>("#prefix")!;
const suffixInput = document.querySelector<HTMLInputElement>("#suffix")!;
const hrpSelect = document.querySelector<HTMLSelectElement>("#hrp")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start-btn")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn")!;
const selftestBtn = document.querySelector<HTMLButtonElement>("#selftest-btn")!;
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
let stopRequested = false;
let searching = false;

function gpuContext(): Promise<GpuContext> {
  if (!ctxPromise) {
    ctxPromise = createGpuContext();
  }
  return ctxPromise;
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
  stopRequested = true;
});

selftestBtn.addEventListener("click", () => {
  void runSelfTest();
});

async function runSelfTest(): Promise<void> {
  setError(null);
  gpuStatus.textContent = "Running self-test…";
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
    gpuStatus.textContent = "Self-test passed (CPU generator + GPU vs JS puzzle hashes).";
  } catch (err) {
    gpuStatus.textContent = "Self-test failed.";
    setError(err instanceof Error ? err.message : String(err));
  }
}

async function runSearch(params: VanityParams): Promise<void> {
  searching = true;
  stopRequested = false;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  selftestBtn.disabled = true;
  resultEl.hidden = true;
  resultEmpty.hidden = false;
  const expected = expectedTrials(params);
  expectedEl.textContent = formatCount(expected);
  const intermediateSk = crypto.getRandomValues(new Uint8Array(32));
  const started = performance.now();
  let keys = 0;
  let startIndex = 0;

  try {
    const ctx = await gpuContext();
    gpuStatus.textContent = "Searching on WebGPU…";
    while (!stopRequested) {
      const hits = await runFilterBatch(ctx, intermediateSk, startIndex, DEFAULT_BATCH, params);
      keys += DEFAULT_BATCH;
      startIndex = (startIndex + DEFAULT_BATCH) >>> 0;
      const elapsedSec = (performance.now() - started) / 1000;
      const rate = elapsedSec > 0 ? keys / elapsedSec : 0;
      keysTriedEl.textContent = formatCount(keys);
      keysPerSecEl.textContent = formatCount(rate);
      etaEl.textContent = rate > 0 ? formatDuration((expected - keys) / rate) : "—";

      const verified = verifyAndSelectHit(intermediateSk, hits, params);
      if (verified && addressMatches(verified.address, params)) {
        showResult(verified.address, verified.secretKey, verified.index);
        gpuStatus.textContent = "Match found.";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (stopRequested && resultEl.hidden) {
      gpuStatus.textContent = "Stopped.";
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
    gpuStatus.textContent = "Search failed.";
  } finally {
    searching = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    selftestBtn.disabled = false;
  }
}

void (async () => {
  const query = new URLSearchParams(location.search);
  const selftest = query.has("selftest");
  const smoke = query.has("smoke");
  try {
    if (selftest) {
      await runSelfTest();
      const failed = !formError.hidden;
      document.title = failed ? "SELFTEST_FAIL" : "SELFTEST_OK";
      document.documentElement.dataset.selftest = failed ? "fail" : "pass";
      return;
    }
    await gpuContext();
    gpuStatus.textContent = "WebGPU ready.";
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
    if (selftest || smoke) {
      document.title = "SELFTEST_FAIL";
      document.documentElement.dataset.selftest = "fail";
    }
  }
})();
