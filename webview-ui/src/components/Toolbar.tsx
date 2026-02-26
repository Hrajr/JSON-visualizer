import { useCallback, useState } from 'react';

interface ToolbarProps {
  fileName: string;
  totalRecords: number;
  totalErrors: number;
  currentOffset: number;
  pageSize: number;
  onOpenFile: () => void;
  onGoToRow: (index: number) => void;
  onPageChange: (offset: number) => void;
  onToggleColumns: () => void;
  showErrors: boolean;
  onShowErrors: () => void;
}

export function Toolbar({
  fileName,
  totalRecords,
  totalErrors,
  currentOffset,
  pageSize,
  onOpenFile,
  onGoToRow,
  onPageChange,
  onToggleColumns,
  showErrors,
  onShowErrors,
}: ToolbarProps) {
  const [goToInput, setGoToInput] = useState('');

  const handleGoTo = useCallback(() => {
    const idx = parseInt(goToInput, 10);
    if (!isNaN(idx) && idx >= 0) {
      onGoToRow(idx);
      setGoToInput('');
    }
  }, [goToInput, onGoToRow]);

  const currentPage = Math.floor(currentOffset / pageSize) + 1;
  const totalPages = Math.ceil(totalRecords / pageSize);

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button onClick={onOpenFile} title="Open another file">📂 Open</button>
        <button onClick={onToggleColumns} title="Toggle columns">⚙ Columns</button>
        {showErrors && (
          <button
            onClick={onShowErrors}
            title="View parse errors"
            style={{ background: '#a03030' }}
          >
            ⚠ {totalErrors} errors
          </button>
        )}
      </div>

      <div className="toolbar-group">
        <button
          onClick={() => onPageChange(Math.max(0, currentOffset - pageSize))}
          disabled={currentOffset === 0}
          title="Previous page"
        >
          ◀
        </button>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          Page {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalRecords - 1, currentOffset + pageSize))}
          disabled={currentOffset + pageSize >= totalRecords}
          title="Next page"
        >
          ▶
        </button>
      </div>

      <div className="toolbar-group goto-row">
        <input
          type="number"
          placeholder="Row #"
          value={goToInput}
          onChange={e => setGoToInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleGoTo()}
          min={0}
          max={totalRecords - 1}
        />
        <button onClick={handleGoTo} title="Go to row">Go</button>
      </div>

      <div className="file-info">
        <span>{fileName}</span>
        <span className="badge" style={{ marginLeft: 8 }}>
          {totalRecords.toLocaleString()} records
        </span>
      </div>
    </div>
  );
}
