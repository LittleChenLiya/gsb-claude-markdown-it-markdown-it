---
title: Footnotes
category: Main
---

# Footnotes

The bundled footnote plugin adds [^name] references and block-level
footnote definitions:

```md
First reference[^b], second one[^a], and again[^b].

[^a]: Footnote content is parsed as regular markdown,
    including *inline markup*.

    And even multiple blocks, like lists:

    - item 1
    - item 2
[^b]: Another note.
```

## Usage

The plugin is opt-in (not enabled by default):

```js
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt().use(MarkdownIt.footnote)
const html = md.render('text[^a]\n\n[^a]: note\n')
```

## Behavior

- References `[^name]` in the text become numbered superscript links.
  Numbering follows the __order of first reference__ in the document, not
  the order of definitions. Definitions may appear before or after their
  references.
- Referencing the same footnote multiple times creates one backlink per
  reference in the footnote body. Backlink targets are fixed by reference
  occurrence order (`fnref1`, `fnref1:1`, `fnref1:2`, ...).
- Footnote definitions (`[^name]: ...`) are block-level. Continuation
  lines indented by 4+ spaces belong to the definition, so multi-paragraph
  notes, nested lists and other block content work. Definition content is
  parsed with the regular block and inline parsers.
- Definitions that are never referenced are not rendered.
- References without a matching definition stay visible as literal text
  (e.g. `[^name]`) and are reported as diagnostics.
- Duplicate definitions: the first one wins, later ones are discarded and
  reported as diagnostics.
- Markers inside code spans, code blocks and escaped with `\` are not
  treated as footnotes.

## Namespaces

When several rendered fragments are combined into a single page, generated
HTML ids would collide. Pass a per-fragment namespace to keep them unique:

```js
const md = new MarkdownIt().use(MarkdownIt.footnote, { namespace: 'page1' })
// ids become "page1-fn1", "page1-fnref1", ...

// or override per render:
const html = md.render(src, { footnoteNamespace: 'page2' })
```

All ids and hrefs are HTML-escaped, so any namespace string is safe.

## Diagnostics

Problems found during rendering are collected in `env.footnotes.diagnostics`:

```js
const env = {}
const html = md.render('text[^missing]\n', env)

console.log(env.footnotes.diagnostics)
// [ { type: 'missing-definition', label: 'missing', message: '...' } ]
```

Diagnostic types:

- `missing-definition` - a reference has no matching definition.
- `duplicate-definition` - a definition was ignored because the label
  was already defined.

`env.footnotes` is reset on every render, so repeated renders never
share state, even when the same `env` object is reused.

## Demo

```bash
npm run demo:footnote
```

prints the assigned numbering, generated backlinks and diagnostics for a
sample document.
