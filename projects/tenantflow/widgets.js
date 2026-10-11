// Live widgets in the deck: <div class="tf-widget" data-level="2" data-mode="cedar-only" data-modes="cedar-only,tenantflow">
// mounts the game's board (game/src/board.js) running the real JS monitor. "Next step" plays the level's scripted
// attack one step at a time; the audience can also drag chips directly.
(function () {
  "use strict";
  document.documentElement.dataset.theme = "light"; // slides are light; keep the board light too
  const NAMES = { none: "Off", "cedar-only": "Cedar", fides: "FIDES", tenantflow: "TenantFlow" };
  const h = (tag, props, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v != null) e.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };

  function mount(box) {
    const level = TF.LEVELS[(+box.dataset.level || 1) - 1];
    const modes = (box.dataset.modes || box.dataset.mode || "tenantflow").split(",");
    let mode = box.dataset.mode || modes[0];
    let next = 0;
    const status = h("span", { class: "w-status", "aria-live": "polite" });
    const host = h("div", { class: "w-board" });
    const stepBtn = h("button", { type: "button", class: "w-step", onclick: step }, "Next step ▶");
    const bar = h("div", { class: "w-bar" },
      h("span", { class: "w-modes", role: "group", "aria-label": "Protection" }, modes.map((m) =>
        h("button", { type: "button", class: "w-mode " + m, "aria-pressed": String(m === mode), onclick: () => { mode = m; reset(); } }, NAMES[m]))),
      level.solution.length ? stepBtn : null,
      h("button", { type: "button", onclick: reset }, "Reset"),
      status);
    box.replaceChildren(...(box.dataset.controls === "none" ? [] : [bar]), host);
    const board = TF.mountBoard(host, { level, mode, compact: true,
      onEvent: (res) => { const w = res.entries[res.entries.length - 1].why; status.textContent = w.short; status.className = "w-status " + w.tone; } });
    async function step() {
      if (next >= level.solution.length) return;
      stepBtn.disabled = true;
      await board.play([level.solution[next++]], 200);
      stepBtn.disabled = next >= level.solution.length;
      stepBtn.textContent = next >= level.solution.length ? "Done" : `Next step ▶ (${next + 1}/${level.solution.length})`;
    }
    function reset() {
      next = 0; stepBtn.disabled = false; stepBtn.textContent = "Next step ▶"; status.textContent = ""; status.className = "w-status";
      bar.querySelectorAll(".w-mode").forEach((b) => b.setAttribute("aria-pressed", String(b.classList.contains(mode))));
      board.reset(mode);
    }
  }
  function init() { document.querySelectorAll(".tf-widget").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
