# JSON Visualizer

A high-performance, client-side web application for visualizing large files containing concatenated JSON objects.

## Features

- **Streaming file parsing** – Files are read in chunks using `File.stream()` and parsed in a Web Worker, keeping the UI responsive even for files with hundreds of thousands of records
- **Robust JSON extraction** – Brace-counting parser that handles nested braces inside strings, escaped quotes, and whitespace between objects
- **Virtual table** – Only visible rows are rendered, enabling smooth scrolling through massive datasets
- **Dynamic columns** – Columns are derived from encountered keys, ordered by frequency; supports visibility toggling, pinning (up to 3), and reordering
- **Debounced search** – Case-insensitive search runs in a dedicated Web Worker; shows match count and timing
- **Row detail drawer** – Click any row to see its full key/value pairs and raw JSON
- **Sample data generator** – Generate test files with configurable record count
- **Keyboard shortcuts** – `Ctrl/Cmd+F` focuses search, `Esc` closes drawer

## Architecture

```
┌───────────────────────────────────────────────────┐
│  Main Thread (Vue 3 + Reactive State)             │
│                                                   │
│  App.vue                                          │
│  ├── FileLoader.vue    – file input / drag+drop   │
│  ├── SearchBar.vue     – search input + stats     │
│  ├── ColumnManager.vue – sidebar column controls  │
│  ├── VirtualTable.vue  – virtualised data table   │
│  └── RowDrawer.vue     – record detail drawer     │
│                                                   │
│  Composables:                                     │
│  ├── useParser.ts      – parser worker lifecycle  │
│  ├── useSearch.ts      – search worker lifecycle  │
│  └── useColumns.ts     – column state management  │
└──────────┬────────────────────┬───────────────────┘
           │                    │
     ┌─────▼─────┐      ┌──────▼──────┐
     │  Parser    │      │  Search     │
     │  Worker    │      │  Worker     │
     │            │      │             │
     │  Reads     │      │  Filters    │
     │  file in   │      │  pre-built  │
     │  chunks,   │      │  search     │
     │  emits     │      │  strings    │
     │  batches   │      │  by query   │
     └────────────┘      └─────────────┘
```

### Key Performance Strategies

1. **Web Workers** – Parsing and search run off the main thread
2. **Batched messaging** – Records are sent in batches (default 200) to reduce postMessage overhead
3. **Shallow reactivity** – `shallowRef` + `markRaw` prevent Vue from deeply observing large arrays of records
4. **Row virtualisation** – Only ~30-50 rows are in the DOM at any time regardless of dataset size
5. **Search string caching** – Lowercase search strings are built once during parsing and reused for every search

## Setup

```bash
npm install
npm run dev
```

Open `http://localhost:5174` in your browser.

## Build for Production

```bash
npm run build
npm run preview
```

## Tech Stack

- Vue 3 + Composition API + TypeScript
- Vite (dev server + bundler)
- TailwindCSS (styling)
- Web Workers (parsing + search)
- No backend required – purely client-side
