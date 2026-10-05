# markdown-it-heading-anchors

Explicit, deterministic heading anchors for [markdown-it](https://github.com/markdown-it/markdown-it).

- Every heading gets a unique `id` derived from its text.
- Repeated headings are disambiguated by **occurrence order**: `foo`,
  `foo-2`, `foo-3`, … and references can target a specific occurrence.
- Numbering is **local to a single parse**. There is no module-level counter,
  so parsing the same document twice (in any process state) gives byte
  identical output.
- Embedded snippets can render with an explicit **prefix** for their scope.
- Explicit **user ids** (`# Title {#my-id}`) and ids already present on
  heading tokens are preserved and participate in **collision detection**;
  a duplicate reports **both locations**.
- Headings that produce an empty slug get a deterministic fallback id
  (`section`, configurable).

## Usage

```js
import MarkdownIt from 'markdown-it'
import headingAnchors from './plugins/heading-anchors/index.mjs'

const md = new MarkdownIt().use(headingAnchors, {
  // all options are optional
  prefix: '',            // prepended to every id of this scope
  emptySlug: 'section',  // fallback when the text yields no slug
  // slugify: customFn,   // override the built-in slug function
  resolveReferences: true // rewrite #name / #name/n links
})

md.render('# Hello\n\n# Hello')
// <h1 id="hello">Hello</h1>
// <h1 id="hello-2">Hello</h1>
```

### Explicit user ids

Append `{#some-id}` to a heading. The marker is removed from the rendered
text and the id is never rewritten.

```md
# Introduction {#intro}
```

```html
<h1 id="intro">Introduction</h1>
```

If the same id is declared twice, the render throws an error carrying both
positions:

```js
try {
  md.render('# First {#dup}\n\n# Second {#dup}')
} catch (err) {
  err.code        // 'HEADING_ANCHOR_DUPLICATE_ID'
  err.collisions  // [{ id, first: { line, level, text },
                  //     second: { line, level, text }, explicit: [true, true] }]
}
```

Generated ids always step around reserved user ids, so `# API` after an
explicit `{#api}` becomes `api-2`. An `id` attribute already placed on a
`heading_open` token by another rule is treated the same way: it is kept
(no prefix added, because it belongs to another scope) and is included in
collision detection.

### Occurrence-aware heading references

Links whose destination is `#name` or `#name/N` are rewritten to the
matching id, where `N` is the 1-based occurrence in document order:

```md
# API

[first](#api) · [second](#api/2)

## API
```

```html
<h1 id="api">API</h1>
<p><a href="#api">first</a> · <a href="#api-2">second</a></p>
<h2 id="api-2">API</h2>
```

A destination containing spaces must use the CommonMark `<...>` form,
e.g. `[x](<#Foo Bar>)`. References that cannot be resolved are left
untouched and reported on the parse metadata
(`unresolvedReferences`). Set `resolveReferences: false` to disable
rewriting entirely.

### Prefixes for embedded snippets

Give an embedded fragment its own id namespace for a single render by
passing the prefix through `env` (overrides the plugin option):

```js
md.render('# Notes\n\n# Notes', { headingAnchorsPrefix: 'snip-' })
// <h1 id="snip-notes">Notes</h1>
// <h1 id="snip-notes-2">Notes</h1>
```

References inside that render are prefixed automatically
(`#notes/2` → `#snip-notes-2`). A later render with a fresh `env` starts
from scratch.

### Parse metadata

Pass an `env` object to `render`; after rendering, `getAnchors(env)` returns
the collected anchors in document order plus diagnostics:

```js
import { getAnchors } from './plugins/heading-anchors/index.mjs'

const env = {}
md.render(source, env)
getAnchors(env)
// {
//   anchors: [{ id, rawId, text, slug, line, level, explicit }, ...],
//   unresolvedReferences: ['#missing'],
//   collisions: []
// }
```

## Unicode slug rule

The built-in `slugify` is a pure, locale-independent function. It is
exported (`import { slugify }`) and can be replaced via the `slugify`
option. Steps:

1. **Normalize** with Unicode **NFKD**, then remove every character in
   Unicode general category **M** (combining marks, regex `\p{M}`).
   Accents are dropped while the base letter survives:
   `café` → `cafe`, `Ångström` → `angstrom`. This also removes the Greek
   tonos: `Ελληνικά` → `ελληνικα`.
2. **Lowercase** with JavaScript's default Unicode case mapping
   (`String.prototype.toLowerCase()`).
3. **Keep** Unicode letters (`\p{L}` — this retains CJK, Cyrillic, Greek,
   …), numbers (`\p{N}`), ASCII underscore `_` and hyphen `-`.
4. Each maximal run of anything else — Unicode separators/whitespace
   (`\p{Z}`), control/format/surrogate/private-use code points (`\p{C}`),
   punctuation (`\p{P}`) and symbols (`\p{S}`, including emoji) — becomes
   one ASCII hyphen `-`.
5. Collapse consecutive hyphens and trim leading/trailing hyphens.

Examples:

| Input | Slug |
| --- | --- |
| `Hello World` | `hello-world` |
| `café` | `cafe` |
| `标题 锚点` | `标题-锚点` |
| `Кириллица` | `кириллица` |
| `emoji 😀 here` | `emoji-here` |
| `100% done!` | `100-done` |
| `FOO---BAR` | `foo-bar` |
| `!!!` | *(empty → `section`)* |

If steps 1–5 yield an empty string, the id `section` is used by default;
the second empty heading becomes `section-2`, and so on. Configure
`emptySlug` to change the base name.

### Duplicate numbering

For a base slug `foo`, the plugin assigns the first free id in the
sequence `foo`, `foo-2`, `foo-3`, … against all ids already claimed in
this parse (generated and user-provided). The sequence reflects document
order, so references like `#foo/2` are unambiguous.

## Scope guarantees

- All counters and maps are stored on the markdown-it `env` under a
  `Symbol` key and recreated for every new `env`. Nothing is stored on the
  module or the plugin function.
- Therefore: `md.render(src, {})` called any number of times, on one
  instance or several, always produces the same ids, in the same order.

## Local test & demo

Tests use Node's built-in test runner (no extra dependency):

```bash
node --test test/plugins/heading-anchors/heading-anchors.test.mjs
```

Runnable example (loads markdown-it from this repository's sources):

```bash
node plugins/heading-anchors/example.mjs
```
