# Changelog

All notable changes to Typodown.

## [0.0.1] - 2026-08-16

### Bug Fixes

- Fix a few rendering edge cases (@vemonet)
- Fix nested quoteblocks (@vemonet)

### Features

- Initial commit (@vemonet)
- Migrate to use CodeMirror 6 (@vemonet)
- Add custom right click menu to add table, improve table editing (@vemonet)
- Add standalone app for desktop and android built with tauri v2, add toolbar (@vemonet)
- Improve editor (@vemonet)
- Add pwa on the website /vault/ path (requires chromium based browser with filesystem API) (@vemonet)
- Enable to toggle between rendered and raw markdown with ctrl+/ (@vemonet)
- Support local images in markdown and html files in tauri app and vscode extension (@vemonet)

### Miscellaneous

- Update website URL from github pages to https://typodown.app (@vemonet)
- Fix devEngine version (@vemonet)
- Fix vp install (@vemonet)
- Fix type checking (@vemonet)
- Fix app builds in ci (@vemonet)
- Fix aliases (@vemonet)
- Fix windows build (@vemonet)
- Improve release process (@vemonet)
- Fix release process

### Performance

- Fix blank gap when scrolling, improve rendering performance when scrolling (@vemonet)
- Improve performance overall, fix title styling and edge cases (@vemonet)

### Refactor

- Clean up dead code (@vemonet)

### Testing

- Add benchmark to check performance and resource usage compared to existing similar solutions (@vemonet)
