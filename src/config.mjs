import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadConfig(configPath = "examples/dot.config.json") {
  const path = resolve(process.cwd(), configPath);
  const raw = await readFile(path, "utf8");
  const config = JSON.parse(raw);
  validateConfig(config, path);
  return expandEnv(config);
}

function validateConfig(config, path) {
  if (!config || typeof config !== "object") {
    throw new Error(`Invalid config at ${path}: expected object.`);
  }
  if (!config.providers || typeof config.providers !== "object") {
    throw new Error(`Invalid config at ${path}: missing providers.`);
  }
  if (!config.models || typeof config.models !== "object") {
    throw new Error(`Invalid config at ${path}: missing models.`);
  }
  if (config.adaptive !== undefined) {
    if (!config.adaptive || typeof config.adaptive !== "object" || Array.isArray(config.adaptive)) {
      throw new Error(`Invalid config at ${path}: adaptive must be an object.`);
    }
    if (config.adaptive.policy && !["lean", "balanced", "strict"].includes(config.adaptive.policy)) {
      throw new Error(`Invalid config at ${path}: adaptive.policy must be lean, balanced, or strict.`);
    }
    for (const key of ["maxCalls", "maxCredits", "maxLatencyMs", "estimatedCreditsPerCall"]) {
      const value = config.adaptive[key];
      if (value !== undefined && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        throw new Error(`Invalid config at ${path}: adaptive.${key} must be a non-negative number.`);
      }
    }
  }
}

function expandEnv(value) {
  if (typeof value === "string" && value.startsWith("env:")) {
    const key = value.slice(4);
    return process.env[key] || "";
  }
  if (Array.isArray(value)) return value.map(expandEnv);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandEnv(item)]));
}

export function resolveModelRef(config, role) {
  const ref = config.models?.[role];
  if (!ref || typeof ref !== "string") {
    throw new Error(`Missing model ref for role "${role}".`);
  }
  return resolveRef(config, ref);
}

export function resolveRef(config, ref) {
  const index = ref.indexOf("/");
  if (index <= 0) {
    throw new Error(`Invalid model ref "${ref}". Use provider/model-id.`);
  }
  const providerName = ref.slice(0, index);
  const model = ref.slice(index + 1);
  const provider = config.providers?.[providerName];
  if (!provider) {
    throw new Error(`Unknown provider "${providerName}" for model ref "${ref}".`);
  }
  return { providerName, provider, model, ref };
}

export function getWorkerRegistry(config) {
  if (config.workers && typeof config.workers === "object") {
    return Object.fromEntries(
      Object.entries(config.workers).map(([id, worker]) => {
        const modelRef = typeof worker === "string" ? worker : worker.model;
        if (!modelRef) throw new Error(`Worker "${id}" is missing model.`);
        return [
          id,
          {
            id,
            label: worker.label || id,
            modelRef,
            capabilities: worker.capabilities || [],
            cost: worker.cost || "unknown",
            latency: worker.latency || "unknown",
            notes: worker.notes || "",
          },
        ];
      }),
    );
  }

  return Object.fromEntries(
    Object.entries(config.models || {}).map(([role, modelRef]) => [
      role,
      {
        id: role,
        label: role,
        modelRef,
        capabilities: defaultCapabilities(role),
        cost: role === "finalizer" ? "medium" : "low",
        latency: role === "finalizer" ? "medium" : "low",
        notes: "Derived from legacy models map.",
      },
    ]),
  );
}

function defaultCapabilities(role) {
  const map = {
    router: ["routing", "classification"],
    drafter: ["drafting", "implementation", "analysis"],
    critic: ["verification", "security", "privacy", "edge-cases"],
    finalizer: ["synthesis", "writing", "final-answer"],
  };
  return map[role] || ["general"];
}
