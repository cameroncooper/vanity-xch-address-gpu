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

export const WORKGROUP_SIZE = 64;
export const DEFAULT_BATCH = 32;
export const HASH_STRIDE = 32;
export const DEFAULT_TABLE_URL = "g1_table.bin";
const PARAMS_BYTES = 544;

export interface GpuInitOptions {
  /** Same-origin URL of the 6-bit G1 table. Default: `g1_table.bin` relative to the page. */
  tableUrl?: string;
  /** Preloaded table bytes. Skips `fetch` when set. */
  tableBytes?: Uint8Array;
  entryPoint?: string;
  batchSize?: number;
}

export interface GpuHit {
  index: number;
  puzzleHash: Uint8Array;
}

export interface GpuContext {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
  tableBuffer: GPUBuffer;
  paramsBuffer: GPUBuffer;
  skBuffer: GPUBuffer;
  hitCountBuffer: GPUBuffer;
  hashesBuffer: GPUBuffer;
  hashesReadBuffer: GPUBuffer;
  maxBatch: number;
  bindGroup: GPUBindGroup;
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

export async function createGpuContext(options: GpuInitOptions = {}): Promise<GpuContext> {
  const entryPoint = options.entryPoint ?? "hash_kernel";
  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  if (!("gpu" in navigator) || !navigator.gpu) {
    throw new Error("WebGPU is not available in this browser");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No WebGPU adapter found");
  }
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

  const paramsBuffer = device.createBuffer({
    size: PARAMS_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const skBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const hitCountBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const hashesBuffer = device.createBuffer({
    size: batchSize * HASH_STRIDE,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const hashesReadBuffer = device.createBuffer({
    size: batchSize * HASH_STRIDE,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
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
    compute: { module, entryPoint },
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
    device,
    pipeline,
    tableBuffer,
    paramsBuffer,
    skBuffer,
    hitCountBuffer,
    hashesBuffer,
    hashesReadBuffer,
    maxBatch: batchSize,
    bindGroup,
  };
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
  if (count > ctx.maxBatch) {
    throw new Error(`batch count ${count} exceeds max ${ctx.maxBatch}`);
  }
  writeParams(ctx, startIndex, count, params, matchAll, debugStage);
  ctx.device.queue.writeBuffer(ctx.skBuffer, 0, intermediateSk);
  ctx.device.queue.writeBuffer(ctx.hitCountBuffer, 0, new Uint32Array([0, 0, 0, 0]));

  const workgroups = Math.ceil(count / WORKGROUP_SIZE);
  const encoder = ctx.device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(ctx.pipeline);
  pass.setBindGroup(0, ctx.bindGroup);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  encoder.copyBufferToBuffer(ctx.hashesBuffer, 0, ctx.hashesReadBuffer, 0, count * HASH_STRIDE);
  ctx.device.queue.submit([encoder.finish()]);

  const done = ctx.device.queue.onSubmittedWorkDone();
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("GPU dispatch timed out")), 60000);
  });
  await Promise.race([done, timeout]);

  await ctx.hashesReadBuffer.mapAsync(GPUMapMode.READ);
  const hashBytes = new Uint8Array(ctx.hashesReadBuffer.getMappedRange().slice(0, count * HASH_STRIDE));
  ctx.hashesReadBuffer.unmap();
  return parseHashes(hashBytes, startIndex, count);
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
  ctx: GpuContext,
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
  ctx.device.queue.writeBuffer(ctx.paramsBuffer, 0, buf);
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

function parseHashes(bytes: Uint8Array, startIndex: number, count: number): GpuHit[] {
  const hits: GpuHit[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i * HASH_STRIDE;
    hits.push({
      index: (startIndex + i) >>> 0,
      puzzleHash: bytes.slice(offset, offset + HASH_STRIDE),
    });
  }
  return hits;
}
