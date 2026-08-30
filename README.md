# FeedSparc Sync

An Obsidian plugin that connects to your FeedSparc account and pulls queued articles directly into your vault as Markdown notes.

## Features

- **Queue consumption:** Fetches only the items you've explicitly queued in FeedSparc.
- **Idempotent upsert:** A note's original `source_id` is written to its frontmatter. If you queue the same article twice, the plugin updates the existing note instead of duplicating it, even if you moved the file elsewhere in your vault.
- **Template engine:** Fully customizable paths, frontmatter, and note bodies.
- **Background sync:** Can automatically pull new items every few minutes.
- **CORS-safe:** Uses Obsidian's internal `requestUrl` API.

## Installation via BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) in Obsidian.
2. In BRAT settings, click **Add beta plugin**.
3. Enter this repository's URL: `https://github.com/ssmonkk/rssagent`
4. Enable the plugin in **Community plugins**.

## Configuration

1. **API Base URL:** The root URL of your FeedSparc instance (e.g. `https://feedsparc.com`).
2. **API Token:** Generate an export token in FeedSparc's settings menu (`/settings`) and paste it here.
3. Click **Test connection** to confirm it works.
4. Set a destination folder for your notes (leave blank for the vault root).

## Template Variables

The filename, frontmatter, and note body templates accept these placeholders using `{{variable}}` syntax:

| Variable | Description |
| --- | --- |
| `sourceId` | Unique FeedSparc item ID (always included in frontmatter as `source_id`) |
| `title` | The article title |
| `url` | The URL of the original article |
| `feedTitle` | The name of the source feed |
| `publishedAt` | The published date/time |
| `date` | The published date as `YYYY-MM-DD` |
| `summary` | AI-generated summary (if available) |
| `body` | The full content of the article |
| `tags` | Tags assigned in FeedSparc |
