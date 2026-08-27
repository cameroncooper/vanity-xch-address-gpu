# WebGPU vanity (reference)

Standalone TypeScript + WGSL Chia vanity search. Copy this directory into your own project and wire it to your UI. It is not a hosted service and does not need to be iframed.

Derivation is GPU-native (`SHA256("vanity-chia-gpu-v1" || intermediate_sk || index)`). Results are spendable standard `xch1` / `txch1` addresses, but **not** Chia mnemonic/index portable. Persist the hex secret key.

## Requirements

- HTTPS (or `localhost`) — WebGPU is a secure-context API
- A browser with WebGPU
- Node.js 20+ to install deps and optionally regenerate `g1_table.bin`

## Demo app

```bash
cd webgpu
npm install
npm test
npm run dev
```

## Use as a library in your site

1. Copy `webgpu/` (or vendor `src/`, `public/g1_table.bin`, and `package.json` deps).
2. Serve `g1_table.bin` as a static file next to your page (Vite: put it in `public/`).
3. Import the API and call it from your code:

```ts
import {
  bytesToHex,
  createGpuContext,
  parseVanityParams,
  searchVanity,
} from "./webgpu/src/index.ts";

const params = parseVanityParams("q", "", "xch");
const ctx = await createGpuContext({
  tableUrl: "/g1_table.bin", // or any same-origin path
});
const stop = new AbortController();
const hit = await searchVanity({
  params,
  ctx,
  signal: stop.signal,
  onProgress: ({ keysChecked, keysPerSec, etaSec }) => {
    console.log(keysChecked, keysPerSec, etaSec);
  },
});
// hit.address, bytesToHex(hit.secretKey), hit.index
```

`createGpuContext` also accepts `tableBytes` if you loaded the table yourself.

Shaders are bundled through Vite `?raw` imports. Any bundler that can import `.wgsl` as text (or a copy of that setup) works. There is no backend.

`npm run generate-table` rebuilds `public/g1_table.bin` after you change window size in `scripts/generate-table.mjs`.

## Compare to CUDA on the same GPU

Run the CLI benchmark and this page on the same machine. Chrome should pick the discrete NVIDIA GPU (`powerPreference: "high-performance"`). Confirm the adapter name in the status line, then click **Benchmark**.

```bash
# CUDA (same machine)
cargo run --release -p vanity-chia --features gpu -- --benchmark --gpu

# WebGPU
cd webgpu && npm run dev
# open the URL, click Benchmark (or ?benchmark=1)
```

This compares implementations, not just hardware. The WGSL path is the same algorithm but much slower than the CUDA kernel.

## Security

- Keys exist in page JS/GPU memory. Anyone who ships this page can change the JS and steal them.
- Do not log or send the secret key.
- GPU-native keys are recovered from the hex secret key, not a Chia mnemonic.
