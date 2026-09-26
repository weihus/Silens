# Silens 📝

<div align="center">
  <strong>语言 / Language</strong>：
  <a href="README.md">简体中文</a> | <a href="README.en.md">English</a>
</div>

Silens is an extremely minimal, local-first, zero-friction immersive Markdown writing tool built on [Tauri](https://tauri.app/). It follows the design principles of "open and write, data sovereignty, no distraction," giving you an "once-in-a-lifetime" focused writing experience.

## ✨ About

Silens is a distraction-free writing space. Thanks to Tauri's low-level architecture, it has minimal memory usage and instant startup. All notes are saved as plain `.md` text in `Documents/Silens_Notes` on your machine, with no private metadata, no cloud dependency, and your privacy fully protected.

## 🛣️ Roadmap & Progress

- [x] **Immersive editing & silent saving**: Start writing with no title; the UI fades as you type, and silently saves to `YYYY-MM-DD.md` after 1500ms of idle.
- [x] **Stream-of-consciousness Ghost Tags & block parsing**: No colored blocks, no single-line truncation. Write freely with plain `#tags` — a single Enter continues, a **double Enter auto-splits** and archives the whole content block.
- [x] **Ambient white-noise engine**: Rain, Fire, and Night soundscapes — no socializing background noise (e.g. cafés), only absolute solitude.
- [x] **Physical spring typewriter & smart sleep**: A damped spring algorithm pushes the page up smoothly and locks it at 35% of the viewport while typing; it sleeps instantly when you scroll or use arrow keys to review.
- [x] **Pin mode (two-pane)**: One-click lock on the timeline sidebar; the main editor glides over to yield a fluid two-pane workspace.
- [x] **Shadow index & state swap**: A hidden SQLite index powers the sidebar; a single water-fog transition flips it into a global tag cloud.
- [x] **Spotlight-grade global travel**: A floating glassmorphism command palette (Cmd+K) with rich "card preview" context; Enter travels precisely and triggers a "ghost highlight."
- [x] **Silent safe backup**: Auto-snapshots on quit or every 6 hours, intelligently keeping the 10 most recent.
- [x] **Bidirectional links**: Type `[[` for auto-complete across prefix, substring, and fuzzy strategies — jump instantly to any related note from your history.
- [ ] **Cloud AI manager (Pro)**: Background semantic decomposition and structuring.
- [x] **Cloud workspace transfer**: Safely move your workspace to iCloud / OneDrive / Dropbox, enjoying cloud sync while keeping a local snapshot as a double safety net.

## 🧩 Tech Stack

A modern frontend/backend architecture communicating over Tauri IPC:

- **Frontend (presentation)**: React 19 + TypeScript + Vite + Tailwind CSS
  - **Editor**: TipTap (ProseMirror) for a seamless WYSIWYG Markdown experience.
  - **State & interaction**: Native React state, Framer Motion animations, a Spotlight-style global command palette, and multi-format export via html2pdf.js / html-to-image.
- **Backend (system layer)**: Rust + Tauri Core
  - `std::fs` / `walkdir`: high-performance local file-system traversal and I/O.
  - `serde` / `serde_json`: seamless serialization between Rust structs and frontend JSON.
  - `rusqlite` (SQLite): a high-performance shadow index for millisecond-level structured queries while keeping `.md` data sovereignty.

## 🚀 Core Features

### 1. The Zen Canvas
- **No title, no-friction start**: Throw away the "new — name — write" flow. Open the app and the cursor is already blinking on today's blank page; time is your natural coordinate.
- **Typing lock & the world retreating**: An extremely restrained interface. The moment you type, the cursor is forced invisible and the top logo, word count, and settings entry smoothly fade within 300ms — "start writing → the world retreats" into absolute silence. The world only reappears after 1000ms of stillness.
- **Physical spring typewriter & intent-aware sleep**: In place of rigid centered scrolling, a physical spring keeps your line anchored at the golden 35% of the screen while writing. When you use the mouse or arrow keys to edit old text, the typewriter sleeps and never steals your view.
- **Immersive fade & vignette**: A bottom gradient vignette that switches seamlessly with the day/night theme. While typing or scrolling, the word count, pomodoro, and other elements vanish; a second after you stop, they float back up like letters on still water.
- **Atmosphere panel**: Invoked with `Cmd/Ctrl + Shift + M`, the settings panel uses an extremely restrained ghost-state, borderless design — no traditional form categories (no `THEME` / `SOUND` / `VOLUME` / `FOCUS` headers or dividers), just faint background blocks and opacity shifts to signal "inactive / hover / active." A hairline slider track with a discreet thumb, and export demoted to a borderless ghost button at the bottom that only reveals on hover. All of this keeps absolute immersion and visual order even while adjusting parameters.

### 2. Stream of Consciousness & Auto-Routing
- **Invisible Markdown**: Traditional H1–H6 heading syntax that breaks your flow is dropped; only bold and italic remain. Combined with a 620px golden reading width, it forms a borderless timeline of time. A single Enter keeps lines tightly joined; a **double Enter creates a comfortable 48px–64px breathing gap**, perfectly matching the underlying "new content block" intuition.
- **One page for everything, block-level tags**: No frequent page switching. On the same sheet, tag a work note `#todo` on one line and a film review `#movie` on the next. The system silently slices content by tag into independent blocks.
- **The silent disk**: 1500ms after you stop typing, it writes to disk silently; each day auto-generates a `YYYY-MM-DD.md`. You just "pour"; the system "keeps" it.
- **Timeline recap**: The sidebar abandons complex tree folders for a timeline waterfall of month/day that matches human intuition, with smooth expansion to review past records elegantly.
- **Sidebar state swap**: Click the `#` marker at the top of the sidebar and the timeline dissolves like water vapor, flipping in place into a "global tag cloud directory." Click a tag to switch to a parallel timeline, with dynamic-height virtual scrolling and a draggable time scrubber.
- **Pin mode (two-pane)**: While reviewing, click the sidebar "pin" and the main canvas glides right like a fluid to yield, becoming an efficient two-pane comparison workspace — no more anxiety about "mouse-out auto-close."
- **The all-seeing eye & ghost travel (Spotlight & Ghost Highlight)**: `Cmd+K` summons a featherweight glassmorphism command palette with an original "card preview" two-column view for second-level search across your history. Enter travels instantly to an old canvas, and the target content fades in with a 1.5s "ghost highlight" so your thoughts never break.
- **Fully automatic backup fortress**: A low-overhead resident guardian thread snapshots the whole workspace to `Silens_Backups` on exit or every 6 hours, intelligently pruning to the 10 most recent — enterprise-grade peace of mind.

- **Cloud workspace transfer**: Safely move Silens's main workspace to a local iCloud Drive, OneDrive, or Dropbox folder. The system adapts to cloud sync for seamless cross-device writing, while all snapshot backups stay forced in local `Documents/Silens_Backups` — even if the cloud fails or goes offline, local data has a double safeguard.

### 3. Personal Sanctuary
- **Built-in white-noise engine**: A high-quality Web Audio engine provides three restrained soundscapes — Rain, Fire, and Night — one click to isolate the outside world.
- **Dictatorial typography**: No font or layout settings at all. The system forces the top native sans-serif font stack on macOS / Windows, welded to `19px` size, `1.9` line height, and `620px` width, using a low-contrast dark gray (`#2f3441`) — taking over your layout anxiety entirely.
- **Graceful export**: Export to Markdown, plain text, or PNG/JPG, preserving the full layout.

### 4. Advanced: The Invisible Manager (AI) [🔥 Pro Preview]
- **Free tier foundation**: A high-energy Rust regex engine aggregates your `#tag` blocks locally in milliseconds, generating structured waterfall recaps.
- **AI semantic decomposition (planned)**: For untagged "pure stream-of-consciousness" text, a cloud AI manager silently decomposes it into todos, journal entries, and reading notes, and supports waking your second brain through "AI soul dialogue."

## ⌨️ Keyboard Shortcuts

For maximum immersion and frictionless operation, Silens removes most traditional buttons in favor of highly efficient global shortcuts (mapped for both macOS and Windows/Linux):

- **Global search travel (Spotlight)**: `Cmd / Ctrl` + `K`
- **Summon / collapse timeline**: `Cmd / Ctrl` + `L`
- **Toggle focus mode ("once-in-a-lifetime")**: `Cmd / Ctrl` + `Shift` + `F`
- **Toggle atmosphere settings**: `Cmd / Ctrl` + `Shift` + `M`
- **Undo**: `Cmd / Ctrl` + `Z`
- **Redo**: `Cmd / Ctrl` + `Y` or `Shift` + `Cmd / Ctrl` + `Z`

## 💻 Development & Build

### Prerequisites

Make sure your environment has:
- Node.js (LTS recommended)
- Rust (via `rustup`)
- Tauri platform dependencies (Windows: C++ Build Tools, macOS: Xcode, Linux: webkit2gtk, etc.)

### Install dependencies

After cloning, install frontend dependencies in the project root:

```bash
npm install
```

### Local development

Start the frontend only, or the full Tauri desktop app:

**Frontend only (web mode)**:
```bash
npm run dev
```

**Full desktop app (Tauri mode)**:
```bash
npx tauri dev
```
*The first run compiles Rust dependencies and may take a while; later builds use the cache and are much faster.*

### Build & release

When ready to ship, run the following. Tauri builds the frontend and compiles it with the Rust backend into native binaries for each platform (`.exe`, `.app`, `.dmg`, `.deb`):

```bash
npx tauri build
```
Bundled output lands in `src-tauri/target/release/bundle/`.

## 📁 Core Directory Structure

```text
Sliens/
├── src/                    # Frontend source (UI, API wrappers, routing, state)
├── src-tauri/              # Rust backend source
│   ├── Cargo.toml          # Rust dependencies & project config
│   ├── tauri.conf.json     # Tauri core config (window, permissions, build)
│   └── src/
│       └── main.rs         # Core Rust logic (file I/O, tag substitution, IPC commands)
├── package.json            # Frontend dependencies & scripts
└── README.md               # Project documentation
```

## 🤝 Contributing

Issues and pull requests are welcome! Feel free to start a discussion about Markdown rendering or the local file-management approach.

## 📄 License

MIT License
