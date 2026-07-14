import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  GitBranch,
  Network,
  Pause,
  Play,
  Radio,
  RadioTower,
  RotateCcw,
  ShieldAlert,
  Square,
  Terminal,
  Waypoints,
} from "lucide-react";

const WORKERS = {
  router: {
    id: "router",
    label: "ROUTER",
    model: "dot-nemotron-nano",
    role: "Classifies task and selects the smallest useful workflow.",
    icon: GitBranch,
    cost: "low",
    speed: "fast",
    sees: ["user task"],
  },
  drafter: {
    id: "drafter",
    label: "DRAFTER",
    model: "dot-deepseek-v4-flash",
    role: "Builds the first concrete answer or implementation pass.",
    icon: Cpu,
    cost: "low",
    speed: "fast",
    sees: ["route", "user task"],
  },
  critic: {
    id: "critic",
    label: "VERIFIER",
    model: "dot-gemma-4-uncensored",
    role: "Attacks the draft for hidden bugs, privacy leaks, and edge cases.",
    icon: ShieldAlert,
    cost: "low",
    speed: "medium",
    sees: ["route", "draft"],
  },
  finalizer: {
    id: "finalizer",
    label: "FINALIZER",
    model: "dot-qwen-coder-480b",
    role: "Merges useful work into the final answer and removes weak claims.",
    icon: RadioTower,
    cost: "medium",
    speed: "medium",
    sees: ["route", "draft", "verify"],
  },
};

const PIPELINES = {
  "code-review": {
    label: "CODE-REVIEW",
    hint: "Security, privacy, race conditions, billing, test gaps.",
    prompt: "Review this API design for billing and privacy bugs.",
  },
  research: {
    label: "RESEARCH",
    hint: "Separate signal from speculation, then compress into a usable brief.",
    prompt: "Compare speculative decoding and multi-agent verification for low-latency inference.",
  },
  general: {
    label: "GENERAL",
    hint: "Route easy tasks directly and escalate only when the prompt needs it.",
    prompt: "Design the smallest useful launch checklist for a privacy AI API.",
  },
};

const PROVIDER_PRESETS = {
  mock: {
    id: "mock",
    label: "Mock local",
    type: "mock",
    baseUrl: "",
    envKey: "",
    help: "Deterministic local model stubs. Safe for demos, docs, and screenshots.",
    models: {
      router: "router-small",
      drafter: "worker-small",
      critic: "critic-small",
      finalizer: "finalizer-small",
    },
  },
  dot: {
    id: "dot",
    label: "Dot API",
    type: "dot",
    baseUrl: "https://api.usedot.xyz/agent/v1",
    envKey: "DOT_API_KEY",
    help: "Dot credits + OpenAI-compatible agent endpoint.",
    models: {
      router: "dot-nemotron-nano",
      drafter: "dot-deepseek-v4-flash",
      critic: "dot-gemma-4-uncensored",
      finalizer: "dot-qwen-coder-480b",
    },
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    type: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    headers: {
      "HTTP-Referer": "https://usedot.xyz",
      "X-Title": "Dot Loom",
    },
    help: "Useful for mixing many hosted models behind one key.",
    models: {
      router: "google/gemma-3-4b-it",
      drafter: "deepseek/deepseek-chat",
      critic: "qwen/qwen-2.5-coder-32b-instruct",
      finalizer: "deepseek/deepseek-chat",
    },
  },
  openai: {
    id: "openai",
    label: "OpenAI-compatible",
    type: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    help: "Any provider that exposes /chat/completions can use this shape.",
    models: {
      router: "gpt-4o-mini",
      drafter: "gpt-4o-mini",
      critic: "gpt-4o-mini",
      finalizer: "gpt-4o",
    },
  },
  ollama: {
    id: "ollama",
    label: "Ollama local",
    type: "ollama",
    baseUrl: "http://localhost:11434",
    envKey: "",
    help: "Runs fully local models through Ollama. No API key.",
    models: {
      router: "gemma3:4b",
      drafter: "qwen2.5-coder:7b",
      critic: "qwen3:8b",
      finalizer: "qwen3:8b",
    },
  },
  custom: {
    id: "custom",
    label: "Custom",
    type: "openai-compatible",
    baseUrl: "",
    envKey: "",
    help: "Paste any OpenAI-compatible base URL and model IDs.",
    models: {
      router: "",
      drafter: "",
      critic: "",
      finalizer: "",
    },
  },
};

