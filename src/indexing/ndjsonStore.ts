import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * NDJSON-backed store for parsed JSON objects.
 *
 * Each object is one line in the NDJSON file. An in-memory index maps
 * record number → byte offset for O(1) random access.
 */
export class NdjsonStore {
  private ndjsonPath: string;
  private offsets: number[] = [];   // record index → byte offset in NDJSON file
  private fd: number | null = null;
  private writeStream: fs.WriteStream | null = null;
  private currentByteOffset = 0;
  private columns: Set<string> = new Set();
  private columnsFromFirstN = 2000;
  private recordCount = 0;
  private _closed = false;

  constructor(private storageDir: string) {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    this.ndjsonPath = path.join(storageDir, `parsed_${Date.now()}.ndjson`);
  }

  /** Open write stream for appending parsed objects. */
  openForWriting(): void {
    this.writeStream = fs.createWriteStream(this.ndjsonPath, { encoding: 'utf-8' });
    this.offsets = [];
    this.currentByteOffset = 0;
    this.recordCount = 0;
    this.columns = new Set();
  }

  /** Append one parsed object. */
  appendObject(obj: Record<string, unknown>): void {
    if (!this.writeStream) { throw new Error('Store not open for writing'); }

    // Collect column names from the first N records
    if (this.recordCount < this.columnsFromFirstN) {
      for (const key of Object.keys(obj)) {
        this.columns.add(key);
      }
    }

    const line = JSON.stringify(obj) + '\n';
    const byteLen = Buffer.byteLength(line, 'utf-8');

    this.offsets.push(this.currentByteOffset);
    this.writeStream.write(line);
    this.currentByteOffset += byteLen;
    this.recordCount++;
  }

  /** Finish writing. Returns discovered columns. */
  async finishWriting(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this.writeStream) { return resolve([]); }
      this.writeStream.end(() => {
        this.writeStream = null;
        resolve(Array.from(this.columns));
      });
      this.writeStream.on('error', reject);
    });
  }

  /** Total records stored. */
  get totalRecords(): number {
    return this.recordCount;
  }

  /** Get discovered columns (union of keys from first N records). */
  getColumns(): string[] {
    return Array.from(this.columns);
  }

  /**
   * Read a page of records by index range.
   * @param offset Starting record index.
   * @param limit Number of records to read.
   */
  async readPage(offset: number, limit: number): Promise<Record<string, unknown>[]> {
    if (offset < 0 || offset >= this.offsets.length) { return []; }

    const end = Math.min(offset + limit, this.offsets.length);
    const startByte = this.offsets[offset];

    // Calculate end byte: either start of the next record after `end-1`, or EOF
    let endByte: number;
    if (end < this.offsets.length) {
      endByte = this.offsets[end];
    } else {
      const stat = fs.statSync(this.ndjsonPath);
      endByte = stat.size;
    }

    const byteLength = endByte - startByte;
    if (byteLength <= 0) { return []; }

    const buffer = Buffer.alloc(byteLength);
    const fd = fs.openSync(this.ndjsonPath, 'r');
    try {
      fs.readSync(fd, buffer, 0, byteLength, startByte);
    } finally {
      fs.closeSync(fd);
    }

    const text = buffer.toString('utf-8');
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const results: Record<string, unknown>[] = [];
    for (const line of lines) {
      try {
        results.push(JSON.parse(line));
      } catch {
        results.push({});
      }
    }
    return results;
  }

  /**
   * Read a single record by index.
   */
  async readRecord(index: number): Promise<Record<string, unknown> | null> {
    if (index < 0 || index >= this.offsets.length) { return null; }
    const page = await this.readPage(index, 1);
    return page[0] ?? null;
  }

  /**
   * Stream-search through all records, calling `onMatch` for each matching index.
   * Returns a cancel function.
   */
  streamSearch(
    query: string,
    column: string | undefined,
    matchType: 'contains' | 'equals' | 'regex',
    onMatch: (index: number) => void,
    onProgress: (scanned: number) => void,
    onDone: () => void,
  ): { cancel: () => void } {
    let cancelled = false;
    const cancel = () => { cancelled = true; };

    const doSearch = async () => {
      const BATCH = 500;
      let regex: RegExp | null = null;
      if (matchType === 'regex') {
        try { regex = new RegExp(query, 'i'); } catch { return onDone(); }
      }
      const lowerQuery = query.toLowerCase();

      for (let i = 0; i < this.offsets.length; i += BATCH) {
        if (cancelled) { return; }
        const end = Math.min(i + BATCH, this.offsets.length);
        const rows = await this.readPage(i, end - i);

        for (let j = 0; j < rows.length; j++) {
          if (cancelled) { return; }
          const row = rows[j];
          const idx = i + j;
          const keys = column ? [column] : Object.keys(row);

          let match = false;
          for (const k of keys) {
            const val = row[k];
            if (val === undefined || val === null) { continue; }
            const strVal = typeof val === 'string' ? val : JSON.stringify(val);

            if (matchType === 'contains') {
              if (strVal.toLowerCase().includes(lowerQuery)) { match = true; break; }
            } else if (matchType === 'equals') {
              if (strVal.toLowerCase() === lowerQuery) { match = true; break; }
            } else if (matchType === 'regex' && regex) {
              if (regex.test(strVal)) { match = true; break; }
            }
          }

          if (match) { onMatch(idx); }
        }

        onProgress(end);
      }

      onDone();
    };

    // Fire asynchronously
    doSearch().catch(() => onDone());
    return { cancel };
  }

  /** Cleanup: delete NDJSON file. */
  dispose(): void {
    this._closed = true;
    try {
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }
      if (fs.existsSync(this.ndjsonPath)) {
        fs.unlinkSync(this.ndjsonPath);
      }
    } catch { /* ignore */ }
  }

  get filePath(): string {
    return this.ndjsonPath;
  }
}
