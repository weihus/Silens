# Silens — Product Hunt Launch Kit

This kit describes the **current development build**. For features available in a downloaded package, check its [Release notes](https://github.com/weihus/Silens/releases).

## 1. The Basics

**Product Name:** Silens

**Tagline:** A quiet space for daily thoughts and longer pieces.

**Short Description:**

> Silens is a local-first Markdown writing app for daily notes and titled pieces. Start in today's page, find your writing through time and tags, and settle into focus mode. Your work stays in plain files you can back up, move, and export.

**Download:** https://github.com/weihus/Silens/releases/latest

**Source:** https://github.com/weihus/Silens

## 2. Maker's Comment

> Hi Product Hunt. I built Silens to make it easier to begin writing and return to what I've written.
>
> Open the app and you're in today's daily note, ready to capture a thought without filling in a title. When you want a standalone piece, use the sidebar + or choose New titled note from Cmd/Ctrl + K. Its title and body live together in one Markdown file, and changing the title keeps the filename stable.
>
> Time and tags bring both kinds of writing together. Start with this month, flip through weeks, months, or years, or jump straight to a past period. Daily notes return as individual blocks; titled pieces return with a title and summary. Expand busy days, open a month from the year overview, and return to where you left off. The selected range carries across views, and your current document stays in place until you open a result.
>
> Both share the same quiet canvas: an interface that fades while you type, an Ichigo-ichie focus mode and timer, and optional Rain, Fire, or Night soundscapes. Wiki links and backlinks help you follow connections between notes. When you're ready to share, export as Markdown, TXT, PNG, or JPG, with the title included for titled pieces.
>
> Silens stores your writing as local Markdown files, with verified snapshots and workspace migration. If you choose a cloud-synced folder, your sync provider handles transfers between devices.
>
> I'd love to hear how you move between quick daily notes and longer pieces, and what helps you find a thought worth returning to.

## 3. Product Description / Key Features

- **Begin with today's page** — Launch straight into `YYYY-MM-DD.md` and capture a thought. Create a titled piece through the sidebar + or New titled note in Cmd/Ctrl + K when you want a separate document.
- **Give longer pieces their own space** — A titled note stores its title as the first H1 alongside its body in one `article-UUID.md` file. Renaming the title preserves the filename and links; exports include the title.
- **Rediscover by week, month, year, and tag** — Start with this month, browse adjacent periods, or select a date directly. Month view expands busy days; year view groups months and lets you open one and return. Creation-date ranges carry across time, tag, and titled-note views, and reopening the sidebar during the same app session restores your place. Continue writing lists titled notes within the selected range in Recently modified order, with creation-date sorting available too.
- **Stay with your writing** — Both forms share the fading interface, Ichigo-ichie focus mode, timer, and typewriter scrolling, with themes and optional ambient sound to suit your session.
- **Follow connections and search** — Use Wiki links, `[[file|label]]` aliases, and backlinks that display source titles. Cmd/Ctrl + K brings up search with contextual previews.
- **Keep portable Markdown files** — Autosave checks for external changes before overwriting. Verified snapshots and workspace migration carry notes and their creation-date registry together. Export Markdown, TXT, PNG, or JPG; use a sync folder when you want your chosen provider to handle cross-device transfers.

## 4. Gallery Captions

Use the existing gallery assets in this order; each entry maps to its filename stem.

### Image 1 — 01-cover.png

**Headline:** A place for daily thoughts and longer pieces.

**Caption:** Start in today's daily note, or create a titled piece for a thought that needs its own page. Both live as Markdown files in your workspace.

### Image 2 — 02-focus.png

**Headline:** Stay with the words.

**Caption:** The interface fades while you write. Ichigo-ichie focus mode and a timer give daily notes and titled pieces the same quiet space.

### Image 3 — 03-rediscover.png

**Headline:** Return through time and tags.

**Caption:** Rediscover daily-note blocks and titled pieces together. Keep your date range as you move between views, then open a result to read the full text.

### Image 4 — 04-connections.png

**Headline:** Follow a thought from one note to another.

**Caption:** Connect notes with Wiki links and display aliases. Backlinks show source titles, while stable filenames keep links intact as titles change.

### Image 5 — 05-search.png

**Headline:** Find a thought. Begin a piece.

**Caption:** Open Cmd/Ctrl + K to search with context previews or choose New titled note for a standalone piece.

### Image 6 — 06-atmosphere.png

**Headline:** Choose the atmosphere for your next page.

**Caption:** Set the theme, focus duration, and ambient sound. Rain, Fire, and Night accompany both daily writing and longer pieces.

## 5. Practical Answers for Launch Conversations

**Where is my writing stored?**

Notes are plain Markdown files, stored by default in `Documents/Silens_Notes`. Daily notes use date filenames; new titled pieces use stable `article-UUID.md` filenames. Everyday writing works locally. A cloud service you choose may sync this folder, and `Documents` itself may be managed by iCloud or OneDrive.

**How do creation dates work?**

Creation dates stay fixed in the workspace's `.silens-created.json` registry and travel with backups and workspace migration. Modification time tracks later edits separately. Older article files are registered using the earlier available filesystem birth or modification time, then keep that creation date. The search index lives in app-local data and can be rebuilt from the workspace.

**How does Silens protect saved work?**

Before saving, Silens compares disk content with the last loaded or saved content and refuses an overwrite if it detects an external change or deletion. Failed writes leave the text in the editor for recovery or export. Closing waits for saves and a backup; an error keeps the window open. Snapshots are verified before publication and run every six hours while the app runs, before closing, or on request. Successful publication retains the latest ten snapshots, though cleanup failures can leave more. Restoring a snapshot replaces the notes folder after first backing up its current state.

**Can I move or sync my workspace?**

Workspace migration copies and verifies files before switching, retains the originals, and stops on conflicting destination content. Identical destination files can be reused; a failed migration may leave files already copied. Your chosen sync provider handles cross-device transfers. Silens does not merge concurrent edits or guarantee their detection. Backups stay in `Documents/Silens_Backups`; if `Documents` is cloud-managed, these may also be synced.

**How do updates work?**

In-app updates show the version and release notes and require confirmation to download. Installation follows saving and backup, and signed packages are verified. Update checks do not upload notes. Older releases need a manual upgrade to gain the updater; Linux in-app updates apply to AppImage, while DEB installations require a manual download.
