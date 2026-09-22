# Readest Web Highlights

Import your [Readest](https://readest.com/) library and highlights into ordinary Obsidian Markdown notes. This plugin connects to the Readest **web API**, so you do not need to install or run the local Readest application or give Obsidian access to its files.

Readest Web Highlights is an independent community plugin by [wavey](https://github.com/keptan). It is not affiliated with Readest.

## Features

- Creates one editable note per book, with title, author, format, reading progress, and a local cover image in its properties.
- Downloads the actual cover from Readest Cloud when one is available. Books without a cloud cover get a local typographic SVG cover.
- Imports highlights in page and CFI order as color-aware Obsidian callouts. Highlight and attached note titles link back to the exact annotation in the Readest web reader.
- Keeps annotation identity in private plugin data rather than visible comments. Write your own notes between highlights, change an imported block, or start from a Markdown template. Later syncs add new highlights in place and leave locally edited blocks intact.
- Syncs on command, on startup, or at a configurable interval. It reads from Readest and never changes your Readest library.
- Runs on desktop and mobile Obsidian, with no local Readest installation required.

The plugin creates notes and cover files in the vault folders you choose. It does not create a Base or alter an existing Base. If you want a library view, you can build one yourself from the imported note properties.

## Install

Requires Obsidian 1.13.1 or newer and a Readest account with cloud sync enabled for the books and annotations you want to import.

Once listed in the Obsidian Community Plugins directory, search for **Readest Web Highlights**, install it, and enable it. Until then, download `main.js`, `manifest.json`, and `styles.css` from a [GitHub release](https://github.com/keptan/obsidian-readest/releases) and place them in `<vault>/.obsidian/plugins/readest-highlights-web/`. Reload Obsidian and enable the plugin.

Open the plugin settings, enter your Readest email, and select **Connect** to sign in. The password is used for sign-in and is not saved. The renewable session is stored in Obsidian SecretStorage. Run **Readest Web Highlights: Sync library and highlights** from the command palette, or use the ribbon icon.

## Editing and linking

You can write freely between imported highlights. Sync only replaces an imported block when its Readest source changed **and** the block still matches the last version the plugin wrote. A block you edited locally is preserved. Text in your template and book notes stays yours.

The title of each imported highlight is a web link to its Readest annotation. An attached Readest note uses the same destination. Obsidian hands external links to your browser; browser and OS behavior determines whether an existing Readest tab is reused. The plugin cannot reliably focus an arbitrary already-open browser tab.

Existing `Library.base` files from development versions are left in place and are no longer generated or modified. The published plugin uses the unique ID `readest-highlights-web`. On first load, it reads settings and highlight identity data from the former `readest-highlights` ID if present. Disable the old development plugin before enabling this one.

## Data and limitations

The plugin requests your book metadata, annotations, and available cover images from `web.readest.com` and Readest's authenticated storage. Book notes and cover images are stored only in the vault folders you configure. It does not download book files or upload your Obsidian notes. Its use of Readest's web sync and storage APIs is unofficial; Readest may change those APIs.

Web annotation links require the book to be available to the Readest web reader. A browser may open a new tab for each external link.

## Development

```bash
npm ci
npm test
npm run build
```

For manual development installation, copy the built `main.js` plus `manifest.json` and `styles.css` into the plugin folder above.

Report bugs or request features at [github.com/keptan/obsidian-readest/issues](https://github.com/keptan/obsidian-readest/issues).

## License

[MIT](LICENSE) © 2026 wavey.
