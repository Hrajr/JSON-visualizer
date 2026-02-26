import * as vscode from 'vscode';
import { ViewerPanel } from './webview/ViewerPanel';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBarItem);

  const storageUri = context.globalStorageUri;

  const disposable = vscode.commands.registerCommand('jsonTxtVisualizer.openViewer', () => {
    ViewerPanel.createOrShow(context.extensionUri, storageUri, statusBarItem);
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {
  if (ViewerPanel.currentPanel) {
    ViewerPanel.currentPanel.dispose();
  }
}
