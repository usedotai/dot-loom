import { chatWithMock } from "./mock.mjs";
import { chatWithOllama } from "./ollama.mjs";
import { chatWithOpenAICompatible } from "./openai-compatible.mjs";

export async function chat(config, role, messages, options = {}) {
  const { resolveModelRef } = await import("../config.mjs");
  const modelRef = resolveModelRef(config, role);
  return chatResolvedModelRef(modelRef, messages, { ...options, role });
}

export async function chatModelRef(config, modelRefString, messages, options = {}) {
  const { resolveRef } = await import("../config.mjs");
  const modelRef = resolveRef(config, modelRefString);
  return chatResolvedModelRef(modelRef, messages, options);
}

async function chatResolvedModelRef(modelRef, messages, options = {}) {
  const providerType = modelRef.provider.type || "openai-compatible";
  const started = Date.now();

  let result;
  if (providerType === "mock") {
    result = await chatWithMock(modelRef, messages, options);
  } else if (providerType === "ollama") {
    result = await chatWithOllama(modelRef, messages, options);
  } else if (providerType === "openai-compatible" || providerType === "dot") {
    result = await chatWithOpenAICompatible(modelRef, messages, options);
  } else {
    throw new Error(`Unsupported provider type "${providerType}" for ${modelRef.providerName}.`);
  }

  return {
    ...result,
    role: options.role || modelRef.model,
    provider: modelRef.providerName,
    model: modelRef.model,
    modelRef: modelRef.ref,
    elapsedMs: Date.now() - started,
  };
}
