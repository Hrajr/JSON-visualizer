import * as fs from 'fs';
import { EventEmitter } from 'events';

export interface StreamParserEvents {
  object: (obj: Record<string, unknown>, index: number) => void;
  error: (err: Error, rawChunk: string, index: number) => void;
  progress: (bytesRead: number) => void;
  end: (totalObjects: number, totalErrors: number) => void;
}

/**
 * Streaming JSON object parser for files containing concatenated JSON objects.
 *
 * Tracks brace depth and string/escape state to correctly detect object boundaries,
 * even when objects are split across read chunks or contain braces inside strings.
 */
export class StreamJsonParser extends EventEmitter {
  private braceDepth = 0;
  private inString = false;
  private escaping = false;
  private objectStart = -1;
  private buffer = '';
  private objectIndex = 0;
  private errorCount = 0;
  private cancelled = false;

  constructor() {
    super();
  }

  /**
   * Parse a file at `filePath` by streaming chunks.
   * @param filePath Absolute path to the .txt file.
   * @param chunkSize Read chunk size in bytes (default 1MB).
   */
  async parse(filePath: string, chunkSize = 1024 * 1024): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const stat = fs.statSync(filePath);
      const totalBytes = stat.size;
      let bytesRead = 0;

      const stream = fs.createReadStream(filePath, {
        encoding: 'utf-8',
        highWaterMark: chunkSize,
      });

      stream.on('data', (data: string | Buffer) => {
        if (this.cancelled) {
          stream.destroy();
          return;
        }
        const chunk = typeof data === 'string' ? data : data.toString('utf-8');
        this.processChunk(chunk);
        bytesRead += Buffer.byteLength(chunk, 'utf-8');
        this.emit('progress', bytesRead, totalBytes);
      });

      stream.on('end', () => {
        // If there's remaining buffer with content, try to parse it
        if (this.buffer.trim().length > 0 && this.objectStart !== -1) {
          this.tryParseObject(this.buffer);
        }
        this.emit('end', this.objectIndex, this.errorCount);
        resolve();
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Parse from a raw string (useful for testing).
   */
  parseString(input: string): void {
    this.processChunk(input);
    if (this.buffer.trim().length > 0 && this.objectStart !== -1) {
      this.tryParseObject(this.buffer);
    }
    this.emit('end', this.objectIndex, this.errorCount);
  }

  cancel(): void {
    this.cancelled = true;
  }

  private processChunk(chunk: string): void {
    this.buffer += chunk;

    let i = this.buffer.length - chunk.length; // start scanning from where new data begins
    if (i < 0) { i = 0; }

    // But if objectStart == -1, scan from the beginning to find the first '{'
    if (this.objectStart === -1) {
      i = 0;
    }

    while (i < this.buffer.length) {
      if (this.cancelled) { return; }

      const ch = this.buffer[i];

      if (this.escaping) {
        this.escaping = false;
        i++;
        continue;
      }

      if (this.inString) {
        if (ch === '\\') {
          this.escaping = true;
        } else if (ch === '"') {
          this.inString = false;
        }
        i++;
        continue;
      }

      // Not in string
      if (ch === '"') {
        this.inString = true;
        i++;
        continue;
      }

      if (ch === '{') {
        if (this.braceDepth === 0) {
          this.objectStart = i;
        }
        this.braceDepth++;
        i++;
        continue;
      }

      if (ch === '}') {
        this.braceDepth--;
        if (this.braceDepth === 0 && this.objectStart !== -1) {
          const raw = this.buffer.substring(this.objectStart, i + 1);
          this.tryParseObject(raw);
          // Trim buffer up to current position
          this.buffer = this.buffer.substring(i + 1);
          i = 0;
          this.objectStart = -1;
          continue;
        }
        if (this.braceDepth < 0) {
          this.braceDepth = 0; // recover
        }
        i++;
        continue;
      }

      i++;
    }

    // If we haven't started an object, discard leading whitespace
    if (this.objectStart === -1) {
      this.buffer = this.buffer.trimStart();
    }
  }

  private tryParseObject(raw: string): void {
    try {
      const obj = JSON.parse(raw);
      this.emit('object', obj, this.objectIndex);
      this.objectIndex++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('error', new Error(message), raw.substring(0, 200), this.objectIndex);
      this.errorCount++;
      this.objectIndex++;
    }
  }
}
