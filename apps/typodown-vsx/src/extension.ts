import * as vscode from "vscode";
import type { HostMessage, ThemeSetting, WebviewMessage } from "./protocol.ts";

const VIEW_TYPE = "typodown.editor";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new TypodownEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("typodown-vsx.openWith", (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) void vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
    }),
    vscode.commands.registerCommand("typodown-vsx.openToSide", (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) {
        void vscode.commands.executeCommand(
          "vscode.openWith",
          target,
          VIEW_TYPE,
          vscode.ViewColumn.Beside,
        );
      }
    }),
  );
}

export function deactivate(): void {
  // no-op
}

class TypodownEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    const webview = panel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    webview.html = this.render(webview);

    // Track the text the webview currently holds so we can tell our own edits
    // (which echo back through onDidChangeTextDocument) from external ones.
    let syncedText = document.getText();

    const post = (message: HostMessage): void => {
      void webview.postMessage(message);
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      const text = document.getText();
      if (text === syncedText) return; // our own edit coming back
      syncedText = text;
      post({ type: "update", text });
    });

    // Push the theme setting to the webview when it changes.
    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("typodown.theme")) post({ type: "theme", theme: readTheme() });
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
      configSub.dispose();
    });

    webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.type === "ready") {
        syncedText = document.getText();
        post({ type: "init", text: syncedText, theme: readTheme() });
      } else if (message.type === "edit") {
        if (message.text === document.getText()) return;
        syncedText = message.text;
        void this.replaceDocument(document, message.text);
      } else if (message.type === "clipboard") {
        void vscode.env.clipboard.readText().then((text) => post({ type: "clipboard", text }));
      }
    });
  }

  private replaceDocument(document: vscode.TextDocument, text: string): Thenable<boolean> {
    const edit = new vscode.WorkspaceEdit();
    const wholeRange = new vscode.Range(0, 0, document.lineCount, 0);
    edit.replace(document.uri, wholeRange, text);
    return vscode.workspace.applyEdit(edit);
  }

  private render(webview: vscode.Webview): string {
    const scriptUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"))
      .toString();
    const nonce = makeNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net`,
      `font-src ${webview.cspSource} https://cdn.jsdelivr.net`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Typodown</title>
    <style>
      html, body { height: 100%; margin: 0; padding: 0; }
      #app { min-height: 100%; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

function readTheme(): ThemeSetting {
  const value = vscode.workspace.getConfiguration("typodown").get<string>("theme");
  return value === "light" || value === "dark" ? value : "editor";
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
