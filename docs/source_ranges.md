---
title: Source ranges
category: Main
---

# Source ranges

By default markdown-it only tracks line numbers (`token.map`). If you need
exact character positions - for example, to highlight tokens in an editor -
enable the `sourceRanges` option:

```js
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ sourceRanges: true })
const tokens = md.parse('甲 &amp; _乙😀_', {})

tokens[1].children[2].sourceRanges // [ [ 9, 12 ] ] -> '乙😀'
```

## `token.sourceRanges`

When the option is enabled, every token produced by the built-in rules gets
a `sourceRanges` property: a list of half-open `[start, end)` ranges of
UTF-16 code unit offsets in the **original** string passed to
`md.parse()` / `md.render()`. Note that:

- Ranges include the syntax markers that formed the token (`_`, `**`, `](`,
  backticks, `>` quote markers, indentation, ...).
- Positions are always given in the original input: removed indentation,
  `\r\n` -> `\n` normalization and other content transformations are already
  accounted for. They are never derived from the (decoded) token content.
- Parent tokens cover the ranges of all their children.
- A token assembled from disjoint pieces of the source (e.g. a paragraph
  inside a blockquote, where `> ` prefixes were removed between lines) has
  multiple ranges, in ascending order.
- When adjacent text tokens are merged (e.g. an entity or escape sequence
  joined with surrounding text), their ranges are merged too.
- Tokens without known source - typically tokens inserted by plugins that
  don't record positions - get `null`. Positions are never faked.

When the option is disabled (the default), `sourceRanges` is `null` on all
tokens and no mapping work is performed.

```js
const src = '*甲\\*\r\n乙*'
const tokens = new MarkdownIt({ sourceRanges: true }).parse(src, {})

for (const token of tokens[1].children) {
  console.log(token.type, token.sourceRanges)
}
// em_open [ [ 0, 1 ] ]    -> '*'
// text    [ [ 1, 4 ] ]    -> '甲\\*'  (escape covers backslash + char)
// softbreak [ [ 4, 6 ] ]  -> '\r\n'  (covers the whole CRLF)
// text    [ [ 6, 7 ] ]    -> '乙'
// em_close [ [ 7, 8 ] ]   -> '*'
```

A runnable demo is available at
[`support/demo-source-ranges.mjs`](https://github.com/markdown-it/markdown-it/blob/master/support/demo-source-ranges.mjs).

## Plugin API

Plugins that create tokens can record their source with
`token.setSourceRange(start, end)`:

```js
md.inline.ruler.push('my_rule', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x25 /* % */) return false
  if (!silent) {
    const token = state.push('my_token', '', 0)
    token.content = 'percent'
    // offsets are local to the inline input (`state.src`);
    // they are translated to document offsets automatically
    token.setSourceRange(state.pos, state.pos + 1)
  }
  state.pos++
  return true
})
```

- In **inline rules**, pass offsets in the inline input (`state.src` of the
  inline state). They are translated to document offsets automatically.
- In **block rules**, pass offsets in the document source (`state.src` of
  the block state).
- For tokens made of disjoint source pieces, assign `token.sourceRanges`
  directly with an ordered list of `[start, end)` ranges.
- Tokens you don't annotate keep `sourceRanges === null`, which callers
  should treat as "source unknown".

Recording ranges only makes sense when the `sourceRanges` option is
enabled; you can check `state.md.options.sourceRanges` to skip the work
otherwise.
