/**
 * Shared message types for communication between extension host and webview.
 * Uses discriminated unions on the `type` field.
 */

// ── Host → Webview messages ──

export interface ParseProgressMsg {
  type: 'parseProgress';
  recordsParsed: number;
  bytesRead: number;
  totalBytes: number;
  errors: number;
}

export interface ParseCompleteMsg {
  type: 'parseComplete';
  totalRecords: number;
  totalErrors: number;
  columns: string[];
  sampleErrors: string[];
}

export interface DataPageMsg {
  type: 'dataPage';
  requestId: string;
  offset: number;
  rows: Record<string, unknown>[];
  totalRecords: number;
}

export interface SearchResultsMsg {
  type: 'searchResults';
  requestId: string;
  matchingIndices: number[];
  scannedSoFar: number;
  totalRecords: number;
  done: boolean;
}

export interface SearchCancelledMsg {
  type: 'searchCancelled';
  requestId: string;
}

export interface RowJsonMsg {
  type: 'rowJson';
  requestId: string;
  index: number;
  json: string;
}

export interface ErrorMsg {
  type: 'error';
  message: string;
}

export interface FileSelectedMsg {
  type: 'fileSelected';
  filePath: string;
  fileSize: number;
}

export type HostToWebviewMessage =
  | ParseProgressMsg
  | ParseCompleteMsg
  | DataPageMsg
  | SearchResultsMsg
  | SearchCancelledMsg
  | RowJsonMsg
  | ErrorMsg
  | FileSelectedMsg;

// ── Webview → Host messages ──

export interface RequestFileMsg {
  type: 'requestFile';
}

export interface RequestParseMsg {
  type: 'requestParse';
  filePath: string;
}

export interface RequestDataPageMsg {
  type: 'requestDataPage';
  requestId: string;
  offset: number;
  limit: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface RequestSearchMsg {
  type: 'requestSearch';
  requestId: string;
  query: string;
  column?: string;       // undefined = global
  matchType?: 'contains' | 'equals' | 'regex';
}

export interface CancelSearchMsg {
  type: 'cancelSearch';
  requestId: string;
}

export interface RequestRowJsonMsg {
  type: 'requestRowJson';
  requestId: string;
  index: number;
}

export interface GoToRowMsg {
  type: 'goToRow';
  index: number;
}

export type WebviewToHostMessage =
  | RequestFileMsg
  | RequestParseMsg
  | RequestDataPageMsg
  | RequestSearchMsg
  | CancelSearchMsg
  | RequestRowJsonMsg
  | GoToRowMsg;
