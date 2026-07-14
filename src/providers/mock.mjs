export async function chatWithMock(modelRef, messages, options = {}) {
  await sleep(60, options.signal);
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
      "Final review: verify billing and credit spend only after successful generation, protect privacy boundaries, enforce idempotency against replay and double-spend, and add concurrency and failure-path tests.",
    finalizer:
      "Final: route the request through a small specialist, verify the draft against billing/privacy invariants, then produce a concise patched plan with tests.",
  };

  const content = contentByRole[role];
  if (options.stream === true && typeof options.onToken === "function") {
    for (const chunk of chunkText(content, 18)) {
      await sleep(15, options.signal);
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

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("Request aborted."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("Request aborted."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function chunkText(text, size) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
