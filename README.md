# ALS Analyser

A browser-based inspector for Ableton Live Set files (`.als`). Drop in a project file and get an instant breakdown of its structure — tracks, plugins, devices, clips, and more — without uploading anything to a server.

**[Open ALS Analyser →](https://mkr237.github.io/als-analyser/)**

## Features

- **Project metadata** — BPM, time signature, Live version, and total clip count at a glance
- **Track breakdown** — counts of audio, MIDI, group, and return tracks with a visual proportional bar
- **Third-party plugins** — lists all VST2, VST3, AU, and Max for Live devices with instance counts
- **Native Ableton devices** — inventory of built-in instruments and effects used
- **Per-track device list** — every track with its device chain shown as chips
- **Observations** — automatic flags for frozen tracks, empty device chains, high plugin counts, and portability

## How to Use

1. Open `index.html` in any modern browser (Chrome, Firefox, Safari, Edge)
2. Drag and drop an `.als` file onto the drop zone, or click to browse
3. The analysis renders immediately in the browser
4. Click **← Analyse another file** to inspect a different project

No installation, no dependencies, no server. Everything runs locally in your browser.

## How It Works

Ableton Live Set files are gzip-compressed XML. ALS Analyser:

1. Reads the file using the `FileReader` API
2. Decompresses it using the native `DecompressionStream` API
3. Parses the XML with `DOMParser`
4. Traverses the document tree to extract track, device, clip, and metadata nodes
5. Renders the results as HTML

## Compatibility

Requires a browser with support for:
- `DecompressionStream` (Chrome 80+, Firefox 113+, Safari 16.4+, Edge 80+)
- `DOMParser`
- `FileReader`

Tested against projects saved by Ableton Live 10, 11, and 12.

## Privacy

Nothing leaves your machine. The file is read and processed entirely in the browser tab. There is no backend, no analytics, and no network requests (aside from loading Google Fonts on first use).

## Project Structure

```
ALS Analyser/
└── index.html    # Complete self-contained application (HTML + CSS + JS)
```

## Limitations

- Tempo automation is not accounted for — only the project's base BPM is shown
- Time signature is read from the first automation event; projects with multiple time signature changes will only show the first
- Device detection for native Ableton devices uses a known tag list and may miss devices added in newer Live versions
- Clip counts include all clips across the arrangement and session views

## License

MIT — do whatever you like with it.
