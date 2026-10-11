// Shell of "Leak the Vault": level stepper, protection switch, mission, feedback with "Why?", result card, sandbox.
(function () {
  "use strict";
  const TF = window.TF;
  const { LEVELS, ALL_ACTIONS } = TF;
  const MODES = [
    { id: "none", name: "Off", note: "No checks at all." },
    { id: "cedar-only", name: "Cedar", note: "Each call is checked against a policy, one at a time." },
    { id: "fides", name: "FIDES", note: "Cedar plus FIDES-style labels (our re-implementation of the 1.5.0 logic)." },
    { id: "tenantflow", name: "TenantFlow", note: "Cedar plus tenant labels that follow the data." },
  ];
  const state = { level: 0, mode: "none", board: null, policy: null };

  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const $ = (id) => document.getElementById(id);
  const lv = () => LEVELS[state.level];
  const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));
  const thmLink = (name) => h("a", { href: TF.THEOREMS[name] || "#", target: "_blank", rel: "noopener" }, name);

  function describe(e) {
    const x = e.action, sess = state.board && state.board.session;
    const t = sess && sess.mon.sessions[e.agent.session] ? sess.mon.sessions[e.agent.session][0] : "?";
    const who = `${{ bank: "bank", insure: "insurer" }[t] || t} ${e.agent.path.length ? "helper" : "agent"}`;
    const what = { call: `call ${x.tool}(${show(x.args)})`, query: `query "${x.q}"`, write: `write ${show(x.payload)}`,
      delegate: `delegate to role ${x.role}`, report: `report ${show(x.payload)}`, receive: `receive from helper ${x.child}` }[x.op];
    return `${who}: ${what} → ${TF.isDenied(e.response) ? "denied (" + e.response.reason + ")" : e.filtered ? "allowed, entry filtered out" : "allowed"}`;
  }

  // ---- top controls ----
  function renderLevels() {
    $("levels").replaceChildren(...LEVELS.map((l, i) => h("button", {
      type: "button", class: "level-btn", "aria-current": i === state.level ? "step" : null,
      onclick: () => { state.level = i; start(); } }, h("span", { class: "num" }, String(l.id)), h("span", { class: "lt" }, l.title))));
  }
  function renderModes() {
    const box = $("modes");
    box.replaceChildren(h("span", { class: "modes-label" }, "Protection:"), ...MODES.map((m) => h("label", { class: "mode " + m.id },
      h("input", { type: "radio", name: "mode", value: m.id, checked: state.mode === m.id, onchange: () => { state.mode = m.id; restart(); } }),
      h("span", null, m.name))));
    $("mode-note").textContent = MODES.find((m) => m.id === state.mode).note;
  }

  // ---- mission & feedback ----
  function renderMission() {
    const l = lv();
    const hint = h("p", { class: "hint", hidden: true }, "Hint: " + l.hint);
    $("mission").replaceChildren(
      h("p", { class: "kicker" }, `Level ${l.id} of ${LEVELS.length}`),
      h("h2", null, l.mission),
      h("div", { class: "row" },
        h("button", { type: "button", onclick: () => { hint.hidden = !hint.hidden; } }, "💡 Hint"),
        l.solution.length ? h("button", { type: "button", onclick: showMe }, "▶ Show me") : null,
        h("button", { type: "button", onclick: restart }, "↺ Reset")),
      hint);
  }
  function feedback(res) {
    const last = res.entries[res.entries.length - 1];
    const w = last.why;
    const icon = { blocked: "⛔", leak: "💥", ok: "✅" }[w.tone] || "•";
    const det = h("details", null, h("summary", null, "Why? (details)"),
      h("p", null, w.detail),
      w.theorem ? h("p", null, "Lean theorem: ", thmLink(w.theorem), w.also ? [", ", thmLink(w.also)] : null)
        : w.also ? h("p", null, "Lean theorem: ", thmLink(w.also)) : h("p", { class: "muted" }, "No theorem is claimed about Cedar itself."),
      w.slide ? h("p", null, "Slide: ", h("a", { href: w.slide.href }, w.slide.label)) : null,
      h("p", { class: "mono small" }, res.entries.map(describe).join("\n")));
    $("feedback").className = "feedback " + w.tone;
    $("feedback").replaceChildren(h("p", { class: "fb-main" }, h("span", { "aria-hidden": "true" }, icon + " "), w.short), det);
  }
  function resultCard(won) {
    const l = lv();
    const cmp = TF.compare(l, state.policyCedar);
    const card = $("result");
    card.hidden = false;
    card.className = "result " + (won ? "leak" : "safe");
    card.replaceChildren(
      h("h2", null, won ? (l.goal === "forgedPay" ? "💥 Paid." : "💥 Leaked.") : "🛡️ Blocked."),
      h("p", { class: "lesson" }, l.lesson),
      l.solution.length ? h("div", { class: "compare", role: "table", "aria-label": "The same attack against every protection" },
        h("p", { class: "small muted" }, "The same attack against every protection:"),
        h("div", { class: "cmp-row" }, MODES.map((m) => h("div", { class: "cmp " + (cmp[m.id] ? "bad" : "good"), role: "cell" },
          h("strong", null, m.name), h("span", null, cmp[m.id] ? (l.goal === "forgedPay" ? "pays" : "leaks") : "blocks"))))) : null,
      h("details", null, h("summary", null, "Details"), h("p", null, l.lessonDetail),
        (l.theorems || []).length ? h("p", null, "Lean: ", (l.theorems || []).flatMap((t, i) => [i ? ", " : "", thmLink(t)])) : null,
        h("p", { class: "small muted" }, "Guarantees hold in the Lean model under the spec's assumptions: trusted session, adapter and tool registry, complete mediation, stateless tools, Cedar sees only principal and action, agents do not see denial reasons, no side channels incl. data-independent scheduling (A1–A8 in docs/spec.md §9). That the monitor never reads a label out of a payload is by construction and tested, not a theorem.")),
      h("div", { class: "row" },
        state.mode !== "tenantflow" ? h("button", { type: "button", class: "primary", onclick: () => { state.mode = "tenantflow"; restart(); } }, "Try it with TenantFlow") : null,
        state.level < LEVELS.length - 1 ? h("button", { type: "button", class: state.mode === "tenantflow" ? "primary" : "", onclick: () => { state.level++; start(); } }, "Next level →") : null));
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function showMe() {
    restart();
    await state.board.play(lv().solution);
    if (!state.board.session.won) resultCard(false);
  }

  // ---- sandbox (level 5) ----
  function renderSandbox() {
    const box = $("sandbox");
    if (!lv().sandbox) { box.hidden = true; return; }
    box.hidden = false;
    if (!state.policy) state.policy = new Set(ALL_ACTIONS.map((a) => "analyst|" + a));
    const roles = [["analyst", "Agents (role analyst)"], ["ops", "Helpers (role ops)"]];
    const nice = (a) => a.replace("call:notify_insure", "use Insurer inbox").replace("call:pay", "use Payments").replace("call:fetch", "read Web ticket")
      .replace("call:deliver", "answer the user").replace("query", "search index").replace("write", "write to index")
      .replace("delegate", "start a helper").replace("report", "report to parent").replace("receive", "receive from helper");
    const out = h("div", { id: "fuzz-out", "aria-live": "polite" });
    box.replaceChildren(
      h("h2", null, "Your Cedar policy"),
      h("p", { class: "small muted" }, "Tick what each role may do. Cedar checks every single call against this list."),
      h("div", { class: "policy" }, roles.map(([r, title]) => h("fieldset", null, h("legend", null, title),
        ALL_ACTIONS.map((a) => h("label", { class: "perm" }, h("input", { type: "checkbox", checked: state.policy.has(r + "|" + a),
          onchange: (ev) => { ev.target.checked ? state.policy.add(r + "|" + a) : state.policy.delete(r + "|" + a); restart(); } }), " " + nice(a)))))),
      h("div", { class: "row" }, h("button", { type: "button", class: "primary", onclick: () => attack(out) }, "🎲 Let the attacker try (1000 random runs)")),
      out);
  }
  function policyCedar() {
    return state.policy ? { allow: [...state.policy].map((k) => { const [role, action] = k.split("|"); return { role, action }; }) } : undefined;
  }
  async function attack(out) {
    restart();
    const found = TF.fuzz(state.board.session.scenario, state.mode, "violation", { seed: 1 + Math.floor(Math.random() * 1e6), episodes: 1000, length: 8 });
    if (!found) {
      out.replaceChildren(h("div", { class: "result safe" }, h("h2", null, "🛡️ Nothing found."),
        h("p", null, state.mode === "tenantflow" ? lv().lesson : "No leak in 1000 random runs of 8 steps with this policy. A random search can miss leaks; switch the protection and try again."),
        h("details", null, h("summary", null, "Details"), h("p", null, lv().lessonDetail), h("p", null, "Lean: ", thmLink("Model.isolation"), ", ", thmLink("Model.isolation_int")))));
      return;
    }
    out.replaceChildren(h("div", { class: "result leak" }, h("h2", null, `💥 Leak found after ${found.episode} runs, in ${found.steps.length} step(s). Watch:`),
      h("ol", { class: "mono small" }, found.steps.map((s) => h("li", null, describe({ ...s, response: { kind: "ok" } }).replace(/ → allowed$/, ""))))));
    await state.board.play(found.steps, 1100);
  }

  // ---- lifecycle ----
  function restart() {
    $("result").hidden = true;
    $("feedback").className = "feedback";
    $("feedback").replaceChildren(h("p", { class: "fb-main muted" }, "Drag a tile or a coloured chip onto a highlighted place. Or click it, then click the place."));
    state.policyCedar = lv().sandbox ? policyCedar() : undefined;
    renderModes();
    if (!state.board) {
      state.board = TF.mountBoard($("board"), { level: lv(), mode: state.mode, cedar: state.policyCedar,
        onEvent: (res) => {
          feedback(res);
          // the attack this level is about cannot work in this mode: say so and show the lesson
          if (!res.ok && !lv().sandbox && lv().solution.length && !TF.compare(lv(), state.policyCedar)[state.mode]) resultCard(false);
        },
        onWin: () => { if (!lv().sandbox) resultCard(true); } });
    } else state.board.reset(state.mode, state.policyCedar);
  }
  function start() {
    state.board = null;
    const old = $("board"), fresh = old.cloneNode(false); // drop the old board's listeners
    old.replaceWith(fresh);
    renderLevels(); renderMission(); renderSandbox();
    restart();
    try { localStorage.setItem("ltv-level", String(state.level)); } catch (_) { /* storage unavailable */ }
  }
  try { const s = parseInt(localStorage.getItem("ltv-level"), 10); if (s >= 0 && s < LEVELS.length) state.level = s; } catch (_) { /* ignore */ }
  const p = new URLSearchParams(location.search);
  if (p.has("level")) state.level = Math.max(0, Math.min(LEVELS.length - 1, (parseInt(p.get("level"), 10) || 1) - 1));
  if (p.has("mode") && MODES.some((m) => m.id === p.get("mode"))) state.mode = p.get("mode");
  start();
})();
