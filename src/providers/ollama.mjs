export async function chatWithOllama(modelRef, messages, options = {}) {
  const baseUrl = String(modelRef.provider.baseUrl || "http://localhost:11434").replace(/\/+$/g, "");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: modelRef.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.2,
        num_predict: options.maxTokens ?? 1200,
      },
    }),
    signal: options.signal,
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw new Error(`${modelRef.providerName}/${modelRef.model} failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return {
    content: json?.message?.content || "",
    usage: ollamaUsage(json),
    raw: json,
  };
}

function ollamaUsage(json) {
  if (!json) return null;
  return {
    prompt_tokens: json.prompt_eval_count ?? null,
    completion_tokens: json.eval_count ?? null,
    total_tokens: (json.prompt_eval_count || 0) + (json.eval_count || 0) || null,
  };
}
