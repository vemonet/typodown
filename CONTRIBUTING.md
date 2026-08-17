---
---

# 🛠️ Development

[![CI](https://github.com/vemonet/typodown/actions/workflows/ci.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/ci.yml) [![Release](https://github.com/vemonet/typodown/actions/workflows/release.yml/badge.svg)](https://github.com/vemonet/typodown/actions/workflows/release.yml)

> [!IMPORTANT]
>
> Requires [Vite+](https://viteplus.dev/guide/) installed.

Lint:

```sh
vp check --fix
```

Check everything is ready:

```sh
vp run ready
```

Run the tests:

```sh
vp test
```

Build the monorepo:

```sh
vp run build
```

## 🏗️ How it works

New to the codebase? Start here. This is the 10,000-foot view; the files
themselves carry the detail.

### One library, four surfaces

Everything that makes Typodown an editor lives in **one package**. The four
things you can install are thin hosts around it:

| Path                                                           | What it is                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/typodown`](packages/typodown)                       | The editor library, published to npm as `@vemonet/typodown`. **All editing and rendering logic is here.**                                       |
| [`packages/typodown/index.html`](packages/typodown/index.html) | The demo site and landing page ([typodown.app](https://typodown.app)), which is also the fastest way to try a change.                           |
| [`apps/typodown-app`](apps/typodown-app)                       | Desktop + Android app: a [Tauri v2](https://v2.tauri.app/) shell around a SolidJS frontend.                                                     |
| [`apps/typodown-pwa`](apps/typodown-pwa)                       | The same SolidJS frontend built for the browser. Its entry point is literally one re-export of the app's, so there is no second UI to maintain. |
| [`apps/typodown-vsx`](apps/typodown-vsx)                       | VS Code extension: an extension-host half and a webview half that talk over a typed message protocol.                                           |

If you are fixing how markdown looks or behaves, you almost certainly want
`packages/typodown/src`, not an app.

### The core idea

There is no preview pane and no separate rendered document. **The markdown text
is the single source of truth, and nothing ever rewrites it in order to render
it.** CodeMirror 6 owns the caret, selection, history, clipboard and viewport
virtualisation; on top of that sits a decoration layer that makes plain text
_look_ rendered.

The Typora trick is one rule: hide the raw syntax everywhere **except** on the
construct the caret is touching. Put the cursor in a heading and the `#` comes
back, editable in place. Move away and it is a heading again.

### The rendering pipeline

```
markdown text
  |
  |  typodownMarkdown()  -- CommonMark + GFM + math, via @codemirror/lang-markdown
  v
Lezer syntax tree        -- incremental: CodeMirror reparses only what changed
  |
  |  live-preview.ts     -- walks the tree, emits decorations
  v
DecorationSet
  |
  |  CodeMirror applies them over the unchanged text
  v
what you see
```

[`live-preview.ts`](packages/typodown/src/live-preview.ts) is the heart of the
project (and the biggest file). It emits three kinds of decoration:

- **mark**: style a construct in place (heading sizes, bold, inline code, links).
- **replace**: hide the syntax marks (`**`, `#`, backticks, the `](url)` half of
  a link) so only the content shows.
- **widget**: swap a whole construct for real DOM. Checkboxes, bullets, images,
  horizontal rules, tables, highlighted code blocks with a copy button, Mermaid
  diagrams, KaTeX math, and sanitized raw HTML are all widgets.

The reveal-on-caret behaviour is not a mode or a state machine: every decorator
just asks whether the selection overlaps the range it is about to hide, and
skips hiding when it does. That single predicate is the whole feature.

**Two decoration sources, and why it matters.** `livePreview()` returns a pair:

- `inlinePlugin` is a **ViewPlugin**. It only rebuilds over
  `view.visibleRanges`, so its cost is bounded by the viewport, not the
  document. This handles everything inline.
- `blockField` is a **StateField**, and it scans the whole document. It has to
  be a state field because multi-line replacements (a rendered table, an HTML
  block) change block layout, and CodeMirror only accepts layout-affecting
  decorations from state, not from a view plugin.

That whole-document scan is why `blockField` is full of fast paths, and why you
should be careful editing it: an edit that looks harmless can turn every
keystroke into a full-document rebuild. It skips work when an edit is a simple
inline one (it maps the existing decorations instead of rebuilding), and on
caret moves it compares the tracked selection-sensitive ranges and bails out
unless the caret actually crossed a widget boundary. Whole-document line scans
for rarer features are gated behind a cheap substring check on the source.

One more wrinkle worth knowing: **the Lezer tree parses lazily**, so on first
load it is often incomplete and later transactions extend it. Both decoration
sources track how far it has parsed and rebuild as it advances. If something
renders only after you type a character, that is the mechanism to look at.

### The rest of the library

| File                                                 | Role                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`editor.ts`](packages/typodown/src/editor.ts)       | The `Typodown` class: assembles the CodeMirror extensions, keymap and commands, and is the public API surface.                           |
| [`highlight.ts`](packages/typodown/src/highlight.ts) | Code-block highlighting, delegated to CodeMirror's own Lezer grammars and mapped onto `cm-td-tok-*` theme classes.                       |
| [`export.ts`](packages/typodown/src/export.ts)       | Markdown to standalone HTML (used by the app's export-to-HTML/PDF). Walks the same tree as the live preview but emits semantic HTML.     |
| [`sanitize.ts`](packages/typodown/src/sanitize.ts)   | DOMPurify, applied at **every** raw-HTML sink. Markdown files are untrusted input, so skipping this is a stored-XSS hole.                |
| [`theme.css`](packages/typodown/src/theme.css)       | Every colour is a `--td-*` variable scoped to `.typodown[data-td-theme="..."]`. `setTheme()` does nothing but write that attribute.      |
| `toolbar.ts`, `outline.ts`, `search.ts`, `menu.ts`   | The floating UI (formatting toolbar, heading outline, find/replace, table menus). Plain DOM, no framework, themed by the same variables. |
| `math.ts`, `emoji.ts`, `clipboard.ts`, `prefs.ts`    | KaTeX blocks, `:emoji:` completion, HTML-to-markdown paste, and localStorage-backed UI preferences.                                      |

Raw mode (<kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>/</kbd>) is a good illustration of
how the layers separate: it swaps the live-preview extension out of a CodeMirror
`Compartment` for plain syntax highlighting. Same text, same parser, no
decorations.

### How the hosts embed it

Every host does the same thing: `createTypodown(element, options)`. A few
options exist purely because embedders differ in what the web platform gives
them, and they are the usual source of "works on the website, broken in the app"
bugs:

- `getClipboardText` - VS Code webviews block `navigator.clipboard`, so the
  extension reads it from the extension host instead.
- `openLink` - `window.open` is a no-op in a Tauri webview; links have to go
  through the opener plugin to reach the system browser.
- `resolveImageSrc` - a relative image path means nothing until you know which
  file is open, so the host resolves it.

Beyond that:

- **VS Code**: [`extension.ts`](apps/typodown-vsx/src/extension.ts) registers a
  `CustomTextEditorProvider` and drives the webview
  ([`webview/main.ts`](apps/typodown-vsx/src/webview/main.ts)) over the typed
  messages in [`protocol.ts`](apps/typodown-vsx/src/protocol.ts). Both halves
  guard against echoing their own edits back at each other.
- **Desktop / Android / PWA**: [`vault.ts`](apps/typodown-app/src/lib/vault.ts)
  holds the open-folder state, and [`tauri.ts`](apps/typodown-app/src/lib/tauri.ts)
  is the seam that makes one frontend serve three targets: it branches on
  `IS_TAURI` between Tauri's filesystem commands and the browser's File System
  Access API. [`graph.ts`](apps/typodown-app/src/lib/graph.ts) derives the link
  graph from the files alone, with pure builders kept testable without Tauri.

### Tests

The library's test suite lives in [`packages/typodown/tests`](packages/typodown/tests)
and is where behaviour is pinned down - including a run against the CommonMark
spec. Rendering and editing changes are much easier to land with a test than to
argue about by hand:

```sh
vp test
```

## ⚡️ Demo website

Run dev server:

```sh
vp run dev
```

Build website:

```sh
vp run demo:build
```

## 🧩 VSCode extension

Build lib first:

```sh
vp run @vemonet/typodown#build
```

Start the VSCode extension dev host using <kbd>F5</kbd> in VSCode.

Build and install extension in your local VSCode:

```sh
vp run vsx:install
```

Copy the `.apk` file:

```sh
cp apps/typodown-app/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk ~/Dropbox/typodown.apk
```

## 💻 Desktop and smartphone app

Built with [Tauri v2](https://v2.tauri.app/).

Start in dev:

```sh
vp run app:dev
```

Build desktop app:

```sh
vp run app:build
```

Build Android `.apk` (for sideloading / direct install):

```sh
vp run app:apk
```

Build Android `.aab` (Android App Bundle, required by the Play Store):

```sh
vp run app:aab
```

## 🏷️ Release

> [!IMPORTANT]
>
> You must add these repo secrets or the Android build job fails:
>
> - `ANDROID_KEYSTORE_BASE64`: your upload keystore `typodown.jks`, base64-encoded (`base64 -i ~/.keystores/typodown.jks | pbcopy`)
> - `ANDROID_KEYSTORE_PASSWORD`
> - `ANDROID_KEY_ALIAS` (`typodown`)
>
> For Play Store publishing (optional; the release still succeeds without it):
>
> - `PLAY_SERVICE_ACCOUNT_JSON`: the full JSON key of a Google Play service account (see [Publish to Google Play](#-publish-to-google-play) below)

```sh
vp run release
```

> [!NOTE]
> The npm package and VSCode extension are built and published locally, then a GitHub Actions workflow ([`release.yml`](.github/workflows/release.yml)) builds the platform artefacts (desktop app, Android `.apk` + `.aab`, unsigned iOS `.ipa`), attaches the desktop bundles, `.apk` and `.ipa` to the GitHub release, and uploads the `.aab` to the Play Store's internal track.

You can trigger the release workflow manually (`workflow_dispatch`) for a **dry run**: it builds every artefact and uploads them to the workflow run (no GitHub release, no Play Store upload).

### 🍎 iOS `.ipa` (unsigned)

There is no Apple Developer account behind this repo, so the iOS job builds with `--no-sign`: it generates the Xcode project with `tauri ios init` (`gen/apple` is not committed, unlike `gen/android`, because generating it needs Xcode), archives with `--archive-only` to skip the export step that demands a signing identity, then packages the archive's app bundle as an `.ipa` by hand.

That `.ipa` **cannot be installed by double-clicking**: it has to be re-signed first, e.g. with [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io), or by opening the project in Xcode and running it on a connected device with a free personal team. The job is `continue-on-error`, so an iOS failure never blocks a release.

To ship a properly installable build you need a paid Apple Developer account, and then either `--export-method release-testing` with a certificate + provisioning profile in secrets (devices listed in the profile), or `--export-method app-store-connect` with an App Store Connect API key for TestFlight.

### 🖋️ Sign `.apk`

One time setup: init Android Studio, enable NDK and CLI in Settings > Android SDK

```sh
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
```

To sign the Android `.apk`, generate a keystore:

```sh
mkdir -p ~/.keystores
keytool -genkey -v -keystore ~/.keystores/typodown.jks -keyalg RSA -keysize 2048 -validity 10000 -alias typodown
```

Create `apps/typodown-app/src-tauri/gen/android/keystore.properties`:

```sh
storeFile=/Users/you/.keystores/typodown.jks
storePassword=password
keyPassword=password
keyAlias=typodown
```

### ▶️ Publish to Google Play

The Play Store distributes the `.aab` (Android App Bundle). The release workflow signs it with the upload keystore and uploads it to the **internal testing**&#x20;

**track** via the Play Developer API; you then promote it to production from the Play Console. One-time setup

1. **Create the app in the** **[Play Console](https://play.google.com/console/).** Use the package name `io.github.vemonet.typodown` (must match `bundle.identifier` in [`tauri.conf.json`](apps/typodown-app/src-tauri/tauri.conf.json)).
2. **Do the first upload manually.** The Play Developer API cannot create an app or its first release. Build a bundle locally (`vp run app:aab`) and upload `app-universal-release.aab` under _Testing > Internal testing > Create new release_, then complete the required store listing, content rating, data-safety and target-audience forms until the app is in a releasable state. Later releases are automated.
3. **Enrol in** **[Play App Signing](https://support.google.com/googleplay/android-developer/answer/9842756)** (default for new apps). You upload bundles signed with the _upload key_ (our `typodown.jks`); Google re-signs with the managed _app signing key_. Keep `typodown.jks` safe - it is how the workflow authenticates uploads.
4. **Create a service account for CI:**
   - In [Google Cloud Console](https://console.cloud.google.com/) create a service account and a JSON key for it.
   - In the Play Console under _Users and permissions > Invite new users_, add the service account email and grant it access to this app with the _Release to testing tracks_ (and _Manage production releases_ if you later automate promotion) permissions.
   - Add the JSON key file's contents as the `PLAY_SERVICE_ACCOUNT_JSON` repo secret.

#### Versioning

Play requires a unique, increasing `versionCode` for every upload. Tauri derives it from the `version` in [`tauri.conf.json`](apps/typodown-app/src-tauri/tauri.conf.json) as `major * 1000000 + minor * 1000 + patch` (so `0.1.0` -> `1000`, `0.1.1` -> `1001`). The workflow syncs that `version` to the release tag automatically, so just make sure each release tag is a higher semver than the last.

#### Releasing

Tag a release as usual (`vp run release`). Once the workflow finishes, the new build appears on the **internal** track in the Play Console; open the release there and **promote it to Production** (or a closed/open testing track) when you are ready to ship. To change the default track the workflow targets, edit the `track:` field in the _Publish to Google Play_ step of [`release.yml`](.github/workflows/release.yml).
