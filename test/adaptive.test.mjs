import test from "node:test";
import assert from "node:assert/strict";
import { assessTask, resolveAdaptiveLimits, runAdaptive } from "../src/adaptive.mjs";

const config = {
  providers: { mock: { type: "mock" } },
  models: {
    router: "mock/router-small",
    drafter: "mock/worker-small",
    critic: "mock/critic-small",
    finalizer: "mock/finalizer-small",
  },
};

test("balanced policy accepts a low-risk direct answer in one call", async () => {
  const result = await runAdaptive(config, "What is a mutex?", {
    pipeline: "general",
    policy: "balanced",
    stream: false,
  });
  assert.equal(result.metrics.calls, 1);
  assert.equal(result.workflow.escalated, false);
  assert.equal(result.workflow.router, "local-policy");
  assert.deepEqual(result.trace.map((item) => item.id), ["direct"]);
});

test("balanced policy selectively verifies a high-risk task without a router call", async () => {
  const result = await runAdaptive(config, "Review this billing API for replay and privacy bugs.", {
    pipeline: "code-review",
    policy: "balanced",
    stream: false,
  });
  assert.equal(result.metrics.calls, 2);
  assert.equal(result.workflow.escalated, true);
  assert.match(result.workflow.escalationReason, /high-risk/);
  assert.deepEqual(result.trace.map((item) => item.id), ["direct", "verify"]);
  assert.equal(result.trace.some((item) => item.modelRef.includes("router")), false);
});

test("lean and strict presets enforce different computation depths", async () => {
  const prompt = "Audit this authorization and tenant isolation API.";
  const lean = await runAdaptive(config, prompt, { pipeline: "code-review", policy: "lean", stream: false });
  const strict = await runAdaptive(config, prompt, { pipeline: "code-review", policy: "strict", stream: false });
  assert.equal(lean.metrics.calls, 1);
  assert.equal(strict.metrics.calls, 3);
  assert.deepEqual(strict.trace.map((item) => item.id), ["direct", "verify", "final"]);
});

test("explicit call and credit ceilings stop the workflow before another provider call", async () => {
  const byCalls = await runAdaptive(config, "Review this payment API.", {
    pipeline: "code-review",
    policy: "strict",
    maxCalls: 1,
    stream: false,
  });
  assert.equal(byCalls.metrics.calls, 1);
  assert.equal(byCalls.workflow.budget.limited, true);
  assert.equal(byCalls.workflow.budget.stopReason, "max-calls-reached");

  const byCredits = await runAdaptive(config, "Review this payment API.", {
    pipeline: "code-review",
    policy: "balanced",
    maxCredits: 1,
    creditPerCall: 1,
    stream: false,
  });
  assert.equal(byCredits.metrics.calls, 1);
  assert.equal(byCredits.workflow.budget.stopReason, "max-credits-reached");
});

test("model-specific credit estimates block an expensive reviewer before the call", async () => {
  const estimatedConfig = {
    ...config,
    adaptive: {
      estimatedCreditsPerCall: 1,
      estimatedCreditsByModel: {
        "mock/worker-small": 1,
        "mock/critic-small": 4,
      },
    },
  };
  const result = await runAdaptive(estimatedConfig, "Review this payment API.", {
    pipeline: "code-review",
    policy: "balanced",
    maxCredits: 3,
    stream: false,
  });
  assert.equal(result.metrics.calls, 1);
  assert.equal(result.workflow.budget.stopReason, "max-credits-reached");
  assert.equal(result.workflow.budget.used.estimatedCredits, 1);
});

test("task assessment is local and policy validation is strict", () => {
  assert.equal(assessTask("Say hello", "general").risk, "low");
  assert.equal(assessTask("Review an SSRF-prone webhook API", "code-review").risk, "high");
  assert.throws(() => resolveAdaptiveLimits(config, { policy: "turbo" }), /lean, balanced, or strict/);
  assert.throws(() => resolveAdaptiveLimits(config, { maxCalls: 0 }), /max-calls/);
});

test("latency ceiling aborts an in-flight provider request", async () => {
  await assert.rejects(
    runAdaptive(config, "What is a mutex?", {
      pipeline: "general",
      policy: "lean",
      maxLatencyMs: 1,
      stream: false,
    }),
    /aborted|timeout/i,
  );
});
