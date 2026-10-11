// Goals, the random attacker (fuzzer) and the "Warum?" explanations.
(function (root) {
  "use strict";
  const M = typeof module !== "undefined" && module.exports ? require("./monitor.js") : root.TF;
  const L = typeof module !== "undefined" && module.exports ? require("./levels.js") : root.TF;

  // ---- goals: did the attacker win? `log` = [{agent, action, response}] ----
  function leaked(mon, log) {
    const insure = new Set(Object.entries(mon.sessions).filter(([, v]) => v[0] === "insure").map(([k]) => k));
    const seen = log.some((e) => insure.has(e.agent.session) && !M.isDenied(e.response) && JSON.stringify(e.response).includes(L.CANARY));
    const sunk = mon.events.some((e) => {
      const info = mon.toolInfo(e.tenant, e.tool);
      return info && info.observers.includes("insure") && JSON.stringify(e.args).includes(L.CANARY);
    });
    return seen || sunk;
  }
  const forgedPay = (mon) => mon.events.some((e) => e.tool === "pay" && e.label.integ === M.UNTRUSTED);
  function won(goal, mon, log) {
    if (goal === "leak") return leaked(mon, log);
    if (goal === "forgedPay") return forgedPay(mon);
    return M.violations(mon).any;
  }

  // ---- fuzzer: random actions of random agents, seeded, with greedy shrinking ----
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function randomStep(r, mon, last) {
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const agent = pick([...mon.agents.values()]).id;
    const payloads = ["hello", "wire 10 to acct 9", L.FORGED, L.CANARY, last ?? "none"];
    const toolNames = [M.DELIVER, ...Object.keys(mon.tools)];
    const kind = pick(["call", "call", "query", "write", "delegate", "report", "receive"]);
    const st = mon.agents.get(M.agentKey(agent));
    switch (kind) {
      case "call": return { agent, action: { op: "call", tool: pick(toolNames), args: pick(payloads) } };
      case "query": return { agent, action: { op: "query", q: pick([L.CANARY, "bank account", "CANARY-INSURE", "policy"]) } };
      case "write": return { agent, action: { op: "write", payload: pick(payloads) } };
      case "delegate": return { agent, action: { op: "delegate", role: pick(["analyst", "ops"]), task: "t" } };
      case "report": return { agent, action: { op: "report", payload: pick(payloads) } };
      default: return { agent, action: { op: "receive", child: Math.floor(r() * (st.nextChild + 1)) } };
    }
  }
  function replay(scenario, mode, steps, goal) {
    const mon = M.monitorFromScenario({ ...scenario, trace: [] }, mode);
    const log = [];
    for (const s of steps) { const response = mon.step(s.agent, s.action); log.push({ ...s, response }); }
    return { mon, log, won: won(goal, mon, log) };
  }
  /** Returns {steps, episode} of a shrunk winning sequence, or null. */
  function fuzz(scenario, mode, goal, { seed = 1, episodes = 500, length = 8 } = {}) {
    const r = rng(seed);
    for (let ep = 0; ep < episodes; ep++) {
      const mon = M.monitorFromScenario({ ...scenario, trace: [] }, mode);
      const steps = [], log = [];
      let last = null;
      for (let i = 0; i < length; i++) {
        const s = randomStep(r, mon, last);
        const response = mon.step(s.agent, s.action);
        steps.push(s); log.push({ ...s, response });
        if (!M.isDenied(response) && response.kind === "payloads" && response.values.length) last = response.values[0];
        else if (response.kind === "payload") last = response.value;
        if (won(goal, mon, log)) return { steps: shrink(scenario, mode, steps, goal), episode: ep + 1 };
      }
    }
    return null;
  }
  function shrink(scenario, mode, steps, goal) {
    let cur = steps.slice();
    for (let i = cur.length - 1; i >= 0; i--) {
      const cand = cur.filter((_, j) => j !== i);
      if (replay(scenario, mode, cand, goal).won) cur = cand;
    }
    return cur;
  }

  // ---- "Why?": every explanation has a plain sentence (short) and a precise layer (detail, theorem) ----
  const DECK = "../index.html#/";
  // id = the slide's id in web/deck/index.qmd (stable when slides are added or reordered)
  const slide = (id, title) => ({ label: title, href: DECK + id });
  const MODE_WHY = {
    none: "No protection is switched on, so nothing is checked.",
    "cedar-only": "Cedar allowed this single call, and nothing remembers where the data came from.",
    fides: "FIDES has no tenant in its labels, and for a tool without a trust declaration it believes labels written in the call's arguments.",
  };

  function explain(mode, act, resp, ctx) {
    const name = act.op === "call" ? "call:" + act.tool : act.op;
    if (M.isDenied(resp)) {
      const r = resp.reason;
      if (r === "cedar") return { tone: "blocked", short: "Cedar says no: this role has no permission for this step.",
        detail: `Cedar denied ${name} for the agent's role. Cedar judges each call on its own (role and action); nothing is proven about Cedar itself.`,
        slide: slide("cedar", "What Cedar checks per call") };
      if (r.startsWith("flow: context not readable")) return { tone: "blocked", short: "TenantFlow blocks it: this agent carries data that the receiver may not see.",
        detail: "Monitor rule for call: every observer of the tool must be allowed to read the agent's context label. The label comes from where the data was read, not from what it says.",
        theorem: "Model.isolation", slide: slide("invariant", "The invariant as a formula") };
      if (r.startsWith("flow: tool requires trusted")) return { tone: "blocked", short: "TenantFlow blocks it: this tool needs trusted input, and the agent has read untrusted data.",
        detail: "Monitor rule for call: a tool with needsTrusted requires an integrity-trusted context. The registry marks that source untrusted, and labels cover the labels of all sources, integrity included. That a label written inside the data is never read is by construction and tested, not a theorem.",
        theorem: "Model.isolation_int", also: "Model.no_launder", slide: slide("forgery", "The forgery attack") };
      if (r.startsWith("flow: tainted")) return { tone: "blocked", short: "TenantFlow blocks it: this agent has read another tenant's data and may not write to the shared index.",
        detail: "Monitor rule for write: the agent's context must be readable by its own tenant. Whatever is written keeps the writer's label, which covers all its sources.", theorem: "Model.no_launder", slide: slide("labels", "Labels") };
      if (r.startsWith("fides:")) return { tone: "blocked", short: "FIDES blocks it: it considers the context untrusted.", detail: "FIDES 1.5.0 label logic (re-implemented): needs-trusted tools refuse an untrusted context.", slide: slide("forgery", "The forgery attack") };
      return { tone: "blocked", short: `Not possible: ${r}.`, detail: `Monitor precondition: ${r}.` };
    }
    if (ctx.leak && ctx.goal === "forgedPay") return { tone: "leak", short: "Allowed – Payments just acted on untrusted data from outside. " + MODE_WHY[mode],
      detail: "The payment tool requires trusted input, but the agent's context depends on an untrusted source (ground truth).", slide: slide("forgery", "The forgery attack") };
    if (ctx.leak) return { tone: "leak", short: "Allowed – and that was the leak. " + MODE_WHY[mode],
      detail: "Every single step passed the active checks. The data now reached the other side.", slide: slide("sequence", "Three allowed calls, one leak") };
    if (mode === "tenantflow" && act.op === "query") return { tone: "ok", short: "Allowed. The search only returns entries this tenant may read.",
      detail: "Only documents whose label is readable by the agent's tenant are ranked; the agent's label becomes the join of what it received.", theorem: "Model.noninterference", slide: slide("labels", "Labels") };
    if (mode === "tenantflow" && act.op === "write") return { tone: "ok", short: "Allowed. The entry keeps the writer's colour.",
      detail: "The document is stored with the writer's context label; whoever reads it later inherits that label.", theorem: "Model.no_launder", slide: slide("labels", "Labels") };
    if (mode === "tenantflow" && act.op === "delegate") return { tone: "ok", short: "Allowed. The helper starts with the same colour as its parent.",
      detail: "A child's context label equals its parent's at creation, and labels only grow.", theorem: "Model.child_ctx_eq", slide: slide("labels", "Labels") };
    if (mode === "tenantflow" && act.op === "call" && resp.kind === "payload") return { tone: "ok", short: "Allowed. The agent now carries the colour of what it read.",
      detail: "The result's label comes from the tool registry and is joined into the agent's context label.", theorem: "Model.no_launder", slide: slide("labels", "Labels") };
    return { tone: "ok", short: "Allowed.", detail: mode === "tenantflow" ? "All checks passed." : MODE_WHY[mode], slide: slide("cedar", "What Cedar checks per call") };
  }

  function explainFiltered(mode, doc, t) {
    const tenant = { bank: "the bank", insure: "the insurer" }[t] || t;
    return { tone: "blocked", short: `The search did not return it: this entry is not readable by ${tenant}.`,
      detail: `TenantFlow filters the shared index per tenant: the entry is labelled ${[...doc.label.owners].join(", ") || "no owner"}. The search ran (and was allowed), but only entries readable by ${tenant} were ranked.`,
      theorem: "Model.noninterference", slide: slide("sequence", "Three allowed calls, one leak") };
  }

  const api = { leaked, forgedPay, won, fuzz, replay, explain, explainFiltered, rng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TF = Object.assign(root.TF || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
