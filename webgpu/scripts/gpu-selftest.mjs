#!/usr/bin/env node
import { spawn } from "node:child_process";

const url = process.argv[2] ?? "http://127.0.0.1:5173/?selftest=1";
const port = 9333;
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--enable-unsafe-webgpu",
    "--enable-webgpu-developer-features",
    "--ignore-gpu-blocklist",
    "--disable-gpu-sandbox",
    "--no-first-run",
    "--ozone-platform=headless",
    "--user-data-dir=/tmp/vanity-webgpu-chrome3",
    url,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

chrome.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

async function waitForPage() {
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

try {
  const wsUrl = await waitForPage();
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
  while (Date.now() - started < 180000) {
    try {
      const result = await call("Runtime.evaluate", {
        expression: `({
          status: document.documentElement.dataset.selftest || "",
          title: document.title,
          gpu: document.querySelector("#gpu-status")?.textContent ?? "",
          error: document.querySelector("#form-error")?.textContent ?? "",
          address: document.querySelector("#result-address")?.textContent ?? "",
          href: location.href,
        })`,
        returnByValue: true,
      });
      value = result.result.value;
      if (value?.status) {
        break;
      }
    } catch (err) {
      console.error("evaluate failed:", err instanceof Error ? err.message : err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(JSON.stringify(value, null, 2));
  if (value?.status !== "pass") {
    process.exitCode = 1;
  }
  ws.close();
} finally {
  chrome.kill("SIGTERM");
}
