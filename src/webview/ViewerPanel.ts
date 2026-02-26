import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { StreamJsonParser } from '../parser/streamJsonObjects';
import { NdjsonStore } from '../indexing/ndjsonStore';
import {
  WebviewToHostMessage,
  HostToWebviewMessage,
} from '../shared/messages';

export class ViewerPanel {
  public static currentPanel: ViewerPanel | undefined;
  private static readonly viewType = 'jsonTxtVisualizer';

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly storageUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  private store: NdjsonStore | null = null;
  private currentFilePath: string | null = null;
  private statusBarItem: vscode.StatusBarItem;
  private activeSearchCancel: (() => void) | null = null;

  public static createOrShow(
    extensionUri: vscode.Uri,
    storageUri: vscode.Uri,
    statusBarItem: vscode.StatusBarItem,
  ): ViewerPanel {
    const column = vscode.ViewColumn.One;

    if (ViewerPanel.currentPanel) {
      ViewerPanel.currentPanel.panel.reveal(column);
      return ViewerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      ViewerPanel.viewType,
      'JSON TXT Visualizer',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist'),
        ],
      },
    );

    ViewerPanel.currentPanel = new ViewerPanel(panel, extensionUri, storageUri, statusBarItem);
    return ViewerPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    storageUri: vscode.Uri,
    statusBarItem: vscode.StatusBarItem,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.storageUri = storageUri;
    this.statusBarItem = statusBarItem;

    this.panel.webview.html = this.getHtmlForWebview();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    // If there's currently an open .txt file, notify the webview
    this.checkActiveEditor();
  }

  private checkActiveEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.fileName.endsWith('.txt')) {
      const filePath = editor.document.fileName;
      try {
        const stat = fs.statSync(filePath);
        this.postMessage({
          type: 'fileSelected',
          filePath,
          fileSize: stat.size,
        });
      } catch { /* ignore */ }
    }
  }

  private async handleMessage(msg: WebviewToHostMessage): Promise<void> {
    switch (msg.type) {
      case 'requestFile':
        await this.handleFileSelection();
        break;
      case 'requestParse':
        await this.handleParse(msg.filePath);
        break;
      case 'requestDataPage':
        await this.handleDataPage(msg.requestId, msg.offset, msg.limit, msg.sortColumn, msg.sortDirection);
        break;
      case 'requestSearch':
        this.handleSearch(msg.requestId, msg.query, msg.column, msg.matchType);
        break;
      case 'cancelSearch':
        this.handleCancelSearch();
        break;
      case 'requestRowJson':
        await this.handleRowJson(msg.requestId, msg.index);
        break;
      case 'goToRow':
        // Handled in webview
        break;
    }
  }

  private async handleFileSelection(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'Text files': ['txt', 'json', 'ndjson', 'jsonl'],
        'All files': ['*'],
      },
    });
    if (uris && uris.length > 0) {
      const filePath = uris[0].fsPath;
      try {
        const stat = fs.statSync(filePath);
        this.postMessage({
          type: 'fileSelected',
          filePath,
          fileSize: stat.size,
        });
      } catch (err) {
        this.postMessage({ type: 'error', message: `Cannot access file: ${err}` });
      }
    }
  }

  private async handleParse(filePath: string): Promise<void> {
    // Dispose old store
    if (this.store) {
      this.store.dispose();
      this.store = null;
    }

    this.currentFilePath = filePath;
    const storagePath = this.storageUri.fsPath;
    this.store = new NdjsonStore(storagePath);
    this.store.openForWriting();

    const parser = new StreamJsonParser();
    const sampleErrors: string[] = [];
    let errorCount = 0;
    let totalBytes = 0;
    try {
      totalBytes = fs.statSync(filePath).size;
    } catch { /* fallback handled below */ }

    parser.on('object', (obj: Record<string, unknown>, _index: number) => {
      this.store!.appendObject(obj);
    });

    parser.on('error', (err: Error, rawChunk: string, _index: number) => {
      errorCount++;
      if (sampleErrors.length < 10) {
        sampleErrors.push(`Record ~${_index}: ${err.message} | ${rawChunk.substring(0, 100)}`);
      }
    });

    let lastProgressTime = 0;
    parser.on('progress', (bytesRead: number, total: number) => {
      const now = Date.now();
      if (now - lastProgressTime > 200) {
        lastProgressTime = now;
        this.postMessage({
          type: 'parseProgress',
          recordsParsed: this.store!.totalRecords,
          bytesRead,
          totalBytes: total,
          errors: errorCount,
        });
        this.updateStatusBar(filePath, this.store!.totalRecords);
      }
    });

    try {
      await parser.parse(filePath);
      const columns = await this.store.finishWriting();

      this.postMessage({
        type: 'parseComplete',
        totalRecords: this.store.totalRecords,
        totalErrors: errorCount,
        columns,
        sampleErrors,
      });

      this.updateStatusBar(filePath, this.store.totalRecords);
    } catch (err) {
      this.postMessage({
        type: 'error',
        message: `Parse failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private async handleDataPage(
    requestId: string,
    offset: number,
    limit: number,
    sortColumn?: string,
    sortDirection?: 'asc' | 'desc',
  ): Promise<void> {
    if (!this.store) {
      this.postMessage({ type: 'error', message: 'No data loaded' });
      return;
    }

    try {
      let rows = await this.store.readPage(offset, limit);

      // Apply sorting if requested (on the page only — for full sorting on huge files,
      // you'd need a sorted index, which is a much larger feature)
      if (sortColumn && sortDirection) {
        rows = [...rows].sort((a, b) => {
          const aVal = a[sortColumn];
          const bVal = b[sortColumn];
          if (aVal === undefined || aVal === null) return 1;
          if (bVal === undefined || bVal === null) return -1;
          const aStr = typeof aVal === 'string' ? aVal : JSON.stringify(aVal);
          const bStr = typeof bVal === 'string' ? bVal : JSON.stringify(bVal);
          const cmp = aStr.localeCompare(bStr, undefined, { numeric: true });
          return sortDirection === 'asc' ? cmp : -cmp;
        });
      }

      this.postMessage({
        type: 'dataPage',
        requestId,
        offset,
        rows,
        totalRecords: this.store.totalRecords,
      });
    } catch (err) {
      this.postMessage({
        type: 'error',
        message: `Failed to read page: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  private handleSearch(
    requestId: string,
    query: string,
    column?: string,
    matchType: 'contains' | 'equals' | 'regex' = 'contains',
  ): void {
    if (!this.store) { return; }

    // Cancel previous search
    this.handleCancelSearch();

    const matchingIndices: number[] = [];

    const { cancel } = this.store.streamSearch(
      query,
      column,
      matchType,
      (index) => {
        matchingIndices.push(index);
        // Send partial results every 100 matches
        if (matchingIndices.length % 100 === 0) {
          this.postMessage({
            type: 'searchResults',
            requestId,
            matchingIndices: [...matchingIndices],
            scannedSoFar: 0,
            totalRecords: this.store!.totalRecords,
            done: false,
          });
        }
      },
      (scanned) => {
        // Progress — send periodically
        if (scanned % 2000 === 0 || scanned === this.store!.totalRecords) {
          this.postMessage({
            type: 'searchResults',
            requestId,
            matchingIndices: [...matchingIndices],
            scannedSoFar: scanned,
            totalRecords: this.store!.totalRecords,
            done: false,
          });
        }
      },
      () => {
        this.postMessage({
          type: 'searchResults',
          requestId,
          matchingIndices,
          scannedSoFar: this.store!.totalRecords,
          totalRecords: this.store!.totalRecords,
          done: true,
        });
        this.activeSearchCancel = null;
      },
    );

    this.activeSearchCancel = cancel;
  }

  private handleCancelSearch(): void {
    if (this.activeSearchCancel) {
      this.activeSearchCancel();
      this.activeSearchCancel = null;
    }
  }

  private async handleRowJson(requestId: string, index: number): Promise<void> {
    if (!this.store) { return; }
    const record = await this.store.readRecord(index);
    this.postMessage({
      type: 'rowJson',
      requestId,
      index,
      json: record ? JSON.stringify(record, null, 2) : '{}',
    });
  }

  private updateStatusBar(filePath: string, records: number): void {
    const fileName = path.basename(filePath);
    this.statusBarItem.text = `$(database) ${fileName}: ${records.toLocaleString()} records`;
    this.statusBarItem.show();
  }

  private postMessage(msg: HostToWebviewMessage): void {
    this.panel.webview.postMessage(msg);
  }

  private getHtmlForWebview(): string {
    const webview = this.panel.webview;
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist');

    // Find built assets
    const distPath = distUri.fsPath;
    let scriptFile = 'assets/index.js';
    let cssFile = '';

    try {
      const assetsDir = path.join(distPath, 'assets');
      if (fs.existsSync(assetsDir)) {
        const files = fs.readdirSync(assetsDir);
        const jsFile = files.find(f => f.endsWith('.js') && f.startsWith('index'));
        const css = files.find(f => f.endsWith('.css') && f.startsWith('index'));
        if (jsFile) { scriptFile = `assets/${jsFile}`; }
        if (css) { cssFile = `assets/${css}`; }
      }
    } catch { /* use defaults */ }

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, scriptFile));
    const nonce = getNonce();

    let cssLink = '';
    if (cssFile) {
      const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, cssFile));
      cssLink = `<link rel="stylesheet" href="${cssUri}" />`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};" />
  ${cssLink}
  <title>JSON TXT Visualizer</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    ViewerPanel.currentPanel = undefined;
    this.handleCancelSearch();

    if (this.store) {
      this.store.dispose();
      this.store = null;
    }

    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) { d.dispose(); }
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
