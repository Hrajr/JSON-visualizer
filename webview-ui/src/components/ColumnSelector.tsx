interface ColumnSelectorProps {
  columns: string[];
  visibleColumns: string[];
  pinnedColumns: Set<string>;
  onToggle: (col: string) => void;
  onTogglePin: (col: string) => void;
  onClose: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

export function ColumnSelector({
  columns,
  visibleColumns,
  pinnedColumns,
  onToggle,
  onTogglePin,
  onClose,
  onSelectAll,
  onSelectNone,
}: ColumnSelectorProps) {
  return (
    <div className="column-selector">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>Columns ({visibleColumns.length}/{columns.length})</strong>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', padding: '0 4px', fontSize: 14 }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button onClick={onSelectAll} style={{ fontSize: 11, padding: '2px 8px' }}>All</button>
        <button onClick={onSelectNone} style={{ fontSize: 11, padding: '2px 8px' }}>None</button>
      </div>
      {columns.map(col => (
        <label key={col}>
          <input
            type="checkbox"
            checked={visibleColumns.includes(col)}
            onChange={() => onToggle(col)}
          />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{col}</span>
          <button
            onClick={(e) => { e.preventDefault(); onTogglePin(col); }}
            style={{
              background: pinnedColumns.has(col) ? 'var(--btn-bg)' : 'transparent',
              border: '1px solid var(--border)',
              padding: '0 4px',
              fontSize: 10,
              borderRadius: 2,
            }}
            title={pinnedColumns.has(col) ? 'Unpin' : 'Pin'}
          >
            📌
          </button>
        </label>
      ))}
    </div>
  );
}
