import { createHash } from "node:crypto";
import { getWorkerRegistry, resolveRef } from "./config.mjs";
import { chatModelRef } from "./providers/index.mjs";
import { getPipeline } from "./pipelines/index.mjs";

export async function runAdaptive(config, input, options = {}) {
  const pipeline = getPipeline(options.pipeline);
  const workers = getWorkerRegistry(config);
  const trace = [];
  const outputs = new Map();
  const started = Date.now();

  const routerWorker = pickWorker(workers, ["router", "planner", "finalizer"]);
  const route = await runWorkerStep(
    config,
    {
      id: "route",
      role: "router",
      workerId: routerWorker.id,
      workerRef: routerWorker.modelRef,
      subtask: "Classify the task, identify risk areas, and recommend the smallest useful workflow.",
      access: [],
    },
    {
      pipeline,
      input,
      workers,
      outputs,
      trace,
      options,
      system: "You are Dot Loom's adaptive router. Return compact routing notes, not the final answer.",
    },
  );
  outputs.set("route", route.content);

  const plan = buildPlan({ input, pipeline, route: route.content, workers });
  options.onWorkflowPlan?.({ plan, workers });

  for (const step of plan.steps) {
    const result = await runWorkerStep(config, step, {
      pipeline,
      input,
      workers,
      outputs,
      trace,
      options,
      system: workerSystemPrompt(step, workers[step.workerId]),
    });
    outputs.set(step.id, result.content);
  }

  const finalStep = plan.steps.at(-1);
  const answer = pickAnswer(finalStep ? outputs.get(finalStep.id) : "", outputs);
  const metrics = summarize(trace, Date.now() - started);
  const receipt = makeReceipt({ pipeline, plan, trace, metrics, answer });

  return {
    pipeline: `${pipeline.name}:adaptive`,
    answer,
    trace,
    metrics,
    workflow: {
      mode: "adaptive",
      route: route.content,
      plan,
      score: scoreAnswer(answer),
      receipt,
    },
  };
}

function buildPlan({ input, pipeline, route, workers }) {
  const profile = classify(input, pipeline.name, route);
  const steps = [];

  if (profile.simple) {
    const finalizer = pickWorker(workers, ["finalizer", "drafter", "critic"]);
    steps.push({
      id: "final",
      role: "finalizer",
      workerId: finalizer.id,
      workerRef: finalizer.modelRef,
      subtask: "Answer directly. Keep the result concise and useful.",
      access: ["route"],
    });
  } else if (profile.kind === "code-review") {
    const drafter = pickWorker(workers, ["drafter", "finalizer"]);
    const critic = pickWorker(workers, ["critic", "finalizer"]);
    const finalizer = pickWorker(workers, ["finalizer", "drafter"]);
    steps.push(
      {
        id: "draft",
        role: "drafter",
        workerId: drafter.id,
        workerRef: drafter.modelRef,
        subtask:
          "Produce a first-pass senior engineering review. Focus on concrete failure modes and implementation risk.",
        access: ["route"],
      },
      {
        id: "verify",
        role: "critic",
        workerId: critic.id,
        workerRef: critic.modelRef,
        subtask:
          "Audit the draft for billing bugs, privacy leaks, replay/double-spend issues, race conditions, and missing tests.",
        access: ["route", "draft"],
      },
      {
        id: "final",
        role: "finalizer",
        workerId: finalizer.id,
        workerRef: finalizer.modelRef,
        subtask:
          "Synthesize the final answer. Preserve high-severity findings, remove weak claims, and make the output actionable.",
        access: ["route", "draft", "verify"],
      },
    );
  } else if (profile.kind === "research") {
    const researcher = pickWorker(workers, ["drafter", "finalizer"]);
    const critic = pickWorker(workers, ["critic", "finalizer"]);
    const finalizer = pickWorker(workers, ["finalizer", "drafter"]);
    steps.push(
      {
        id: "research",
        role: "researcher",
        workerId: researcher.id,
        workerRef: researcher.modelRef,
        subtask: "Extract the strongest claims, evidence, unknowns, and technical implications.",
        access: ["route"],
      },
      {
        id: "challenge",
        role: "critic",
        workerId: critic.id,
        workerRef: critic.modelRef,
        subtask: "Challenge weak assumptions and separate verified claims from speculation.",
        access: ["route", "research"],
      },
      {
        id: "final",
        role: "finalizer",
        workerId: finalizer.id,
        workerRef: finalizer.modelRef,
        subtask: "Return a concise research synthesis with clear confidence boundaries.",
        access: ["route", "research", "challenge"],
      },
    );
  } else {
    const drafter = pickWorker(workers, ["drafter", "finalizer"]);
    const critic = pickWorker(workers, ["critic", "finalizer"]);
    const finalizer = pickWorker(workers, ["finalizer", "drafter"]);
    steps.push(
      {
        id: "draft",
        role: "drafter",
        workerId: drafter.id,
        workerRef: drafter.modelRef,
        subtask: "Produce a useful first-pass answer with concrete assumptions.",
        access: ["route"],
      },
      {
        id: "verify",
        role: "critic",
        workerId: critic.id,
        workerRef: critic.modelRef,
        subtask: "Find missing constraints, false assumptions, and privacy or safety issues.",
        access: ["route", "draft"],
      },
      {
        id: "final",
        role: "finalizer",
        workerId: finalizer.id,
        workerRef: finalizer.modelRef,
        subtask: "Merge the useful draft and verifier notes into the final response.",
        access: ["route", "draft", "verify"],
      },
    );
  }

  return {
    kind: profile.kind,
    complexity: profile.simple ? "low" : profile.complexity,
    steps,
  };
}

