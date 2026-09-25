---
title: Footnotes
category: Main
---

# Footnotes

The `default` preset includes a built-in footnote extension (not available in
the `commonmark` and `zero` presets).

## Syntax

Reference a footnote anywhere in the text with `[^name]`, and define it at
block level with `[^name]: content`:

```md
First reference to b[^b], then to a[^a], then b again[^b].

[^a]: note a
[^b]: note b
    continued lines are indented by 4 spaces
```

- Footnotes are numbered in __order of first reference__, not in order of
  definition (`b` above becomes `[1]`, `a` becomes `[2]`).
- Definitions may appear before or after their references.
- A footnote referenced several times gets one back-link (`↩`) per reference,
  each pointing to its own reference anchor (`#fnref1`, `#fnref1:1`, ...),
  numbered by reference occurrence.
- Footnote content is parsed with the regular block and inline rules, so
  multiple paragraphs, nested lists and inline markup all work.
- Definitions that are never referenced are not rendered.
- Markers inside code fences, code spans or after a backslash escape
  (`\[^a]`) are not treated as footnotes.

## Namespaces

When several rendered fragments are merged into a single page, generated HTML
ids would collide. Pass a per-fragment namespace via `env.footnoteNamespace`
to keep them unique:

```js
import MarkdownIt from 'markdown-it'
const md = new MarkdownIt()

const part1 = md.render('see[^x]\n\n[^x]: note\n', { footnoteNamespace: 'part1' })
const part2 = md.render('see[^x]\n\n[^x]: note\n', { footnoteNamespace: 'part2' })
// ids: part1-fn1, part1-fnref1, part2-fn1, part2-fnref1, ...
```

All ids and `href`s derived from the namespace are HTML-escaped.

## Diagnostics

Problems are reported through `env.footnoteDiagnostics` instead of throwing:

```js
const env = {}
const html = md.render('missing[^nope]\n\n[^a]: one\n[^a]: two\n', env)

console.log(env.footnoteDiagnostics)
// [
//   { type: 'duplicate-definition', name: 'a' },
//   { type: 'missing-definition', name: 'nope' }
// ]
```

- `missing-definition`: a `[^name]` reference has no matching definition.
  The source text is kept visible in the output as-is.
- `duplicate-definition`: a definition with the same name already exists.
  The first definition stays in effect, later ones are discarded.

The collected numbering is available in `env.footnotes.list` (in order of
first reference, with per-footnote reference counts).

Each `render` call keeps its state in the `env` object, so repeated renders
don't leak footnotes into each other.

## Demo

```bash
npm run demo:footnote
```

prints the assigned numbers, generated back-links and diagnostics for
a sample document.

## Disable

```js
const md = new MarkdownIt()
  .disable(['footnote_def', 'footnote_ref', 'footnote_tail'])
```
