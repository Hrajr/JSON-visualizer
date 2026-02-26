import { useState, useCallback, useRef, useEffect } from 'react';

interface SearchBarProps {
  columns: string[];
  onSearch: (query: string, column?: string, matchType?: 'contains' | 'equals' | 'regex') => void;
  onCancel: () => void;
  searchDone: boolean;
  matchCount: number | null;
  scanned: number;
  totalRecords: number;
}

export function SearchBar({
  columns,
  onSearch,
  onCancel,
  searchDone,
  matchCount,
  scanned,
  totalRecords,
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [column, setColumn] = useState<string>('');
  const [matchType, setMatchType] = useState<'contains' | 'equals' | 'regex'>('contains');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const triggerSearch = useCallback((q: string, col: string, mt: 'contains' | 'equals' | 'regex') => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearch(q, col || undefined, mt);
    }, 400);
  }, [onSearch]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    triggerSearch(val, column, matchType);
  };

  const handleColumnChange = (val: string) => {
    setColumn(val);
    if (query.trim()) {
      triggerSearch(query, val, matchType);
    }
  };

  const handleMatchTypeChange = (val: 'contains' | 'equals' | 'regex') => {
    setMatchType(val);
    if (query.trim()) {
      triggerSearch(query, column, val);
    }
  };

  const handleClear = () => {
    setQuery('');
    onSearch('');
  };

  return (
    <div className="filter-row">
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search..."
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
        />
        <select value={column} onChange={e => handleColumnChange(e.target.value)}>
          <option value="">All columns</option>
          {columns.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={matchType} onChange={e => handleMatchTypeChange(e.target.value as 'contains' | 'equals' | 'regex')}>
          <option value="contains">Contains</option>
          <option value="equals">Equals</option>
          <option value="regex">Regex</option>
        </select>
        {query && (
          <button onClick={handleClear} style={{ background: 'transparent', border: '1px solid var(--border)', padding: '4px 8px' }}>
            ✕
          </button>
        )}
        {!searchDone && (
          <button onClick={onCancel} style={{ background: '#a03030' }}>
            Cancel
          </button>
        )}
      </div>
      <div className="search-info">
        {matchCount !== null && (
          <>
            {matchCount.toLocaleString()} matches
            {!searchDone && (
              <> (scanning: {scanned.toLocaleString()} / {totalRecords.toLocaleString()})</>
            )}
          </>
        )}
      </div>
    </div>
  );
}
