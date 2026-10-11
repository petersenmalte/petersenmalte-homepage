// The interactive board: bank side | shared middle | insurer side. Data chips are dragged (mouse, touch) or
// picked and placed (click / tap / keyboard) onto agents, the shared index and tools. Every move runs the real
// monitor (play.js) and is animated: the chip lands, or bounces back with the reason.
// Used by the game (game.js) and by the live widgets in the slide deck.
(function (root) {
  "use strict";
  const TF = root.TF;
  const reduced = () => root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));
  const isVar = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.var === "string";
  const short = (v) => { if (isVar(v)) return "🔒 hidden by FIDES (" + v.var + ")"; const s = show(v); return s.length > 26 ? s.slice(0, 24) + "…" : s; };
  const TENANT_NAME = { bank: "Bank", insure: "Insurer" };

  function labelClass(label) {
    const o = [...(label.owners || [])].sort();
    const c = o.length === 0 ? "nobody" : o.length > 1 ? "mixed" : o[0];
    return "lab-" + c + (label.integrity === "untrusted" || label.integ === "untrusted" ? " untrusted" : "");
  }
  function labelText(label) {
    const o = [...(label.owners || [])].sort().map((t) => TENANT_NAME[t] || t);
    const integ = label.integrity || label.integ;
    return (o.length ? o.join(" + ") : "no owner") + (integ === "untrusted" ? ", untrusted" : "");
  }
  const forged = (p) => p && typeof p === "object" && p.security_label;

  /**
   * mountBoard(el, {level, mode, cedar, compact, onEvent(entry, result), onWin(session)})
   * returns {session, reset(mode, cedar), play(steps), destroy()}
   */
  function mountBoard(el, opts) {
    let S = new TF.Session(opts.level, opts.mode, opts.cedar);
    let picked = null; // {item, el}
    let busy = false;
    let announced = false;
    const live = h("div", { class: "sr-only", "aria-live": "assertive" });

    // ---- what can go where ----
    function targetsFor(item) {
      const t = [];
      for (const st of S.agents()) {
        const a = { kind: "agent", agent: st.id };
        if (item.kind === "source" || item.kind === "doc") t.push(a);
        if (item.kind === "chip") {
          const c = item.agent, p = st.id;
          if (c.session === p.session && c.path.length === p.path.length + 1 && p.path.every((n, i) => n === c.path[i])) t.push(a);
        }
      }
      if (item.kind === "chip") {
        t.push({ kind: "index" });
        for (const [tool, ui] of Object.entries(TF.TOOL_UI)) if (ui.kind === "sink" && S.mon.tools[tool]) t.push({ kind: "sink", tool });
        if (opts.level.spawn && item.agent.path.length === 0) t.push({ kind: "spawn", role: opts.level.spawn.role });
      }
      return t;
    }
    const targetKey = (t) => t.kind === "agent" ? "agent:" + TF.agentKey(t.agent) : t.kind === "sink" ? "tool:" + t.tool : t.kind;
    const placeEl = (k) => el.querySelector(`[data-place="${CSS.escape(k)}"]`);

    // ---- rendering ----
    function chipEl(chip, item, extraClass) {
      const b = h("button", { type: "button", class: `chip ${labelClass(chip.label)} ${extraClass || ""}`, "data-chip": chip.id,
        "aria-label": `Data "${show(chip.payload)}", label ${labelText(chip.label)}. Pick up to move.`, title: show(chip.payload) },
        h("span", { class: "chip-text" }, short(chip.payload)),
        forged(chip.payload) ? h("span", { class: "sticker" }, "says: trusted ✓") : null);
      if (item) makeDraggable(b, item);
      else b.disabled = true;
      return b;
    }
    function agentCard(st) {
      const a = st.id, k = TF.agentKey(a);
      const tenant = S.tenantOf(a);
      const isChild = a.path.length > 0;
      const ctx = TF.labelJson(st.ctx);
      const card = h("div", { class: `place agent ${tenant}`, "data-place": "agent:" + k },
        h("div", { class: "agent-head" },
          h("span", { class: `avatar ${labelClass(ctx)}`, "aria-hidden": "true" }, isChild ? "🤖" : "🧑‍💼"),
          h("span", null, h("strong", null, isChild ? "Helper" : `${TENANT_NAME[tenant] || tenant} agent`),
            h("span", { class: "muted small" }, ` role ${st.role}`))),
        h("div", { class: "carries small" }, "carries: ", h("span", { class: `tag ${labelClass(ctx)}` }, labelText(ctx))),
        h("div", { class: "hand" }, S.hand(a).map((c) => chipEl(c, { kind: "chip", agent: a, chip: c }))));
      return card;
    }
    function toolTile(tool) {
      const ui = TF.TOOL_UI[tool];
      const tile = h(ui.kind === "source" ? "button" : "div", {
        class: `place tool ${ui.kind}`, "data-place": "tool:" + tool, type: ui.kind === "source" ? "button" : null,
        "aria-label": `${ui.name}: ${ui.note}${ui.kind === "source" ? " Pick up to read it with an agent." : ""}` },
        h("span", { class: "tool-icon", "aria-hidden": "true" }, ui.icon),
        h("span", null, h("strong", null, ui.name), h("span", { class: "small muted block" }, ui.note)));
      if (ui.kind === "source") makeDraggable(tile, { kind: "source", tool });
      if (ui.kind === "sink") {
        const evs = S.mon.events.filter((e) => e.tool === tool);
        if (evs.length) tile.append(h("div", { class: "hand" }, evs.map((e) => chipEl({ id: "e", payload: e.args, label: TF.labelJson(e.label) }, null, "landed"))));
      }
      return tile;
    }
    function render() {
      const sides = { bank: [], middle: [], insure: [] };
      for (const tool of Object.keys(S.mon.tools)) if (TF.TOOL_UI[tool]) sides[TF.TOOL_UI[tool].side].push(toolTile(tool));
      const agents = S.agents().sort((x, y) => x.id.path.length - y.id.path.length);
      for (const st of agents) sides[S.tenantOf(st.id) === "insure" ? "insure" : "bank"].push(agentCard(st));
      if (opts.level.spawn) sides.bank.push(h("div", { class: "place spawn", "data-place": "spawn" },
        h("span", { class: "tool-icon", "aria-hidden": "true" }, "➕"),
        h("span", null, h("strong", null, opts.level.spawn.label), h("span", { class: "small muted block" }, "Drop data here to hand it to a new helper."))));
      const index = h("div", { class: "place index", "data-place": "index" },
        h("div", { class: "index-head" }, h("strong", null, "Shared search index"), h("span", { class: "small muted" }, " both companies use it")),
        h("div", { class: "hand" }, S.mon.index.length ? S.mon.index.map((d, i) =>
          chipEl({ id: "d" + i, payload: d.payload, label: TF.labelJson(d.label) }, { kind: "doc", i })) : h("span", { class: "muted small" }, "empty")));
      sides.middle.unshift(index);
      el.replaceChildren(
        h("div", { class: `board ${opts.compact ? "compact" : ""}` },
          h("div", { class: "side bank", role: "region", "aria-label": "Bank side" }, h("h3", { class: "side-title" }, "🏦 Bank"), sides.bank),
          h("div", { class: "side middle", role: "region", "aria-label": "Shared platform" }, h("h3", { class: "side-title" }, "Shared platform"), sides.middle),
          h("div", { class: "side insure", role: "region", "aria-label": "Insurer side" }, h("h3", { class: "side-title" }, "🛡️ Insurer"), sides.insure)),
        live);
      if (picked) highlight(picked.item);
    }

    // ---- picking, dragging, dropping ----
    function highlight(item) {
      el.querySelectorAll(".place").forEach((p) => p.classList.remove("droppable"));
      if (!item) return;
      for (const t of targetsFor(item)) {
        const p = placeEl(targetKey(t));
        if (p) { p.classList.add("droppable"); p.dataset.target = JSON.stringify(t); }
      }
    }
    function clearPick() {
      picked = null;
      el.querySelectorAll(".picked").forEach((x) => x.classList.remove("picked"));
      highlight(null);
    }
    function makeDraggable(node, item) {
      node.classList.add("draggable");
      let start = null, ghost = null;
      node.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (busy) return;
        if (picked && picked.el === node) { clearPick(); return; }
        clearPick();
        picked = { item, el: node };
        node.classList.add("picked");
        highlight(item);
        live.textContent = "Picked up. Now choose where to put it; highlighted places accept it. Escape cancels.";
      });
      node.addEventListener("pointerdown", (ev) => {
        if (busy || ev.button !== 0) return;
        start = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
      });
      node.addEventListener("pointermove", (ev) => {
        if (!start || ev.pointerId !== start.id) return;
        if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) {
          node.setPointerCapture(ev.pointerId);
          ghost = node.cloneNode(true);
          ghost.classList.add("ghost");
          document.body.append(ghost);
          node.classList.add("lifted");
          highlight(item);
        }
        if (ghost) {
          ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px";
          const over = dropTargetAt(ev.clientX, ev.clientY);
          el.querySelectorAll(".over").forEach((x) => x.classList.remove("over"));
          if (over) over.classList.add("over");
        }
      });
      const end = async (ev) => {
        if (!start) return;
        start = null;
        if (!ghost) return; // a click, handled above
        ev.preventDefault();
        const over = dropTargetAt(ev.clientX, ev.clientY);
        const g = ghost; ghost = null;
        node.classList.remove("lifted");
        el.querySelectorAll(".over").forEach((x) => x.classList.remove("over"));
        // swallow the click that follows a drag
        node.addEventListener("click", (e) => e.stopImmediatePropagation(), { once: true, capture: true });
        if (over) await perform(item, JSON.parse(over.dataset.target), node, g);
        else { await flyBack(g, node); highlight(null); }
      };
      node.addEventListener("pointerup", end);
      node.addEventListener("pointercancel", end);
    }
    function dropTargetAt(x, y) {
      const hit = document.elementFromPoint(x, y);
      const p = hit && hit.closest(".place.droppable");
      return p && el.contains(p) ? p : null;
    }
    el.addEventListener("click", (ev) => {
      if (!picked || busy) return;
      const p = ev.target.closest(".place.droppable");
      if (p && el.contains(p)) { const { item, el: src } = picked; clearPick(); perform(item, JSON.parse(p.dataset.target), src, null); }
    });
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && picked) { clearPick(); live.textContent = "Cancelled."; return; }
      if ((ev.key === "Enter" || ev.key === " ") && picked) {
        const p = ev.target.closest(".place.droppable");
        if (p && ev.target === p) { ev.preventDefault(); const { item, el: src } = picked; clearPick(); perform(item, JSON.parse(p.dataset.target), src, null); }
      }
    });
    function makeTargetsFocusable() {
      el.querySelectorAll(".place").forEach((p) => { if (!p.matches("button")) p.tabIndex = p.classList.contains("droppable") ? 0 : -1; });
    }
    new MutationObserver(makeTargetsFocusable).observe(el, { subtree: true, attributes: true, attributeFilter: ["class"] });

    // ---- animation ----
    function makeGhostAt(src) {
      const r = src.getBoundingClientRect();
      const g = src.cloneNode(true);
      g.classList.add("ghost");
      g.style.left = r.left + r.width / 2 + "px"; g.style.top = r.top + r.height / 2 + "px";
      document.body.append(g);
      return g;
    }
    async function flyTo(g, dest) {
      const r = dest.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 40);
      if (!reduced()) {
        const from = { left: g.style.left, top: g.style.top };
        await g.animate([from, { left: x + "px", top: y + "px" }], { duration: 450, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" }).finished;
      }
      g.style.left = x + "px"; g.style.top = y + "px";
    }
    async function flyBack(g, src) {
      if (!document.body.contains(src)) { g.remove(); return; }
      if (!reduced()) await g.animate([{ transform: "translate(-50%,-50%) translateX(0)" }, { transform: "translate(-50%,-50%) translateX(-8px)" },
        { transform: "translate(-50%,-50%) translateX(8px)" }, { transform: "translate(-50%,-50%) translateX(0)" }], { duration: 260 }).finished;
      await flyTo(g, src);
      g.remove();
    }
    function bubble(dest, text, tone) {
      const b = h("div", { class: `bubble ${tone}`, role: "status" }, text);
      dest.append(b);
      setTimeout(() => b.remove(), reduced() ? 4000 : 3600);
    }

    async function perform(item, target, srcEl, ghost) {
      if (busy) return;
      busy = true;
      const dest = placeEl(targetKey(target));
      const g = ghost || (srcEl && document.body.contains(srcEl) ? makeGhostAt(srcEl) : null);
      if (g) await flyTo(g, dest);
      const res = S.drop(item, target);
      const last = res && res.entries[res.entries.length - 1];
      if (!res || !res.ok) {
        if (g) await flyBack(g, srcEl);
        render();
        const d = placeEl(targetKey(target));
        if (last && d) bubble(d, last.why.short, "blocked");
      } else {
        if (g) g.remove();
        render();
        const d = placeEl(targetKey(target));
        if (d) { d.classList.add("pop"); setTimeout(() => d.classList.remove("pop"), 600); if (last && last.leak) bubble(d, "Leak!", "leak"); }
      }
      if (last) live.textContent = last.why.short;
      busy = false;
      if (opts.onEvent && res) opts.onEvent(res, S);
      if (S.won && !announced) { announced = true; if (opts.onWin) opts.onWin(S); }
    }

    // ---- replay of monitor steps (scripted attack, fuzzer counterexample) ----
    function placesFor(step) {
      const a = step.action, k = "agent:" + TF.agentKey(step.agent);
      if (a.op === "call") return TF.TOOL_UI[a.tool] && TF.TOOL_UI[a.tool].kind === "source" ? ["tool:" + a.tool, k] : [k, "tool:" + a.tool];
      if (a.op === "query") return ["index", k];
      if (a.op === "write") return [k, "index"];
      if (a.op === "delegate") return [k, "spawn"];
      if (a.op === "receive") return ["agent:" + TF.agentKey(TF.childId(step.agent, a.child)), k];
      return [k, k];
    }
    async function play(steps, delay = 900) {
      busy = true;
      for (const step of steps) {
        const [from, to] = placesFor(step).map(placeEl);
        let g = null;
        if (from && to && from !== to) {
          g = h("span", { class: "chip ghost dot" }, "•");
          const r = from.getBoundingClientRect();
          g.style.left = r.left + r.width / 2 + "px"; g.style.top = r.top + 30 + "px";
          document.body.append(g);
          await flyTo(g, to);
        }
        const e = S.run(step.agent, step.action);
        if (g) { if (TF.isDenied(e.response)) await flyBack(g, from); else g.remove(); }
        render();
        const d = to && placeEl(placesFor(step)[1]);
        if (d) bubble(d, e.why.short, TF.isDenied(e.response) ? "blocked" : e.leak ? "leak" : "ok");
        if (opts.onEvent) opts.onEvent({ ok: !TF.isDenied(e.response), entries: [e] }, S);
        await wait(delay);
      }
      busy = false;
      if (S.won && !announced) { announced = true; if (opts.onWin) opts.onWin(S); }
    }

    document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && picked) clearPick(); });
    render();
    return {
      get session() { return S; },
      reset(mode, cedar) {
        if (mode) opts.mode = mode;
        if (cedar !== undefined) opts.cedar = cedar;
        S = new TF.Session(opts.level, opts.mode, opts.cedar);
        picked = null; announced = false; busy = false;
        render();
      },
      play,
      render,
    };
  }

  root.TF = Object.assign(root.TF || {}, { mountBoard, labelClass, labelText });
})(typeof globalThis !== "undefined" ? globalThis : this);
