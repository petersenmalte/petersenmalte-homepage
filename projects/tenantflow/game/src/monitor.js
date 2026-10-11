// JS port of tenantflow.monitor (itself a line-by-line port of Lean `Exec.step`) and of the benchmark
// baselines (none / cedar-only / fides, see python/src/tenantflow/baselines.py; FIDES follows agent-framework-core
// 1.5.0: tier 2 declared source_integrity, tier 3 labels found in the call arguments, auto_hide_untrusted).
// Classic script that works in the browser (global `TF`) and in Node (`require`).
(function (root) {
  "use strict";
  const TRUSTED = "trusted", UNTRUSTED = "untrusted", DELIVER = "deliver";
  const MODES = ["none", "cedar-only", "fides", "tenantflow"];

  // ---- labels ----
  const label = (owners, integ = TRUSTED) => ({ owners: new Set(owners), integ });
  const join = (a, b) => ({
    owners: new Set([...a.owners, ...b.owners]),
    integ: a.integ === UNTRUSTED || b.integ === UNTRUSTED ? UNTRUSTED : TRUSTED,
  });
  const joinAll = (ls) => ls.reduce(join, label([]));
  const readableBy = (l, tenant) => [...l.owners].every((t) => t === tenant);
  const labelJson = (l) => ({ owners: [...l.owners].sort(), integrity: l.integ });
  const labelFromJson = (j) => {
    if (j.integrity !== TRUSTED && j.integrity !== UNTRUSTED) throw new Error("bad integrity");
    return label(j.owners, j.integrity);
  };

  // ---- toy embedding (must match Lean / Python exactly) ----
  const sortKeys = (v) =>
    Array.isArray(v) ? v.map(sortKeys)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
    : v;
  const payloadText = (p) => (typeof p === "string" ? p : JSON.stringify(sortKeys(p)));
  const tokens = (s) => s.split(/\s+/).filter((t) => t.length > 0);
  const score = (q, p) => {
    const pt = tokens(payloadText(p));
    return tokens(q).filter((t) => pt.includes(t)).length;
  };

  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
  const agentKey = (a) => a.session + "/" + a.path.join(".");
  const childId = (a, n) => ({ session: a.session, path: [...a.path, n] });
  const denied = (reason) => ({ kind: "denied", reason });
  const isDenied = (r) => r.kind === "denied";

  // ---- FIDES label logic (agent-framework-core 1.5.0, re-implemented as in baselines.py) ----
  const CONF = { public: 0, private: 1 };
  const fidesLabel = (integrity = TRUSTED, conf = "public") => ({ integrity, conf });
  const fidesJoin = (a, b) => ({
    integrity: a.integrity === UNTRUSTED || b.integrity === UNTRUSTED ? UNTRUSTED : TRUSTED,
    conf: CONF[a.conf] >= CONF[b.conf] ? a.conf : b.conf,
  });
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  function embeddedLabel(p) {
    // ContentLabel.from_dict of a dict's security_label field (the forgeable part), or null
    if (isObj(p) && "security_label" in p && isObj(p.security_label)) {
      const d = p.security_label;
      const integ = "integrity" in d ? d.integrity : TRUSTED;
      const conf = "confidentiality" in d ? d.confidentiality : "public";
      if ((integ !== TRUSTED && integ !== UNTRUSTED) || !(conf in CONF)) return null;
      return fidesLabel(integ, conf);
    }
    return null;
  }

  class Monitor {
    /** cfg: {sessions:{sid:[tenant,user,role]}, tools, toolResults, authorize(role,action), topK, index:[{label,payload}]} */
    constructor(mode, cfg) {
      if (!MODES.includes(mode)) throw new Error("unknown mode " + mode);
      this.mode = mode;
      this.sessions = cfg.sessions;
      this.tools = cfg.tools || {};
      this.toolResults = cfg.toolResults || {};
      this.authorize = cfg.authorize || (() => true);
      this.topK = cfg.topK ?? 3;
      this.index = (cfg.index || []).map((d) => ({ label: d.label, payload: clone(d.payload) }));
      this.agents = new Map();
      this.events = [];
      this.fidesCtx = new Map();
      this.fidesDocs = new Map(); // doc object -> FidesLabel
      this.fidesCfg = { undeclared: new Set((cfg.fides && cfg.fides.undeclared) || []), autoHide: !cfg.fides || cfg.fides.autoHide !== false };
      this.fidesVars = new Map(); // var id -> [FIDES label, ground-truth label of the hidden data]
      for (const [sid, [tenant, , role]] of Object.entries(this.sessions)) {
        const a = { session: sid, path: [] };
        this.agents.set(agentKey(a), { id: a, session: sid, role, ctx: label([tenant]), nextChild: 0, outbox: [], parent: null });
        this.fidesCtx.set(agentKey(a), fidesLabel());
      }
      for (const d of this.index) this.fidesDocs.set(d, fidesLabel(TRUSTED, "private"));
    }

    toolInfo(tenant, tool) {
      if (tool === DELIVER) return { observers: [tenant], needsTrusted: false, result: null };
      return this.tools[tool] || null;
    }
    rank(q, docs) {
      return docs.map((d, i) => [d, i, score(q, d.payload)])
        .sort((x, y) => y[2] - x[2] || x[1] - y[1]).slice(0, this.topK).map((x) => x[0]);
    }
    actionName(act) { return act.op === "call" ? "call:" + act.tool : act.op; }
    /** _get_input_labels: labels in the call arguments (+ ground truth of referenced hidden results) */
    argLabels(value) {
      const fl = [], gt = [];
      const walk = (v) => {
        if (isObj(v) && Object.keys(v).length === 1 && typeof v.var === "string" && this.fidesVars.has(v.var)) {
          const [f, g] = this.fidesVars.get(v.var); fl.push(f); gt.push(g);
        } else if (isObj(v)) {
          let lab = embeddedLabel(v);
          if (!lab && !("security_label" in v) && isObj(v.label)) lab = embeddedLabel({ security_label: v.label });
          if (lab) fl.push(lab);
          Object.values(v).forEach(walk);
        } else if (Array.isArray(v)) v.forEach(walk);
      };
      walk(value);
      return [fl, gt];
    }

    step(a, act) {
      const key = agentKey(a);
      const st = this.agents.get(key);
      if (!st) return denied("unknown agent");
      const sess = this.sessions[st.session];
      if (!sess) return denied("unknown session");
      const t = sess[0];
      const tf = this.mode === "tenantflow", fides = this.mode === "fides";
      const cedar = this.mode === "none" || this.authorize(st.role, this.actionName(act));
      const fctx = this.fidesCtx.get(key) || fidesLabel();

      switch (act.op) {
        case "call": {
          const info = this.toolInfo(t, act.tool);
          if (!info) return denied("unregistered tool");
          if (!cedar) return denied("cedar");
          if (tf) {
            if (!info.observers.every((u) => readableBy(st.ctx, u))) return denied("flow: context not readable by every observer of the tool");
            if (info.needsTrusted && st.ctx.integ !== TRUSTED) return denied("flow: tool requires trusted input");
          } else if (fides && info.needsTrusted && fctx.integrity !== TRUSTED) {
            return denied("fides: untrusted context");
          }
          const [argFl, argGt] = fides ? this.argLabels(act.args) : [[], []];
          const eventLabel = argGt.reduce(join, st.ctx); // dereferenced hidden data flows into the tool
          let resp = { kind: "ok" };
          if (act.tool !== DELIVER && info.result) resp = { kind: "payload", value: clone(this.toolResults[act.tool] ?? null) };
          this.events.push({ tenant: t, tool: act.tool, args: clone(act.args ?? null), label: eventLabel });
          if (!info.result) return resp; // nothing comes back to the agent
          const gtResult = join(eventLabel, info.result);
          if (!fides) { st.ctx = gtResult; return resp; }
          let resultFl;
          if (!this.fidesCfg.undeclared.has(act.tool)) resultFl = fidesLabel(info.result.integ, "private"); // tier 2
          else if (argFl.length) resultFl = fidesLabel(argFl.reduce(fidesJoin, fidesLabel()).integrity, "private"); // tier 3
          else resultFl = fidesLabel(UNTRUSTED, "private");
          if (this.fidesCfg.autoHide && resultFl.integrity === UNTRUSTED && resp.kind === "payload") {
            const vid = "var_" + (this.fidesVars.size + 1);
            this.fidesVars.set(vid, [resultFl, gtResult]);
            this.fidesCtx.set(key, fidesLabel(fctx.integrity, fidesJoin(fctx, resultFl).conf)); // hidden: integrity unchanged
            return { kind: "payload", value: { var: vid } };
          }
          st.ctx = gtResult;
          this.fidesCtx.set(key, fidesJoin(fctx, resultFl));
          return resp;
        }
        case "query": {
          if (!cedar) return denied("cedar");
          const pool = tf ? this.index.filter((d) => readableBy(d.label, t)) : this.index;
          const ranked = this.rank(act.q, pool);
          st.ctx = join(st.ctx, joinAll(ranked.map((d) => d.label)));
          if (fides) {
            let f = fctx;
            for (const d of ranked) f = fidesJoin(f, this.fidesDocs.get(d) || fidesLabel(TRUSTED, "private"));
            this.fidesCtx.set(key, f);
          }
          return { kind: "payloads", values: ranked.map((d) => clone(d.payload)) };
        }
        case "write": {
          if (!cedar) return denied("cedar");
          if (tf && !readableBy(st.ctx, t)) return denied("flow: tainted agent may not write");
          const doc = { label: st.ctx, payload: clone(act.payload ?? null) };
          this.index.push(doc);
          if (fides) this.fidesDocs.set(doc, fidesLabel(fctx.integrity, "private"));
          return { kind: "ok" };
        }
        case "delegate": {
          if (!cedar) return denied("cedar");
          const n = st.nextChild++;
          const cid = childId(a, n);
          this.agents.set(agentKey(cid), { id: cid, session: st.session, role: act.role, ctx: st.ctx, nextChild: 0, outbox: [], parent: a });
          this.fidesCtx.set(agentKey(cid), fctx);
          return { kind: "child", n };
        }
        case "report": {
          if (!st.parent) return denied("report: agent has no parent");
          st.outbox.push(clone(act.payload ?? null));
          return { kind: "ok" };
        }
        case "receive": {
          const cid = childId(a, act.child);
          const child = this.agents.get(agentKey(cid));
          if (!child) return denied("receive: no such child");
          const out = child.outbox;
          child.outbox = [];
          st.ctx = join(st.ctx, child.ctx);
          if (fides) this.fidesCtx.set(key, fidesJoin(fctx, this.fidesCtx.get(agentKey(cid)) || fidesLabel()));
          return { kind: "payloads", values: out };
        }
        default:
          throw new Error("bad op " + act.op);
      }
    }

    stateJson() {
      const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
      const agents = [...this.agents.values()].sort((x, y) =>
        cmp(x.session, y.session) || x.id.path.reduce((c, n, i) => c || (i >= y.id.path.length ? 1 : n - y.id.path[i]), 0) ||
        x.id.path.length - y.id.path.length);
      return {
        agents: agents.map((s) => ({ agent: s.id, ctx: labelJson(s.ctx), role: s.role, nextChild: s.nextChild, outbox: s.outbox, parent: s.parent })),
        index: this.index.map((d) => ({ label: labelJson(d.label), payload: d.payload })),
        events: this.events.map((e) => ({ tenant: e.tenant, tool: e.tool, args: e.args, label: labelJson(e.label) })),
      };
    }
  }

  // ---- ground truth (same as tenantflow.check.violations) ----
  function violations(mon) {
    const v = { confidentiality: false, integrity: false, detail: [] };
    for (const st of mon.agents.values()) {
      const tenant = mon.sessions[st.session][0];
      const foreign = [...st.ctx.owners].filter((o) => o !== tenant);
      if (foreign.length) { v.confidentiality = true; v.detail.push(`agent ${agentKey(st.id)} holds data of ${foreign}`); }
    }
    for (const e of mon.events) {
      const info = mon.toolInfo(e.tenant, e.tool);
      if (!info) continue;
      if (!info.observers.every((u) => readableBy(e.label, u))) {
        v.confidentiality = true;
        v.detail.push(`tool '${e.tool}' called with data of ${[...e.label.owners].sort()}, observed by ${info.observers}`);
      }
      if (info.needsTrusted && e.label.integ !== TRUSTED) { v.integrity = true; v.detail.push(`trusted-only tool '${e.tool}' ran on an untrusted context`); }
    }
    v.any = v.confidentiality || v.integrity;
    return v;
  }

  // ---- scenario runner (oracle-compatible; `mode` selects the system) ----
  function monitorFromScenario(sc, mode = "tenantflow") {
    const sessions = {};
    for (const s of sc.sessions) {
      if (s.sid in sessions) throw new Error("duplicate session id " + s.sid);
      sessions[s.sid] = [s.tenant, s.user, s.role || "default"];
    }
    const tools = {};
    for (const [k, v] of Object.entries(sc.tools || {}))
      tools[k] = { observers: v.observers, needsTrusted: !!v.needsTrusted, result: v.result ? labelFromJson(v.result) : null };
    const cedar = sc.cedar ?? "allow_all";
    const allowed = cedar === "allow_all" ? null : new Set(cedar.allow.map((r) => r.role + "\u0000" + r.action));
    return new Monitor(mode, {
      sessions, tools, toolResults: sc.toolResults || {}, topK: sc.topK ?? 3, fides: sc.fides,
      authorize: allowed ? (role, action) => allowed.has(role + "\u0000" + action) : () => true,
      index: (sc.index || []).map((d) => ({ label: labelFromJson(d.label), payload: d.payload })),
    });
  }
  function runScenario(sc, mode = "tenantflow") {
    const mon = monitorFromScenario(sc, mode);
    const decisions = sc.trace.map((s) => {
      const resp = mon.step(s.agent, s.action);
      const st = mon.agents.get(agentKey(s.agent));
      return { agent: s.agent, response: resp, denied: isDenied(resp), ctx: st ? labelJson(st.ctx) : null };
    });
    return { decisions, final: mon.stateJson(), monitor: mon };
  }

  const api = { TRUSTED, UNTRUSTED, DELIVER, MODES, Monitor, label, join, labelJson, labelFromJson, readableBy,
    agentKey, childId, isDenied, violations, monitorFromScenario, runScenario, score, payloadText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TF = Object.assign(root.TF || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