const OUTPUTS = {
  router: [
    "classification=code-review",
    "risk=billing+privacy",
    "plan=draft -> verify -> final",
    "budget=low-cost workers first",
  ],
  drafter: [
    "Found idempotency, replay, and floating point billing risks.",
    "Suggested integer credits, tx hash uniqueness, and strict API key auth.",
    "Flagged prompt/content logging as a privacy boundary violation.",
  ],
  critic: [
    "Draft missed multi-tab token replay and failed-run refund semantics.",
    "Privacy note: usage telemetry must stay aggregate by key, not prompt-linked.",
    "Require tests for import/export vault recovery and API spend sync.",
  ],
  finalizer: [
    "Critical fixes: idempotent spends, unique token nullifiers, no prompt logs, and atomic credit debit.",
    "UX fix: sync credits silently before asking the user to retry.",
    "Residual risk: shared API credits trade unlinkability for usability.",
  ],
};

const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

const CLI_ROLE_MAP = {
  direct: "drafter",
  editor: "critic",
  route: "router",
  router: "router",
  draft: "drafter",
  drafter: "drafter",
  research: "drafter",
  verify: "critic",
  critic: "critic",
  challenge: "critic",
  final: "finalizer",
  finalizer: "finalizer",
};

function buildPlan({ mode, pipeline, budget }) {
  if (mode === "fixed") return ["router", "drafter", "critic", "finalizer"];
  const direct = pipeline === "general" ? "finalizer" : "drafter";
  if (budget === "lean" || (budget === "balanced" && pipeline === "general")) return [direct];
  if (budget === "strict") return ["drafter", "critic", "finalizer"];
  return [direct, "critic"];
}

// network-map node positions: signal-relay zig-zag across the transmission line
function layoutNodes(plan) {
  const n = plan.length;
  return plan.map((id, i) => ({
    id,
    x: n === 1 ? 50 : 13 + (i / (n - 1)) * 74,
    y: i % 2 === 0 ? 32 : 68,
  }));
}

function edgePath(a, b) {
  const ax = a.x * 10;
  const ay = a.y * 4;
  const bx = b.x * 10;
  const by = b.y * 4;
  const mx = (ax + bx) / 2;
  return `M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`;
}

