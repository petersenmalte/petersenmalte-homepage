// Game logic without DOM: a level session holds the monitor plus the data chips each agent holds.
// The board (board.js) turns a drag "item onto target" into monitor actions via `drop`; replays use `run`.
(function (root) {
  "use strict";
  const node = typeof module !== "undefined" && module.exports;
  const M = node ? require("./monitor.js") : root.TF;
  const R = node ? require("./rules.js") : root.TF;
  const L = node ? require("./levels.js") : root.TF;

  const key = (p) => JSON.stringify(p);
  let chipSeq = 0;

  class Session {
    /** level: an entry of LEVELS; mode: none | cedar-only | fides | tenantflow; cedar: optional allow-list */
    constructor(level, mode, cedar) {
      this.level = level; this.mode = mode;
      const sc = L.withTrace(level, []);
      if (cedar) sc.cedar = cedar;
      this.scenario = sc;
      this.mon = M.monitorFromScenario(sc, mode);
      this.hands = new Map(); // agentKey -> [chip]
      for (const st of this.mon.agents.values()) this.hands.set(M.agentKey(st.id), []);
      for (const c of level.startHand || []) this.give(c.agent, c.payload, M.labelFromJson(c.label), c.origin);
      this.log = [];
      this.won = false;
    }
    agents() { return [...this.mon.agents.values()]; }
    tenantOf(a) { return this.mon.sessions[a.session][0]; }
    hand(a) { return this.hands.get(M.agentKey(a)) || []; }
    chipLabel(chip) { return chip.label; }

    give(a, payload, label, origin) {
      const h = this.hands.get(M.agentKey(a)) || [];
      if (!h.some((c) => key(c.payload) === key(payload)))
        h.push({ id: "c" + ++chipSeq, payload, label: M.labelJson(label), origin });
      this.hands.set(M.agentKey(a), h);
    }

    /** One monitor step; updates hands. Returns the log entry. */
    run(agent, action, meta = {}) {
      const before = this.won;
      // hypothesis of theorem (e) before the step: the agent depends only on its tenant's trusted data
      const st0 = this.mon.agents.get(M.agentKey(agent));
      const t0 = st0 && this.mon.sessions[st0.session] ? this.mon.sessions[st0.session][0] : null;
      const single = st0 && st0.ctx.integ === M.TRUSTED && st0.ctx.owners.size === 1 && st0.ctx.owners.has(t0);
      const info0 = action.op === "call" && t0 ? this.mon.toolInfo(t0, action.tool) : null;
      const privateTool = action.op !== "call" || (info0 && info0.observers.every((u) => u === t0));
      const response = this.mon.step(agent, action);
      const entry = { agent, action, response, meta };
      this.log.push(entry);
      const st = this.mon.agents.get(M.agentKey(agent));
      entry.ctx = st ? M.labelJson(st.ctx) : null;
      if (!M.isDenied(response)) {
        if (action.op === "call" && response.kind === "payload") {
          const info = this.mon.toolInfo(this.tenantOf(agent), action.tool);
          this.give(agent, response.value, info.result, action.tool);
        } else if (action.op === "query") {
          for (const v of response.values) {
            const doc = this.mon.index.find((d) => key(d.payload) === key(v));
            this.give(agent, v, doc ? doc.label : st.ctx, "index");
          }
        } else if (action.op === "delegate") {
          const child = M.childId(agent, response.n);
          this.hands.set(M.agentKey(child), []);
          if (action.task != null && meta.chip) this.give(child, action.task, M.labelFromJson(meta.chip.label), "task");
        } else if (action.op === "receive") {
          const child = this.mon.agents.get(M.agentKey(M.childId(agent, action.child)));
          for (const v of response.values) this.give(agent, v, child.ctx, "helper");
        }
      }
      this.won = R.won(this.level.goal, this.mon, this.log);
      entry.leak = this.won && !before;
      entry.why = R.explain(this.mode, action, response, { leak: entry.leak, goal: this.level.goal });
      if (this.mode === "tenantflow" && single && privateTool && !M.isDenied(response))
        entry.why = { ...entry.why, also: "Model.transparency",
          detail: entry.why.detail + " Before this step the agent depended only on its own tenant's trusted data" +
            (action.op === "call" ? " and the tool is private to its tenant" : "") +
            ", so TenantFlow could not have denied it for a flow reason (theorem (e)): only Cedar or a missing agent, tool or child can." };
      if (action.op === "query" && !M.isDenied(response) && st) {
        // a matching entry that this tenant may not read was left out: say so (only TenantFlow filters)
        const t = this.tenantOf(agent);
        const hidden = this.mon.index.find((d) => !M.readableBy(d.label, t) && M.score(action.q, d.payload) > 0 &&
          !response.values.some((v) => key(v) === key(d.payload)));
        if (hidden) { entry.filtered = true; entry.why = R.explainFiltered(this.mode, hidden, t); }
      }
      return entry;
    }

    /** item: {kind: 'source', tool} | {kind: 'doc', i} | {kind: 'chip', agent, chip} | {kind: 'agent', agent}
     *  target: {kind: 'agent', agent} | {kind: 'index'} | {kind: 'sink', tool} | {kind: 'spawn', role}
     *  Returns {ok, entries, filtered?} or null if the move is not possible at all. */
    drop(item, target) {
      const entries = [];
      if (item.kind === "source" && target.kind === "agent") {
        entries.push(this.run(target.agent, { op: "call", tool: item.tool, args: "read" }));
      } else if (item.kind === "doc" && target.kind === "agent") {
        const doc = this.mon.index[item.i];
        const before = this.hand(target.agent).slice();
        const e = this.run(target.agent, { op: "query", q: M.payloadText(doc.payload) });
        entries.push(e);
        // the player asked for this entry: only it lands in the hand (the context label still joins all results)
        const got = this.hand(target.agent).filter((c) => !before.includes(c) && key(c.payload) === key(doc.payload));
        this.hands.set(M.agentKey(target.agent), [...before, ...got]);
        if (!M.isDenied(e.response) && !e.response.values.some((v) => key(v) === key(doc.payload))) {
          e.filtered = true;
          e.why = R.explainFiltered(this.mode, doc, this.tenantOf(target.agent));
          return { ok: false, filtered: true, entries };
        }
      } else if (item.kind === "chip" && target.kind === "index") {
        entries.push(this.run(item.agent, { op: "write", payload: item.chip.payload }));
      } else if (item.kind === "chip" && target.kind === "sink") {
        entries.push(this.run(item.agent, { op: "call", tool: target.tool, args: item.chip.payload }, { chip: item.chip }));
      } else if (item.kind === "chip" && target.kind === "spawn") {
        entries.push(this.run(item.agent, { op: "delegate", role: target.role, task: item.chip.payload }, { chip: item.chip }));
      } else if (item.kind === "chip" && target.kind === "agent") {
        // child hands data back to its parent: report, then the parent receives
        const c = item.agent, p = target.agent;
        const isChild = c.session === p.session && c.path.length === p.path.length + 1 && p.path.every((n, i) => n === c.path[i]);
        if (!isChild) return null;
        const e1 = this.run(c, { op: "report", payload: item.chip.payload });
        entries.push(e1);
        if (!M.isDenied(e1.response)) entries.push(this.run(p, { op: "receive", child: c.path[c.path.length - 1] }));
      } else return null;
      return { ok: entries.every((e) => !M.isDenied(e.response)), entries };
    }
  }

  /** Runs a level's scripted attack in every mode: {mode: won} */
  function compare(level, cedar) {
    const out = {};
    for (const mode of M.MODES) {
      const s = new Session(level, mode, cedar);
      for (const st of level.solution) s.run(st.agent, st.action);
      out[mode] = s.won;
    }
    return out;
  }

  const api = { Session, compare };
  if (node) module.exports = api;
  else root.TF = Object.assign(root.TF || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
