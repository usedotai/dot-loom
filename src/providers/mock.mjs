export async function chatWithMock(modelRef, messages, options = {}) {
  await sleep(60);
  const prompt = messages.map((m) => m.content).join("\n").slice(0, 1200);
  const role = modelRef.ref.includes("router")
    ? "router"
    : modelRef.ref.includes("critic")
      ? "critic"
      : modelRef.ref.includes("finalizer")
        ? "finalizer"
        : "worker";

  const contentByRole = {
    router: JSON.stringify({
      route: prompt.toLowerCase().includes("code") || prompt.toLowerCase().includes("api") ? "code-review" : "general",
      complexity: "medium",
      reason: "Prompt mentions implementation/API risk.",
    }),
    worker:
      "Draft: identify auth boundaries, credit accounting, replay/double-spend guards, streaming behavior, and provider isolation.",
    critic:
      "Critique: verify the spend is committed only after successful generation, confirm idempotency keys, and test multi-tab vault sync.",
    finalizer:
      "Final: route the request through a small specialist, verify the draft against billing/privacy invariants, then produce a concise patched plan with tests.",
  };

  const content = contentByRole[role];
  if (options.stream === true && typeof options.onToken === "function") {
    for (const chunk of chunkText(content, 18)) {
      await sleep(15);
      options.onToken(chunk);
    }
  }
  return {
    content,
    usage: {
      prompt_tokens: Math.ceil(prompt.length / 4),
      completion_tokens: Math.ceil(content.length / 4),
      total_tokens: Math.ceil((prompt.length + content.length) / 4),
    },
    raw: { mock: true, role },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
