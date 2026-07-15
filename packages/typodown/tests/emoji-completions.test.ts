import { expect, test } from "vite-plus/test";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { typodownMarkdown, emojiCompletions } from "../src/editor.ts";
import { loadEmojiIndex, searchEmoji } from "../src/emoji.ts";

/** Run the emoji completion source on `doc` with the caret at the marker `|`
 * (removed from the document). Async: the source lazily loads the dataset. */
async function complete(docWithCaret: string) {
  const pos = docWithCaret.indexOf("|");
  const doc = docWithCaret.slice(0, pos) + docWithCaret.slice(pos + 1);
  const state = EditorState.create({ doc, extensions: [typodownMarkdown()] });
  return emojiCompletions(new CompletionContext(state, pos, false));
}

// ---- search ----------------------------------------------------------------

test("exact shortcode matches and returns the emoji", async () => {
  const index = await loadEmojiIndex();
  const rocket = searchEmoji(index, "rocket").find(([n]) => n === "rocket");
  expect(rocket?.[1]).toBe("\u{1F680}");
});

test("prefix matches rank above tag-only matches", async () => {
  const index = await loadEmojiIndex();
  const names = searchEmoji(index, "tada").map(([n]) => n);
  expect(names[0]).toBe("tada"); // exact/prefix name hit wins
});

test("results are de-duplicated by emoji", async () => {
  const index = await loadEmojiIndex();
  const emojis = searchEmoji(index, "rocket").map(([, e]) => e);
  expect(new Set(emojis).size).toBe(emojis.length);
});

test("EXTRA_EMOJI shortcodes are searchable", async () => {
  const index = await loadEmojiIndex();
  const dot = searchEmoji(index, "median_dot").find(([n]) => n === "median_dot");
  expect(dot?.[1]).toBe("·");
});

// ---- trigger ---------------------------------------------------------------

test("`:rocket` applies the emoji character", async () => {
  const result = await complete("blast off :rocket|");
  const rocket = result?.options.find((o) => o.label.includes(":rocket:"));
  expect(rocket?.apply).toBe("\u{1F680}");
  expect(result?.from).toBe("blast off ".length); // replaces from the colon
});

test("a single character already triggers", async () => {
  const result = await complete("say :t|");
  expect((result?.options.length ?? 0) > 0).toBe(true);
});

test("punctuation emoticons never trigger", async () => {
  expect(await complete(":)|")).toBeNull();
  expect(await complete("hi :(|")).toBeNull();
});

test("a colon glued to a word does not trigger (URLs, times)", async () => {
  expect(await complete("https:|")).toBeNull();
  expect(await complete("at 10:30|")).toBeNull();
});

test("a query with no emoji match returns null", async () => {
  expect(await complete("see :zzzzzz|")).toBeNull();
});

test("triggers at the start of a line", async () => {
  const result = await complete(":fire|");
  expect(result?.options.some((o) => o.apply === "\u{1F525}")).toBe(true);
});
