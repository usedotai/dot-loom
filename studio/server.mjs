import http from "node:http";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer as createViteServer } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const dotRoot = await resolveDotRoot(rootDir);
const cliPath = path.join(dotRoot, "src", "cli.mjs");
const host = process.env.HOST || "127.0.0.1";
const configs = {
  mock: path.join(dotRoot, "examples", "mock.config.json"),
  dot: path.join(dotRoot, "examples", "dot-code.config.json"),
};

const vite = await createViteServer({
  root: rootDir,
  appType: "spa",
  server: {
    host,
    middlewareMode: true,
  },
});

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/loom/status") {
      sendJson(res, {
        ok: true,
        dotApiKey: Boolean(process.env.DOT_API_KEY),
        env: {
          DOT_API_KEY: Boolean(process.env.DOT_API_KEY),
          OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
          OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
        },
        configs: [...Object.keys(configs), "byok"],
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/loom/run") {
      await handleRun(req, res);
      return;
    }

    vite.middlewares(req, res);
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, { error: error.message }, 500);
    } else {
      res.end();
    }
  }
});

server.listen(Number(process.env.PORT || 3955), host, () => {
  const port = server.address().port;
  console.log(`Dot Loom Studio`);
  console.log(`  Local:   http://localhost:${port}/`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(`  Network: http://${host}:${port}/`);
  }
  console.log(`  CLI:     ${cliPath}`);
});

