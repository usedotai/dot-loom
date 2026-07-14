export async function chatWithOpenAICompatible(modelRef, messages, options = {}) {
  const baseUrl = normalizeBaseUrl(modelRef.provider.baseUrl);
  const apiKey = modelRef.provider.apiKey;
  if (!baseUrl) throw new Error(`Provider "${modelRef.providerName}" is missing baseUrl.`);
  if (!apiKey && modelRef.provider.auth !== "none") {
    throw new Error(`Provider "${modelRef.providerName}" is missing apiKey. Use "env:KEY" in config.`);
  }

  const body = {
    model: modelRef.model,
    messages,
    temperature: options.temperature ?? 0.2,
    stream: options.stream === true,
  };
  if (Number.isFinite(options.maxTokens) && options.maxTokens > 0) {
    body.max_tokens = options.maxTokens;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(modelRef.provider.headers || {}),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (options.stream === true && response.ok) {
    return streamOpenAICompatible(response, options);
  }

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!response.ok) {
    const detail = json?.error?.message || text.slice(0, 500);
    throw new Error(`${modelRef.providerName}/${modelRef.model} failed: ${response.status} ${detail}`);
  }

  const content = json?.choices?.[0]?.message?.content;
  return {
    content: typeof content === "string" ? content : JSON.stringify(content ?? ""),
    usage: json?.usage || null,
    payment: json?.dot_parameters?.agent_api_payment || null,
    raw: json,
  };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/g, "");
}

async function streamOpenAICompatible(response, options = {}) {
  if (!response.body) {
    return { content: "", usage: null, raw: { streamed: true, empty: true } };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let thinking = "";
  let usage = null;
  let payment = null;
  const frames = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      processSsePart(part);
    }
  }

  if (buffer.trim()) processSsePart(buffer);

  return {
    content,
    thinking: thinking || null,
    usage,
    payment,
    raw: { streamed: true, frames: frames.length },
  };

  function processSsePart(part) {
    const dataLines = part
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (!dataLines.length) return;
    const data = dataLines.join("\n");
    if (data === "[DONE]") {
      options.onFrame?.({ type: "done" });
      return;
    }

    let frame;
    try {
      frame = JSON.parse(data);
    } catch {
      options.onFrame?.({ type: "malformed", data });
      return;
    }
    frames.push(frame);

    if (frame.usage) usage = frame.usage;
    if (frame.dot_parameters?.agent_api_payment) payment = frame.dot_parameters.agent_api_payment;
    if (frame.privacy) options.onFrame?.({ type: "privacy", privacy: frame.privacy });
    if (frame.dot_parameters?.agent_api_payment) {
      options.onFrame?.({ type: "payment", payment: frame.dot_parameters.agent_api_payment });
    }

    for (const choice of frame.choices || []) {
      const delta = choice.delta || {};
      for (const key of ["thinking", "reasoning", "reasoning_content", "thought"]) {
        if (typeof delta[key] === "string" && delta[key]) {
          thinking += delta[key];
          options.onThinking?.(delta[key]);
        }
      }
      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        options.onToken?.(delta.content);
      }
    }
  }
}
