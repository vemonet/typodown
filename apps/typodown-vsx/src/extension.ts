import * as vscode from "vscode";
import type { HostMessage, ThemeSetting, WebviewMessage } from "./protocol.ts";

const VIEW_TYPE = "typodown.editor";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new TypodownEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
    vscode.commands.registerCommand("typodown.openWith", (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (target) void vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE);
    }),
    vscode.commands.registerCommand("typodown.openToSide", (uri?: vscode.Uri) => {
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
    const documentDirectory = vscode.Uri.joinPath(document.uri, "..");
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        documentDirectory,
        ...(vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? []),
      ],
    };
    webview.html = this.render(webview);

    // Track the text the webview currently holds so we can tell our own edits
    // (which echo back through onDidChangeTextDocument) from external ones.
    let syncedText = document.getText();
    // Our applyEdit calls are async, so consecutive keystrokes (or a keystroke
    // racing a format-on-save edit) can interleave. Serialize them through a
    // queue and suppress change events while any are in flight: reacting to an
    // intermediate state used to post stale text back to the webview, which
    // replaced the document under the user and teleported the caret.
    let applyQueue: Thenable<unknown> = Promise.resolve();
    let applying = 0;

    const post = (message: HostMessage): void => {
      void webview.postMessage(message);
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (applying > 0) return; // our own edits in flight; reconciled at drain
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
        post({
          type: "init",
          text: syncedText,
          theme: readTheme(),
          imageBaseUri: `${webview.asWebviewUri(documentDirectory).toString()}/`,
        });
      } else if (message.type === "edit") {
        syncedText = message.text;
        applying++;
        const settle = (): void => {
          applying--;
          if (applying > 0) return;
          // The queue drained: if an external edit (e.g. trim/format on
          // save) interleaved with ours, push the final state once.
          const text = document.getText();
          if (text !== syncedText) {
            syncedText = text;
            post({ type: "update", text });
          }
        };
        applyQueue = applyQueue
          .then(() => this.replaceDocument(document, message.text))
          .then(settle, settle);
      } else if (message.type === "clipboard") {
        void vscode.env.clipboard.readText().then((text) => post({ type: "clipboard", text }));
      } else if (message.type === "openLink") {
        void vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
    });
  }

  /** Apply the webview's text as a minimal edit (common prefix / suffix
   * trimmed) rather than a whole-document replace, so VS Code sees the actual
   * keystroke-sized change: undo stays granular and save participants (trim,
   * format) compose with it instead of fighting a full rewrite. */
  private replaceDocument(document: vscode.TextDocument, text: string): Thenable<boolean> {
    const old = document.getText();
    if (old === text) return Promise.resolve(true);
    const minLen = Math.min(old.length, text.length);
    let prefix = 0;
    while (prefix < minLen && old[prefix] === text[prefix]) prefix++;
    let suffix = 0;
    while (
      suffix < minLen - prefix &&
      old[old.length - 1 - suffix] === text[text.length - 1 - suffix]
    ) {
      suffix++;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(prefix), document.positionAt(old.length - suffix)),
      text.slice(prefix, text.length - suffix),
    );
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
      html, body, #app { height: 100%; margin: 0; padding: 0; overflow: hidden; }
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
  return value === "light" ||
    value === "dark" ||
    value === "dracula" ||
    value === "nord" ||
    value === "solarized-light" ||
    value === "solarized-dark"
    ? value
    : "editor";
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