async function handleRun(req, res) {
  const body = await readJson(req);
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new Error("Missing prompt.");
  if (prompt.length > 8000) throw new Error("Prompt is too long for the local studio bridge.");

  const configKey = ["dot", "mock", "byok"].includes(body.config) ? body.config : "mock";
  const pipeline = ["code-review", "research", "general"].includes(body.pipeline) ? body.pipeline : "general";
  const mode = body.mode === "adaptive" ? "adaptive" : "fixed";
  const policy = ["lean", "balanced", "strict"].includes(body.policy) ? body.policy : "balanced";
  const temperature = Number.isFinite(Number(body.temperature)) ? String(Number(body.temperature)) : "0.2";
  const maxTokens = Number(body.maxTokens);
  const tempConfig = configKey === "byok" ? await createByokConfig(body.byok) : null;
  const configPath = tempConfig?.path || configs[configKey];

  const args = [
    cliPath,
    "run",
    prompt,
    "--config",
    configPath,
    "--pipeline",
    pipeline,
    "--temperature",
    temperature,
  ];
  if (mode === "adaptive") args.push("--adaptive", "--policy", policy);
  if (Number.isFinite(maxTokens) && maxTokens > 0) args.push("--max-tokens", String(Math.min(maxTokens, 12000)));

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const child = spawn(process.execPath, args, {
    cwd: dotRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const commandConfig = tempConfig
    ? `tmp/${path.basename(tempConfig.dir)}/loom.byok.config.json`
    : path.relative(dotRoot, configs[configKey]);

  sendEvent(res, "start", {
    config: configKey,
    provider: tempConfig?.provider || configKey,
    mode,
    policy: mode === "adaptive" ? policy : null,
    pipeline,
    command: ["node", "src/cli.mjs", "run", JSON.stringify(prompt), "--config", commandConfig, "--pipeline", pipeline, mode === "adaptive" ? "--adaptive" : "", mode === "adaptive" ? `--policy ${policy}` : ""]
      .filter(Boolean)
      .join(" "),
  });

  req.on("close", () => {
    if (!child.killed) child.kill("SIGTERM");
  });

  child.stdout.on("data", (chunk) => sendEvent(res, "stdout", { text: chunk.toString("utf8") }));
  child.stderr.on("data", (chunk) => sendEvent(res, "stderr", { text: chunk.toString("utf8") }));
  child.on("error", (error) => sendEvent(res, "error", { message: error.message }));
  child.on("close", (code, signal) => {
    sendEvent(res, "close", { code, signal });
    res.end();
    if (tempConfig) {
      rm(tempConfig.dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function createByokConfig(byok = {}) {
  const provider = sanitizeProvider(byok.provider);
  const models = sanitizeModels(byok.models);
  const dir = await mkdtemp(path.join(os.tmpdir(), "dot-loom-"));
  const file = path.join(dir, "loom.byok.config.json");
  const config = {
    name: `Dot Loom BYOK - ${provider.label}`,
    providers: {
      byok: provider.config,
    },
    models: Object.fromEntries(
      Object.entries(models).map(([role, model]) => [role, `byok/${model}`]),
    ),
    workers: Object.fromEntries(
      Object.entries(models).map(([role, model]) => [
        role,
        {
          model: `byok/${model}`,
          label: `${provider.label} ${role}`,
          capabilities: capabilitiesForRole(role),
          cost: provider.type === "mock" ? "none" : "byok",
          latency: "provider",
          notes: "Generated by the local Dot Loom Studio bridge. API keys are not written to the repository.",
        },
      ]),
    ),
  };
  await writeFile(file, JSON.stringify(config, null, 2), "utf8");
  return { path: file, dir, provider: provider.label };
}

function sanitizeProvider(raw = {}) {
  const type = ["mock", "ollama", "openai-compatible", "dot"].includes(raw.type)
    ? raw.type
    : "openai-compatible";
  const label = String(raw.label || raw.id || type).replace(/[^\w .:-]/g, "").slice(0, 48) || type;

  if (type === "mock") return { label: "Mock", type, config: { type: "mock" } };

  if (type === "ollama") {
    return {
      label,
      type,
      config: {
        type: "ollama",
        baseUrl: String(raw.baseUrl || "http://localhost:11434").replace(/\/+$/g, ""),
      },
    };
  }

  const baseUrl = String(raw.baseUrl || "").replace(/\/+$/g, "");
  if (!baseUrl) throw new Error("BYOK provider is missing baseUrl.");

  const apiKey = String(raw.apiKey || "").trim();
  const envKey = String(raw.envKey || "").trim().replace(/[^\w]/g, "");
  if (!apiKey && !envKey) throw new Error("BYOK provider needs an API key or env key.");

  const headers = raw.headers && typeof raw.headers === "object"
    ? Object.fromEntries(
        Object.entries(raw.headers)
          .filter(([key, value]) => typeof key === "string" && typeof value === "string")
          .map(([key, value]) => [key.slice(0, 80), value.slice(0, 300)]),
      )
    : {};

  return {
    label,
    type,
    config: {
      type,
      baseUrl,
      apiKey: apiKey || `env:${envKey}`,
      ...(Object.keys(headers).length ? { headers } : {}),
    },
  };
}

function sanitizeModels(raw = {}) {
  const roles = ["router", "drafter", "critic", "finalizer"];
  const out = {};
  for (const role of roles) {
    const model = String(raw[role] || "").trim();
    if (!model) throw new Error(`BYOK model missing for ${role}.`);
    if (model.length > 160) throw new Error(`BYOK model id too long for ${role}.`);
    out[role] = model.replace(/^byok\//, "");
  }
  return out;
}

function capabilitiesForRole(role) {
  const map = {
    router: ["routing", "classification", "budgeting"],
    drafter: ["drafting", "analysis", "implementation"],
    critic: ["verification", "privacy", "security", "edge-cases"],
    finalizer: ["synthesis", "final-answer"],
  };
  return map[role] || ["general"];
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 128_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
    req.on("error", reject);
  });
}

async function resolveDotRoot(studioRoot) {
  const explicit = process.env.DOT_LOOM_ROOT;
  const candidates = [
    explicit && path.resolve(explicit),
    path.resolve(studioRoot, ".."),
    path.resolve(studioRoot, "..", "dot-loom"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "src", "cli.mjs"), constants.R_OK);
      return candidate;
    } catch {
      // Try the next known layout.
    }
  }

  throw new Error("Cannot find Dot Loom CLI. Set DOT_LOOM_ROOT to the repository root.");
}