async function runWorkerStep(config, step, context) {
  const worker = context.workers[step.workerId];
  if (!worker) throw new Error(`Unknown worker "${step.workerId}" in adaptive plan.`);
  const resolved = resolveRef(config, worker.modelRef);
  const messages = adaptiveMessages(step, context, worker);
  context.options.onStepStart?.({
    role: step.id,
    messages,
    modelRef: worker.modelRef,
    provider: resolved.providerName,
    model: resolved.model,
  });
  const result = await chatModelRef(config, worker.modelRef, messages, {
    ...context.options,
    role: step.id,
    onToken: (token) => context.options.onToken?.({ role: step.id, token }),
    onThinking: (token) => context.options.onThinking?.({ role: step.id, token }),
    onFrame: (frame) => context.options.onFrame?.({ role: step.id, frame }),
  });
  context.trace.push({
    id: step.id,
    role: step.role,
    workerId: step.workerId,
    provider: result.provider,
    model: result.model,
    modelRef: result.modelRef,
    subtask: step.subtask,
    access: step.access || [],
    elapsedMs: result.elapsedMs,
    usage: result.usage,
    payment: result.payment || null,
  });
  context.options.onStepEnd?.({ role: step.id, result });
  return result;
}

function adaptiveMessages(step, context, worker) {
  const visible = (step.access || [])
    .map((id) => {
      const value = context.outputs.get(id);
      return value ? `### ${id}\n${value}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  const workerCard = [
    `worker_id: ${worker.id}`,
    `model: ${worker.modelRef}`,
    `capabilities: ${(worker.capabilities || []).join(", ") || "general"}`,
    `cost: ${worker.cost}`,
    `latency: ${worker.latency}`,
  ].join("\n");

  return [
    { role: "system", content: context.system },
    {
      role: "user",
      content: [
        `Pipeline: ${context.pipeline.name}`,
        `Pipeline instruction: ${context.pipeline.instruction}`,
        "",
        "Worker card:",
        workerCard,
        "",
        `Subtask: ${step.subtask}`,
        "",
        "User task:",
        context.input,
        visible ? `\nVisible prior outputs:\n${visible}` : "",
        "",
        "Return only the result for your subtask. Do not mention hidden workers or inaccessible outputs.",
      ].join("\n"),
    },
  ];
}

function workerSystemPrompt(step) {
  if (step.role === "critic") {
    return "You are a verifier in Dot Loom. Be adversarial, specific, and concise. Focus on correctness, privacy, security, and missing tests.";
  }
  if (step.role === "router") {
    return "You are Dot Loom's router. Classify the task and identify the strongest worker strategy.";
  }
  if (step.role === "finalizer") {
    return "You are Dot Loom's finalizer. Synthesize only the useful evidence into a clean final answer.";
  }
  return "You are a specialist worker in Dot Loom. Complete the assigned subtask directly.";
}

function classify(input, pipelineName, route) {
  const text = `${pipelineName}\n${input}\n${route}`.toLowerCase();
  const simpleIntent =
    input.length < 160 &&
    pipelineName === "general" &&
    /^(name|list|say|give|what is|what's|explain in one|one|short)\b/i.test(input.trim()) &&
    !/\b(review|audit|investigate|compare|debug|implement|patch|design)\b/i.test(input);
  if (simpleIntent) return { kind: "general", complexity: "low", simple: true };

  const code = /\b(api|code|repo|github|billing|privacy|security|race|database|token|wallet|tool|agent)\b/.test(text);
  const research = /\b(research|paper|benchmark|compare|evidence|study|architecture|framework)\b/.test(text);
  const simple = input.length < 180 && !code && !research && pipelineName === "general";
  if (pipelineName === "code-review" || code) return { kind: "code-review", complexity: "high", simple: false };
  if (pipelineName === "research" || research) return { kind: "research", complexity: "medium", simple: false };
  return { kind: "general", complexity: simple ? "low" : "medium", simple };
}

function pickAnswer(candidate, outputs) {
  if (isUsableAnswer(candidate)) return candidate;
  for (const id of ["final", "verify", "challenge", "research", "draft", "route"]) {
    const value = outputs.get(id);
    if (isUsableAnswer(value)) return value;
  }
  if (candidate?.trim()) return candidate;
  for (const id of ["final", "verify", "challenge", "research", "draft", "route"]) {
    const value = outputs.get(id);
    if (value?.trim()) return value;
  }
  return "";
}

function isUsableAnswer(value) {
  const text = value?.trim() || "";
  return Boolean(text && (text.length > 80 || /[.!?)]$/.test(text) || text.includes("\n")));
}

function pickWorker(workers, preferredIds) {
  for (const id of preferredIds) {
    if (workers[id]) return workers[id];
  }
  const first = Object.values(workers)[0];
  if (!first) throw new Error("No workers configured.");
  return first;
}

function summarize(trace, elapsedMs) {
  const usage = trace.reduce(
    (sum, item) => {
      const u = item.usage || {};
      sum.promptTokens += Number(u.prompt_tokens || 0);
      sum.completionTokens += Number(u.completion_tokens || 0);
      sum.totalTokens += Number(u.total_tokens || 0);
      sum.spentCredits += Number(item.payment?.spent_credits || 0);
      return sum;
    },
    { promptTokens: 0, completionTokens: 0, totalTokens: 0, spentCredits: 0 },
  );
  return {
    calls: trace.length,
    elapsedMs,
    ...usage,
  };
}

function scoreAnswer(answer) {
  const text = answer.trim();
  let score = 0.5;
  if (text.length > 120) score += 0.15;
  if (/\b(risk|fix|test|because|therefore|tradeoff|assumption)\b/i.test(text)) score += 0.15;
  if (/^\s*(i can't|i cannot|sorry|as an ai)/i.test(text)) score -= 0.2;
  if (text.length > 3000) score -= 0.05;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function makeReceipt({ pipeline, plan, trace, metrics, answer }) {
  const safeTrace = trace.map((item) => ({
    id: item.id,
    workerId: item.workerId,
    modelRef: item.modelRef,
    elapsedMs: item.elapsedMs,
    totalTokens: item.usage?.total_tokens || 0,
    spentCredits: item.payment?.spent_credits || 0,
  }));
  const payload = {
    pipeline: pipeline.name,
    planKind: plan.kind,
    steps: plan.steps.map(({ id, workerId, access }) => ({ id, workerId, access })),
    trace: safeTrace,
    metrics,
    answerHash: hash(answer),
  };
  return {
    version: 1,
    traceHash: hash(JSON.stringify(payload)),
    answerHash: payload.answerHash,
    stepCount: plan.steps.length,
    callCount: trace.length,
    spentCredits: metrics.spentCredits || 0,
  };
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}
