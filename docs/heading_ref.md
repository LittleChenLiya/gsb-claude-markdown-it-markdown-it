# Heading reference plugin

Optional plugin that adds heading anchors and `[[document#heading]]`
references to markdown-it. It lives in
[`src/plugins/heading_ref.ts`](../src/plugins/heading_ref.ts) and is **not**
enabled by default.

## Usage

```js
import MarkdownIt from 'markdown-it'
import headingRef from 'markdown-it/src/plugins/heading_ref.ts'

const md = new MarkdownIt().use(headingRef, {
  // Caller-provided index of external documents. Pure data: the plugin
  // never accesses the network while parsing.
  documents: {
    Guide: 'https://example.com/guide',
    Specs: { href: 'https://example.com/specs', anchors: ['intro', 'faq'] }
  },
  // Title of the document being rendered, so [[Manual#x]] can link to itself
  currentDocument: 'Manual'
})

const env = {}
const html = md.render('See [[#Hello]] and [[Guide#Install]].\n\n# Hello\n', env)
console.log(env.headingRefs) // { anchors, resolved, diagnostics }
```

## What it does

1. **Collects headings and assigns anchors.** Every `heading_open` token
   gets an `id` attribute derived from the visible plain text of the
   heading.
2. **Resolves references.** `[[document#heading]]` (and `[[#heading]]`
   for the current document) becomes a link. Resolution happens after the
   whole document is parsed, so **forward references** to later headings
   work, and duplicates always resolve to the **first** matching anchor.
3. **Reports missing references.** Unresolvable references are rendered as
   literal text and recorded in the token diagnostics
   (`token.meta.diagnostics`) and in `env.headingRefs.diagnostics`.

## Anchor (slug) rules

The anchor is derived from the visible plain text of the heading:

1. Unicode **NFKC** normalization (full-width characters fold to ASCII,
   e.g. full-width `Hello` becomes `Hello`).
2. **Lowercase**.
3. Every whitespace run becomes a single `-`.
4. Everything that is not a letter, number, mark, `_` or `-` is removed
   (all other punctuation is dropped).
5. An empty result becomes `section`.

Duplicates get `-2`, `-3`, ... appended, incrementing until the anchor is
unoccupied, which also avoids real anchors that happen to share the name.
Fixed allocation example for headings `hello`, `hello`, `hello-2`:

| Heading    | Anchor       |
| ---------- | ------------ |
| `hello`  | `hello`    |
| `hello`  | `hello-2`  |
| `hello-2` | `hello-2-2` |

### Visible text value rules

- **Inline code** (`code_inline`) contributes its content verbatim.
- **Images** contribute their alternative text (recursively).
- **Inline HTML** (tags, inline styles, comments) contributes nothing.
- Soft line breaks contribute a single space.

## Reference syntax

```markdown
[[#Local Heading]]        -> <a href="#local-heading">#Local Heading</a>
[[Guide#Install]]         -> <a href="https://example.com/guide#install">Guide#Install</a>
[[Guide#Missing]]         -> literal text + diagnostic (anchor not in index)
[[Unknown#Anything]]      -> literal text + diagnostic (unknown document)
```

- The heading part is slugified with the same rules as heading anchors.
- External documents are resolved **only** through the `documents` index
  passed by the caller; the plugin performs no network access.
- When an index entry provides an `anchors` list, membership is checked
  and unknown anchors are reported as missing.
- Pseudo references inside code fences and inline code are left untouched.

## Diagnostics

Every render stores a fresh report in `env.headingRefs` (state never leaks
between renders, even when the caller reuses the `env` object):

```ts
interface HeadingRefEnv {
  anchors: string[]        // assigned anchors, in document order
  resolved: Array<{ doc: string, heading: string, href: string }>
  diagnostics: Array<{
    code: 'unresolved-heading-ref'
    doc: string
    heading: string
    raw: string
    reason: 'unknown-document' | 'missing-anchor'
  }>
}
```

The same diagnostic objects are attached to the emitted text tokens as
`token.meta.diagnostics`.

## Demo

```bash
node examples/heading-ref-demo.mjs
```

Prints the assigned anchors, the resolved links and the missing references
for a sample document.