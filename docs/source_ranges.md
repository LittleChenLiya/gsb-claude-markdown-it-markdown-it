# Source ranges

By default, markdown-it only tracks line-level source maps
(`token.map = [line_begin, line_end]`). Enabling the `sourceRanges` option
makes every token also carry exact character-level positions in the original
Markdown source:

```js
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ sourceRanges: true })
const tokens = md.parse('甲 &amp; _乙😀_', {})

// each token now has:
// token.sourceRanges === [[start, end], ...] | null
```

## `token.sourceRanges`

An ordered list of half-open `[start, end)` intervals, measured in UTF-16
code units (the same units JavaScript strings use, so an emoji like `😀`
counts as 2). Offsets refer to the **original** source string, exactly as
passed to `md.parse()` — CRLF line endings, removed block indentation and
blockquote markers are all accounted for.

Guarantees:

- Ranges include the syntax markers a token was formed from. For example,
  an `em_open`/`em_close` pair covers the whole `_text_` span, and a
  `text_special` token for `&amp;` covers all 5 characters of the entity,
  not the decoded `&`.
- Parent tokens cover all of their children.
- When adjacent text tokens are merged (e.g. by the `text_join` core rule),
  their ranges are merged too. If the merged parts came from discontinuous
  places of the source, the token keeps multiple ordered ranges.
- Tokens injected by plugins (or otherwise lacking source information) have
  `sourceRanges === null`. Ranges are never fabricated.

The option is off by default. When off, no mapping data is collected and
`sourceRanges` is `null` on every token; the line-level `token.map`
contract is unchanged either way.

## Plugin API

Plugins that create tokens can (and should) record where those tokens came
from. Two helpers are provided:

- `state.mapRange(start, end)` (inline rules): maps a half-open range of
  `state.src` positions to offsets in the original document. Returns
  `null` when the `sourceRanges` option is disabled or the mapping is
  unknown, so plugin code keeps working in both modes.
- `token.addSourceRange(start, end)`: appends a range to a token.

Example inline rule:

```js
md.inline.ruler.push('my_rule', (state, silent) => {
  const start = state.pos
  // ... scan ...
  if (!silent) {
    const token = state.push('my_token', '', 0)
    const range = state.mapRange(start, state.pos)
    if (range) token.addSourceRange(range[0], range[1])
  }
  return true
})
```

Plugins creating tokens detached from the current inline state (e.g. in core
rules) can call `token.addSourceRange()` directly with offsets into the
original source. Plugins that don't record anything simply leave
`sourceRanges` as `null`.
