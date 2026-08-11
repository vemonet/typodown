// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { takeUpSlack } from "../src/editor.ts";

/** A stand-in for a scroll container: jsdom has no layout, so `scrollHeight` /
 * `clientHeight` are always 0 and `scrollTop` is never clamped. Define both,
 * and clamp on assignment the way a browser does. */
function scroller(parent: HTMLElement | null, scrollable: boolean, at = 0, max = 1000) {
  const el = document.createElement("div");
  let top = at;
  Object.defineProperty(el, "scrollHeight", { value: scrollable ? max + 500 : 500 });
  Object.defineProperty(el, "clientHeight", { value: 500 });
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      top = Math.max(0, Math.min(scrollable ? max : 0, v));
    },
  });
  parent?.appendChild(el);
  return el;
}

test("the editor's own scroller takes up the shift when it can", () => {
  const page = scroller(document.body, true, 300);
  const cm = scroller(page, true, 200);

  takeUpSlack(cm, 40);
  expect(cm.scrollTop).toBe(240);
  // The page must not move: the scroller absorbed all of it.
  expect(page.scrollTop).toBe(300);
});

test("the shift falls through to the page when the editor does not scroll", () => {
  // The website / VS Code webview case: the editor grows to fit its content, so
  // `cm-scroller` has nothing to scroll and the page is what moves.
  const page = scroller(document.body, true, 300);
  const cm = scroller(page, false);

  takeUpSlack(cm, -50);
  expect(cm.scrollTop).toBe(0);
  expect(page.scrollTop).toBe(250);
});

test("what one container cannot absorb is passed to the next", () => {
  const page = scroller(document.body, true, 300);
  const cm = scroller(page, true, 10); // only 10px of room above

  takeUpSlack(cm, -30);
  expect(cm.scrollTop).toBe(0); // gave what it had
  expect(page.scrollTop).toBe(280); // the remaining 20px
});

test("a shift nothing can absorb is dropped rather than looping", () => {
  const page = scroller(document.body, false);
  const cm = scroller(page, false);

  takeUpSlack(cm, -30);
  expect(cm.scrollTop).toBe(0);
  expect(page.scrollTop).toBe(0);
});
