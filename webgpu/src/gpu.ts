import typesWgsl from "./shaders/types.wgsl?raw";
import fpWgsl from "./shaders/fp.wgsl?raw";
import g1Wgsl from "./shaders/g1.wgsl?raw";
import sha256Wgsl from "./shaders/sha256.wgsl?raw";
import scalarWgsl from "./shaders/scalar.wgsl?raw";
import puzzleWgsl from "./shaders/puzzle.wgsl?raw";
import filterWgsl from "./shaders/filter.wgsl?raw";

import { charsetValues, encodeBech32m } from "./bech32";
import { addressMatches, type Hrp, type VanityParams } from "./params";
import { verifyGpuHit, type VerifiedHit } from "./verify";

export const WORKGROUP_SIZE = 256;
export const WORKGROUP_SIZES = [64, 128, 256] as const;
export const DEFAULT_BATCH = 262144;
export const HASH_STRIDE = 36;
export const HASH_INDEX_BYTES = 4;
export const DEFAULT_TABLE_URL = "g1_table.bin";
const PARAMS_BYTES = 544;

export interface GpuInitOptions {
  /** Same-origin URL of the 6-bit G1 table. Default: `g1_table.bin` relative to the page. */
  tableUrl?: string;
  /** Preloaded table bytes. Skips `fetch` when set. */
  tableBytes?: Uint8Array;
  entryPoint?: string;
  batchSize?: number;
  workgroupSize?: number;
}

export interface GpuHit {
  index: number;
  puzzleHash: Uint8Array;
}

export interface GpuAdapterLabel {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
}

interface GpuFrame {
  paramsBuffer: GPUBuffer;
  hitCountBuffer: GPUBuffer;
  hitCountReadBuffer: GPUBuffer;
  hashesBuffer: GPUBuffer;
  hashesReadBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
}

export interface GpuContext {
  device: GPUDevice;
  adapter: GpuAdapterLabel;
  pipeline: GPUComputePipeline;
  tableBuffer: GPUBuffer;
  paramsBuffer: GPUBuffer;
  skBuffer: GPUBuffer;
  hitCountBuffer: GPUBuffer;
  hashesBuffer: GPUBuffer;
  hashesReadBuffer: GPUBuffer;
  frames: GpuFrame[];
  maxBatch: number;
  workgroupSize: number;
  bindGroup: GPUBindGroup;
}

export interface GpuBenchmarkResult {
  adapter: GpuAdapterLabel;
  samples: number;
  elapsedSec: number;
  keysPerSec: number;
}

export function shaderSource(): string {
  return [
    typesWgsl,
    fpWgsl,
    g1Wgsl,
    sha256Wgsl,
    scalarWgsl,
    puzzleWgsl,
    filterWgsl,
  ].join("\n");
}

function resolveWorkgroupSize(requested?: number): number {
  const size = requested ?? WORKGROUP_SIZE;
  if (!WORKGROUP_SIZES.includes(size as (typeof WORKGROUP_SIZES)[number])) {
    throw new Error(`workgroup size must be one of ${WORKGROUP_SIZES.join(", ")}`);
  }
  return size;
}

