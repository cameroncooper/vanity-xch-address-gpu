# Security

This project prints live wallet secrets (mnemonics and/or raw BLS secret keys). Treat CLI output, JSON dumps, and the WebGPU page the same way you would a seed phrase.

## Handling results

- Run the CLI and the WebGPU app locally, offline when possible.
- Prefer `--output` so the file is created with mode `0600` on Unix. Do not commit result files.
- Never paste a mnemonic or secret key into an issue, chat, or screenshot.
- GPU and WebGPU hits use a GPU-native derivation. Recover those addresses from the printed hex secret key, not from a Chia mnemonic/index path.

## Reporting a vulnerability

If you find a key-derivation, matching, or secret-handling bug, do not open a public issue with a working exploit or a live key. Describe the affected path (CPU, CUDA, or WebGPU) and how to reproduce with a throwaway test mnemonic.
