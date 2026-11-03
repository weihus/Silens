<p align="center">
  <img src="public/favicon.svg" alt="Silens icon: a sage-green S with a sprouting leaf" width="128" height="128" />
</p>

<h1 align="center">Silens</h1>

<div align="center">
  <strong>语言 / Language</strong>：
  <a href="README.md">简体中文</a> | <a href="README.en.md">English</a>
</div>

Silens is a local-first Markdown writing tool built on [Tauri](https://tauri.app/), with daily notes for passing thoughts and titled notes for longer pieces. Open straight into today's note and start writing; both forms share a warm paper palette and a gentle interface for focused writing.

[Product website source](website/index.html) · [Download Silens](https://github.com/weihus/Silens/releases/latest)

## In-app updates

Open “书写氛围 → 检查软件更新” to check the version and release notes, then choose to download, install, and restart. Background checks run 10 seconds after launch and every four hours; notices appear while idle, outside focus mode and other dialogs. Downloads require confirmation. Installation proceeds only after saving and backing up notes. Signed packages are verified before installation; update checks do not upload notes.

Older releases need one manual upgrade to gain this feature. Linux in-app updates apply to AppImage; DEB installations still require a manual package download.

Before publishing, configure the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` with the private key matching the public key in `src-tauri/tauri.conf.json`, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if applicable. Back up the private key securely and never commit it. The release tag and versions in `package.json`, `Cargo.toml`, and the Tauri config must agree. The release workflow generates `latest.json` after collecting signed artifacts for all three platforms.

## Product website

`website/` is a standalone static site with actual interface screenshots using sample notes, theme previews, and platform downloads. Preview with `python3 -m http.server 4174 --directory website`. Downloads resolve the latest official GitHub Release, with a release-page fallback if the API is unavailable.

Set repository Settings → Pages → Source to **GitHub Actions** to enable deployment through `website.yml`. The workflow deployment result provides the published URL.


## Current development & releases

The features below describe the **current development build**. For features available in a downloaded package, read its [Release notes](https://github.com/weihus/Silens/releases). See also the [changelog](CHANGELOG.md) and [Chinese user manual](MANUAL.md).

- Start in today's daily note, or create a titled note for a standalone piece.
- Review daily notes by block and titled notes by whole-piece title and summary, through shared time and tag views.
- Keep creation dates fixed while tracking modifications separately; carry creation metadata with backups and workspace migrations.
- Use the same focus mode, timer, fading interface, and export options for both kinds of writing.

## About

Notes are stored as plain `.md` files, by default in `Documents/Silens_Notes`. The SQLite index used for search and tags lives in the application's local data directory; private index metadata is not embedded in notes. Everyday writing does not require a cloud service, and there is currently no AI feature silently uploading notes. Sync software you choose may sync the notes folder, and `Documents` itself may be managed by services such as iCloud or OneDrive.

## Roadmap & Progress

- [x] **Gentle interface**: Warm paper, white, and night themes, with system theme and reduced-motion preferences supported.
- [x] **Editing & autosave**: Save to the current file after 1500ms of idle, including clearing an existing note; refuse overwrites when external changes are detected.
- [x] **Daily & titled notes**: Start in today's file or create a standalone piece with its own title and stable filename.
- [x] **Tags, timeline & search**: Review daily-note blocks and whole titled notes through shared creation-date and tag filters, with contextual search previews.
- [x] **Focus & ambient sound**: Both kinds of writing share typewriter scrolling, a focus timer, and Rain, Fire, and Night soundscapes.
- [x] **Wiki links**: `[[document]]` completion and `[[file|label]]` aliases, with forward navigation and prefix, substring, and fuzzy matching.
- [x] **Snapshots & workspace migration**: Publish backups after verification; copy and verify notes during migration while retaining originals.
- [x] **Backlinks**: A collapsed section below the note shows referring notes and context; click to return to a source. Hidden in focus mode.
- [ ] **AI-assisted organization**: Future work only; processing or uploading notes must require explicit user opt-in.

## Tech Stack

The frontend and backend communicate through Tauri IPC:

- **Frontend**: React 19, TypeScript, Vite, and Tailwind CSS; TipTap / ProseMirror and tiptap-markdown provide editing and Markdown serialization, with Framer Motion for animations.
- **Backend**: Rust and Tauri; `std::fs` / `walkdir` handle files, `serde` / `serde_json` handle serialization, and `rusqlite` provides an app-local SQLite index.

## Core Features

### 1. Writing & browsing

- **Daily notes & titled pieces**: Launch into today's `YYYY-MM-DD.md` and write without first entering a title. Use the sidebar **+** or **新建篇目 (New titled note)** in `Cmd/Ctrl + K` to create a standalone piece. Its title and body share one `article-UUID.md` file, with the first H1 storing the title. Editing the title keeps the filename stable.
- **Warm writing canvas**: A paper background, gray-green text and accents, subtle borders, and generous spacing. Both daily and titled notes share the Ichigo-ichie focus mode, timer, and interface that fades while typing and respects the system reduced-motion preference.
- **Explicit navigation**: Browse, search, and sidebar pinning have explicit buttons; key controls provide accessible names and visible keyboard focus. “Back to today” returns to the daily note. Reviewing results keeps the current editor document in place until you click a result to open its full text.
- **Markdown editing**: Imported or opened Markdown retains headings and code structure. Typing `# ` does not automatically create a heading. Bold, italic, lists, and `#tags` are supported.
- **Time, tags & titled-note browsing**: Time and tags provide shared entry points for both kinds of writing: daily notes appear as blocks, and titled notes as whole pieces with titles and summaries. Views organize and filter by creation date; the selected date range persists across time, tag, and titled-note views. A separate **继续写作 (Continue writing)** entry opens titled notes in **Recently modified** order, with creation-date sorting available too. The date filter works within either recall view, and complete creation and modification times remain available in each note's tooltip.
- **Search & sidebar controls**: `Cmd/Ctrl + K` opens compact search; context previews appear with results and are hidden on narrow windows. Dismiss the sidebar with its controls, Escape, or a canvas click when unpinned; moving the pointer away leaves it open. A pinned sidebar returns after search closes.
- **Wiki links & backlinks**: Type `[[` to select a note, use `[[file|label]]` for a display alias, and click a link to open its target. Stable filenames keep links intact when you edit a note's title. When other notes refer to the current document, a collapsed section below the editor shows the number of referring notes. Expand it for source titles and context; click to return to a source and attempt to locate the reference. Each source appears once; self-references and code examples are excluded. Hidden in focus mode. References are read from the current workspace files and refresh on opening, saving, or returning to the app.
- **Atmosphere & export**: Settings include themes, ambient sound, volume, focus duration, and local file actions. Both kinds of writing support Markdown, plain text (TXT), PNG, and JPG exports, including the title for titled notes.

### 2. Saving, backups & recovery

- **Keep the current filename**: Today's note uses `YYYY-MM-DD.md`, and newly created titled notes use a stable `article-UUID.md`; changing its title leaves that filename intact. After opening an older note or another file, autosave writes back to that file. Clearing an existing note is saved too. A new page with neither a title nor body does not create an empty file.
- **Creation & modification dates**: Creation dates stay fixed, while the file's modification time tracks edits independently. Creation dates are registered in the workspace's `.silens-created.json`; the app-local SQLite index can be rebuilt from the notes and this registry. Older article files are registered using the earliest available filesystem birth or modification time, and that creation date then remains fixed.
- **Optimistic conflict checks**: Before saving, disk content is compared with the last loaded or saved content. Detected changes or deletion cause the overwrite to be refused. Writes use a temporary file followed by replacement; failures show an error and retain the text in the editor so you can export a copy. This is not a cross-process lock or concurrent-edit merge mechanism.
- **Save and back up before closing**: Closing the window waits for pending saves, then creates a backup before closing. If saving or backup fails, the window stays open and displays an error.
- **Local snapshots**: Snapshots include notes and the workspace's `.silens-created.json` creation-date registry. They are created every 6 hours while the app runs, before closing the window, or through the manual backup action. They are stored in `Documents/Silens_Backups`. Files are copied to a staging directory and verified before the snapshot is published. Successful publication triggers retention of the latest 10 snapshots; cleanup failures may leave more than 10. Failed copies or verification do not trigger removal of older backups.
- **In-app restore**: Under "书写氛围 → 本地文件 → 恢复备份", snapshots are listed with their time and note count. Confirming restores the whole notes folder. The current notes are snapshotted first, so the same steps can return to the state before the restore; notes created after the chosen snapshot leave the folder but remain in that snapshot. "查看备份" still opens the backup folder.

### 3. Workspaces & cloud folders

Workspace migration accepts a folder on your machine, including a local iCloud Drive, OneDrive, or Dropbox sync folder. Silens copies Markdown files and carries the `.silens-created.json` creation-date registry into `Silens_Notes` at the destination, verifies the content, and rebuilds the app-local index before switching workspaces. Original files are retained. Existing destination files with different content cause migration to stop without overwriting them; identical files can be reused. A failed migration may leave files already copied to the destination.

Third-party software handles cross-device synchronization. Silens does not guarantee detection or merging of concurrent edits. Backups remain in `Documents/Silens_Backups`, but `Documents` may itself be cloud-managed, so these snapshots are not guaranteed to be independent offline copies.

### 4. AI roadmap

Tag organization and search currently run locally. AI-assisted organization is not implemented. Any future cloud AI feature must require explicit opt-in and explain what it processes and uploads; it must not silently upload notes in the background by default.

## Keyboard Shortcuts

Shortcuts complement the visible controls:

- **Global search / New titled note**: `Cmd / Ctrl` + `K`, then search or choose **New titled note** (also available through the sidebar **+**)
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
