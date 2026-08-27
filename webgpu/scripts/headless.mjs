#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "benchmark";
const timeoutMs = Number(process.env.WEBGPU_HEADLESS_TIMEOUT_MS ?? 300000);

const samples = process.env.WEBGPU_BENCH_SAMPLES ?? "10000";
const batch = process.env.WEBGPU_BENCH_BATCH ?? "262144";
const workgroup = process.env.WEBGPU_BENCH_WORKGROUP ?? "256";
const paths = {
  selftest: "/?selftest=1",
  benchmark: `/?benchmark=1&samples=${encodeURIComponent(samples)}&batch=${encodeURIComponent(batch)}&workgroup=${encodeURIComponent(workgroup)}`,
  smoke: "/?smoke=1",
};

function usage() {
  console.error("Usage: node scripts/headless.mjs [selftest|benchmark|smoke|URL]");
  process.exit(2);
}

if (mode === "-h" || mode === "--help") {
  usage();
}

const queryPath = paths[mode];
const explicitUrl = mode.startsWith("http://") || mode.startsWith("https://") ? mode : null;
if (!queryPath && !explicitUrl) {
  usage();
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 50; port += 1) {
    if (!(await canConnect(port))) {
      return port;
    }
  }
  throw new Error("No free TCP port found");
}

function waitForOutput(child, pattern, label, ms = 20000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      reject(new Error(`${label} did not become ready`));
    }, ms);
    const onData = (chunk) => {
      buf += String(chunk);
      if (pattern.test(buf)) {
        clearTimeout(timer);
        child.stdout?.off("data", onData);
        child.stderr?.off("data", onData);
        resolve(buf);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited with ${code}`));
    });
  });
}

async function startVite() {
  if (await canConnect(5173)) {
    return { url: "http://127.0.0.1:5173", child: null };
  }
  const port = await findFreePort(5173);
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForOutput(child, /Local:\s+http:\/\/127\.0\.0\.1/, "vite");
  return { url: `http://127.0.0.1:${port}`, child };
}

async function waitForPage(port) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch {
      // chrome still starting
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chrome page target did not start");
}

const children = [];
try {
  const vite = await startVite();
  if (vite.child) {
    children.push(vite.child);
  }
  const pageUrl = explicitUrl ?? `${vite.url}${queryPath}`;
  const debugPort = await findFreePort(9333);
  const chrome = spawn(
    "google-chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${debugPort}`,
      "--no-sandbox",
      "--enable-unsafe-webgpu",
      "--enable-webgpu-developer-features",
      "--enable-features=Vulkan,UseSkiaRenderer",
      "--use-angle=vulkan",
      "--disable-vulkan-surface",
      "--enable-dawn-features=allow_unsafe_apis,disable_adapter_blocklist",
      "--disable-dawn-features=disallow_unsafe_apis",
      "--ignore-gpu-blocklist",
      "--disable-gpu-sandbox",
      "--disable-software-rasterizer",
      "--no-first-run",
      "--ozone-platform=headless",
      `--user-data-dir=/tmp/vanity-webgpu-chrome-${debugPort}`,
      pageUrl,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        VK_ICD_FILENAMES: "/usr/share/vulkan/icd.d/nvidia_icd.json",
        VK_DRIVER_FILES: "/usr/share/vulkan/icd.d/nvidia_icd.json",
      },
    },
  );
  children.push(chrome);
  chrome.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  const wsUrl = await waitForPage(debugPort);
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
      console.error("console:", args);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      console.error("exception:", JSON.stringify(msg.params.exceptionDetails?.exception ?? msg.params));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  const call = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout calling ${method}`));
      }, 8000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  };

  await call("Page.enable");
  await call("Runtime.enable");

  const started = Date.now();
  let value = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await call("Runtime.evaluate", {
        expression: `(() => {
          const raw = document.documentElement.dataset.cli || "";
          return raw ? JSON.parse(raw) : {
            status: document.documentElement.dataset.selftest || "",
            gpu: document.querySelector("#gpu-status")?.textContent ?? "",
            error: document.querySelector("#form-error")?.textContent ?? "",
          };
        })()`,
        returnByValue: true,
      });
      value = result.result.value;
      if (value && (value.kind || value.status)) {
        break;
      }
    } catch (err) {
      console.error("evaluate failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!value || (!value.kind && !value.status)) {
    throw new Error(`Headless WebGPU timed out after ${timeoutMs}ms`);
  }
  console.log(JSON.stringify(value, null, 2));
  if (value.ok === false || value.status === "fail") {
    process.exitCode = 1;
  }
  ws.close();
} finally {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}
