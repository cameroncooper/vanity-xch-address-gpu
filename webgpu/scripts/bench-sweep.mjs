#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const resultsPath = join(root, "bench-results.jsonl");
const step = process.env.WEBGPU_SWEEP_STEP ?? "sweep";
const samplesFloor = Number(process.env.WEBGPU_BENCH_SAMPLES ?? 10000);
const batches = parseList(process.env.WEBGPU_SWEEP_BATCHES, [1024, 4096, 16384, 65536, 262144]);
const workgroups = parseList(process.env.WEBGPU_SWEEP_WORKGROUPS, [256]);

function parseList(raw, fallback) {
  if (!raw) {
    return fallback;
  }
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function runHeadless(env) {
  return new Promise((resolve) => {
    const child = spawn("node", ["scripts/headless.mjs", "benchmark"], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function parseResult(stdout) {
  const start = stdout.lastIndexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    return null;
  }
  try {
    return JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
}

function formatRow(row) {
  const rate = row.keysPerSec == null ? "FAIL" : Math.round(row.keysPerSec).toLocaleString();
  const elapsed = row.elapsedSec == null ? "—" : Number(row.elapsedSec).toFixed(2);
  return `${String(row.step).padEnd(18)} ${String(row.batch).padStart(7)} ${String(row.workgroup).padStart(4)} ${String(row.samples).padStart(8)} ${rate.padStart(12)} ${elapsed.padStart(8)}`;
}

await mkdir(root, { recursive: true });
const rows = [];
console.log(
  `${"step".padEnd(18)} ${"batch".padStart(7)} ${"wg".padStart(4)} ${"samples".padStart(8)} ${"keys/sec".padStart(12)} ${"sec".padStart(8)}`,
);

outer: for (const workgroup of workgroups) {
  for (const batch of batches) {
    const samples = Math.max(samplesFloor, batch);
    const timeoutMs = String(Math.max(300000, samples * 2));
    const started = Date.now();
    const { code, stdout } = await runHeadless({
      WEBGPU_BENCH_SAMPLES: String(samples),
      WEBGPU_BENCH_BATCH: String(batch),
      WEBGPU_BENCH_WORKGROUP: String(workgroup),
      WEBGPU_HEADLESS_TIMEOUT_MS: timeoutMs,
      WEBGPU_SWEEP_STEP: step,
    });
    const parsed = parseResult(stdout);
    const ok = code === 0 && parsed?.ok === true;
    const row = {
      ts: new Date().toISOString(),
      step,
      ok,
      adapter: parsed?.adapter ?? "",
      batch,
      workgroup: parsed?.workgroup ?? workgroup,
      samples: parsed?.samples ?? samples,
      keysPerSec: ok ? parsed.keysPerSec : null,
      elapsedSec: ok ? parsed.elapsedSec : null,
      error: ok ? "" : parsed?.error || parsed?.gpu || `exit ${code}`,
      wallMs: Date.now() - started,
    };
    rows.push(row);
    await appendFile(resultsPath, `${JSON.stringify(row)}\n`);
    console.log(formatRow(row));
    if (!ok) {
      console.error(`sweep stopped at batch=${batch} workgroup=${workgroup}: ${row.error}`);
      break outer;
    }
  }
}

const passed = rows.filter((row) => row.ok);
if (passed.length > 0) {
  const best = passed.reduce((a, b) => (a.keysPerSec >= b.keysPerSec ? a : b));
  console.log(
    `best: ${Math.round(best.keysPerSec).toLocaleString()} keys/sec @ batch ${best.batch} wg ${best.workgroup}`,
  );
}
if (rows.some((row) => !row.ok)) {
  process.exitCode = 1;
}
