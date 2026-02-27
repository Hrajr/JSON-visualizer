<div align="center">

# JSON Visualizer

**A high-performance web application for exploring large JSON datasets**

Built with Vue 3 · SQLite · TailwindCSS

[Getting Started](#getting-started) · [Features](#features) · [How It Works](#how-it-works) · [Tech Stack](#tech-stack)

</div>

---

## What Is This?

JSON Visualizer lets you open massive `.txt` or `.json` files containing concatenated JSON objects and explore them in a fast, sortable, searchable table — right in Your browser. It's designed for datasets that are too large for typical JSON viewers: millions of records, hundreds of megabytes.

Files are streamed through a Web Worker and stored in **server-side SQLite** databases. The UI only ever loads the current page of records, so it stays responsive regardless of dataset size.

### Who Is It For?

- Developers debugging large API response dumps
- Data engineers inspecting ETL pipeline outputs
- QA teams reviewing bulk test results
- Anyone who needs to quickly browse, search, and filter big JSON files without writing code

---

## Features

### Load & Parse

- **Drag & drop** one or more `.txt` / `.json` files, or click to browse
- **Streaming parser** — files are read in chunks via a Web Worker; the UI never blocks
- **Robust JSON extraction** — handles concatenated objects, nested braces, escaped quotes, and malformed records
- **Auto-discovery** — place files in `data/` and they appear as selectable options in the loader
- **URL loading** — load remote files by URL

### Explore Data

- **Server-side pagination** — only the current page (e.g. 100 rows) is fetched from SQLite; navigate freely without loading everything into memory
- **Smart column ordering** — columns are automatically prioritized by data type and only columns with actual values are shown by default.
- **Full-text search** — powered by SQLite FTS5; comma-separated multi-value search with AND logic
- **Property filters** — filter to records where specific fields have non-empty values
- **Column sorting** — click any header to sort ascending → descending → clear. Sorting happens server-side in SQL.
- **Column management** — toggle visibility, pin up to 3 columns, drag-to-reorder from the sidebar
- **Resizable columns** — drag column edges to resize; drag headers to reorder

### Multi-Dataset

- **Per-dataset SQLite databases** — each file gets its own `.db` file, fully isolated
- **Dataset switching** — switch between or combine previously loaded datasets instantly
- **Persistent metadata** — dataset info is auto-recovered from `.db` files if metadata is lost

### UI

- **Dark mode** — toggle between light and dark themes; preference is saved
- **Row detail drawer** — click any row to inspect all key/value pairs and raw JSON
- **Resizable sidebar** — drag to resize the column management panel
- **Loading progress** — real-time progress bar with record count during parsing
- **Keyboard shortcuts** — `Ctrl+F` to focus search, `Esc` to close the drawer

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later

### Install & Run

```bash
# Clone the repository
git clone https://github.com/your-username/json-visualizer.git
cd json-visualizer

# Install dependencies
npm install

# Start the dev server (http://localhost:4200)
npm run dev
```

### Load Your Data

1. **Drag & drop** a `.txt` or `.json` file onto the drop zone
2. **Or click** the file input to browse
3. **Or place** files in the `data/` directory — they'll appear automatically in the loader

### Build for Production

```bash
npm run build
npm run preview
```

---

## How It Works

```
  Browser                          Vite Dev Server
 ─────────                        ─────────────────
 ┌─────────────────────────┐     ┌──────────────────────┐
 │  Vue 3 App              │     │  SQLite Middleware    │
 │                         │     │                      │
 │  App.vue                │     │  POST /api/db/query  │
 │  ├─ FileLoader          │     │  POST /api/db/record │
 │  ├─ SearchBar           │     │  GET  /api/db/datasets│
 │  ├─ PaginatedTable ◄────┼─────┤  ...                 │
 │  ├─ ColumnManager       │     │                      │
 │  ├─ FilterModal         │     │  ┌────────────────┐  │
 │  ├─ RowDrawer           │     │  │  better-sqlite3│  │
 │  └─ LoadingFooter       │     │  │  + FTS5 index  │  │
 │                         │     │  └────────┬───────┘  │
 │  ┌────────────────┐     │     │           │          │
 │  │  Parser Worker  │     │     │  data/databases/    │
 │  │  streams file → ├─────┼─────┤   ├─ {id}.db       │
 │  │  POSTs batches  │     │     │   └─ _meta.json     │
 │  └────────────────┘     │     └──────────────────────┘
 └─────────────────────────┘
```

1. **Parsing** — The parser Web Worker streams the file in chunks and POSTs record batches to the server, which inserts them into a per-dataset SQLite database with an FTS5 full-text index.
2. **Querying** — When you paginate, search, filter, or sort, the frontend sends a single `POST /api/db/query` request. The server builds a SQL query with `WHERE`, `ORDER BY`, `LIMIT`, and `OFFSET` and returns only the requested page of records plus a total count.
3. **Display** — The table renders only the returned records. No large arrays are ever transferred.

### Performance Design

| Strategy | Why |
|---|---|
| **Server-side pagination** | Only 100 rows cross the wire per page, not millions of indices |
| **FTS5 full-text search** | SQLite's built-in search index — instant results on 2M+ records |
| **Web Worker parsing** | File I/O never blocks the UI thread |
| **Debounced + coalesced fetching** | Multiple reactive triggers merge into a single request |
| **Shallow reactivity** | `shallowRef` prevents Vue from deeply observing large data |
| **Metadata self-healing** | Datasets auto-recover from `.db` files if `_meta.json` is lost |

---

## Project Structure

```
├── server/
│   └── db.ts                 SQLite operations (better-sqlite3)
├── src/
│   ├── App.vue               Root component & layout
│   ├── main.ts               Entry point
│   ├── style.css             Global styles & scrollbars
│   ├── types.ts              Shared TypeScript types
│   ├── components/
│   │   ├── FileLoader.vue    File input, drag+drop, data folder
│   │   ├── SearchBar.vue     Search input with match count
│   │   ├── PaginatedTable.vue Server-paginated data table
│   │   ├── ColumnManager.vue Column visibility, pin, reorder
│   │   ├── FilterModal.vue   Property filter dialog
│   │   ├── DatasetManager.vue Dataset selection & removal
│   │   ├── RowDrawer.vue     Record detail slide-out
│   │   └── LoadingFooter.vue Parsing progress bar
│   ├── composables/
│   │   ├── useParser.ts      Parser worker lifecycle
│   │   ├── useSearch.ts      Server-side search/sort/pagination
│   │   ├── useColumns.ts     Column state & smart ordering
│   │   ├── useDatasets.ts    Dataset persistence
│   │   ├── useDataFolder.ts  Auto-discover data files
│   │   └── useTheme.ts       Dark mode
│   ├── workers/
│   │   └── parser.worker.ts  Streaming parser → server
│   └── utils/
│       ├── db.ts             Server API client
│       ├── parser.ts         JSON extraction (brace counting)
│       └── format.ts         Column name formatting
├── data/                     Place .txt/.json files here
├── vite.config.ts            Vite + SQLite middleware plugin
├── tailwind.config.js        TailwindCSS configuration
└── package.json
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Vue 3.5 + Composition API + TypeScript 5.7 |
| Bundler | Vite 6 |
| Styling | TailwindCSS 3.4 |
| Fonts | Inter (UI) · JetBrains Mono (data) — self-hosted via @fontsource |
| Database | SQLite via better-sqlite3 (server-side, per-dataset) |
| Search | SQLite FTS5 full-text index |
| Concurrency | Web Workers (ES module format) |

---

## License

MIT
