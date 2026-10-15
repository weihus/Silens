# Silens

<div align="center">
  <strong>语言 / Language</strong>：
  <a href="README.md">简体中文</a> | <a href="README.en.md">English</a>
</div>

Silens is a local-first Markdown writing tool built on [Tauri](https://tauri.app/), with a warm paper palette and a gentle interface for focused writing.

## v1.1.0

This minor release focuses on dependable saving and a quieter writing experience while retaining the existing Markdown note format. See the [changelog](CHANGELOG.md) and [Chinese user manual](MANUAL.md).

- Correct historical-note save targets, empty edits, and save ordering during navigation; preserve a draft copy before reloading external changes.
- Verify snapshots before publishing, retain originals during workspace migration, and store indexes in app-local data.
- Compact search with previews only when results exist; fix persistent empty-result notices, overlapping panels, and focus conflicts.
- Warm paper and gray-green visual hierarchy, deliberate sidebar dismissal, and a gentle UI return after 2.2 seconds of inactivity.
- Improve IME completion, Wiki links, blank lines in Markdown code blocks, exports, and Apple Silicon development launches under Rosetta.

## About

Notes are stored as plain `.md` files, by default in `Documents/Silens_Notes`. The SQLite index used for search and tags lives in the application's local data directory; private index metadata is not embedded in notes. Everyday writing does not require a cloud service, and there is currently no AI feature silently uploading notes. Sync software you choose may sync the notes folder, and `Documents` itself may be managed by services such as iCloud or OneDrive.

## Roadmap & Progress

- [x] **Gentle interface**: Warm paper, white, and night themes, with system theme and reduced-motion preferences supported.
- [x] **Editing & autosave**: Save to the current file after 1500ms of idle, including clearing an existing note; refuse overwrites when external changes are detected.
- [x] **Tags, timeline & search**: Local indexing, tag browsing, contextual search previews, and explicit sidebar, pin, and search controls.
- [x] **Focus & ambient sound**: Typewriter scrolling, a focus timer, and Rain, Fire, and Night soundscapes.
- [x] **Wiki links**: `[[document]]` completion and forward navigation, with prefix, substring, and fuzzy matching.
- [x] **Snapshots & workspace migration**: Publish backups after verification; copy and verify notes during migration while retaining originals.
- [ ] **Backlinks**: Show which notes reference the current document.
- [ ] **AI-assisted organization**: Future work only; processing or uploading notes must require explicit user opt-in.

## Tech Stack

The frontend and backend communicate through Tauri IPC:

- **Frontend**: React 19, TypeScript, Vite, and Tailwind CSS; TipTap / ProseMirror and tiptap-markdown provide editing and Markdown serialization, with Framer Motion for animations.
- **Backend**: Rust and Tauri; `std::fs` / `walkdir` handle files, `serde` / `serde_json` handle serialization, and `rusqlite` provides an app-local SQLite index.

## Core Features

### 1. Writing & browsing

- **Warm writing canvas**: A paper background, gray-green text and accents, subtle borders, and generous spacing. The interface fades while typing and respects the system reduced-motion preference.
- **Explicit navigation**: The header shows the current note's date or filename, with a “Back to today” button when viewing older notes. Browse, search, and sidebar pinning have explicit buttons; key controls provide accessible names and visible keyboard focus.
- **Markdown editing**: Imported or opened Markdown retains headings and code structure. Typing `# ` does not automatically create a heading. Bold, italic, lists, and `#tags` are supported, with local indexing for browsing content blocks.
- **Timeline & search**: Browse by date or tag. Dismiss the sidebar with its controls, Escape, or a canvas click when unpinned; moving the pointer away leaves it open. `Cmd/Ctrl + K` opens compact search; context previews appear with results and are hidden on narrow windows. A pinned sidebar returns after search closes.
- **Wiki links**: Type `[[` to select a note and click a link to open its target. These are forward links; a backlinks list is not yet implemented.
- **Atmosphere & export**: Settings include themes, ambient sound, volume, focus duration, and local file actions. Export supports Markdown, plain text, PNG, and JPG.

### 2. Saving, backups & recovery

- **Keep the current filename**: Today's note uses `YYYY-MM-DD.md`; after opening an older note or another file, autosave writes back to that file. Clearing an existing note is saved too. A new page with no content does not create an empty file.
- **Optimistic conflict checks**: Before saving, disk content is compared with the last loaded or saved content. Detected changes or deletion cause the overwrite to be refused. Writes use a temporary file followed by replacement; failures show an error and retain the text in the editor so you can export a copy. This is not a cross-process lock or concurrent-edit merge mechanism.
- **Save and back up before closing**: Closing the window waits for pending saves, then creates a backup before closing. If saving or backup fails, the window stays open and displays an error.
- **Local snapshots**: Snapshots are created every 6 hours while the app runs, before closing the window, or through the manual backup action. They are stored in `Documents/Silens_Backups`. Files are copied to a staging directory and verified before the snapshot is published. Successful publication triggers retention of the latest 10 snapshots; cleanup failures may leave more than 10. Failed copies or verification do not trigger removal of older backups.
- **Manual recovery**: In the atmosphere panel, expand the local files section and choose the view-backups action to open the backup folder. Recovery requires manually selecting and copying files; there is no in-app restore interface.

### 3. Workspaces & cloud folders

Workspace migration accepts a folder on your machine, including a local iCloud Drive, OneDrive, or Dropbox sync folder. Silens copies Markdown files into `Silens_Notes` at the destination, verifies the content, and rebuilds the local index before switching workspaces. Original files are retained. Existing destination files with different content cause migration to stop without overwriting them; identical files can be reused. A failed migration may leave files already copied to the destination.

Third-party software handles cross-device synchronization. Silens does not guarantee detection or merging of concurrent edits. Backups remain in `Documents/Silens_Backups`, but `Documents` may itself be cloud-managed, so these snapshots are not guaranteed to be independent offline copies.

### 4. AI roadmap

Tag organization and search currently run locally. AI-assisted organization is not implemented. Any future cloud AI feature must require explicit opt-in and explain what it processes and uploads; it must not silently upload notes in the background by default.

## Keyboard Shortcuts

Shortcuts complement the visible controls:

- **Global search (Spotlight)**: `Cmd / Ctrl` + `K`
- **Open / collapse timeline**: `Cmd / Ctrl` + `L`
- **Toggle focus mode**: `Cmd / Ctrl` + `Shift` + `F`
- **Toggle atmosphere settings**: `Cmd / Ctrl` + `Shift` + `M`
- **Undo**: `Cmd / Ctrl` + `Z`
- **Redo**: `Cmd / Ctrl` + `Y` or `Shift` + `Cmd / Ctrl` + `Z`

## Development & Build

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

On macOS, `tauri.macos.conf.json` selects a native Cargo launcher. In an Apple Silicon Rosetta terminal it launches Cargo as arm64 to avoid `cc/xcrun` architecture mismatches. Frontend-only mode does not provide native file APIs; use Tauri mode for actual note operations.

Checks: `npm run build`, `npx vitest run`, and `cargo test --manifest-path src-tauri/Cargo.toml`. In a Rosetta terminal, use `scripts/cargo-native.sh test --manifest-path src-tauri/Cargo.toml`.

### Build & release

When ready to ship, run the following. Tauri builds the frontend and compiles it with the Rust backend into native binaries for each platform (`.exe`, `.app`, `.dmg`, `.deb`):

```bash
npx tauri build
```

Bundled output lands in `src-tauri/target/release/bundle/`.

## Core Directory Structure

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

## Contributing

Issues and pull requests are welcome! Feel free to start a discussion about Markdown rendering or the local file-management approach.

## License

MIT License
