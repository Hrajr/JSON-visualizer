import { useRef, useCallback, useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  ColumnResizeMode,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

interface DataTableProps {
  rows: Record<string, unknown>[];
  columns: string[];
  pinnedColumns: Set<string>;
  totalRecords: number;
  currentOffset: number;
  pageSize: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
  onSort: (column: string) => void;
  onViewRow: (index: number) => void;
  onCopyRow: (index: number) => void;
  onPageChange: (offset: number) => void;
  searchResults: number[] | null;
}

function formatCellValue(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  // Objects/arrays: compact stringify
  try {
    const s = JSON.stringify(val);
    return s.length > 100 ? s.substring(0, 100) + '…' : s;
  } catch {
    return String(val);
  }
}

function isComplexValue(val: unknown): boolean {
  return val !== null && val !== undefined && typeof val === 'object';
}

export function DataTable({
  rows,
  columns,
  pinnedColumns,
  totalRecords,
  currentOffset,
  pageSize,
  sortColumn,
  sortDirection,
  onSort,
  onViewRow,
  onCopyRow,
  onPageChange,
  searchResults,
}: DataTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columnResizeMode] = useState<ColumnResizeMode>('onChange');

  // Define columns for the table
  const columnDefs = useMemo<ColumnDef<Record<string, unknown>, unknown>[]>(() => {
    const defs: ColumnDef<Record<string, unknown>, unknown>[] = [
      {
        id: '__row_num',
        header: '#',
        size: 70,
        minSize: 50,
        enableResizing: false,
        cell: (info) => {
          const globalIndex = currentOffset + info.row.index;
          return (
            <span style={{ opacity: 0.6, fontSize: 11 }}>{globalIndex}</span>
          );
        },
      },
    ];

    for (const col of columns) {
      defs.push({
        id: col,
        accessorFn: (row) => row[col],
        header: col,
        size: 180,
        minSize: 60,
        cell: (info) => {
          const val = info.getValue();
          const display = formatCellValue(val);
          if (isComplexValue(val)) {
            return (
              <span
                style={{ cursor: 'pointer', color: 'var(--btn-bg)' }}
                title="Click to expand"
                onClick={() => onViewRow(currentOffset + info.row.index)}
              >
                {display}
              </span>
            );
          }
          return display;
        },
      });
    }

    // Actions column
    defs.push({
      id: '__actions',
      header: '',
      size: 80,
      minSize: 80,
      enableResizing: false,
      cell: (info) => {
        const globalIndex = currentOffset + info.row.index;
        return (
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              onClick={() => onViewRow(globalIndex)}
              style={{ fontSize: 10, padding: '1px 4px' }}
              title="View JSON"
            >
              👁
            </button>
            <button
              onClick={() => onCopyRow(globalIndex)}
              style={{ fontSize: 10, padding: '1px 4px' }}
              title="Copy JSON"
            >
              📋
            </button>
          </div>
        );
      },
    });

    return defs;
  }, [columns, currentOffset, onViewRow, onCopyRow]);

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    columnResizeMode,
    getCoreRowModel: getCoreRowModel(),
    // Manual sorting (handled by host)
    manualSorting: true,
  });

  const { rows: tableRows } = table.getRowModel();

  const rowVirtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 20,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  // Pagination
  const totalPages = Math.ceil(totalRecords / pageSize);
  const currentPage = Math.floor(currentOffset / pageSize) + 1;

  const handleScroll = useCallback(() => {
    if (!parentRef.current) return;
    const el = parentRef.current;
    // If near bottom, load next page
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
      const nextOffset = currentOffset + pageSize;
      if (nextOffset < totalRecords) {
        // Don't auto-paginate for now; let user use the toolbar
      }
    }
  }, [currentOffset, pageSize, totalRecords]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', opacity: 0.5 }}>
        {searchResults && searchResults.length === 0 ? 'No matching records found.' : 'No data loaded.'}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="table-container"
      onScroll={handleScroll}
    >
      <table style={{ width: table.getCenterTotalSize() }}>
        <thead>
          {table.getHeaderGroups().map(headerGroup => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map(header => {
                const isPinned = pinnedColumns.has(header.id);
                const isSorted = sortColumn === header.id;
                return (
                  <th
                    key={header.id}
                    className={isPinned ? 'pinned' : ''}
                    style={{
                      width: header.getSize(),
                      position: header.id === '__row_num' ? 'sticky' : undefined,
                      left: header.id === '__row_num' ? 0 : undefined,
                      zIndex: header.id === '__row_num' ? 3 : 2,
                    }}
                    onClick={() => {
                      if (header.id !== '__row_num' && header.id !== '__actions') {
                        onSort(header.id);
                      }
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                    {isSorted && (
                      <span className="sort-indicator">
                        {sortDirection === 'asc' ? '▲' : '▼'}
                      </span>
                    )}
                    {header.column.getCanResize() && (
                      <div
                        className={`resizer ${header.column.getIsResizing() ? 'isResizing' : ''}`}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {virtualItems.map(virtualRow => {
            const row = tableRows[virtualRow.index];
            return (
              <tr
                key={row.id}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start - (virtualItems[0]?.start ?? 0)}px)`,
                }}
              >
                {row.getVisibleCells().map(cell => {
                  const isPinned = pinnedColumns.has(cell.column.id);
                  return (
                    <td
                      key={cell.id}
                      className={`${cell.column.id === '__row_num' ? 'row-num' : ''} ${isPinned ? 'pinned' : ''}`}
                      style={{
                        width: cell.column.getSize(),
                        maxWidth: cell.column.getSize(),
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Bottom pagination bar */}
      <div style={{
        position: 'sticky',
        bottom: 0,
        background: 'var(--header-bg)',
        borderTop: '1px solid var(--border)',
        padding: '6px 12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 12,
        zIndex: 5,
      }}>
        <span>
          Showing {currentOffset + 1}–{Math.min(currentOffset + rows.length, totalRecords)} of {totalRecords.toLocaleString()}
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            disabled={currentOffset === 0}
            onClick={() => onPageChange(0)}
            style={{ fontSize: 11, padding: '2px 6px' }}
          >
            ⏮
          </button>
          <button
            disabled={currentOffset === 0}
            onClick={() => onPageChange(Math.max(0, currentOffset - pageSize))}
            style={{ fontSize: 11, padding: '2px 6px' }}
          >
            ◀
          </button>
          <span>Page {currentPage} / {totalPages}</span>
          <button
            disabled={currentOffset + pageSize >= totalRecords}
            onClick={() => onPageChange(currentOffset + pageSize)}
            style={{ fontSize: 11, padding: '2px 6px' }}
          >
            ▶
          </button>
          <button
            disabled={currentOffset + pageSize >= totalRecords}
            onClick={() => onPageChange(Math.max(0, (totalPages - 1) * pageSize))}
            style={{ fontSize: 11, padding: '2px 6px' }}
          >
            ⏭
          </button>
        </div>
      </div>
    </div>
  );
}
