# JSON TXT Visualizer

A VS Code extension for visualizing large `.txt` files containing concatenated JSON objects in a high-performance data table.

## Features

- **Streaming Parser**: Handles files of hundreds of MB to multiple GB without loading everything into memory
- **NDJSON Indexing**: Parsed objects are written to an indexed NDJSON temp file for fast random access
- **Virtualized Table**: Only visible rows are rendered using `@tanstack/react-table` + `@tanstack/react-virtual`
- **Column Management**: Auto-discovers columns from first 2000 records; toggle visibility and pin columns
- **Search & Filter**: Global or column-specific search with contains/equals/regex modes; streams results progressively
- **Go to Row**: Jump directly to any row number
- **Copy Row JSON**: Copy any row's full JSON with one click
- **Sort**: Click column headers to sort (within current page)
- **Status Bar**: Shows current file name and record count

## Architecture

```
Extension Host (TypeScript)          Webview (React + Vite)
┌──────────────────────────┐        ┌──────────────────────────┐
│ extension.ts             │        │ App.tsx                  │
│ ├─ parser/               │◄──────►│ ├─ DataTable.tsx         │
│ │  └─ streamJsonObjects  │  msg   │ ├─ SearchBar.tsx         │
│ ├─ indexing/             │        │ ├─ Toolbar.tsx           │
│ │  └─ ndjsonStore        │        │ ├─ ColumnSelector.tsx    │
│ └─ webview/              │        │ └─ JsonModal.tsx         │
│    └─ ViewerPanel        │        └──────────────────────────┘
└──────────────────────────┘
```

Communication uses `vscode.postMessage` / `onDidReceiveMessage` with TypeScript discriminated union message types defined in `src/shared/messages.ts`.

## Usage

1. Open VS Code with this extension installed
2. Run command: **JSON TXT Visualizer: Open Viewer** (`Ctrl+Shift+P`)
3. Click "Open File..." or it auto-detects the currently open `.txt` file
4. Click "Parse & Load" to start streaming the file
5. Browse data in the table, search, filter, and sort

## Building

### Prerequisites

- Node.js 18+
- npm

### Install dependencies

```bash
npm run install:all
```

### Build everything

```bash
npm run build
npm run build:webview
```

### Watch mode (extension only)

```bash
npm run watch
```

### Run tests

```bash
npm run test:parser
```

### Debug in VS Code

1. Open this folder in VS Code
2. Press `F5` to launch the Extension Development Host
3. In the new window, run `Ctrl+Shift+P` → "JSON TXT Visualizer: Open Viewer"

## Performance Notes

- **Streaming Parser**: Uses `fs.createReadStream` with configurable chunk size (default 1 MB). Tracks brace depth and string/escape state to detect JSON object boundaries across chunk boundaries.
- **NDJSON Index**: Each parsed object is written as one line to a temporary NDJSON file. An in-memory array maps record index → byte offset for O(1) random access reads.
- **Memory**: Only one page of rows (default 200) is held in memory at a time. The NDJSON file lives on disk.
- **Search**: Scans the NDJSON file in batches of 500 records, sending partial results back to the UI progressively. Search can be cancelled mid-scan.
- **UI**: The webview uses row virtualization — only visible rows are rendered to the DOM regardless of dataset size.

## File Format

The extension expects text files with concatenated JSON objects:

```json
{
  "id": 1,
  "name": "Alice",
  "email": "alice@example.com"
}
{
  "id": 2,
  "name": "Bob",
  "email": "bob@example.com"
}
```

Objects can be pretty-printed or compact, separated by whitespace or nothing at all. The parser handles all these cases.

## License

MIT
