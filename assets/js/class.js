/* Interactive widgets for "Prompting Techniques, Fast and Slow".
   Everything runs in the browser. No network, no API, no model calls. */
(function () {
  "use strict";
  const PE = (window.PE = window.PE || {});
  const $ = (id) => document.getElementById(id);
  const fmt = (x, d = 1) => (x * 100).toFixed(d) + "%";

  /* ---------- illustrative tokenizer used by tokenized headings ---------- */
  const SUFFIX = ["ization", "ations", "ation", "ments", "ment", "ness", "ing", "tion", "ers", "est", "ed", "ly", "es", "s"];
  function splitWord(w) {
    if (w.length <= 5) return [w];
    for (const s of SUFFIX) {
      if (w.toLowerCase().endsWith(s) && w.length - s.length >= 3) return [...splitWord(w.slice(0, w.length - s.length)), w.slice(w.length - s.length)];
    }
    if (w.length > 8) { const k = Math.ceil(w.length / 2); return [w.slice(0, k), w.slice(k)]; }
    return [w];
  }
  PE.pseudoTokenize = function (text) {
    const raw = text.match(/\s+|[A-Za-zÀ-ɏ']+|\d|[^\sA-Za-z\d]/gu) || [];
    const toks = []; let sp = "";
    raw.forEach((r) => {
      if (/^\s+$/.test(r)) { if (r === " ") sp = " "; else { if (sp) toks.push(sp); sp = ""; toks.push(r); } return; }
      if (/^[A-Za-zÀ-ɏ']+$/u.test(r)) { const p = splitWord(r); p[0] = sp + p[0]; toks.push(...p); }
      else toks.push(sp + r);
      sp = "";
    });
    if (sp) toks.push(sp);
    return toks;
  };

  function seg(container, onPick) {
    const btns = Array.from(container.querySelectorAll("button"));
    btns.forEach((b) => b.addEventListener("click", () => {
      btns.forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      onPick(b.dataset.v, b);
    }));
  }
  function barRow(label, v, cls = "", txt) {
    return `<div class="bar ${cls}"><span>${label}</span><span class="track"><span class="fill" style="width:${Math.max(0, Math.min(1, v)) * 100}%"></span></span><span class="v">${txt ?? fmt(v)}</span></div>`;
  }

  /* ---------- 1. Bat and ball (CRT) ---------- */
  function initBatBall() {
    const inp = $("bb-in"); if (!inp) return;
    const out = $("bb-verdict");
    function check() {
      const v = parseFloat(inp.value.replace(/[^\d.]/g, ""));
      if (isNaN(v)) { out.className = "verdict"; out.textContent = "Type a number of cents, for example 7."; return; }
      const c = v < 1.5 && inp.value.includes(".") ? Math.round(v * 100) : Math.round(v);
      if (c === 5) { out.className = "verdict ok"; out.textContent = "5 cents. That is System 2 talking."; }
      else if (c === 10) { out.className = "verdict bad"; out.textContent = "10 cents: the System 1 answer. Check it: the bat would cost $1.10, total $1.20."; }
      else { out.className = "verdict bad"; out.textContent = `${c} cents? Check: ball + (ball + $1.00) should equal $1.10.`; }
    }
    $("bb-check").addEventListener("click", check);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") check(); });
    $("bb-show").addEventListener("click", () => $("bb-reveal").classList.toggle("open"));
  }

  /* ---------- 2. Decoding: temperature and top-p ---------- */
  const NEXT = [["0.10", 3.2], ["0.05", 2.6], ["1.00", 0.5], ["0.55", 0.1], ["1.10", -0.4], ["0.01", -1.1]];
  function initTemp() {
    const T = $("t-T"); if (!T) return;
    const P = $("t-P"), box = $("t-bars"), pick = $("t-pick");
    let last = -1;
    function dist() {
      const t = parseFloat(T.value), p = parseFloat(P.value);
      const z = NEXT.map(([, l]) => Math.exp(l / Math.max(t, 0.01)));
      const s = z.reduce((a, b) => a + b, 0);
      const pr = z.map((x) => x / s);
      const order = pr.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
      const keep = new Set(); let c = 0;
      for (const [v, i] of order) { keep.add(i); c += v; if (c >= p) break; }
      const ks = pr.reduce((a, v, i) => a + (keep.has(i) ? v : 0), 0);
      const fin = pr.map((v, i) => (keep.has(i) ? v / ks : 0));
      return { pr, keep, fin };
    }
    function render() {
      $("t-Tv").textContent = parseFloat(T.value).toFixed(2);
      $("t-Pv").textContent = parseFloat(P.value).toFixed(2);
      const { keep, fin } = dist();
      box.innerHTML = NEXT.map(([w], i) => barRow("$" + w, fin[i], (keep.has(i) ? "" : "cut") + (i === last ? " picked" : ""))).join("");
      const H = -fin.reduce((a, v) => a + (v > 0 ? v * Math.log2(v) : 0), 0);
      if ($("t-H")) $("t-H").textContent = H < 0.3 ? "Very predictable: the same answer almost every time." : H < 1.2 ? "Some variety: mostly the top answer, sometimes others." : "Lots of variety: answers change from run to run.";
    }
    $("t-sample").addEventListener("click", () => {
      const { fin } = dist(); let r = Math.random(), i = 0;
      for (; i < fin.length - 1; i++) { r -= fin[i]; if (r <= 0) break; }
      last = i; render();
      pick.innerHTML = `Sampled: <b>$${NEXT[i][0]}</b>` + (i === 0 ? " (fast, fluent, wrong)" : i === 1 ? " (correct)" : "");
    });
    T.addEventListener("input", render); P.addEventListener("input", render); render();
  }

  /* ---------- 3. Number game: few-shot learning as Bayesian concept inference ---------- */
  function initNumberGame() {
    const grid = $("ng-grid"); if (!grid) return;
    const U = Array.from({ length: 100 }, (_, i) => i + 1);
    const H = [];
    const add = (name, f, prior) => { const ext = U.filter(f); if (ext.length) H.push({ name, ext: new Set(ext), size: ext.length, prior }); };
    const math = [];
    math.push(["even numbers", (x) => x % 2 === 0], ["odd numbers", (x) => x % 2 === 1]);
    for (let k = 3; k <= 12; k++) math.push([`multiples of ${k}`, (x) => x % k === 0]);
    for (let d = 0; d <= 9; d++) math.push([`ends in ${d}`, (x) => x % 10 === d]);
    math.push(["powers of 2", (x) => (x & (x - 1)) === 0], ["powers of 3", (x) => [1, 3, 9, 27, 81].includes(x)],
      ["square numbers", (x) => Number.isInteger(Math.sqrt(x))], ["cubes", (x) => [1, 8, 27, 64].includes(x)],
      ["prime numbers", (x) => { if (x < 2) return false; for (let i = 2; i * i <= x; i++) if (x % i === 0) return false; return true; }],
      ["all numbers 1 to 100", () => true]);
    math.forEach(([n, f]) => add(n, f, 0.6 / math.length));
    const iv = [];
    for (let a = 0; a < 10; a++) for (let b = a + 1; b <= 10; b++) iv.push([a * 10 + 1, b * 10]);
    iv.forEach(([a, b]) => add(`between ${a} and ${b}`, (x) => x >= a && x <= b, 0.4 / iv.length));

    grid.innerHTML = U.map((n) => `<button type="button" data-n="${n}" aria-label="${n}"><span class="p"></span><span class="n">${n}</span></button>`).join("");
    const cellBtns = Array.from(grid.querySelectorAll("button"));
    let D = [16];
    function render() {
      const logp = H.map((h) => (D.every((x) => h.ext.has(x)) ? Math.log(h.prior) - D.length * Math.log(h.size) : -Infinity));
      const m = Math.max(...logp);
      const w = logp.map((l) => (l === -Infinity ? 0 : Math.exp(l - m)));
      const s = w.reduce((a, b) => a + b, 0) || 1;
      const post = w.map((x) => x / s);
      const top = post.map((p, i) => [p, i]).sort((a, b) => b[0] - a[0]).slice(0, 6);
      $("ng-bars").innerHTML = top.map(([p, i]) => barRow(H[i].name, p, "", fmt(p, 0))).join("");
      cellBtns.forEach((b) => {
        const n = +b.dataset.n;
        const pred = H.reduce((a, h, i) => a + (h.ext.has(n) ? post[i] : 0), 0);
        b.querySelector(".p").style.opacity = (0.08 + 0.72 * pred).toFixed(3) * (pred > 0.01 ? 1 : 0);
        b.classList.toggle("ex", D.includes(n));
        b.title = `p(${n} is in the concept | examples) = ${(pred * 100).toFixed(0)}%`;
      });
      $("ng-d").textContent = D.length ? D.join(", ") : "(none)";
    }
    cellBtns.forEach((b) => b.addEventListener("click", () => {
      const n = +b.dataset.n; D = D.includes(n) ? D.filter((x) => x !== n) : [...D, n]; render();
    }));
    seg($("ng-presets"), (v) => { D = v ? v.split(",").map(Number) : []; render(); });
    render();
  }

  /* ---------- 4. Anchoring: live class experiment with a permutation test ---------- */
  function initAnchor() {
    const a = $("an-a"); if (!a) return;
    const b = $("an-b");
    seg($("an-group"), (v) => {
      const anchor = v === "A" ? 10 : 65;
      $("an-q").innerHTML = `The wheel stopped at <b>${anchor}</b>.\n\n1. Is the percentage of UN member countries that are African higher or lower than ${anchor}%?\n2. What is your best estimate of that percentage?`;
    });
    const nums = (t) => (t.match(/\d+(\.\d+)?/g) || []).map(Number);
    const med = (x) => { const s = [...x].sort((p, q) => p - q), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
    const mean = (x) => x.reduce((p, q) => p + q, 0) / x.length;
    $("an-run").addEventListener("click", () => {
      const A = nums(a.value), B = nums(b.value), out = $("an-out");
      if (A.length < 2 || B.length < 2) { out.textContent = "Enter at least two estimates for each group."; return; }
      const obs = mean(B) - mean(A), all = [...A, ...B]; let ge = 0; const R = 5000;
      for (let r = 0; r < R; r++) {
        const s = [...all]; for (let i = s.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [s[i], s[j]] = [s[j], s[i]]; }
        const d = mean(s.slice(A.length)) - mean(s.slice(0, A.length)); if (Math.abs(d) >= Math.abs(obs)) ge++;
      }
      const pv = (ge + 1) / (R + 1);
      out.innerHTML = `Group A (saw 10): typical guess <b>${med(A)}%</b> · Group B (saw 65): typical guess <b>${med(B)}%</b><br>` +
        `Group B guessed <b>${Math.abs(obs).toFixed(0)} points ${obs >= 0 ? "higher" : "lower"}</b> on average.<br>` +
        `Could that be luck? Shuffling the names into random groups ${R.toLocaleString()} times, a gap this big appeared ` +
        `<b>${pv < 0.001 ? "less than 0.1%" : (pv * 100).toFixed(1) + "%"}</b> of the time.`;
    });
    $("an-demo").addEventListener("click", () => { a.value = "20, 25, 15, 30, 22, 18, 28, 35, 12, 25"; b.value = "45, 50, 40, 38, 55, 42, 35, 48, 60, 44"; $("an-run").click(); });
  }

  /* ---------- 5. Technique playground ---------- */
  const Q = "A notebook and a pen cost ₹110 in total. The notebook costs ₹100 more than the pen. How much does the pen cost?";
  const TECH = {
    direct: { p: `Q: ${Q}\nA:`, o: `₹10`, bad: true,
      n: "The quick, familiar-looking answer pops out first, exactly like a person answering in five seconds." },
    zcot: { p: `Q: ${Q}\nA: Let's think step by step.`, o: `Let the pen cost x. The notebook costs x + 100.\nx + (x + 100) = 110, so 2x = 10, x = 5.\nThe pen costs ₹5.`,
      n: "Five extra words make the model write its working before answering. Costs a longer reply." },
    fcot: { p: `Q: A shirt and a cap cost ₹1,200. The shirt costs ₹800 more than the cap. How much is the cap?\nA: Let the cap be c. Then c + (c + 800) = 1200, so 2c = 400, c = 200. The answer is ₹200.\n\nQ: ${Q}\nA:`,
      o: `Let the pen be p. Then p + (p + 100) = 110, so 2p = 10, p = 5. The answer is ₹5.`,
      n: "One worked example shows how to reason and how to format the answer." },
    l2m: { p: `${Q}\nFirst list the sub-questions you need to answer, then answer them in order.`,
      o: `Sub-question 1: What is the difference between the two prices? ₹100.\nSub-question 2: If we remove the difference, what is left? 110 − 100 = ₹10, shared equally by two "pen-sized" parts.\nSub-question 3: One part? 10 / 2 = ₹5.\nThe pen costs ₹5.`,
      n: "Break the big question into small ones and answer them in order." },
    sc: { p: `Same zero-shot CoT prompt, sampled 5 times at temperature 0.7.`,
      o: `Sample 1 → ₹5\nSample 2 → ₹5\nSample 3 → ₹10\nSample 4 → ₹5\nSample 5 → ₹5\nMajority vote → ₹5 (4 of 5)`,
      n: "Ask the same question several times and take the most common answer. Costs 5× as much." },
    pal: { p: `${Q}\nWrite Python that computes the answer. Do not compute it in your head.`,
      o: `total, diff = 110, 100\npen = (total - diff) / 2     # pen + (pen + diff) = total\nprint(pen)                   # → 5.0`,
      n: "The model writes the steps as code; a computer does the arithmetic. No mental-maths slips." },
    crit: { p: `Answer, then check your answer by substituting it back into the problem. If the check fails, fix it.`,
      o: `Draft: ₹10.\nCheck: pen 10, notebook 110 → total 120 ≠ 110. ✗\nRevise: 2x + 100 = 110 → x = 5. Check: 5 + 105 = 110. ✓\nFinal: ₹5.`,
      n: "Works because the check is real: put the answer back into the problem. \"Are you sure?\" alone often doesn't help." },
    role: { p: `You are a world-class mathematician.\nQ: ${Q}\nA:`, o: `₹10`, bad: true,
      n: "Calling it a genius doesn't make it think harder. Still the five-second answer." },
  };
  function initPlayground() {
    const sg = $("tp-seg"); if (!sg) return;
    function show(k) {
      const t = TECH[k];
      $("tp-p").textContent = t.p;
      $("tp-o").innerHTML = "";
      const sp = document.createElement("span"); sp.className = t.bad ? "bad" : "good"; sp.textContent = t.o;
      $("tp-o").append(sp);
      $("tp-n").textContent = t.n;
    }
    seg(sg, show); show("direct");
  }

  /* ---------- 6. Self-consistency with correlated samples ---------- */
  function binomMajority(N, p) {
    // P(Bin(N,p) > N/2), N odd
    let s = 0, c = 1;
    for (let k = 0; k <= N; k++) {
      if (k > 0) c = (c * (N - k + 1)) / k;
      if (k > N / 2) s += c * Math.pow(p, k) * Math.pow(1 - p, N - k);
    }
    return s;
  }
  function plurality(N, p, m, R) {
    let win = 0;
    for (let r = 0; r < R; r++) {
      const cnt = new Array(m + 1).fill(0);
      for (let i = 0; i < N; i++) { if (Math.random() < p) cnt[0]++; else cnt[1 + ((Math.random() * m) | 0)]++; }
      const mx = Math.max(...cnt); const ties = cnt.filter((x) => x === mx).length;
      if (cnt[0] === mx) win += 1 / ties;
    }
    return win / R;
  }
  function initSC() {
    const P = $("sc-p"); if (!P) return;
    const Nn = $("sc-n"), RHO = $("sc-r"), M = $("sc-m");
    let tid = null;
    function compute() {
      const p = +P.value, N = +Nn.value, rho = +RHO.value, m = +M.value;
      $("sc-pv").textContent = p.toFixed(2); $("sc-nv").textContent = N; $("sc-rv").textContent = rho.toFixed(2); $("sc-mv").textContent = m;
      const agree = binomMajority(N, p), scatter = plurality(N, p, m, 6000), corr = rho * p + (1 - rho) * scatter;
      $("sc-bars").innerHTML = barRow("ask once", p) + barRow("vote, same mistake", agree) + barRow("vote, mixed mistakes", scatter) + barRow("…if they copy", corr, "picked");
      // chart: accuracy vs N
      const Ns = []; for (let n = 1; n <= 41; n += 2) Ns.push(n);
      const W = 520, Hh = 170, L = 44, B = 26, Tp = 8;
      const x = (n) => L + ((n - 1) / 40) * (W - L - 12), y = (v) => Tp + (1 - v) * (Hh - Tp - B);
      const s1 = Ns.map((n) => [x(n), y(binomMajority(n, p))]);
      const scat = Ns.map((n) => plurality(n, p, m, 1200));
      const s2 = Ns.map((n, i) => [x(n), y(scat[i])]);
      const s3 = Ns.map((n, i) => [x(n), y(rho * p + (1 - rho) * scat[i])]);
      const path = (pts) => "M" + pts.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("L");
      const gl = [0, .25, .5, .75, 1].map((v) => `<line x1="${L}" x2="${W - 12}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 5}" text-anchor="end">${v * 100}%</text>`).join("");
      const xl = [1, 11, 21, 31, 41].map((n) => `<text x="${x(n)}" y="${Hh - 8}" text-anchor="middle">${n}</text>`).join("");
      $("sc-chart").innerHTML = `<g class="grid">${gl}</g>${xl}` +
        `<path class="l1" d="${path(s1)}"/><path class="l2" d="${path(s2)}"/><path class="l3" d="${path(s3)}"/>`;
    }
    const sched = () => { clearTimeout(tid); tid = setTimeout(compute, 60); };
    [P, Nn, RHO, M].forEach((e) => e.addEventListener("input", sched)); compute();
  }

  /* ---------- 7. Game of 24: tree search vs one sampled chain ---------- */
  const EPS = 1e-9;
  function children(st) {
    const out = [];
    for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
      const a = st[i], b = st[j], rest = st.filter((_, k) => k !== i && k !== j);
      const ops = [[a.v + b.v, `${a.e} + ${b.e}`, `${a.s} + ${b.s}`], [a.v * b.v, `${a.e} × ${b.e}`, `${a.s} × ${b.s}`],
        ...(a.v >= b.v ? [[a.v - b.v, `${a.e} − ${b.e}`, `${a.s} − ${b.s}`], [b.v - a.v, `${b.e} − ${a.e}`, `${b.s} − ${a.s}`]]
                       : [[b.v - a.v, `${b.e} − ${a.e}`, `${b.s} − ${a.s}`], [a.v - b.v, `${a.e} − ${b.e}`, `${a.s} − ${b.s}`]])];
      if (Math.abs(b.v) > EPS) ops.push([a.v / b.v, `${a.e} ÷ ${b.e}`, `${a.s} ÷ ${b.s}`]);
      if (Math.abs(a.v) > EPS) ops.push([b.v / a.v, `${b.e} ÷ ${a.e}`, `${b.s} ÷ ${a.s}`]);
      ops.forEach(([v, e, s]) => out.push({ step: `${s} = ${+v.toFixed(4)}`, st: [...rest, { v, e: `(${e})`, s: String(+v.toFixed(4)) }] }));
    }
    return out;
  }
  function solve24(nums) {
    const start = nums.map((n) => ({ v: n, e: String(n), s: String(n) }));
    let nodes = 0, leaves = 0, sols = 0, first = null, nodesToFirst = 0;
    const memo = new Map();
    function pRand(st) { // probability that a uniformly random chain from st reaches 24
      if (st.length === 1) return Math.abs(st[0].v - 24) < 1e-6 ? 1 : 0;
      const key = st.map((x) => x.v.toFixed(6)).sort().join("|");
      if (memo.has(key)) return memo.get(key);
      const ch = children(st); const r = ch.reduce((a, c) => a + pRand(c.st), 0) / ch.length;
      memo.set(key, r); return r;
    }
    (function dfs(st, path) {
      nodes++;
      if (st.length === 1) { leaves++; if (Math.abs(st[0].v - 24) < 1e-6) { sols++; if (!first) { first = path; nodesToFirst = nodes; } } return; }
      for (const c of children(st)) dfs(c.st, [...path, { step: c.step, left: c.st.map((x) => x.s).join(" ") }]);
    })(start, []);
    return { nodes, leaves, sols, first, nodesToFirst, p1: pRand(start) };
  }
  function initG24() {
    const inp = $("g24-in"); if (!inp) return;
    function run() {
      const nums = (inp.value.match(/\d+/g) || []).map(Number).slice(0, 4);
      if (nums.length !== 4) { $("g24-steps").textContent = "Enter four whole numbers."; return; }
      const r = solve24(nums);
      $("g24-steps").innerHTML = r.first
        ? r.first.map((s, i) => `<span class="st">Thought ${i + 1}: ${s.step}   (left: ${s.left})</span>`).join("")
        : `<span class="st">No way to make 24 from ${nums.join(", ")}. Search proves it; a single chain could not.</span>`;
      $("g24-p1").textContent = fmt(r.p1, 1);
      $("g24-p5").textContent = fmt(1 - Math.pow(1 - r.p1, 5), 1);
      $("g24-nodes").textContent = r.nodes.toLocaleString();
      $("g24-sub").textContent = `${r.leaves.toLocaleString()} complete chains, ${r.sols.toLocaleString()} reach 24. Depth-first search found the first after ${r.nodesToFirst.toLocaleString()} nodes.`;
    }
    $("g24-go").addEventListener("click", run);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
    seg($("g24-presets"), (v) => { inp.value = v; run(); });
    run();
  }

  /* ---------- 8. Taxi cab problem (base-rate neglect) ---------- */
  function initTaxi() {
    const B = $("tx-b"); if (!B) return;
    const A = $("tx-a");
    function render() {
      const b = +B.value, a = +A.value;
      $("tx-bv").textContent = fmt(b, 0); $("tx-av").textContent = fmt(a, 0);
      const post = (a * b) / (a * b + (1 - a) * (1 - b));
      const nb = Math.round(100 * b), tp = Math.round(nb * a), fp = Math.round((100 - nb) * (1 - a));
      const dots = [];
      for (let i = 0; i < 100; i++) {
        const blue = i < nb, say = blue ? i < tp : i - nb < fp;
        dots.push(`<i class="${blue ? "blue" : ""} ${say ? "say" : ""}"></i>`);
      }
      $("tx-dots").innerHTML = dots.join("");
      $("tx-post").textContent = fmt(post, 0);
      $("tx-freq").innerHTML = `Of 100 cabs, <b>${nb}</b> are Blue. The witness says "Blue" for <b>${tp}</b> Blue cabs and <b>${fp}</b> Green cabs, so P(Blue | "Blue") ≈ ${tp} / (${tp} + ${fp}) = <b>${tp + fp ? fmt(tp / (tp + fp), 0) : "—"}</b>.`;
    }
    B.addEventListener("input", render); A.addEventListener("input", render); render();
  }

  /* ---------- 9. Polls, reveals, quiz, 17 × 24 ---------- */
  function initSmall() {
    document.querySelectorAll("[data-poll]").forEach((wrap) => {
      wrap.querySelectorAll("[data-inc]").forEach((btn) => btn.addEventListener("click", () => {
        const c = wrap.querySelector(`[data-cnt="${btn.dataset.inc}"]`);
        c.textContent = Math.max(0, +c.textContent + (+btn.dataset.d || 1));
      }));
    });
    document.querySelectorAll("[data-reveal]").forEach((btn) => btn.addEventListener("click", () => $(btn.dataset.reveal).classList.toggle("open")));
    document.querySelectorAll(".quiz .q, .mk .card").forEach((q) => q.addEventListener("click", () => q.classList.toggle("open")));
    const m = $("mul-in");
    if (m) {
      const t0 = { v: null };
      m.addEventListener("focus", () => { if (!t0.v) t0.v = performance.now(); });
      $("mul-go").addEventListener("click", () => {
        const ok = parseInt(m.value, 10) === 408, secs = t0.v ? ((performance.now() - t0.v) / 1000).toFixed(1) : "?";
        $("mul-v").className = "verdict " + (ok ? "ok" : "bad");
        $("mul-v").textContent = ok ? `408, in ${secs} s. Effortful, serial, slow: System 2.` : `Not quite (${secs} s). 17 × 24 = 17 × 20 + 17 × 4 = 340 + 68 = 408.`;
        t0.v = null;
      });
    }
  }

  /* ---------- 10. Prompt builder: what does the model have to guess? ---------- */
  const PARTS = [
    ["role", "Role", "You are a customer-support agent for ShopKart, an online store.", "Who is speaking? A friend, a lawyer, the company?"],
    ["task", "Task", "Write a reply to the customer email below.", "What exactly should it produce: a reply, a summary, a refund form?"],
    ["context", "Context", "Policy: orders more than 5 days late get a full refund. Damaged items can be returned free.", "What is the refund policy? It cannot know your company's rules."],
    ["constraints", "Constraints", "Do not promise anything outside the policy. Apologise once, not repeatedly.", "Is it allowed to promise a refund? A discount coupon?"],
    ["tone", "Tone & audience", "Warm and professional. The customer is upset; keep sentences short.", "Formal or friendly? Long or short?"],
    ["format", "Format", "Under 120 words. End with the refund timeline and a support phone number.", "How long? What must the reply end with?"],
  ];
  function initBuilder() {
    const box = $("pb-checks"); if (!box) return;
    box.innerHTML = PARTS.map(([k, label]) => `<label class="check"><input type="checkbox" data-k="${k}"> ${label}</label>`).join("");
    const email = 'Email: "My order #4521 came 6 days late and the box was crushed. I want my money back."';
    function render() {
      const on = new Set(Array.from(box.querySelectorAll("input:checked")).map((i) => i.dataset.k));
      const lines = PARTS.filter(([k]) => on.has(k)).map(([, label, text]) => `${label}: ${text}`);
      $("pb-prompt").textContent = (lines.length ? lines.join("\n") : "Reply to this complaint.") + "\n\n" + email;
      const missing = PARTS.filter(([k]) => !on.has(k));
      $("pb-guess").innerHTML = missing.length
        ? `<b>The model still has to guess (${missing.length}):</b><ul>${missing.map(([, , , q]) => `<li>${q}</li>`).join("")}</ul>`
        : "<b>Nothing left to guess.</b> Every reader, human or model, would now write roughly the same reply.";
      $("pb-meter").style.width = (on.size / PARTS.length) * 100 + "%";
    }
    box.addEventListener("change", render); render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    [initBuilder, initBatBall, initTemp, initNumberGame, initAnchor, initPlayground, initSC, initG24, initTaxi, initSmall].forEach((f) => {
      try { f(); } catch (e) { console.error(f.name, e); }
    });
  });
})();
