#!/usr/bin/env python3
"""
prompting_lab.py — companion lab for "Prompting Techniques, Fast and Slow".

Runs fully offline with only numpy. Every section reproduces a slide or a
derivation from notes.html. An optional section runs real prompts against a
local Ollama model or any OpenAI-compatible endpoint.

Usage
-----
    python prompting_lab.py all                 # every offline demo
    python prompting_lab.py decode              # one section (see SECTIONS below)
    python prompting_lab.py crt --backend mock  # technique comparison, simulated
    python prompting_lab.py crt --backend ollama --model llama3.1:8b
    OPENAI_BASE_URL=... OPENAI_API_KEY=... \
    python prompting_lab.py crt --backend openai --model <name>

Sections: decode, numbergame, calibrate, variance, vote, verify, g24, taxi, crt
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
import os
import random
import re
import urllib.request
from fractions import Fraction
from functools import lru_cache

import numpy as np

RNG = np.random.default_rng(7)


def header(title: str) -> None:
    print("\n" + "=" * 72 + f"\n{title}\n" + "=" * 72)


# ---------------------------------------------------------------------------
# 1. Decoding: temperature, top-p, entropy               (slide 6, notes §2)
# ---------------------------------------------------------------------------
def softmax_T(logits: np.ndarray, T: float) -> np.ndarray:
    z = logits / max(T, 1e-8)
    z = z - z.max()                      # numerical stability: softmax is shift-invariant
    e = np.exp(z)
    return e / e.sum()


def top_p(probs: np.ndarray, p: float) -> np.ndarray:
    order = np.argsort(-probs)
    cum = np.cumsum(probs[order])
    k = int(np.searchsorted(cum, p) + 1)  # smallest prefix with mass >= p
    keep = np.zeros_like(probs, dtype=bool)
    keep[order[:k]] = True
    out = np.where(keep, probs, 0.0)
    return out / out.sum()


def entropy_bits(p: np.ndarray) -> float:
    p = p[p > 0]
    return float(-(p * np.log2(p)).sum())


def demo_decode() -> None:
    header("1. Decoding: temperature and top-p")
    tokens = ["0.10", "0.05", "1.00", "0.55", "1.10", "0.01"]
    logits = np.array([3.2, 2.6, 0.5, 0.1, -0.4, -1.1])   # illustrative
    for T in (0.1, 0.5, 1.0, 2.0):
        pr = softmax_T(logits, T)
        print(f"T={T:<4} H={entropy_bits(pr):.2f} bits  " +
              "  ".join(f"${t}:{v:.2f}" for t, v in zip(tokens, pr)))
    pr = top_p(softmax_T(logits, 1.0), 0.9)
    print("top-p 0.9 at T=1 keeps:", [t for t, v in zip(tokens, pr) if v > 0])
    # Claim from notes: entropy is non-decreasing in T. Check numerically.
    Ts = np.linspace(0.05, 5, 200)
    Hs = [entropy_bits(softmax_T(logits, T)) for T in Ts]
    print("entropy monotone in T:", bool(np.all(np.diff(Hs) >= -1e-12)))
    # Greedy picks the System-1 answer; how often does T=1 sampling pick $0.05?
    draws = RNG.choice(len(tokens), size=10_000, p=softmax_T(logits, 1.0))
    print(f"P(sample = $0.05) at T=1: {np.mean(draws == 1):.3f}")


# ---------------------------------------------------------------------------
# 2. Number game: few-shot as Bayesian concept inference  (slide 9, notes §3)
# ---------------------------------------------------------------------------
def build_hypotheses():
    U = range(1, 101)
    H = {}
    H["even"] = {x for x in U if x % 2 == 0}
    H["odd"] = {x for x in U if x % 2 == 1}
    for k in range(3, 13):
        H[f"multiples of {k}"] = {x for x in U if x % k == 0}
    for d in range(10):
        H[f"ends in {d}"] = {x for x in U if x % 10 == d}
    H["powers of 2"] = {2 ** i for i in range(7)}
    H["powers of 3"] = {1, 3, 9, 27, 81}
    H["squares"] = {i * i for i in range(1, 11)}
    H["cubes"] = {1, 8, 27, 64}
    H["primes"] = {x for x in U if x > 1 and all(x % d for d in range(2, int(x ** .5) + 1))}
    H["all 1-100"] = set(U)
    math_names = list(H)
    for a in range(10):
        for b in range(a + 1, 11):
            H[f"[{a*10+1},{b*10}]"] = set(range(a * 10 + 1, b * 10 + 1))
    interval_names = [n for n in H if n not in math_names]
    prior = {n: 0.6 / len(math_names) for n in math_names}
    prior.update({n: 0.4 / len(interval_names) for n in interval_names})
    return H, prior


def posterior(D, H, prior):
    """p(h|D) ∝ p(h) · Π_i 1[d_i ∈ h] / |h|   (strong sampling, size principle)."""
    logp = {}
    for n, ext in H.items():
        if all(d in ext for d in D):
            logp[n] = math.log(prior[n]) - len(D) * math.log(len(ext))
    m = max(logp.values())
    w = {n: math.exp(l - m) for n, l in logp.items()}
    Z = sum(w.values())
    return {n: v / Z for n, v in w.items()}


def predictive(y, post, H):
    return sum(p for n, p in post.items() if y in H[n])


def demo_numbergame() -> None:
    header("2. Number game: Bayesian inference from examples")
    H, prior = build_hypotheses()
    for D in ([16], [16, 8, 2, 64], [16, 23, 19, 20], [60, 80, 10, 30]):
        post = posterior(D, H, prior)
        top = sorted(post.items(), key=lambda kv: -kv[1])[:3]
        probes = {y: round(predictive(y, post, H), 2) for y in (32, 6, 87, 24, 50)}
        print(f"D={D!s:<18} top: " + ", ".join(f"{n} {p:.2f}" for n, p in top))
        print(f"{'':21}p(y in concept): {probes}")
    print("Likelihood ratio, 4 powers of 2, 'powers of 2' vs 'even':",
          f"(50/7)^4 = {(50/7)**4:,.0f}")


# ---------------------------------------------------------------------------
# 3. Contextual calibration                              (slide 11, notes §4)
# ---------------------------------------------------------------------------
def calibrate(p_input: np.ndarray, p_content_free: np.ndarray) -> np.ndarray:
    W = np.diag(1.0 / p_content_free)
    q = W @ p_input
    return q / q.sum()


def demo_calibrate() -> None:
    header("3. Contextual calibration (Zhao et al., 2021)")
    p_cf = np.array([0.70, 0.30])
    p_x = np.array([0.60, 0.40])
    print("raw:", p_x, "-> calibrated:", calibrate(p_x, p_cf).round(3))
    # Simulate a biased classifier: true label balanced, prompt adds a +0.85 logit to 'pos'.
    n = 5000
    y = RNG.integers(0, 2, n)                       # 0 = pos, 1 = neg
    evidence = np.where(y == 0, 0.8, -0.8) + RNG.normal(0, 1.0, n)
    bias = 0.85
    logit_pos = evidence + bias
    p_pos = 1 / (1 + np.exp(-logit_pos))
    raw_pred = (p_pos < 0.5).astype(int)
    p_cf_sim = np.array([1 / (1 + np.exp(-bias)), 1 - 1 / (1 + np.exp(-bias))])
    cal = np.array([calibrate(np.array([a, 1 - a]), p_cf_sim) for a in p_pos])
    cal_pred = (cal[:, 0] < 0.5).astype(int)
    print(f"simulated accuracy: raw {np.mean(raw_pred == y):.3f}  calibrated {np.mean(cal_pred == y):.3f}")
    print(f"fraction predicted 'pos': raw {np.mean(raw_pred == 0):.2f}  calibrated {np.mean(cal_pred == 0):.2f}")


# ---------------------------------------------------------------------------
# 4. Averaging correlated errors                         (slide 12, notes §5)
# ---------------------------------------------------------------------------
def demo_variance() -> None:
    header("4. Var of the mean of K equicorrelated errors = σ²(ρ + (1-ρ)/K)")
    sigma = 1.0
    for rho in (0.0, 0.3, 0.7):
        for K in (1, 5, 25):
            C = sigma**2 * (rho * np.ones((K, K)) + (1 - rho) * np.eye(K))
            e = RNG.multivariate_normal(np.zeros(K), C, size=50_000)
            emp = e.mean(axis=1).var()
            th = sigma**2 * (rho + (1 - rho) / K)
            print(f"rho={rho:.1f} K={K:<3} empirical {emp:.3f}  formula {th:.3f}")
    print("Limit K→∞: variance → ρσ². Averaging cannot remove shared error.")


# ---------------------------------------------------------------------------
# 5. Self-consistency / majority vote                    (slides 17–18, notes §6)
# ---------------------------------------------------------------------------
def p_majority_binary(N: int, p: float) -> float:
    """P(Bin(N,p) > N/2) for odd N: 'errors agree' worst case."""
    return sum(math.comb(N, k) * p**k * (1 - p) ** (N - k) for k in range(N // 2 + 1, N + 1))


def hoeffding_bound(N: int, p: float) -> float:
    return math.exp(-2 * N * (p - 0.5) ** 2) if p > 0.5 else 1.0


def p_plurality(N: int, p: float, m: int, R: int = 20_000, rho: float = 0.0) -> float:
    """Correct answer vs m wrong answers (uniform). With prob rho all N samples copy one draw."""
    wins = 0.0
    for _ in range(R):
        if RNG.random() < rho:
            wins += RNG.random() < p
            continue
        c = np.zeros(m + 1)
        right = RNG.random(N) < p
        c[0] = right.sum()
        wrong = RNG.integers(1, m + 1, size=(~right).sum())
        np.add.at(c, wrong, 1)
        top = c.max()
        ties = (c == top).sum()
        wins += (c[0] == top) / ties
    return wins / R


def demo_vote() -> None:
    header("5. Self-consistency: exact, bound, plurality, correlation")
    print(f"{'N':>3} {'p':>5} {'agree':>8} {'1-Hoeff':>8} {'scatter4':>9} {'rho=.4':>8}")
    for p in (0.45, 0.6):
        for N in (1, 5, 11, 21, 41):
            a = p_majority_binary(N, p)
            hb = 1 - hoeffding_bound(N, p)
            s = p_plurality(N, p, 4, R=4000)
            c = 0.4 * p + 0.6 * s
            print(f"{N:>3} {p:>5} {a:>8.3f} {hb:>8.3f} {s:>9.3f} {c:>8.3f}")
    print("Check closed form Acc_rho = rho*p + (1-rho)*Acc_0 by simulation:")
    sim = p_plurality(11, 0.45, 4, R=20_000, rho=0.4)
    form = 0.4 * 0.45 + 0.6 * p_plurality(11, 0.45, 4, R=20_000)
    print(f"  simulated {sim:.3f}   formula {form:.3f}")


# ---------------------------------------------------------------------------
# 6. Voting vs verifying                                 (slide 22, notes §8)
# ---------------------------------------------------------------------------
def demo_verify() -> None:
    header("6. Best-of-N with a perfect verifier vs plurality vote")
    for p in (0.1, 0.3, 0.5):
        row = []
        for N in (1, 5, 10, 20):
            ver = 1 - (1 - p) ** N
            vote = p_plurality(N, p, 3, R=3000)
            row.append(f"N={N}: verify {ver:.2f} vote {vote:.2f}")
        print(f"p={p}:  " + " | ".join(row))


# ---------------------------------------------------------------------------
# 7. Game of 24: search vs a single random chain         (slide 20, notes §9)
# ---------------------------------------------------------------------------
def moves(state):
    """All children of a multiset of Fractions (with a human-readable step)."""
    out = []
    for i, j in itertools.combinations(range(len(state)), 2):
        a, b = state[i], state[j]
        rest = [x for k, x in enumerate(state) if k not in (i, j)]
        hi, lo = (a, b) if a >= b else (b, a)
        cand = [(a + b, f"{a} + {b}"), (a * b, f"{a} × {b}"),
                (hi - lo, f"{hi} − {lo}"), (lo - hi, f"{lo} − {hi}")]
        if b != 0:
            cand.append((a / b, f"{a} ÷ {b}"))
        if a != 0:
            cand.append((b / a, f"{b} ÷ {a}"))
        for v, s in cand:
            out.append((tuple(sorted(rest + [v])), f"{s} = {v}"))
    return out


@lru_cache(maxsize=None)
def p_random_chain(state) -> float:
    """Probability that uniformly random moves reach 24 (one System-1 chain)."""
    if len(state) == 1:
        return float(state[0] == 24)
    ch = moves(state)
    return sum(p_random_chain(s) for s, _ in ch) / len(ch)


def solve24(nums):
    start = tuple(sorted(Fraction(n) for n in nums))
    stats = {"nodes": 0}

    def dfs(state, path):
        stats["nodes"] += 1
        if len(state) == 1:
            return path if state[0] == 24 else None
        for s, step in moves(state):
            r = dfs(s, path + [step])
            if r:
                return r
        return None

    return dfs(start, []), stats["nodes"], p_random_chain(start)


def demo_g24() -> None:
    header("7. Game of 24 (exact arithmetic with Fractions)")
    for nums in ([4, 9, 10, 13], [1, 1, 4, 6], [3, 3, 8, 8], [1, 1, 1, 1]):
        path, nodes, p1 = solve24(nums)
        print(f"{nums}: one random chain {p1:.3%}, best-of-5 {1-(1-p1)**5:.2%}, "
              f"DFS nodes to answer {nodes}")
        print("   ", " | ".join(path) if path else "no solution (proved by exhaustive search)")


# ---------------------------------------------------------------------------
# 8. Taxi cab: base rates                                (slide 24, notes §10)
# ---------------------------------------------------------------------------
def demo_taxi() -> None:
    header("8. Taxi cab problem: Bayes vs intuition")
    base, acc = 0.15, 0.80
    post = acc * base / (acc * base + (1 - acc) * (1 - base))
    print(f"P(Blue | witness says Blue) = {post:.3f}  (intuitive answer ≈ {acc})")
    # Natural frequencies, as in Gigerenzer & Hoffrage (1995)
    n = 1000
    blue = round(n * base)
    tp, fp = round(blue * acc), round((n - blue) * (1 - acc))
    print(f"Of {n} cabs: {blue} Blue; witness says Blue for {tp} Blue and {fp} Green → {tp}/{tp+fp} = {tp/(tp+fp):.3f}")
    # Monte Carlo check
    cabs = RNG.random(200_000) < base
    say_blue = np.where(cabs, RNG.random(cabs.size) < acc, RNG.random(cabs.size) > acc)
    print(f"Simulation: {cabs[say_blue].mean():.3f}")


# ---------------------------------------------------------------------------
# 9. Real prompts: technique comparison on fresh CRT-style items (homework 4)
# ---------------------------------------------------------------------------
OBJECTS = [("notebook", "pen"), ("bat", "ball"), ("lamp", "bulb"), ("guitar", "case"),
           ("helmet", "glove"), ("kettle", "lid"), ("bag", "tag"), ("phone", "cover")]


def make_items(n: int, seed: int = 0):
    """Fresh isomorphs of the bat-and-ball item, so memorisation cannot help."""
    rnd = random.Random(seed)
    items = []
    for _ in range(n):
        big, small = rnd.choice(OBJECTS)
        small_price = rnd.choice([3, 4, 5, 6, 7, 8, 9, 11, 12, 15, 18, 25])
        diff = rnd.choice([100, 200, 250, 400, 500, 1000])
        total = 2 * small_price + diff
        q = (f"A {big} and a {small} cost ₹{total} in total. The {big} costs ₹{diff} more "
             f"than the {small}. How much does the {small} cost, in rupees?")
        items.append({"q": q, "a": small_price, "total": total, "diff": diff})
    return items


TEMPLATES = {
    "direct": "Q: {q}\nAnswer with a number only.\nA:",
    "zero_shot_cot": "Q: {q}\nA: Let's think step by step. End with 'Answer: <number>'.",
    "few_shot_cot": ("Q: A shirt and a cap cost ₹1200 in total. The shirt costs ₹800 more than the cap. "
                     "How much does the cap cost, in rupees?\n"
                     "A: Let the cap be c. Then c + (c + 800) = 1200, so 2c = 400 and c = 200. Answer: 200\n\n"
                     "Q: {q}\nA:"),
    "least_to_most": ("{q}\nFirst list the sub-questions you need to answer. Then answer them in order, "
                      "reusing earlier answers. End with 'Answer: <number>'."),
    "pal": ("{q}\nWrite a short Python program that computes the answer and stores it in a variable "
            "named answer. Reply with only the code in a ```python block."),
    "role": "You are a world-class mathematician.\nQ: {q}\nAnswer with a number only.\nA:",
}


def extract_number(text: str):
    m = re.search(r"Answer:\s*₹?\s*(-?\d+(?:\.\d+)?)", text)
    if not m:
        nums = re.findall(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
        if not nums:
            return None
        return float(nums[-1])
    return float(m.group(1))


def run_pal(text: str):
    """Execute model-written code in a tiny namespace. For class use only:
    never run untrusted code like this in production."""
    m = re.search(r"```(?:python)?\s*(.*?)```", text, re.S)
    code = m.group(1) if m else text
    if re.search(r"\b(import|open|exec|eval|__|os|sys|subprocess)\b", code):
        return None
    ns: dict = {}
    try:
        exec(code, {"__builtins__": {"round": round, "abs": abs, "int": int, "float": float, "print": lambda *a, **k: None}}, ns)
        return float(ns.get("answer")) if ns.get("answer") is not None else None
    except Exception:
        return None


class Backend:
    """mock: simulated model. ollama: local server. openai: any OpenAI-compatible API."""

    def __init__(self, kind: str, model: str | None):
        self.kind, self.model = kind, model
        self.tokens = 0

    def __call__(self, prompt: str, temperature: float = 0.0) -> str:
        if self.kind == "mock":
            return self._mock(prompt, temperature)
        if self.kind == "ollama":
            body = {"model": self.model, "prompt": prompt, "stream": False,
                    "options": {"temperature": temperature}}
            req = urllib.request.Request("http://localhost:11434/api/generate",
                                         data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
            out = json.load(urllib.request.urlopen(req, timeout=300))
            self.tokens += out.get("prompt_eval_count", 0) + out.get("eval_count", 0)
            return out["response"]
        if self.kind == "openai":
            base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
            body = {"model": self.model, "temperature": temperature,
                    "messages": [{"role": "user", "content": prompt}]}
            req = urllib.request.Request(base + "/chat/completions", data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json",
                                                  "Authorization": "Bearer " + os.environ.get("OPENAI_API_KEY", "")})
            out = json.load(urllib.request.urlopen(req, timeout=300))
            self.tokens += out.get("usage", {}).get("total_tokens", 0)
            return out["choices"][0]["message"]["content"]
        raise ValueError(self.kind)

    # A toy model with System-1 and System-2 behaviour, so the pipeline runs offline.
    def _mock(self, prompt: str, temperature: float) -> str:
        nums = [int(x) for x in re.findall(r"₹(\d+)", prompt.split("Q: ")[-1] if "Q: " in prompt else prompt)]
        total, diff = (nums[-2], nums[-1]) if len(nums) >= 2 else (110, 100)
        fast, slow = total - diff, (total - diff) // 2
        self.tokens += len(prompt) // 4
        noise = random.random() < (0.15 + 0.3 * temperature)
        if "python" in prompt.lower():
            return f"```python\ntotal, diff = {total}, {diff}\nanswer = (total - diff) / 2\n```"
        if "step" in prompt.lower() or "sub-question" in prompt.lower() or "Answer: 200" in prompt:
            self.tokens += 60
            # slow-path mistakes scatter over several wrong values (this is what makes voting work)
            ans = random.choice([fast, slow + 1, 2 * slow, total, slow - 1]) if noise else slow
            return f"Let x be the small item. x + (x + {diff}) = {total}, so x = {slow}. Answer: {ans}"
        return str(fast if random.random() < 0.8 else slow)    # System 1: fluent and usually wrong


def demo_crt(backend: str, model: str | None, n_items: int, n_sc: int) -> None:
    header(f"9. Technique comparison on {n_items} fresh items (backend={backend})")
    llm = Backend(backend, model)
    items = make_items(n_items)
    results = {}
    for name, tpl in TEMPLATES.items():
        llm.tokens, correct = 0, 0
        for it in items:
            out = llm(tpl.format(q=it["q"]))
            pred = run_pal(out) if name == "pal" else extract_number(out)
            correct += pred is not None and abs(pred - it["a"]) < 1e-6
        results[name] = (correct / len(items), llm.tokens / len(items))
    # self-consistency on top of zero-shot CoT
    llm.tokens, correct = 0, 0
    for it in items:
        votes = [extract_number(llm(TEMPLATES["zero_shot_cot"].format(q=it["q"]), temperature=0.7)) for _ in range(n_sc)]
        votes = [v for v in votes if v is not None]
        if votes:
            best = max(set(votes), key=votes.count)
            correct += abs(best - it["a"]) < 1e-6
    results[f"self_consistency@{n_sc}"] = (correct / len(items), llm.tokens / len(items))
    print(f"{'technique':<22}{'accuracy':>10}{'tokens/item':>14}")
    for k, (acc, tok) in results.items():
        print(f"{k:<22}{acc:>10.2f}{tok:>14.0f}")
    if backend == "mock":
        print("(mock backend: numbers illustrate the pipeline, not a real model)")


SECTIONS = {"decode": demo_decode, "numbergame": demo_numbergame, "calibrate": demo_calibrate,
            "variance": demo_variance, "vote": demo_vote, "verify": demo_verify,
            "g24": demo_g24, "taxi": demo_taxi}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("section", nargs="?", default="all", choices=["all", "crt", *SECTIONS])
    ap.add_argument("--backend", default="mock", choices=["mock", "ollama", "openai"])
    ap.add_argument("--model", default=None)
    ap.add_argument("--items", type=int, default=20)
    ap.add_argument("--sc", type=int, default=5, help="samples for self-consistency")
    args = ap.parse_args()
    random.seed(0)
    if args.section == "all":
        for f in SECTIONS.values():
            f()
        demo_crt("mock", None, args.items, args.sc)
    elif args.section == "crt":
        demo_crt(args.backend, args.model, args.items, args.sc)
    else:
        SECTIONS[args.section]()


if __name__ == "__main__":
    main()
