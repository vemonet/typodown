// Ambient declarations for the webview runtime.

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// The `.css` import is handled by esbuild's `text` loader and returns a string.
declare module "*.css" {
  const content: string;
  export default content;
}
