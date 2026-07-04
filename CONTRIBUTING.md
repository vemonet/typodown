# Development

Check everything is ready:

```bash
vp run ready
```

Run the `tests`:

```bash
vp run -r test
```

Build the monorepo:

```bash
vp run -r build
```

## Start demo website

Run lib dev server:

```sh
vp run @vemonet/typodown#dev
```

Build demo website:

```sh
vp run @vemonet/typodown#build:demo
```

## Start VSCode extension

Build lib:

```sh
vp run @vemonet/typodown#build
```

Start the VSCode extension dev host using **F5** in VSCode.

## Release

```sh
npm run release
```

## Todo

- [ ] Don't switch tables to raw, enable to edit directly in the rendered table. With a small 3 dots button that appears when cursor in the table (top left of the table), show submenu with actions like insert row
- [ ] Enable markdown rendering of text inside cell of a table
- [ ] Support HTML in the markdown, including `<kbd>`
- [ ] Look into [`@chenglou/pretext`](https://github.com/chenglou/pretext) for fast text layout
