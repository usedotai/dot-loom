import { resolveModelRef } from "./config.mjs";
import { chat } from "./providers/index.mjs";
import { getPipeline } from "./pipelines/index.mjs";
import { roleMessages } from "./prompts.mjs";

export async function runFusion(config, input, options = {}) {
  const pipeline = getPipeline(options.pipeline);
  const trace = [];
  const started = Date.now();
  const task = `Pipeline: ${pipeline.name}\nInstruction: ${pipeline.instruction}\n\n${input}`;

  const router = await step(config, "router", roleMessages("router", task), trace, options);
  const draftContext = `Router output:\n${router.content}`;
  const draft = await step(config, "drafter", roleMessages("drafter", task, draftContext), trace, options);

  const criticContext = [
    `Router output:\n${router.content}`,
    `Draft answer:\n${draft.content}`,
    `Pipeline instruction:\n${pipeline.instruction}`,
  ].join("\n\n");
  const critic = await step(config, "critic", roleMessages("critic", task, criticContext), trace, options);

  const finalContext = [
    `Pipeline instruction:\n${pipeline.instruction}`,
    `Router output:\n${router.content}`,
    `Draft answer:\n${draft.content}`,
    `Verifier critique:\n${critic.content}`,
  ].join("\n\n");
  const final = await step(config, "finalizer", roleMessages("finalizer", task, finalContext), trace, options);

  return {
    pipeline: pipeline.name,
    answer: final.content,
    trace,
    metrics: summarize(trace, Date.now() - started),
  };
}

export async function runBaseline(config, input, options = {}) {
  const trace = [];
  const started = Date.now();
  const result = await step(config, "finalizer", roleMessages("finalizer", input), trace, options);
  return {
    pipeline: "baseline",
    answer: result.content,
    trace,
    metrics: summarize(trace, Date.now() - started),
  };
}

async function step(config, role, messages, trace, options) {
  const modelRef = resolveModelRef(config, role);
  options.onStepStart?.({ role, messages, modelRef: modelRef.ref, provider: modelRef.providerName, model: modelRef.model });
  const result = await chat(config, role, messages, {
    ...options,
    onToken: (token) => options.onToken?.({ role, token }),
    onThinking: (token) => options.onThinking?.({ role, token }),
    onFrame: (frame) => options.onFrame?.({ role, frame }),
  });
  trace.push({
    role,
    provider: result.provider,
    model: result.model,
    modelRef: result.modelRef,
    elapsedMs: result.elapsedMs,
    usage: result.usage,
    payment: result.payment || null,
  });
  options.onStepEnd?.({ role, result });
  return result;
}

function summarize(trace, elapsedMs) {
  const usage = trace.reduce(
    (sum, item) => {
      const u = item.usage || {};
      sum.promptTokens += Number(u.prompt_tokens || 0);
      sum.completionTokens += Number(u.completion_tokens || 0);
      sum.totalTokens += Number(u.total_tokens || 0);
      return sum;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );
  return {
    calls: trace.length,
    elapsedMs,
    ...usage,
  };
}
