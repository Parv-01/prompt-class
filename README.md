# Talking to Machines: Prompting, Fast and Slow

A 60-minute interactive class on **prompt engineering techniques**, built around real-world
problems, questions for the class, and ideas from Daniel Kahneman's *Thinking, Fast and Slow*.

**Live:** https://parv-01.github.io/prompt-class/ · **Handout:** https://parv-01.github.io/prompt-class/notes.html

| File | What it is |
|---|---|
| `index.html` | 32-slide interactive deck. Works offline: just open the file. |
| `notes.html` / `notes.pdf` | The handbook: 12 techniques, each with the problem it solves, steps, a template, before/after examples, common mistakes, an exercise and a discussion question. Also a run sheet, checklist, template library and quiz answers. |
| `lab/prompting_lab.py` | Optional, for curious students: small Python simulations behind the demos (needs numpy). |
| `assets/` | Deck engine, widgets and local fonts (OFL). |

## The twelve techniques
**Fast** (help the model pick the right answer): specify · show examples · shape the output ·
remove anchors · reframe · use roles well.
**Slow** (give it room to think and ways to check): think step by step · ask several times ·
break it down · explore options · use tools · check with evidence.
Plus a bonus (give it the facts), "thinking" models, and three thinking traps: base rates,
detailed stories, and prompt injection.

## Interactive moments
Bat-and-ball warm-up · creativity dial · prompt builder ("what would the model have to guess?") ·
prompt makeover cards · guess-the-rule game · **live anchoring experiment** · 17 × 24 ·
technique playground · ask-several-times simulator · Game of 24 · taxi-cab dots · Linda poll ·
quiz. Outputs that stand in for an AI are labelled illustrative.

## Presenting
Press **F** for full screen, **N** for speaker notes with minute-by-minute timings, **G** to jump,
**T** for light/dark. `#12` in the URL opens slide 12.

## Deployment
Served by GitHub Pages from the `main` branch root (Settings → Pages → Deploy from a branch).
Every push to `main` updates the site within a minute or two.
