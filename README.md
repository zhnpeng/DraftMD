# DraftMD

> The open-source macOS AI Markdown editor.

**Language / 语言: [English](README.md) · [中文](README_CN.md)**

DraftMD is a focused Markdown editor for people working alongside AI agents. When an external tool updates an open `.md` file, DraftMD reflects the change in real time while protecting unsaved local edits.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Live Agent Sync** — External changes appear in the editor in real time.
- **True WYSIWYG Editing** — Edit Markdown as rich text without a split preview.
- **Files & Outline** — Browse nearby Markdown files or navigate document headings.
- **Source Mode** — Switch to raw Markdown whenever precise source editing is useful.
- **Markdown Essentials** — Task lists, highlights, KaTeX formulas, Mermaid diagrams, search, and smart line breaks.
- **Built-in Themes** — Choose from twelve bundled light and dark themes.
- **PDF & HTML Export** — Export the current document with its active presentation.
- **Universal macOS App** — One build supports Apple silicon and Intel Macs on macOS 13 or later.
- **Minimal by Design** — No permanent toolbar or status bar.

## Development

Requirements: Node.js 22.12 or later and macOS.

```bash
npm install
npm run dev
```

Quality gates:

```bash
npm run test
npm run typecheck
npm run build
npm run check:theme-colors
```

Build the Universal macOS distributables:

```bash
npm run dist:mac
```

Signing and notarization require the Apple credentials referenced by the release workflow. Local builds are unsigned.

## Documentation

- [Release checklist](docs/release-checklist.md)
- [Privacy](docs/privacy.md)
- [Provider compatibility](docs/provider-compatibility.md)

## License

[MIT](LICENSE). DraftMD includes software derived from ColaMD; see the license file for attribution.
