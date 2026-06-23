const PIPELINES = {
  general: {
    name: "general",
    instruction:
      "Use a balanced workflow. Preserve the user's intent, identify hidden assumptions, then produce a direct final answer.",
  },
  "code-review": {
    name: "code-review",
    instruction:
      "Review like a senior engineer. Prioritize security, billing correctness, privacy boundaries, race conditions, edge cases, and missing tests.",
  },
  research: {
    name: "research",
    instruction:
      "Treat this as technical research. Separate claims from evidence, identify uncertain assumptions, and produce a concise synthesis.",
  },
};

export function getPipeline(name = "general") {
  return PIPELINES[name] || PIPELINES.general;
}

export function listPipelines() {
  return Object.values(PIPELINES);
}
