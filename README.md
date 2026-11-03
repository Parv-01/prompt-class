# Prompting Techniques, Fast and Slow — class kit

A 60-minute interactive class on prompting techniques and their mathematics, framed through
Daniel Kahneman's System 1 / System 2. **Everything works offline**: fonts, KaTeX and all
widgets are bundled; no internet, server, API key or model is needed in the classroom.

| File | What it is |
|---|---|
| `index.html` | 31-slide interactive deck. Double-click to open (Chrome/Edge/Firefox). |
| `notes.html` / `notes.pdf` | Handout: run sheet, every derivation, code, prompt templates, exercises with solutions (22 pages). |
| `lab/prompting_lab.py` | Runnable lab (numpy only) reproducing every slide's maths, plus a real-model comparison harness. |
| `assets/` | Deck engine, widgets, local fonts (OFL) and KaTeX (MIT). |

## Presenting
Open `index.html`, press **F** for full screen. Keys: → / ← move, **N** speaker notes with
minute-by-minute timings, **G** jump to slide, **T** light/dark theme, **?** help. `#18` in the URL opens slide 18.

Interactive slides: 3 (bat and ball), 6 (temperature/top-p), 9 (number game), 10 (live anchoring
experiment with permutation test), 15 (17 × 24), 16 (technique playground), 18 (self-consistency
with correlation), 20 (Game of 24 search), 24 (taxi cab Bayes), 25 (Linda poll), 29 (quiz).
Widget outputs that stand in for a model are labelled illustrative.

If running late, skip slides 13, 21 and 27 (one minute each).

## Lab
```bash
pip install numpy
python lab/prompting_lab.py all                      # all offline demos, ~2 s
python lab/prompting_lab.py crt --backend ollama --model llama3.1:8b --items 30
OPENAI_BASE_URL=... OPENAI_API_KEY=... python lab/prompting_lab.py crt --backend openai --model <name>
```

## Live site
- Slides: https://parv-01.github.io/prompt-class/
- Handout: https://parv-01.github.io/prompt-class/notes.html (PDF: `notes.pdf`)

Pushing to `main` redeploys automatically via `.github/workflows/pages.yml`
(Settings → Pages → Source must be **GitHub Actions**).
