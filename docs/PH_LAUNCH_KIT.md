# Silens — Product Hunt Launch Kit

## 1. The Basics

**Product Name:** Silens

**Tagline:** Just write.

**Short Description (254 chars):**

> Silens is a local-first, distraction-free writing app with zero setup. No folders, no formatting, no cloud. Open it, and you're already writing in today's date file. Silent autosave, ghost tags, and a Zen canvas that fades away the moment you type. Built with Rust + Tauri.

---

## 2. Maker's Comment

**The first comment:**

> Hi Product Hunt. I built Silens because I was tired of *preparing* to write.
>
> Every note app I've used over the years eventually becomes a filing cabinet. Folders to organize, tags to manage, themes to pick, fonts to choose, sync conflicts to resolve, and a settings panel so long it becomes its own product. The moment you open one, the blank page has already turned into a project management dashboard. I didn't sign up for that.
>
> So Silens takes almost everything out. Open it and you're in today's file — a single blank sheet, named by date, with a blinking cursor. That's the whole onboarding. There are no folders, no naming step, no "where does this go?" question. You just write, and when you stop, it's silently saved to `YYYY-MM-DD.md` on your machine. No cloud, no accounts, no data leaving your device.
>
> The one structural tool we kept is what we call **Ghost Tags** — type `#` and a word, and that block quietly routes to a themed timeline. It's enough to find things later, without forcing you to organize *while* writing. Tags are ghosts: they sit in the text, whisper-quiet (low opacity, no color blocks, no borders), and only surface when you ask for them.
>
> The rest is atmosphere. The UI literally fades to nothing within 300ms of your first keystroke. A physical spring typewriter keeps your words anchored in the golden third of the screen. Optional ambient soundscapes — rain, fire, or deep night — let the silence be the kind you choose.
>
> We call it "dictatorial typography" on purpose: no font choices, no line-spacing sliders, no alignment toggles. The layout is welded. You focus on one thing only.
>
> **We're shipping 1.0 today.** It's free, local, and fast (Rust + Tauri). Please open the app, write something you meant to get to, and tell us if the "no settings" approach actually holds — or where it gets in the way.

---

## 3. Product Description / Key Features

*(For the main description body — 4 punchy bullets)*

- **The Zen Canvas** — 300ms after your first keystroke, every button, logo, and counter disappears. The page becomes pure white paper and your words. Stop typing for a second, and the world quietly returns.

- **The Spring Typewriter** — Instead of a static centered column, Silens uses a damped spring algorithm. As you write, the page physically rises, locking your current line in the golden third of the screen. Scroll to read, and the spring sleeps instantly.

- **Ghost Tags** — No folder hierarchy. No tag management panel. Type `#` + a word and that block routes to a timeline, rendered at 40% opacity as an unobtrusive marker in the text. The structure is there when you need it, invisible when you don't.

- **Three Soundscapes** — Rain, fire, or deep night, synthesized locally via Web Audio. No socializing noise, no café clatter. Just the quiet you choose, at a volume that disappears behind your thinking.

---

## 4. Visual Assets Concept (Gallery)

### Image 1 — The Blank Canvas

- **Concept:** Full-frame shot of the empty Silens window, centered 620px column on warm paper-white background. A single caret blinks in the top-left of the column. No toolbar, no chrome.
- **Overlay text** (lower-left, `letter-spacing: 0.25em`, `opacity: 0.4`):
  > **No titles. No folders. Just write.**

### Image 2 — The Fade

- **Concept:** Split-frame or GIF. Left: the fully visible UI (logo, word count, atmosphere panel, timeline indicator) at `opacity: 1`. Right: the same screen 300ms later, all chrome gone, only the text and caret remain. Caption suggests "press any key."
- **Overlay text** (bottom center, tiny mono):
  > **300ms after your first keystroke, everything else is gone.**

### Image 3 — Ghost Tags & Timeline

- **Concept:** Two-panel side-by-side. Left panel: dense stream-of-consciousness prose with three or four `#` tags (`#待办`, `#电影`, `#读书`) scattered through it, each at 40% opacity. Right panel: the sidebar flipped to the "global tag cloud" view — same words, but now grouped into parallel timelines with a subtle scrubber.
- **Overlay text** (top, wide-tracked):
  > **No folders. Just #.**
- **Sub-text:** *Tags are ghosts — invisible in the text, present when you need them.*

### Image 4 — The Three Soundscapes *(Optional Hero Alternative)*

- **Concept:** Three thin vertical strips, each with a different ambient waveform — rain (fine vertical lines), fire (low-freq flicker), night (nearly flat with a single slow pulse). Below, three small labels in the dictatorial font stack.
- **Overlay text** (centered, mono, `opacity: 0.5`):
  > **Pick your quiet.**
- **Sub-text:** *Rain · Fire · Night — synthesized on-device, no streaming.*
