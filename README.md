# vanity-chia

Chia vanity address generator: CPU CLI, optional CUDA acceleration, and a standalone WebGPU browser app.

Generates standard Chia addresses (`xch1…` / `txch1…`) matching a **prefix** (after `xch1`) and/or **suffix** (end of the address).

Prefix and suffix use the bech32 charset only: `qpzry9x8gf2tvdw0s3jn54khce6mua7l`.

## Recovery

| Path | How the address is derived | How to recover |
|------|----------------------------|----------------|
| CPU CLI | Chia hardened path `m/12381/8444/2/<index>` | Import the printed mnemonic into a Chia wallet. The match is at the printed HD path. |
| CUDA `--gpu` | GPU-native (not Chia HD) | Save the printed **hex secret key**. The printed mnemonic does not recreate this address in a normal Chia wallet. |
| WebGPU app | Same GPU-native scheme as CUDA | Save the displayed hex secret key. |

GPU and WebGPU results are spendable standard Chia addresses. They are not portable through Chia's mnemonic/index wallet path.

## Build (CLI)

Requires Rust 1.77+.

```bash
# CPU only
cargo build --release -p vanity-chia

# With CUDA (needs CUDA toolkit + nvcc, rebuild on the GPU you will run on)
cargo build --release -p vanity-chia --features gpu

# Optional: override fixed-base window size (default: 6)
VANITY_FIXED_BASE_WINDOW_BITS=5 cargo build --release -p vanity-chia --features gpu

# Force a CPU-only build even if nvcc is installed
VANITY_FORCE_NO_CUDA=1 cargo build --release -p vanity-chia --features gpu
```

The CUDA kernel is compiled with `-arch=native`, so a binary built on one NVIDIA GPU may not run on another. Rebuild on the machine that will search.

Install from a clone:

```bash
cargo install --path crates/vanity-cli
cargo install --path crates/vanity-cli --features gpu
```

## Usage

```bash
# Prefix only
cargo run --release -p vanity-chia -- --prefix cafe

# Suffix only
cargo run --release -p vanity-chia -- --suffix 0s3j

# Both prefix and suffix
cargo run --release -p vanity-chia -- --prefix ca --suffix fe

# Testnet
cargo run --release -p vanity-chia -- --hrp txch --prefix abc

# GPU search (requires --features gpu build)
cargo run --release -p vanity-chia --features gpu -- --gpu --prefix ab

# Two matches
cargo run --release -p vanity-chia -- --prefix ab --count 2

# Benchmark
cargo run --release -p vanity-chia -- --benchmark --benchmark-samples 5000
cargo run --release -p vanity-chia --features gpu -- --benchmark --gpu

# Validate GPU filter matches CPU (requires CUDA build + GPU)
cargo run --release -p vanity-chia --features gpu -- --validate-gpu --validate-samples 10000
```

## Options

| Flag | Description |
|------|-------------|
| `--prefix` | Base32 chars after `xch1` (`qpzry9x8gf2tvdw0s3jn54khce6mua7l`) |
| `--suffix` | Base32 chars at end of address |
| `--hrp` | `xch` (mainnet) or `txch` (testnet) |
| `--count` | Number of matches to find (default: 1) |
| `--threads` | CPU threads (default: num CPUs) |
| `--batch-size` | Indices per batch (default: 100000) |
| `--gpu` | Use CUDA acceleration |
| `--gpu-batch` | GPU batch size (default: 1048576) |
| `--benchmark` | Print keys/sec and exit |
| `--benchmark-samples` | Benchmark sample size (default: 10000) |
| `--validate-gpu` | Check GPU filter against CPU (requires CUDA) |
| `--validate-samples` | Validation sample size (default: 10000) |
| `--json` | JSON output |
| `--quiet` | Suppress progress output |
| `--output` | Write results to file (mode `0600` on Unix) |

When CUDA is missing at build or runtime, `--gpu` errors out. There is no silent CPU fallback.

## WebGPU (browser)

Standalone TypeScript + WGSL app in [`webgpu/`](webgpu/). It does **not** use the Rust/CUDA crates. Derivation is the same GPU-native scheme as `--gpu`, so keys are recovered from the hex secret key, not a Chia mnemonic.

Throughput is much lower than the CUDA CLI. Short prefixes (1–2 characters) are the realistic target.

```bash
cd webgpu
npm install
npm run generate-table   # writes public/g1_table.bin; skip if the file is already present
npm test
npm run dev
```

Needs a WebGPU browser (Chrome/Edge, or Firefox with WebGPU enabled) and Node.js 20+. The page stays on your machine; there is no backend. See [`webgpu/README.md`](webgpu/README.md) for self-test and security notes.

## Architecture

- **vanity-core**: Chia key derivation (`m/12381/8444/2/<index>`), synthetic key, standard puzzle hash, bech32m encoding, CPU search
- **vanity-gpu**: GPU-native per-index secret derivation, fixed-base BLS12-381 public key generation, synthetic key, puzzle hash, bech32m encode, and prefix/suffix filtering; CPU verifies all GPU hits
- **vanity-cli**: CLI binary
- **webgpu/**: in-browser search (WGSL compute + JS verification)

The CUDA build generates a fixed-base BLS12-381 table at compile time. The default 6-bit window came from local benchmarking on an RTX 5090. Override with `VANITY_FIXED_BASE_WINDOW_BITS=2..6` before building.

## Security

- Mnemonics and secret keys are live wallet secrets — run offline when possible
- GPU hits are verified on CPU before display; WebGPU hits are verified in JS
- GPU-native output is not Chia mnemonic/index portable. Save the printed `SECRET KEY`
- Use `--output` for saving CLI results; the file is created with mode `0600` on Unix
- See [SECURITY.md](SECURITY.md)

## Difficulty

Each constrained base32 character adds ~5 bits (~1/32 of the search space). Estimated trials ≈ `32^(prefix_len + suffix_len)`.

| Constrained chars | ~trials |
|-------------------|---------|
| 1 | 32 |
| 2 | 1,024 |
| 3 | 32,768 |
| 4 | 1,048,576 |
| 5 | 33,554,432 |
| 6 | 1,073,741,824 |

## License

MIT. See [LICENSE](LICENSE).
