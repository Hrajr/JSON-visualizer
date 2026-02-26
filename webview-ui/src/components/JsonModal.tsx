interface JsonModalProps {
  json: string | null;
  rowIndex: number | null;
  onClose: () => void;
  onCopy: () => void;
}

export function JsonModal({ json, rowIndex, onClose, onCopy }: JsonModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <strong>{rowIndex !== null ? `Row #${rowIndex}` : 'Details'}</strong>
          <div style={{ display: 'flex', gap: 4 }}>
            {json && <button onClick={onCopy} style={{ fontSize: 11, padding: '2px 8px' }}>Copy</button>}
            <button onClick={onClose} style={{ background: 'transparent', border: '1px solid var(--border)', padding: '2px 8px' }}>✕</button>
          </div>
        </div>
        {json ? (
          <pre>{json}</pre>
        ) : (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        )}
      </div>
    </div>
  );
}
