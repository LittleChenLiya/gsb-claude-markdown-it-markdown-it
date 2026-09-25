# Heading references plugin

`src/plugins/heading_refs.ts` is an optional plugin that

1. collects all headings, computes their visible plain text and assigns a
   unique `id` anchor to each heading, and
2. resolves `[[doc#heading]]` references in regular text into links.

Because references are resolved in a second core rule that runs after **all**
headings have been collected, forward references (to headings further down
the document) work transparently.

## Usage

```js
import MarkdownIt from 'markdown-it'
import headingRefs from 'markdown-it/src/plugins/heading_refs.ts'

const md = new MarkdownIt().use(headingRefs, {
  docName: 'Home',            // title of the current document (optional)
  docs: {                     // external document index: plain data only,
    Guide: {                  //   doc title -> heading text -> href
      'Getting Started': '/guide/#getting-started'
    }
  }
})

const env = {}
const html = md.render('See [[Guide#Getting Started]] and [[#Intro]].\n\n# Intro\n', env)

console.log(env.headingRefs.headings)     // collected headings + anchors
console.log(env.headingRefs.diagnostics)  // unresolved references
```

## Anchor algorithm

Anchors are derived from the visible plain text of a heading:

1. NFKC normalization (full-width characters fold to ASCII),
2. lowercasing,
3. every whitespace run becomes a single `-`,
4. all other punctuation/symbols are removed (letters, numbers, `_` and `-`
   are kept; adjacent hyphens are **not** collapsed),
5. an empty result (e.g. an empty heading) becomes `section`.

Visible plain text is computed from the inline tokens of the heading:

- `text` and `code_inline` tokens contribute their literal content,
- `image` tokens contribute their alt text (recursively),
- `html_inline` tokens (tags, including inline `style` attributes)
  contribute nothing,
- `softbreak`/`hardbreak` contribute a single space.

### Deduplication

The first heading keeps its natural slug. Later headings with the same
natural slug get `-2`, `-3`, ... appended, skipping any candidate that is
already assigned **or** reserved as the natural slug of a real heading in
the same document. Fixed expectation for headings `hello`, `hello`,
`hello-2` (in that order):

| heading   | anchor    |
| --------- | --------- |
| `hello`   | `hello`   |
| `hello`   | `hello-3` | (`hello-2` is reserved by the real heading below)
| `hello-2` | `hello-2` |

## Reference syntax

- `[[#heading]]` or `[[heading]]` - heading of the current document,
- `[[doc#heading]]` - heading of another document; when `doc` equals the
  `docName` option it resolves internally, otherwise the caller-provided
  `docs` index is consulted.

Matching is slug-based: the heading part is slugified and compared against
the natural slugs of the collected headings (or the keys of the external
index). Internal references resolve to the **first** matching heading in
document order.

The external index is pure data supplied by the caller. The plugin never
performs network (or any other I/O) access while parsing.

References are only recognized in plain `text` tokens, so fenced code
blocks, indented code and inline code never produce references.

## Diagnostics

Resolved references become `link_open`/`text`/`link_close` token triples
with `token.meta.headingRef = { doc, heading, source, resolved: true, href }`
on the `link_open` token.

Unresolved references stay as literal text. The diagnostic is kept both on
the token (`token.meta.headingRef`, with `resolved: false` and a `reason`)
and in `env.headingRefs.diagnostics`. Reasons:

- `empty-heading` - reference without a heading part,
- `missing-doc` - doc not present in the external index,
- `missing-heading` - no heading with a matching slug,
- `invalid-href` - external href rejected by `md.validateLink`.

All per-parse state lives in `env` and is reset at the start of every parse,
so repeated `render` calls (even with a reused `env` object) never leak
state.

## Demo

```sh
npm run demo:heading-refs
```

prints the assigned anchors, the resolved links and the missing references
of a sample document.
