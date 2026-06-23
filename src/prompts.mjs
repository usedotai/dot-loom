export function systemPrompt(role) {
  const prompts = {
    router:
      "You are Dot Loom's router. Classify the task, pick a pipeline, and explain the route briefly. Return compact JSON.",
    drafter:
      "You are Dot Loom's drafter. Produce a direct first-pass answer. Prioritize concrete details and avoid hedging.",
    critic:
      "You are Dot Loom's verifier. Find missing constraints, false assumptions, security issues, and weak reasoning. Be specific.",
    finalizer:
      "You are Dot Loom's finalizer. Merge the draft and critique into one clear final answer. Preserve useful nuance, remove noise.",
  };
  return prompts[role] || prompts.drafter;
}

export function roleMessages(role, userContent, context = "") {
  return [
    { role: "system", content: systemPrompt(role) },
    {
      role: "user",
      content: context ? `${context}\n\nTask:\n${userContent}` : userContent,
    },
  ];
}
