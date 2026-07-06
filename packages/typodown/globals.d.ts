// Allow side-effect CSS imports (handled by Vite / tsdown at build time).
declare module "*.css";

// commonmark-spec ships no types; used only by tests/commonmark-spec.test.ts.
declare module "commonmark-spec" {
  export interface SpecTest {
    markdown: string;
    html: string;
    section: string;
    number: number;
  }
  export const tests: SpecTest[];
}
