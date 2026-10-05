# Heading anchors (explicit ids, occurrence-aware references)

The plugin at [`plugins/heading-anchors`](../../plugins/heading-anchors)
assigns every heading a unique `id`, following a fixed Unicode slug rule.
Duplicate headings are numbered per parse (`foo`, `foo-2`, …), explicit user
ids (`{#id}`) are preserved and collision-checked, and an embedded fragment
can render under its own prefix.

```js
import MarkdownIt from 'markdown-it'
import headingAnchors, { getAnchors } from './plugins/heading-anchors/index.mjs'

const md = new MarkdownIt().use(headingAnchors)

const source = `
# API

See [the second section](#api/2).

## API {#api-2}
`

const env = {}
console.log(md.render(source, env))
// <h1 id="api">API</h1>
// <p>See <a href="#api-2">the second section</a>.</p>
// <h2 id="api-2">API</h2>

console.log(getAnchors(env).anchors)
// [
//   { id: 'api',    slug: 'api',    line: 2, level: 1, explicit: false, ... },
//   { id: 'api-2',  slug: null,     line: 6, level: 2, explicit: true,  ... }
// ]

// Snippet with its own id namespace, for this render only:
md.render('# Notes', { headingAnchorsPrefix: 'snip-' })
// <h1 id="snip-notes">Notes</h1>
```

A duplicate explicit id throws an error that names both locations:

```js
try {
  md.render('# First {#dup}\n\n# Second {#dup}')
} catch (err) {
  // err.code === 'HEADING_ANCHOR_DUPLICATE_ID'
  // err.collisions[0] => { id: 'dup',
  //   first:  { line: 1, text: 'First' },
  //   second: { line: 3, text: 'Second' } }
}
```

All numbering is scoped to one `render` call via `env`; parsing the same
document repeatedly always produces identical ids. See the plugin
[README](../../plugins/heading-anchors/README.md) for the full Unicode slug
specification, and run `node plugins/heading-anchors/example.mjs` for a
worked demo.
