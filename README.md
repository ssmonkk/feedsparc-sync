# RSSAgent Sync

An Obsidian plugin that connects to your RSSAgent account and pulls queued articles directly into your vault as Markdown notes. 

## Features

- **Queue consumption:** Fetches only the items you've explicitly queued in RSSAgent.
- **Idempotent upsert:** A note's original `source_id` is written to its frontmatter. If you queue the same article twice, the plugin updates the existing note instead of duplicating it, even if you moved the file elsewhere in your vault.
- **Template engine:** Fully customizable paths, frontmatter, and note bodies.
- **Background sync:** Can automatically pull new items every few minutes.

## Installation via BRAT (Beta)

This plugin is currently in pre-release. The easiest way to install it is via [BRAT](https://github.com/TfTHacker/obsidian42-brat).

1. Install BRAT from the Obsidian Community Plugins browser.
2. In BRAT's settings, click **Add Beta plugin**.
3. Paste the URL of this repository.
4. Enable the plugin under the Community Plugins tab.

## Setup

Once enabled, go to the plugin settings:

1. **API Base URL:** The root URL of your RSSAgent instance (e.g. `https://dev.instastores.pages.dev`).
2. **API Token:** Generate a token in RSSAgent's settings menu and paste it here.
3. Click **Test connection** to confirm it works.
4. Set a destination folder for your notes (leave blank for the vault root).

## Templates

You can customize how notes are generated using variables like `{{title}}` or `{{url}}`. The plugin provides three template layers:

- **Filename:** Determines the note's path (e.g. `{{date}} {{title}}`). Illegal characters are automatically sanitized.
- **Frontmatter:** Inserted at the top of the file. YAML escaping is handled automatically so quotes inside titles will never corrupt your frontmatter.
- **Body:** The content of the note itself. Markdown syntax is fully supported.

### Available Variables

| Variable | Description |
| --- | --- |
| `sourceId` | Unique RSSAgent item ID (always included in frontmatter as `source_id`) |
| `title` | The article title |
| `url` | The URL of the original article |
| `feedTitle` | The name of the source feed |
| `publishedAt` | The article's original publication timestamp |
| `date` | `YYYY-MM-DD` extracted from the publication date |
| `summary` | A short summary of the article |
| `body` | The full content of the article |
| `tags` | Tags assigned in RSSAgent |
