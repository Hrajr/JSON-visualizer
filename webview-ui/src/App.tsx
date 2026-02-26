import { useState, useEffect, useCallback, useRef } from 'react';
import { postMessage, onMessage, nextRequestId } from './vscodeApi';
import type { HostToWebviewMessage } from '@shared/messages';
import { DataTable } from './components/DataTable';
import { Toolbar } from './components/Toolbar';
import { SearchBar } from './components/SearchBar';
import { ColumnSelector } from './components/ColumnSelector';
import { JsonModal } from './components/JsonModal';

type AppState = 'welcome' | 'fileSelected' | 'parsing' | 'ready';

interface ParseProgress {
  recordsParsed: number;
  bytesRead: number;
  totalBytes: number;
  errors: number;
}

export default function App() {
  const [state, setState] = useState<AppState>('welcome');
  const [filePath, setFilePath] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [pinnedColumns, setPinnedColumns] = useState<Set<string>>(new Set());
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [sampleErrors, setSampleErrors] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [currentOffset, setCurrentOffset] = useState(0);
  const [pageSize] = useState(200);
  const [sortColumn, setSortColumn] = useState<string | undefined>();
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | undefined>();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchColumn, setSearchColumn] = useState<string | undefined>();
  const [searchMatchType, setSearchMatchType] = useState<'contains' | 'equals' | 'regex'>('contains');
  const [searchResults, setSearchResults] = useState<number[] | null>(null);
  const [searchScanned, setSearchScanned] = useState(0);
  const [searchDone, setSearchDone] = useState(true);
  const searchRequestId = useRef('');

  // Modal state
  const [modalJson, setModalJson] = useState<string | null>(null);
  const [modalRowIndex, setModalRowIndex] = useState<number | null>(null);
  const [showColumnSelector, setShowColumnSelector] = useState(false);

  // Error dialog
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Data page tracking
  const [filteredIndices, setFilteredIndices] = useState<number[] | null>(null);

  // Listen for messages from host
  useEffect(() => {
    return onMessage((msg: HostToWebviewMessage) => {
      switch (msg.type) {
        case 'fileSelected':
          setFilePath(msg.filePath);
          setFileSize(msg.fileSize);
          setState('fileSelected');
          break;
        case 'parseProgress':
          setProgress({
            recordsParsed: msg.recordsParsed,
            bytesRead: msg.bytesRead,
            totalBytes: msg.totalBytes,
            errors: msg.errors,
          });
          break;
        case 'parseComplete':
          setTotalRecords(msg.totalRecords);
          setTotalErrors(msg.totalErrors);
          setColumns(msg.columns);
          setVisibleColumns(msg.columns.slice(0, 30)); // Show first 30 by default
          setSampleErrors(msg.sampleErrors);
          setState('ready');
          setCurrentOffset(0);
          // Request first page
          requestPage(0, pageSize);
          break;
        case 'dataPage':
          setRows(msg.rows);
          setTotalRecords(msg.totalRecords);
          break;
        case 'searchResults':
          if (msg.requestId === searchRequestId.current) {
            setSearchResults(msg.matchingIndices);
            setSearchScanned(msg.scannedSoFar);
            setSearchDone(msg.done);
            if (msg.done) {
              setFilteredIndices(msg.matchingIndices.length > 0 ? msg.matchingIndices : null);
            }
          }
          break;
        case 'searchCancelled':
          break;
        case 'rowJson':
          setModalJson(msg.json);
          setModalRowIndex(msg.index);
          break;
        case 'error':
          setErrorMsg(msg.message);
          break;
      }
    });
  }, [pageSize]);

  const requestPage = useCallback((offset: number, limit: number) => {
    const id = nextRequestId();
    postMessage({
      type: 'requestDataPage',
      requestId: id,
      offset,
      limit,
      sortColumn,
      sortDirection,
    });
    setCurrentOffset(offset);
  }, [sortColumn, sortDirection]);

  const handleOpenFile = useCallback(() => {
    postMessage({ type: 'requestFile' });
  }, []);

  const handleParse = useCallback(() => {
    if (!filePath) return;
    setState('parsing');
    setProgress(null);
    setRows([]);
    setSearchResults(null);
    setFilteredIndices(null);
    postMessage({ type: 'requestParse', filePath });
  }, [filePath]);

  const handleSort = useCallback((column: string) => {
    setSortDirection(prev => {
      if (sortColumn === column) {
        return prev === 'asc' ? 'desc' : prev === 'desc' ? undefined : 'asc';
      }
      return 'asc';
    });
    setSortColumn(prev => {
      if (prev === column && sortDirection === 'desc') return undefined;
      return column;
    });
  }, [sortColumn, sortDirection]);

  // Re-fetch when sort changes
  useEffect(() => {
    if (state === 'ready') {
      requestPage(currentOffset, pageSize);
    }
  }, [sortColumn, sortDirection]);

  const handleSearch = useCallback((query: string, column?: string, matchType: 'contains' | 'equals' | 'regex' = 'contains') => {
    setSearchQuery(query);
    setSearchColumn(column);
    setSearchMatchType(matchType);

    if (!query.trim()) {
      setSearchResults(null);
      setFilteredIndices(null);
      setSearchDone(true);
      // Cancel ongoing search
      if (searchRequestId.current) {
        postMessage({ type: 'cancelSearch', requestId: searchRequestId.current });
      }
      requestPage(0, pageSize);
      return;
    }

    const id = nextRequestId();
    searchRequestId.current = id;
    setSearchDone(false);
    setSearchScanned(0);
    setSearchResults([]);

    postMessage({
      type: 'requestSearch',
      requestId: id,
      query,
      column,
      matchType,
    });
  }, [pageSize, requestPage]);

  const handleCancelSearch = useCallback(() => {
    if (searchRequestId.current) {
      postMessage({ type: 'cancelSearch', requestId: searchRequestId.current });
    }
    setSearchDone(true);
  }, []);

  const handleGoToRow = useCallback((index: number) => {
    const pageStart = Math.max(0, index - Math.floor(pageSize / 2));
    requestPage(pageStart, pageSize);
  }, [pageSize, requestPage]);

  const handleCopyRow = useCallback((index: number) => {
    const id = nextRequestId();
    postMessage({ type: 'requestRowJson', requestId: id, index });
  }, []);

  const handleViewRow = useCallback((index: number) => {
    const id = nextRequestId();
    setModalJson(null);
    setModalRowIndex(index);
    postMessage({ type: 'requestRowJson', requestId: id, index });
  }, []);

  const handleToggleColumn = useCallback((col: string) => {
    setVisibleColumns(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  }, []);

  const handleTogglePin = useCallback((col: string) => {
    setPinnedColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) { next.delete(col); } else { next.add(col); }
      return next;
    });
  }, []);

  const handlePageChange = useCallback((newOffset: number) => {
    requestPage(newOffset, pageSize);
  }, [pageSize, requestPage]);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Welcome screen
  if (state === 'welcome') {
    return (
      <div className="app">
        <div className="welcome">
          <h2>JSON TXT Visualizer</h2>
          <p>Open a .txt file containing concatenated JSON objects to visualize them in a high-performance data table.</p>
          <button onClick={handleOpenFile}>Open File...</button>
        </div>
      </div>
    );
  }

  // File selected, not yet parsed
  if (state === 'fileSelected') {
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    return (
      <div className="app">
        <div className="welcome">
          <h2>File Selected</h2>
          <p><strong>{fileName}</strong></p>
          <p>Size: {formatBytes(fileSize)}</p>
          <button onClick={handleParse}>Parse &amp; Load</button>
          <button onClick={handleOpenFile} style={{ background: 'transparent', border: '1px solid var(--border)' }}>
            Choose Different File
          </button>
        </div>
      </div>
    );
  }

  // Parsing/loading
  if (state === 'parsing') {
    const pct = progress && progress.totalBytes > 0
      ? Math.round((progress.bytesRead / progress.totalBytes) * 100)
      : 0;
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner" />
          <div>Parsing file...</div>
          {progress && (
            <>
              <div className="stats">
                {formatBytes(progress.bytesRead)} / {formatBytes(progress.totalBytes)} ({pct}%)
              </div>
              <div className="stats">
                Records: {progress.recordsParsed.toLocaleString()}
                {progress.errors > 0 && ` | Errors: ${progress.errors}`}
              </div>
              <div className="progress-bar-container">
                <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // Ready — show table
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const orderedColumns = [
    ...visibleColumns.filter(c => pinnedColumns.has(c)),
    ...visibleColumns.filter(c => !pinnedColumns.has(c)),
  ];

  return (
    <div className="app">
      <Toolbar
        fileName={fileName}
        totalRecords={totalRecords}
        totalErrors={totalErrors}
        currentOffset={currentOffset}
        pageSize={pageSize}
        onOpenFile={handleOpenFile}
        onGoToRow={handleGoToRow}
        onPageChange={handlePageChange}
        onToggleColumns={() => setShowColumnSelector(prev => !prev)}
        showErrors={sampleErrors.length > 0}
        onShowErrors={() => {
          setModalJson(sampleErrors.join('\n\n'));
          setModalRowIndex(null);
        }}
      />

      <SearchBar
        columns={columns}
        onSearch={handleSearch}
        onCancel={handleCancelSearch}
        searchDone={searchDone}
        matchCount={searchResults?.length ?? null}
        scanned={searchScanned}
        totalRecords={totalRecords}
      />

      {showColumnSelector && (
        <ColumnSelector
          columns={columns}
          visibleColumns={visibleColumns}
          pinnedColumns={pinnedColumns}
          onToggle={handleToggleColumn}
          onTogglePin={handleTogglePin}
          onClose={() => setShowColumnSelector(false)}
          onSelectAll={() => setVisibleColumns([...columns])}
          onSelectNone={() => setVisibleColumns([])}
        />
      )}

      <DataTable
        rows={rows}
        columns={orderedColumns}
        pinnedColumns={pinnedColumns}
        totalRecords={searchResults ? searchResults.length : totalRecords}
        currentOffset={currentOffset}
        pageSize={pageSize}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={handleSort}
        onViewRow={handleViewRow}
        onCopyRow={handleCopyRow}
        onPageChange={handlePageChange}
        searchResults={searchResults}
      />

      {(modalJson !== null || modalRowIndex !== null) && (
        <JsonModal
          json={modalJson}
          rowIndex={modalRowIndex}
          onClose={() => { setModalJson(null); setModalRowIndex(null); }}
          onCopy={() => {
            if (modalJson) {
              navigator.clipboard.writeText(modalJson).catch(() => {});
            }
          }}
        />
      )}

      {errorMsg && (
        <div className="modal-overlay" onClick={() => setErrorMsg(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <strong>Error</strong>
              <button onClick={() => setErrorMsg(null)}>✕</button>
            </div>
            <pre>{errorMsg}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
