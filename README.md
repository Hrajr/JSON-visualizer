# JSON Visualizer

A high-performance, fully client-side web application for exploring large `.txt` files that contain concatenated JSON objects. Records are streamed through a Web Worker and written **directly to IndexedDB** — they never touch the main thread — so the UI stays responsive even with hundreds of thousands of records.

---

## Features

### Parsing & Storage

- **Streaming file parsing** — Files are read in chunks via `File.stream()` inside a dedicated Web Worker, keeping the main thread free.
- **Direct-to-IndexedDB writes** — Parsed records are flushed in small batches (50 records) straight from the parser worker into a per-dataset IndexedDB database. No record data is ever transferred to the main thread during parsing.
- **Robust JSON extraction** — Brace-counting parser handles nested braces, escaped quotes, whitespace between objects, and performs basic JSON repair on malformed records.
- **Batch loading queue** — Drop or select multiple files at once; they are parsed one after another automatically.
- **Auto-discovery** — Place `.txt` files in the `public/data/` folder and they appear in the UI for one-click loading (powered by a custom Vite plugin that serves `/api/data-files`).

### Multi-Dataset Management

- **Per-dataset databases** — Each loaded file gets its own IndexedDB database (`jv-ds-{id}`), so datasets are fully isolated.
- **Dataset switching** — Switch between previously loaded datasets instantly; metadata is persisted in `localStorage`.
- **Safe cleanup** — Reactive state is cleared *before* databases are deleted, preventing Vue watchers from reopening connections mid-teardown.
- **Orphan removal** — On load, `deleteAllJvDatabases()` scans `indexedDB.databases()` to remove stale databases left over from previous sessions.

### Table & Columns

- **Paginated table** — Records are displayed in a paginated table with configurable page size. Only the current page of records is fetched from IndexedDB.
- **Dynamic columns** — Columns are derived from encountered keys, ordered by frequency.
- **Column visibility** — Toggle individual columns on/off from the sidebar.
- **Column pinning** — Pin up to 3 columns so they always appear first.
- **Drag-to-reorder** — Rearrange columns via drag-and-drop in the sidebar.
- **Persistent preferences** — Column visibility, order, and pin state are saved to `localStorage` per dataset.
- **Sortable headers** — Click a column header to sort ascending/descending; sorting runs in the search worker off the main thread.

### Search & Filtering

- **Dedicated search worker** — Search and sort operations run in a separate Web Worker that scans IndexedDB in chunks of 10,000 records.
- **Debounced, case-insensitive search** — Shows match count and execution timing.
- **Property filter** — Filter records to only those with non-empty values for a specific key.
- **Cancellation** — New searches cancel any in-progress scan via operation IDs.

### UI & Interaction

- **Dark mode** — Class-based toggle (`darkMode: 'class'`) with preference saved to `localStorage`.
- **Resizable sidebar** — Drag the sidebar edge to resize; width is persisted.
- **Row detail drawer** — Click any row to view its full key/value pairs and raw JSON in a slide-out panel.
- **Loading progress** — A fixed-bottom progress bar shows parsing progress with record count.
- **Keyboard shortcuts** — `Ctrl/Cmd+F` focuses search, `Esc` closes the drawer.
- **Typography** — Inter for UI text, JetBrains Mono for data cells and row numbers, loaded via Google Fonts.

### Browser Compatibility

- **Persistent storage** — Calls `navigator.storage.persist()` on app mount to opt into durable storage, which raises Firefox's IndexedDB quota from ~2 GB to the full disk allowance.
- **Storage quota logging** — Logs estimated usage and quota on mount and before file loads.