function App() {
  const [mode, setMode] = useState("adaptive");
  const [pipeline, setPipeline] = useState("code-review");
  const [budget, setBudget] = useState("balanced");
  const [privacy, setPrivacy] = useState("smart");
  const [runtime, setRuntime] = useState("demo");
  const [providerPreset, setProviderPreset] = useState("mock");
  const [byokBaseUrl, setByokBaseUrl] = useState(PROVIDER_PRESETS.mock.baseUrl);
  const [byokApiKey, setByokApiKey] = useState("");
  const [byokUseEnv, setByokUseEnv] = useState(false);
  const [byokModels, setByokModels] = useState(PROVIDER_PRESETS.mock.models);
  const [horizon, setHorizon] = useState(4);
  const [prompt, setPrompt] = useState(PIPELINES["code-review"].prompt);
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState(null);
  const [completed, setCompleted] = useState([]);
  const [outputs, setOutputs] = useState({});
  const [events, setEvents] = useState([]);
  const [clock, setClock] = useState("--:--:--");
  const [metrics, setMetrics] = useState({
    elapsed: 0,
    tokens: 0,
    calls: 0,
    receipt: "idle",
  });
  const [terminal, setTerminal] = useState("");
  const [bridgeStatus, setBridgeStatus] = useState({ ok: false, dotApiKey: false });
  const abortRef = useRef(false);
  const controllerRef = useRef(null);
  const terminalRef = useRef(null);
  const eventListRef = useRef(null);

  useEffect(() => {
    const tick = () =>
      setClock(new Date().toLocaleTimeString([], { hour12: false }));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    fetch("/api/loom/status")
      .then((res) => res.json())
      .then((json) => setBridgeStatus(json))
      .catch(() => setBridgeStatus({ ok: false, dotApiKey: false }));
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [terminal]);

  useEffect(() => {
    if (!eventListRef.current) return;
    eventListRef.current.scrollTop = eventListRef.current.scrollHeight;
  }, [events, running]);

  const plan = useMemo(
    () => buildPlan({ mode, pipeline, budget }),
    [mode, pipeline, budget],
  );

  const nodes = useMemo(() => layoutNodes(plan), [plan]);
  const edges = useMemo(
    () => nodes.slice(0, -1).map((node, index) => [node, nodes[index + 1]]),
    [nodes],
  );

  const activePreset = PROVIDER_PRESETS[providerPreset] || PROVIDER_PRESETS.mock;
  const runtimeWorkers = useMemo(() => {
    if (runtime !== "cli-byok") return WORKERS;
    return Object.fromEntries(
      Object.entries(WORKERS).map(([id, worker]) => [
        id,
        {
          ...worker,
          model: byokModels[id] || worker.model,
          cost: activePreset.type === "mock" ? "none" : "byok",
          speed: activePreset.type === "ollama" ? "local" : worker.speed,
        },
      ]),
    );
  }, [activePreset.type, byokModels, runtime]);

  const byokNeedsKey = runtime === "cli-byok" && !["mock", "ollama"].includes(activePreset.type);
  const byokEnvReady = Boolean(activePreset.envKey && bridgeStatus.env?.[activePreset.envKey]);
  const byokReady = runtime !== "cli-byok" || !byokNeedsKey || Boolean(byokApiKey.trim()) || (byokUseEnv && byokEnvReady);

  function applyProviderPreset(id) {
    const next = PROVIDER_PRESETS[id] || PROVIDER_PRESETS.mock;
    setProviderPreset(next.id);
    setByokBaseUrl(next.baseUrl);
    setByokModels(next.models);
    setByokUseEnv(Boolean(next.envKey));
    setByokApiKey("");
  }

  function updateByokModel(role, value) {
    setByokModels((prev) => ({ ...prev, [role]: value }));
  }

  function byokPayload() {
    return {
      provider: {
        id: activePreset.id,
        label: activePreset.label,
        type: activePreset.type,
        baseUrl: byokBaseUrl,
        apiKey: byokUseEnv ? "" : byokApiKey,
        envKey: byokUseEnv ? activePreset.envKey : "",
        headers: activePreset.headers || {},
      },
      models: byokModels,
    };
  }

  function appendEvent(message, tone = "default") {
    setEvents((prev) => [
      ...prev.slice(-10),
      {
        id: `${Date.now()}-${Math.random()}`,
        time: new Date().toLocaleTimeString([], { hour12: false }),
        message,
        tone,
      },
    ]);
  }

  async function runDemo() {
    abortRef.current = false;
    controllerRef.current = null;
    setRunning(true);
    setActive(null);
    setCompleted([]);
    setOutputs({});
    setEvents([]);
    setTerminal("");
    setMetrics({ elapsed: 0, tokens: 0, calls: 0, receipt: "warming" });
    appendEvent("link established :: applying local budget policy", "active");

    const start = performance.now();
    let tokenTotal = 0;

    for (const [workerIndex, workerId] of plan.entries()) {
      if (abortRef.current) break;
      const worker = runtimeWorkers[workerId];
      setActive(workerId);
      appendEvent(`TX ${worker.label} <- ${worker.model}`, "active");

      let text = "";
      const chunks = OUTPUTS[workerId];
      for (const chunk of chunks) {
        if (abortRef.current) break;
        await sleep(workerId === "finalizer" ? 340 : 260);
        text += `${text ? "\n" : ""}${chunk}`;
        tokenTotal += Math.round(chunk.length / 3.8);
        setOutputs((prev) => ({ ...prev, [workerId]: text }));
        setMetrics({
          elapsed: (performance.now() - start) / 1000,
          tokens: tokenTotal,
          calls: workerIndex + 1,
          receipt: `loom_${Math.abs(hash(`${prompt}${workerId}${tokenTotal}`)).toString(16).slice(0, 8)}`,
        });
      }

      if (abortRef.current) break;
      setCompleted((prev) => [...prev, workerId]);
      appendEvent(
        `RX ${worker.label} :: ${Math.max(80, Math.round(text.length / 2))} bytes committed`,
        "done",
      );
      await sleep(160);
    }

    setActive(null);
    setRunning(false);
    if (!abortRef.current) appendEvent("receipt sealed :: link closed", "done");
  }

  async function runRealCli() {
    const controller = new AbortController();
    controllerRef.current = controller;
    abortRef.current = false;
    setRunning(true);
    setActive(null);
    setCompleted([]);
    setOutputs({});
    setEvents([]);
    setTerminal("");
    setMetrics({ elapsed: 0, tokens: 0, calls: 0, receipt: "spawning" });

    const started = performance.now();
    let currentNode = null;
    let eventBuffer = "";
    let lineBuffer = "";
    let tokenEstimate = 0;
    let rawChars = 0;

    const applyCliText = (text) => {
      rawChars += text.length;
      setTerminal((prev) => `${prev}${text}`.slice(-18000));

      const combined = `${lineBuffer}${text}`;
      const lines = combined.split(/\r?\n/);
      lineBuffer = combined.endsWith("\n") || combined.endsWith("\r") ? "" : lines.pop() || "";

      for (const line of lines) {
        if (!line || /^-+$/.test(line.trim())) continue;

        const stepStart = line.match(/^\[(direct|editor|route|router|draft|drafter|research|verify|critic|challenge|final|finalizer)\]\s+(.+)$/i);
        if (stepStart) {
          const stepId = stepStart[1].toLowerCase();
          currentNode = stepId === "direct" && pipeline === "general" ? "finalizer" : CLI_ROLE_MAP[stepId] || currentNode;
          setActive(currentNode);
          appendEvent(`TX ${runtimeWorkers[currentNode]?.label || stepStart[1]} <- ${stepStart[2]}`, "active");
          continue;
        }

        const stepDone = line.match(/^\[done:(direct|editor|route|router|draft|drafter|research|verify|critic|challenge|final|finalizer)\]\s+(.+)$/i);
        if (stepDone) {
          const stepId = stepDone[1].toLowerCase();
          const node = stepId === "direct" && pipeline === "general" ? "finalizer" : CLI_ROLE_MAP[stepId];
          setCompleted((prev) => (prev.includes(node) ? prev : [...prev, node]));
          setMetrics((prev) => ({ ...prev, calls: prev.calls + 1 }));
          appendEvent(`RX ${runtimeWorkers[node]?.label || stepDone[1]} :: ${stepDone[2]}`, "done");
          currentNode = null;
          continue;
        }

        const workflow = line.match(/^\[workflow\]\s+(.+)$/i);
        if (workflow) {
          appendEvent(`PLAN ${workflow[1]}`, "active");
          continue;
        }

        const billing = line.match(/^\[(.+):billing\]\s+(.+)$/i);
        if (billing) {
          appendEvent(`BILLING ${billing[2]}`, "done");
          continue;
        }

        const privacyFrame = line.match(/^\[(.+):privacy\]\s+(.+)$/i);
        if (privacyFrame) {
          appendEvent(`PRIVACY ${privacyFrame[2]}`, "done");
          continue;
        }

        const tokenMatch = line.match(/tokens=(\d+)/i);
        if (tokenMatch) tokenEstimate = Math.max(tokenEstimate, Number(tokenMatch[1]));

        if (currentNode && !line.startsWith("[") && !line.startsWith("Dot Loom") && !line.startsWith("========")) {
          const node = currentNode;
          setOutputs((prev) => ({
            ...prev,
            [node]: `${prev[node] ? `${prev[node]}\n` : ""}${line}`.slice(-2500),
          }));
        }
      }
      setMetrics((prev) => ({
        ...prev,
        elapsed: (performance.now() - started) / 1000,
        tokens: tokenEstimate || Math.round(rawChars / 4),
      }));
    };

    try {
      appendEvent(`spawn cli :: ${runtime === "cli-dot" ? "dot api" : runtime === "cli-byok" ? activePreset.label : "mock config"}`, "active");
      const response = await fetch("/api/loom/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          pipeline,
          mode,
          policy: budget,
          config: runtime === "cli-dot" ? "dot" : runtime === "cli-byok" ? "byok" : "mock",
          byok: runtime === "cli-byok" ? byokPayload() : undefined,
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`CLI bridge returned ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (!abortRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        eventBuffer += decoder.decode(value, { stream: true });
        const parts = eventBuffer.split("\n\n");
        eventBuffer = parts.pop() || "";
        for (const part of parts) {
          const event = parseSse(part);
          if (!event) continue;
          if (event.event === "start") {
            setMetrics((prev) => ({ ...prev, receipt: "cli-live" }));
            appendEvent(event.data.command, "active");
          } else if (event.event === "stdout") {
            applyCliText(event.data.text || "");
          } else if (event.event === "stderr") {
            applyCliText(event.data.text || "");
            appendEvent(`STDERR ${String(event.data.text || "").trim().slice(0, 120)}`, "warn");
          } else if (event.event === "close") {
            const ok = event.data.code === 0;
            appendEvent(ok ? "cli exited cleanly" : `cli exited code=${event.data.code}`, ok ? "done" : "warn");
            setMetrics((prev) => ({
              ...prev,
              elapsed: (performance.now() - started) / 1000,
              receipt: ok ? `cli_${Math.abs(hash(terminal || prompt)).toString(16).slice(0, 8)}` : "cli-error",
            }));
          }
        }
      }
    } catch (error) {
      if (!abortRef.current) appendEvent(`ERROR ${error.message}`, "warn");
    } finally {
      setRunning(false);
      setActive(null);
      controllerRef.current = null;
    }
  }

  function runSelected() {
    if (runtime === "demo") return runDemo();
    return runRealCli();
  }

  function resetRun() {
    abortRef.current = true;
    controllerRef.current?.abort();
    setRunning(false);
    setActive(null);
    setCompleted([]);
    setOutputs({});
    setEvents([]);
    setTerminal("");
    setMetrics({ elapsed: 0, tokens: 0, calls: 0, receipt: "idle" });
  }

  function stopRun() {
    abortRef.current = true;
    controllerRef.current?.abort();
    setRunning(false);
    setActive(null);
    appendEvent("SIGINT :: link halted by operator", "warn");
  }

  const finalAnswer = outputs.finalizer || outputs.critic || outputs.drafter || outputs.final || "";
  const callCap = mode === "fixed" ? 4 : budget === "lean" ? 1 : budget === "strict" ? 3 : 2;
  const linkState = running ? "LINK//ACTIVE" : completed.length ? "LINK//SEALED" : "LINK//IDLE";
  const runtimeState =
    runtime === "cli-dot" && !bridgeStatus.dotApiKey
      ? "DOT KEY MISSING"
      : runtime === "cli-byok" && !byokReady
        ? "BYOK KEY MISSING"
        : runtime === "cli-byok"
          ? activePreset.label.toUpperCase()
          : runtime.toUpperCase();
  const terminalLastLine = terminal
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-1)[0] || "real cli stdout/stderr appears here in CLI-MOCK or CLI-DOT mode.";

  return (
    <main className="loom-shell">
      <div className="scanlines" />
      <div className="ambient" />

      <header className="topbar">
        <div className="brand">
          <span className="led" data-live={running ? "1" : "0"} />
          <span className="brand-mark">
            <Waypoints size={15} /> DOT.LOOM
          </span>
          <span className="brand-sub">// ORCHESTRATION TERMINAL</span>
        </div>
        <div className="status-rail">
          <span className="stat">NODE api.usedot.xyz</span>
          <span className="stat">{linkState}</span>
          <span className="stat">{clock}</span>
        </div>
        <div className="top-actions">
          <button className="ghost-button">
            <Terminal size={14} /> CLI-PARITY
          </button>
          <button
            className="primary-button"
            onClick={running ? stopRun : runSelected}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
            {running ? "HALT" : "TRANSMIT"}
          </button>
        </div>
      </header>

      <section className="control-strip">
        <Segmented label="runtime" value={runtime} onChange={setRuntime} options={[["demo", "DEMO"], ["cli-mock", "CLI-MOCK"], ["cli-dot", "CLI-DOT"], ["cli-byok", "CLI-BYOK"]]} />
        <Segmented label="mode" value={mode} onChange={setMode} options={[["adaptive", "ADAPTIVE"], ["fixed", "FIXED"]]} />
        <Segmented
          label="pipeline"
          value={pipeline}
          onChange={(value) => {
            setPipeline(value);
            setPrompt(PIPELINES[value].prompt);
          }}
          options={Object.entries(PIPELINES).map(([id, item]) => [id, item.label])}
        />
        <Segmented label="policy" value={budget} onChange={setBudget} options={[["lean", "LEAN"], ["balanced", "BAL"], ["strict", "STRICT"]]} />
        <Segmented label="privacy" value={privacy} onChange={setPrivacy} options={[["smart", "SMART"], ["full", "FULL"], ["off", "OFF"]]} />
        <div className="bridge-indicator">
          <span>bridge</span>
          <strong>{bridgeStatus.ok ? runtimeState : "OFFLINE"}</strong>
        </div>
      </section>

      {runtime === "cli-byok" && (
        <section className="panel byok-panel">
          <PanelHead kicker="provider pool" title="bring your own models">
            <span className={byokReady ? "provider-state provider-ready" : "provider-state provider-warn"}>
              {byokReady ? "ready" : "needs key"}
            </span>
          </PanelHead>
          <div className="byok-grid">
            <label>
              <span>preset</span>
              <select value={providerPreset} onChange={(event) => applyProviderPreset(event.target.value)}>
                {Object.values(PROVIDER_PRESETS).map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>base url</span>
              <input
                value={byokBaseUrl}
                disabled={activePreset.type === "mock"}
                placeholder="https://provider.example/v1"
                onChange={(event) => setByokBaseUrl(event.target.value)}
              />
            </label>
            <label className="key-cell">
              <span>api key</span>
              {activePreset.type === "mock" || activePreset.type === "ollama" ? (
                <input value="not required" disabled />
              ) : byokUseEnv ? (
                <input value={`${activePreset.envKey} ${byokEnvReady ? "detected" : "not detected"}`} disabled />
              ) : (
                <input
                  type="password"
                  value={byokApiKey}
                  placeholder="paste key for this local run"
                  onChange={(event) => setByokApiKey(event.target.value)}
                  autoComplete="off"
                />
              )}
            </label>
            <label className="env-toggle">
              <input
                type="checkbox"
                checked={byokUseEnv}
                disabled={!activePreset.envKey}
                onChange={(event) => setByokUseEnv(event.target.checked)}
              />
              <span>{activePreset.envKey ? `use ${activePreset.envKey}` : "no env key"}</span>
            </label>
          </div>
          <div className="role-grid">
            {["router", "drafter", "critic", "finalizer"].map((role) => (
              <label key={role}>
                <span>{role}</span>
                <input value={byokModels[role] || ""} onChange={(event) => updateByokModel(role, event.target.value)} />
              </label>
            ))}
          </div>
          <p className="provider-note">
            {activePreset.help} Keys are sent only to this local bridge process and written to a temporary config that is deleted after the run.
          </p>
        </section>
      )}

      <section className="workspace">
        <div className="left-column">
          <section className="panel prompt-panel">
            <PanelHead kicker="task input" title={PIPELINES[pipeline].label}>
              <button className="icon-button" onClick={resetRun} aria-label="Reset run">
                <RotateCcw size={15} />
              </button>
            </PanelHead>
            <div className="prompt-wrap">
              <span className="prompt-caret">loom&gt;</span>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} spellCheck={false} />
            </div>
            <p className="hint">// {PIPELINES[pipeline].hint}</p>
            <div className="micro-controls">
              <span><Activity size={12} /> draft horizon</span>
              {[2, 4, 6].map((value) => (
                <button key={value} className={horizon === value ? "active" : ""} onClick={() => setHorizon(value)}>h={value}</button>
              ))}
            </div>
          </section>

          <section className="panel trace-panel">
            <PanelHead kicker="live trace" title="tail -f loom.log">
              <span className="receipt">{metrics.receipt}</span>
            </PanelHead>
            <div className="event-list" ref={eventListRef}>
              {events.length === 0 ? (
                <p className="empty">// awaiting transmission — press TRANSMIT to open the link.</p>
              ) : (
                events.map((event) => (
                  <div className={`event event-${event.tone}`} key={event.id}>
                    <span>{event.time}</span>
                    <p>{event.message}</p>
                  </div>
                ))
              )}
              {running && <div className="event event-cursor"><span /><p>_</p></div>}
            </div>
          </section>
        </div>

        <section className="panel graph-panel">
          <PanelHead
            kicker="network map"
            title={mode === "adaptive" ? "runtime-selected topology" : "fixed relay chain"}
          >
            <div className="plan-pill"><Network size={13} /> {plan.length} HOPS</div>
          </PanelHead>

          <div className="graph-stage">
            <svg className="edge-layer" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true">
              {edges.map(([a, b], index) => {
                const isActive = completed.includes(a.id) || active === a.id || active === b.id;
                return <path key={`bg-${a.id}-${b.id}`} id={`edge-${index}`} className={isActive ? "edge edge-active" : "edge"} d={edgePath(a, b)} />;
              })}
              {edges.map(([a, b], index) => {
                const isActive = completed.includes(a.id) || active === a.id || active === b.id;
                if (!isActive) return null;
                return (
                  <circle key={`pkt-${a.id}-${b.id}`} className="packet" r="3.4">
                    <animateMotion dur="1.05s" repeatCount="indefinite" rotate="auto">
                      <mpath href={`#edge-${index}`} />
                    </animateMotion>
                  </circle>
                );
              })}
            </svg>

            <div className="node-layer">
              {nodes.map((node, index) => (
                <NetworkNode
                  key={node.id}
                  node={node}
                  index={index}
                  worker={runtimeWorkers[node.id]}
                  active={active === node.id}
                  complete={completed.includes(node.id)}
                  output={outputs[node.id]}
                />
              ))}
            </div>
          </div>

          <div className="metrics-grid">
            <Metric icon={Radio} label="T+" value={`${metrics.elapsed.toFixed(1)}s`} />
            <Metric icon={Activity} label="payload" value={`${metrics.tokens.toLocaleString()} tok`} />
            <Metric icon={Waypoints} label="calls / cap" value={`${metrics.calls}/${callCap}`} />
            <Metric icon={ShieldAlert} label="cipher" value={privacy} />
          </div>
        </section>

        <aside className="right-column">
          <section className="panel plan-panel">
            <PanelHead kicker="access control" title="per-node ACL" />
            <div className="access-list">
              {plan.map((workerId, index) => (
                <div className="access-row" key={workerId}>
                  <span>
                    <em>{String(index).padStart(2, "0")}</em> {WORKERS[workerId].label}
                  </span>
                    <p>sees: {runtimeWorkers[workerId].sees.join(" + ")}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel answer-panel">
            <PanelHead kicker="final synthesis" title="stdout" />
            <pre>{finalAnswer ? finalAnswer : "// finalizer stdout streams here once the relay chain completes._"}</pre>
          </section>
        </aside>
      </section>

      <section className="panel terminal-dock" aria-label="Process stream">
        <div className="terminal-dock-head">
          <div>
            <p className="section-kicker">raw cli</p>
            <h2>process stream</h2>
          </div>
          <div className="terminal-tail">
            <span>last</span>
            <strong>{terminalLastLine}</strong>
          </div>
        </div>
        <pre ref={terminalRef}>{terminal || "// real cli stdout/stderr appears here in CLI-MOCK or CLI-DOT mode._"}</pre>
      </section>
    </main>
  );
}

function parseSse(block) {
  const lines = block.split(/\r?\n/);
  const event = lines.find((line) => line.startsWith("event: "))?.slice(7).trim() || "message";
  const dataRaw = lines
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .join("\n");
  if (!dataRaw) return null;
  try {
    return { event, data: JSON.parse(dataRaw) };
  } catch {
    return null;
  }
}

function NetworkNode({ node, index, worker, active, complete, output }) {
  const Icon = worker.icon;
  const status = complete ? "ONLINE" : active ? "TX/RX" : "QUEUED";
  const lastLine = output ? output.split("\n").slice(-1)[0] : "";
  const state = complete ? "is-complete" : active ? "is-active" : "is-idle";
  return (
    <article
      className={`node ${state}`}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
    >
      <div className="node-head">
        <span className="node-icon"><Icon size={15} /></span>
        <span className="node-id">N{String(index).padStart(2, "0")}</span>
        <span className="node-status">{status}</span>
      </div>
      <h3>{worker.label}</h3>
      <p className="model-name">{worker.model}</p>
      <div className="node-tags">
        <span>{worker.cost}$</span>
        <span>{worker.speed}</span>
      </div>
      <p className="node-readout">{lastLine ? `> ${lastLine}` : "> idle"}</p>
    </article>
  );
}

function PanelHead({ kicker, title, children }) {
  return (
    <div className="panel-heading">
      <div>
        <p className="section-kicker">[ {kicker} ]</p>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Segmented({ label, value, onChange, options }) {
  return (
    <div className="segmented">
      <span>--{label}</span>
      <div>
        {options.map(([id, text]) => (
          <button key={id} className={value === id ? "selected" : ""} onClick={() => onChange(id)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={14} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function hash(value) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return h;
}

export default App;
