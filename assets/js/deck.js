/* Deck engine: navigation, scaling, tokenized headings, voiceover drawer. No build step. */
(function () {
  "use strict";
  const W = 1600, H = 900;
  const stage = document.getElementById("stage");
  const slides = Array.from(stage.querySelectorAll(".slide"));
  const drawer = document.getElementById("drawer");
  const help = document.getElementById("help");
  const goto = document.getElementById("goto");
  let cur = 0;

  /* ---- theme ---- */
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem("pc-theme");
    if (saved) root.dataset.theme = saved;
    else if (matchMedia("(prefers-color-scheme: dark)").matches) root.dataset.theme = "dark";
  } catch (e) { /* storage unavailable */ }
  function toggleTheme() {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("pc-theme", root.dataset.theme); } catch (e) {}
  }

  /* ---- scale the 1600x900 canvas to the viewport ---- */
  function fit() {
    const s = Math.min(innerWidth / W, innerHeight / H);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  addEventListener("resize", fit);
  fit();

  /* ---- tokenized headings: the talk's signature ---- */
  function tokenizeHeading(el) {
    const text = el.textContent;
    const toks = window.PE.pseudoTokenize(text);
    el.textContent = "";
    let n = 0;
    toks.forEach((t) => {
      const s = document.createElement("span");
      s.textContent = t;
      if (/^\s+$/.test(t)) { s.className = "tok sp"; }
      else { s.className = "tok" + (n % 2 ? " b" : ""); s.style.setProperty("--i", n); n++; }
      el.appendChild(s);
    });
    el.setAttribute("aria-label", text);
  }
  slides.forEach((sl) => sl.querySelectorAll(".tk").forEach(tokenizeHeading));

  /* ---- context bar ---- */
  const cells = document.getElementById("ctx-cells");
  slides.forEach(() => { const c = document.createElement("span"); c.className = "cell"; cells.appendChild(c); });
  const CTX = 32768;

  /* ---- goto list ---- */
  const gl = document.getElementById("goto-list");
  slides.forEach((sl, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = `${i + 1}. ${sl.dataset.title || "Slide"}`;
    b.addEventListener("click", () => { close(goto); go(i); });
    li.appendChild(b); gl.appendChild(li);
  });

  /* ---- navigation ---- */
  function go(i, fromHash) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    slides[cur].classList.remove("active", "sweep");
    cur = i;
    const sl = slides[cur];
    sl.classList.add("active");
    // one orchestrated moment: an attention sweep across the heading tokens
    void sl.offsetWidth;
    sl.classList.add("sweep");

    document.getElementById("ctx-sec").textContent = sl.dataset.part || "";
    Array.from(cells.children).forEach((c, k) => { c.className = "cell" + (k < cur ? " on" : k === cur ? " now" : ""); });
    const used = Math.round(((cur + 1) / slides.length) * CTX);
    document.getElementById("ctx-count").textContent = `${cur + 1} / ${slides.length}`;
    document.getElementById("ctx-cells").title = `${used.toLocaleString()} of ${CTX.toLocaleString()} tokens`;

    const notes = sl.querySelector(".notes");
    document.getElementById("drawer-h").textContent = `Voiceover, slide ${cur + 1}: ${sl.dataset.title || ""}`;
    document.getElementById("drawer-body").innerHTML = notes ? notes.innerHTML : "<p>No voiceover for this slide.</p>";
    drawer.scrollTop = 0;

    Array.from(gl.querySelectorAll("button")).forEach((b, k) => b.classList.toggle("cur", k === cur));
    if (!fromHash) history.replaceState(null, "", "#" + (cur + 1));
    document.title = `${cur + 1}. ${sl.dataset.title || ""} | Prompting Techniques`;
    document.dispatchEvent(new CustomEvent("slide:enter", { detail: { index: cur, el: sl } }));
  }
  const next = () => go(cur + 1), prev = () => go(cur - 1);

  function open(o) { o.classList.add("open"); const f = o.querySelector("button, [tabindex]"); if (f) f.focus(); }
  function close(o) { o.classList.remove("open"); }
  function anyOpen() { return help.classList.contains("open") || goto.classList.contains("open"); }

  document.addEventListener("keydown", (e) => {
    const t = e.target;
    const typing = t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT");
    if (e.key === "Escape") { close(help); close(goto); if (typing) t.blur(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (anyOpen() && e.key !== "?" && e.key.toLowerCase() !== "g") return;
    switch (e.key) {
      case "ArrowRight": case "PageDown": case " ": e.preventDefault(); next(); break;
      case "ArrowLeft": case "PageUp": e.preventDefault(); prev(); break;
      case "Home": go(0); break;
      case "End": go(slides.length - 1); break;
      default:
        switch (e.key.toLowerCase()) {
          case "n": drawer.classList.toggle("open"); break;
          case "t": toggleTheme(); break;
          case "f": if (!document.fullscreenElement) document.documentElement.requestFullscreen?.(); else document.exitFullscreen?.(); break;
          case "g": goto.classList.contains("open") ? close(goto) : open(goto); break;
          case "?": help.classList.contains("open") ? close(help) : open(help); break;
        }
    }
  });
  [help, goto].forEach((o) => o.addEventListener("click", (e) => { if (e.target === o) close(o); }));

  document.querySelectorAll(".hud button").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.cmd;
    if (c === "next") next(); else if (c === "prev") prev();
    else if (c === "notes") drawer.classList.toggle("open");
    else if (c === "theme") toggleTheme();
    else if (c === "help") open(help);
    else if (c === "goto") open(goto);
  }));

  /* touch swipe */
  let x0 = null;
  stage.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) (dx < 0 ? next : prev)();
    x0 = null;
  });

  addEventListener("hashchange", () => { const n = parseInt(location.hash.slice(1), 10); if (n) go(n - 1, true); });

  /* maths */
  function renderMath() {
    if (window.renderMathInElement) {
      renderMathInElement(stage, {
        delimiters: [{ left: "\\[", right: "\\]", display: true }, { left: "\\(", right: "\\)", display: false }],
        throwOnError: false
      });
    }
  }
  if (document.readyState === "complete") renderMath(); else addEventListener("load", renderMath);

  const start = parseInt(location.hash.slice(1), 10);
  go(start ? start - 1 : 0, true);
})();