---

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  Main Thread (Vue 3 + Reactive State)                  │
│                                                        │
│  App.vue                                               │
│  ├── FileLoader.vue      – file input / drag+drop      │
│  ├── DatasetManager.vue  – multi-dataset selection      │
│  ├── SearchBar.vue       – search input + stats         │
│  ├── ColumnManager.vue   – sidebar column controls      │
│  ├── PaginatedTable.vue  – paginated data table         │
│  ├── RowDrawer.vue       – record detail drawer         │
│  └── LoadingFooter.vue   – progress bar during parsing  │
│                                                        │
│  Composables:                                          │
│  ├── useParser.ts        – parser worker lifecycle      │
│  ├── useSearch.ts        – search worker lifecycle      │
│  ├── useColumns.ts       – column visibility/order/pin  │
│  ├── useDatasets.ts      – multi-dataset persistence    │
│  ├── useDataFolder.ts    – auto-discover data files     │
│  └── useTheme.ts         – dark mode toggle             │
│                                                        │
│  Utils:                                                │
│  ├── db.ts               – IndexedDB helpers + storage  │
│  ├── parser.ts           – JSON extraction utility      │
│  └── format.ts           – column name formatting       │
└──────────┬──────────────────────────┬──────────────────┘
           │ postMessage              │ postMessage
     ┌─────▼──────────┐       ┌──────▼──────────┐
     │  Parser Worker  │       │  Search Worker  │
     │                 │       │                 │
     │  Streams file   │       │  Scans IDB in   │
     │  in chunks,     │       │  10 k-record    │
     │  writes records │       │  chunks,        │
     │  directly to    │       │  returns        │
     │  IndexedDB      │       │  matching IDs   │
     └────────┬────────┘       └────────┬────────┘
              │ put / add               │ getAll
         ┌────▼────────────────────────▼────┐
         │         IndexedDB                │
         │  One database per dataset        │
         │  jv-ds-{id} → RECORDS store      │
         └──────────────────────────────────┘
```

### Key Performance Strategies

1. **Web Workers** — Parsing and search run entirely off the main thread.
2. **Direct IDB writes** — Records flow from the parser worker straight into IndexedDB; the main thread never holds the full dataset in memory.
3. **Chunked scanning** — The search worker reads 10,000 records at a time via cursor, enabling cancellation and progress without loading everything at once.
4. **Shallow reactivity** — `shallowRef` and `triggerRef` prevent Vue from deeply observing large result arrays.
5. **Retry with halving** — IDB `put` batches automatically halve on `QuotaExceededError`, retrying down to single records before giving up.
6. **Per-dataset isolation** — Separate IDB databases per file avoid contention and simplify cleanup.

---

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server on http://localhost:4200
npm run dev
```

### Load Data

- **Drag & drop** a `.txt` file (or multiple files) onto the drop zone.
- **Click** the file input to browse.
- **Auto-discovered files** — Place `.txt` files in `public/data/` and they will appear as selectable options in the loader.

### Build for Production

```bash
npm run build
npm run preview
```

---

## Project Structure

```
src/
├── App.vue                   Root component & layout
├── main.ts                   App entry point
├── style.css                 Global styles, scrollbars, fonts
├── components/
│   ├── FileLoader.vue        File input, drag+drop, data folder
│   ├── DatasetManager.vue    Multi-dataset selection & removal
│   ├── SearchBar.vue         Search input with match count
│   ├── ColumnManager.vue     Column visibility, pin, reorder
│   ├── PaginatedTable.vue    Paginated data table
│   ├── RowDrawer.vue         Full record detail view
│   └── LoadingFooter.vue     Parsing progress bar
├── composables/
│   ├── useParser.ts          Parser worker lifecycle
│   ├── useSearch.ts          Search worker lifecycle
│   ├── useColumns.ts         Column state management
│   ├── useDatasets.ts        Dataset persistence
│   ├── useDataFolder.ts      Auto-discover public/data files
│   └── useTheme.ts           Dark mode
├── workers/
│   ├── parser.worker.ts      Streaming parser → IDB
│   └── search.worker.ts      Search & sort via IDB scan
└── utils/
    ├── db.ts                 IndexedDB management & storage APIs
    ├── parser.ts             JSON extraction (brace counting)
    └── format.ts             Column name formatting
```

---

## Tech Stack

| Layer       | Technology                                  |
| ----------- | ------------------------------------------- |
| Framework   | Vue 3.5 + Composition API + TypeScript 5.7  |
| Bundler     | Vite 6                                      |
| Styling     | TailwindCSS 3.4                             |
| Fonts       | Inter · JetBrains Mono (Google Fonts)       |
| Storage     | IndexedDB (per-dataset) · localStorage      |
| Concurrency | Web Workers (ES module format)              |
| Backend     | None — purely client-side                   |
