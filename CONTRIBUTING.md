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
