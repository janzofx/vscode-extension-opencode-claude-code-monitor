import * as vscode from 'vscode';
import * as path from 'path';
import type { StateManager } from './state';

/**
 * Webview Panel Manager
 * Creates and manages the Agent Observatory webview panel
 */

export class PanelManager {
  private static currentPanel: PanelManager | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private stateManager: StateManager;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    stateManager: StateManager
  ) {
    this.panel = panel;
    this.stateManager = stateManager;

    // Set the HTML content
    this.panel.webview.html = this.getWebviewContent(extensionUri);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      message => {
        this.handleMessage(message);
      },
      null,
      this.disposables
    );

    // Handle panel disposal
    this.panel.onDidDispose(
      () => {
        PanelManager.currentPanel = undefined;
        this.disposables.forEach(d => d.dispose());
      },
      null,
      this.disposables
    );

    // Send initial state when webview is ready
    this.stateManager.setPanel(panel);
  }

  public static createOrShow(
    extensionUri: vscode.Uri,
    stateManager: StateManager
  ): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If panel already exists, show it
    if (PanelManager.currentPanel) {
      PanelManager.currentPanel.panel.reveal(column);
      return;
    }

    // Create new panel
    const panel = vscode.window.createWebviewPanel(
      'agentObservatory',
      'Agent Observatory',
      column || vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    PanelManager.currentPanel = new PanelManager(panel, extensionUri, stateManager);
  }

  /**
   * Handle messages from the webview
   */
  private handleMessage(message: any): void {
    this.stateManager.handleWebviewMessage(message);
  }

  /**
   * Get the HTML content for the webview
   */
  private getWebviewContent(extensionUri: vscode.Uri): string {
    const webviewJs = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'out', 'webview.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${this.panel.webview.cspSource} 'unsafe-inline';
    script-src ${this.panel.webview.cspSource};
  ">
  <title>Agent Observatory</title>
</head>
<body>
  <div id="root"></div>
  <script src="${webviewJs}"></script>
</body>
</html>`;
  }
}