export async function createGpuContext(options: GpuInitOptions = {}): Promise<GpuContext> {
  const entryPoint = options.entryPoint ?? "hash_kernel";
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const workgroupSize = resolveWorkgroupSize(options.workgroupSize);
  if (!("gpu" in navigator) || !navigator.gpu) {
    throw new Error("WebGPU is not available in this browser");
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) {
    throw new Error("No WebGPU adapter found");
  }
  const adapterLabel = readAdapterLabel(adapter);
  const device = await adapter.requestDevice();
  device.addEventListener("uncapturederror", (event) => {
    console.error("WebGPU error", event.error, event.error.message);
  });
  void device.lost.then((info) => {
    console.error("WebGPU device lost", info.message, info.reason);
  });

  const tableBytes =
    options.tableBytes ??
    new Uint8Array(await (await fetch(resolveTableUrl(options.tableUrl))).arrayBuffer());
  const tableBuffer = device.createBuffer({
    size: tableBytes.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(tableBuffer, 0, tableBytes);

  const skBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const module = device.createShaderModule({ code: shaderSource() });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length > 0) {
    const details = errors
      .map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`)
      .join("\n");
    throw new Error(`WGSL compile failed:\n${details}`);
  }

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipeline = device.createComputePipeline({
    layout: pipelineLayout,
    compute: {
      module,
      entryPoint,
      constants: { workgroup_size_x: workgroupSize },
    },
  });

  const frames: GpuFrame[] = [0, 1].map(() => {
    const paramsBuffer = device.createBuffer({
      size: PARAMS_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const hitCountBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const hitCountReadBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const hashesBuffer = device.createBuffer({
      size: batchSize * HASH_STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const hashesReadBuffer = device.createBuffer({
      size: batchSize * HASH_STRIDE,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: skBuffer } },
        { binding: 2, resource: { buffer: tableBuffer } },
        { binding: 3, resource: { buffer: hitCountBuffer } },
        { binding: 4, resource: { buffer: hashesBuffer } },
      ],
    });
    return {
      paramsBuffer,
      hitCountBuffer,
      hitCountReadBuffer,
      hashesBuffer,
      hashesReadBuffer,
      bindGroup,
    };
  });
  const primary = frames[0]!;

  return {
    device,
    adapter: adapterLabel,
    pipeline,
    tableBuffer,
    paramsBuffer: primary.paramsBuffer,
    skBuffer,
    hitCountBuffer: primary.hitCountBuffer,
    hashesBuffer: primary.hashesBuffer,
    hashesReadBuffer: primary.hashesReadBuffer,
    frames,
    maxBatch: batchSize,
    workgroupSize,
    bindGroup: primary.bindGroup,
  };
}

export interface PendingBatch {
  slot: number;
  startIndex: number;
  count: number;
  compact: boolean;
}

export function enqueueFilterBatch(
  ctx: GpuContext,
  slot: number,
  intermediateSk: Uint8Array,
  startIndex: number,
  count: number,
  params: VanityParams,
  matchAll = false,
  debugStage = 0,
): PendingBatch {
  if (count > ctx.maxBatch) {
    throw new Error(`batch count ${count} exceeds max ${ctx.maxBatch}`);
  }
  const frame = ctx.frames[slot];
  if (!frame) {
    throw new Error(`invalid GPU frame ${slot}`);
  }
  const compact = isPrefixCompact(params, matchAll);
  writeParams(ctx.device, frame.paramsBuffer, startIndex, count, params, matchAll, debugStage);
  ctx.device.queue.writeBuffer(ctx.skBuffer, 0, intermediateSk);
  ctx.device.queue.writeBuffer(frame.hitCountBuffer, 0, new Uint32Array([0, 0, 0, 0]));

  const workgroups = Math.ceil(count / ctx.workgroupSize);
  const encoder = ctx.device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(ctx.pipeline);
  pass.setBindGroup(0, frame.bindGroup);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  encoder.copyBufferToBuffer(frame.hitCountBuffer, 0, frame.hitCountReadBuffer, 0, 16);
  encoder.copyBufferToBuffer(frame.hashesBuffer, 0, frame.hashesReadBuffer, 0, count * HASH_STRIDE);
  ctx.device.queue.submit([encoder.finish()]);
  return { slot, startIndex, count, compact };
}

export async function collectFilterBatch(ctx: GpuContext, pending: PendingBatch): Promise<GpuHit[]> {
  const frame = ctx.frames[pending.slot];
  if (!frame) {
    throw new Error(`invalid GPU frame ${pending.slot}`);
  }
  const timeoutMs = Math.max(60000, pending.count * 4);
  const mapped = frame.hashesReadBuffer.mapAsync(GPUMapMode.READ);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("GPU dispatch timed out")), timeoutMs);
  });
  await Promise.race([mapped, timeout]);
  let hitCount = pending.count;
  if (pending.compact) {
    await frame.hitCountReadBuffer.mapAsync(GPUMapMode.READ);
    hitCount = new Uint32Array(frame.hitCountReadBuffer.getMappedRange().slice(0, 4))[0] ?? 0;
    frame.hitCountReadBuffer.unmap();
  }
  const hashBytes = new Uint8Array(
    frame.hashesReadBuffer.getMappedRange().slice(0, hitCount * HASH_STRIDE),
  );
  frame.hashesReadBuffer.unmap();
  return parseHashes(hashBytes, pending.startIndex, hitCount);
}

export async function runFilterBatch(
  ctx: GpuContext,
  intermediateSk: Uint8Array,
  startIndex: number,
  count: number,
  params: VanityParams,
  matchAll = false,
  debugStage = 0,
): Promise<GpuHit[]> {
  const pending = enqueueFilterBatch(
    ctx,
    0,
    intermediateSk,
    startIndex,
    count,
    params,
    matchAll,
    debugStage,
  );
  return collectFilterBatch(ctx, pending);
}

export async function benchmarkGpu(
  ctx: GpuContext,
  samples = 64,
): Promise<GpuBenchmarkResult> {
  const params: VanityParams = { prefix: "a", suffix: null, hrp: "xch" };
  const intermediateSk = crypto.getRandomValues(new Uint8Array(32));
  const batch = Math.min(ctx.maxBatch, samples);
  await runFilterBatch(ctx, intermediateSk, 0, batch, params);
  let processed = 0;
  const started = performance.now();
  let slot = 0;
  let pending: PendingBatch | null = null;
  while (processed < samples) {
    const count = Math.min(batch, samples - processed);
    const next = enqueueFilterBatch(ctx, slot, intermediateSk, processed, count, params);
    processed += count;
    slot ^= 1;
    if (pending) {
      await collectFilterBatch(ctx, pending);
    }
    pending = next;
  }
  if (pending) {
    await collectFilterBatch(ctx, pending);
  }
  const elapsedSec = (performance.now() - started) / 1000;
  return {
    adapter: ctx.adapter,
    samples,
    elapsedSec,
    keysPerSec: elapsedSec > 0 ? samples / elapsedSec : 0,
  };
}

export function formatAdapterLabel(adapter: GpuAdapterLabel): string {
  return adapter.description || adapter.device || adapter.vendor || "WebGPU adapter";
}

function readAdapterLabel(adapter: GPUAdapter): GpuAdapterLabel {
  const info = adapter.info;
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
}

export async function crossCheckGpu(ctx: GpuContext, sampleCount = 1): Promise<void> {
  const intermediateSk = new Uint8Array(32).fill(0x11);
  const params: VanityParams = { prefix: null, suffix: null, hrp: "xch" };
  const hits = await runFilterBatch(ctx, intermediateSk, 0, sampleCount, params, true);
  if (hits.length !== sampleCount) {
    throw new Error(`self-test expected ${sampleCount} hits, got ${hits.length}`);
  }
  for (const hit of hits) {
    const verified = verifyGpuHit(intermediateSk, hit.index, "xch", hit.puzzleHash);
    if (verified.index !== hit.index) {
      throw new Error("self-test index mismatch");
    }
  }
}

export function verifyAndSelectHit(
  intermediateSk: Uint8Array,
  hits: GpuHit[],
  params: VanityParams,
): VerifiedHit | null {
  for (const hit of hits) {
    const address = encodeBech32m(params.hrp, hit.puzzleHash);
    if (!addressMatches(address, params)) {
      continue;
    }
    return verifyGpuHit(intermediateSk, hit.index, params.hrp, hit.puzzleHash);
  }
  return null;
}

function writeParams(
  device: GPUDevice,
  paramsBuffer: GPUBuffer,
  startIndex: number,
  count: number,
  params: VanityParams,
  matchAll: boolean,
  debugStage: number,
): void {
  const buf = new ArrayBuffer(PARAMS_BYTES);
  const u32 = new Uint32Array(buf);
  u32[0] = startIndex >>> 0;
  u32[1] = count >>> 0;
  u32[2] = hrpKind(params.hrp);
  const prefix = params.prefix ? charsetValues(params.prefix) : [];
  const suffix = params.suffix ? charsetValues(params.suffix) : [];
  u32[3] = prefix.length;
  u32[4] = suffix.length;
  u32[5] = matchAll ? 1 : 0;
  u32[6] = 384;
  u32[7] = debugStage >>> 0;
  for (let i = 0; i < prefix.length; i++) {
    u32[8 + i] = prefix[i]!;
  }
  for (let i = 0; i < suffix.length; i++) {
    u32[72 + i] = suffix[i]!;
  }
  device.queue.writeBuffer(paramsBuffer, 0, buf);
}

function hrpKind(hrp: Hrp): number {
  switch (hrp) {
    case "xch":
      return 0;
    case "txch":
      return 1;
    default: {
      const exhaustive: never = hrp;
      throw new Error(`unsupported hrp ${exhaustive}`);
    }
  }
}

function resolveTableUrl(tableUrl = DEFAULT_TABLE_URL): string {
  return new URL(tableUrl, document.baseURI).toString();
}

function isPrefixCompact(params: VanityParams, matchAll: boolean): boolean {
  return !matchAll && params.prefix != null && params.suffix == null;
}

function parseHashes(bytes: Uint8Array, _startIndex: number, count: number): GpuHit[] {
  const hits: GpuHit[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    const offset = i * HASH_STRIDE;
    hits.push({
      index: view.getUint32(offset, true) >>> 0,
      puzzleHash: bytes.slice(offset + HASH_INDEX_BYTES, offset + HASH_STRIDE),
    });
  }
  return hits;
}
