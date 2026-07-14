export function printHuman(result, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("");
  console.log("Dot Loom");
  console.log("========");
  console.log(`pipeline       ${result.pipeline}`);
  if (result.workflow?.policy) console.log(`policy         ${result.workflow.policy}`);
  console.log(`calls          ${result.metrics.calls}`);
  console.log(`elapsed        ${(result.metrics.elapsedMs / 1000).toFixed(2)}s`);
  if (result.metrics.totalTokens) {
    console.log(`tokens         ${result.metrics.totalTokens}`);
  }
  if (result.metrics.spentCredits) {
    console.log(`credits        ${result.metrics.spentCredits}`);
  }
  if (result.workflow?.receipt) {
    console.log(`receipt        ${result.workflow.receipt.traceHash}`);
  }
  if (result.workflow?.budget) {
    const budget = result.workflow.budget;
    console.log(`budget         ${budget.used.calls}/${budget.limits.maxCalls} calls${budget.limited ? ` (${budget.stopReason})` : ""}`);
    if (result.workflow.escalated) console.log(`escalated      ${result.workflow.escalationReason}`);
  }
  if (result.workflow?.plan) {
    console.log("");
    console.log("WORKFLOW");
    for (const step of result.workflow.plan.steps) {
      const access = step.access?.length ? ` access=[${step.access.join(",")}]` : "";
      console.log(`${step.id.padEnd(10)} ${step.workerRef.padEnd(42)} ${step.role}${access}`);
    }
  }
  console.log("");
  console.log("TRACE");
  for (const item of result.trace) {
    const tokens = item.usage?.total_tokens ? ` tokens=${item.usage.total_tokens}` : "";
    const credits = item.payment?.spent_credits !== undefined ? ` credits=${item.payment.spent_credits}` : "";
    console.log(
      `${String(item.id || item.role).padEnd(10)} ${item.modelRef.padEnd(42)} ${(item.elapsedMs / 1000).toFixed(2)}s${tokens}${credits}`,
    );
  }
  console.log("");
  console.log("ANSWER");
  console.log(result.answer.trim());
}

export function createLiveReporter(enabled = true) {
  if (!enabled) {
    return {
      onStepStart() {},
      onToken() {},
      onThinking() {},
      onFrame() {},
      onStepEnd() {},
      onWorkflowPlan() {},
    };
  }

  const thinkingOpen = new Set();

  return {
    onStepStart(step) {
      console.log("");
      console.log(`[${step.role}] ${step.modelRef}`);
      console.log("-".repeat(Math.min(80, 12 + step.modelRef.length)));
    },
    onToken({ token }) {
      process.stdout.write(token);
    },
    onThinking({ role, token }) {
      if (!thinkingOpen.has(role)) {
        thinkingOpen.add(role);
        process.stdout.write(`\n[${role}:reasoning]\n`);
      }
      process.stdout.write(token);
    },
    onFrame({ role, frame }) {
      if (frame.type === "privacy") {
        process.stdout.write(
          `\n[${role}:privacy] ${frame.privacy?.status || "ready"} mode=${frame.privacy?.mode || "unknown"}\n`,
        );
      }
      if (frame.type === "payment") {
        const payment = frame.payment || {};
        process.stdout.write(
          `\n[${role}:billing] spent=${payment.spent_credits ?? "?"} reserved=${payment.reserved_credits ?? "?"} balance=${payment.balance_credits ?? "?"}\n`,
        );
      }
    },
    onStepEnd({ role, result }) {
      const usage = result.usage?.total_tokens ? ` tokens=${result.usage.total_tokens}` : "";
      const payment =
        result.payment?.spent_credits !== undefined ? ` spent=${result.payment.spent_credits}cr` : "";
      const empty = result.content?.trim() ? "" : " empty-output";
      process.stdout.write(`\n[done:${role}] ${(result.elapsedMs / 1000).toFixed(2)}s${usage}${payment}\n`);
      if (empty) process.stdout.write(`[warn:${role}]${empty}\n`);
    },
    onWorkflowPlan({ plan }) {
      const budget = plan.budget ? ` maxCalls=${plan.budget.maxCalls} maxCredits=${plan.budget.maxCredits ?? "n/a"}` : "";
      process.stdout.write(`\n[workflow] ${plan.kind} complexity=${plan.complexity} steps<=${plan.steps.length}${budget}\n`);
      for (const step of plan.steps) {
        const access = step.access?.length ? ` access=[${step.access.join(",")}]` : "";
        process.stdout.write(`[workflow] ${step.id} -> ${step.workerRef}${access}\n`);
      }
    },
  };
}

export function printDoctor(config) {
  console.log("");
  console.log("Dot Loom doctor");
  console.log("===============");
  for (const [name, provider] of Object.entries(config.providers || {})) {
    const noAuth = provider.auth === "none" || provider.type === "mock" || provider.type === "ollama";
    const auth = provider.apiKey ? "api key present" : noAuth ? "no auth" : "missing api key";
    console.log(`${name.padEnd(14)} type=${String(provider.type || "openai-compatible").padEnd(18)} ${auth}`);
  }
  console.log("");
  for (const [role, ref] of Object.entries(config.models || {})) {
    console.log(`${role.padEnd(14)} ${ref}`);
  }
  if (config.workers) {
    console.log("");
    console.log("workers");
    for (const [id, worker] of Object.entries(config.workers)) {
      const model = typeof worker === "string" ? worker : worker.model;
      const caps = typeof worker === "string" ? "" : ` ${String(worker.capabilities || []).split(",").join(",")}`;
      console.log(`${id.padEnd(14)} ${String(model).padEnd(42)}${caps}`);
    }
  }
}
