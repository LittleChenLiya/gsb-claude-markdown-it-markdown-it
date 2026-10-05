# Code block replacement plans

An **explicit replacement plan** rewrites the content of block-level code
tokens (`fence` and indented `code_block`) in a parsed token stream, without
re-parsing the source and without touching anything else.

A plan is *explicit* because it is created up front against a fixed token
stream: it captures the targeted blocks (token reference, position in the
stream and source line range) together with their original `content` as a
**baseline**. Applying the plan later is atomic — it either rewrites every
targeted token or, when the baseline no longer matches, refuses and changes
nothing.

## Creating and applying a plan

```js
import MarkdownIt from 'markdown-it'
import { createCodeBlockPlan } from 'markdown-it'

const md = new MarkdownIt()
const env = {}
const tokens = md.parse(src, env)

// select fenced blocks whose info-string language is `js`
const plan = createCodeBlockPlan(tokens, { lang: 'js' }, 'const a = 42\n')

if (plan.apply()) {
  const html = md.renderer.render(tokens, md.options, env)
}
```

`createCodeBlockPlan(tokens, selector, content)`:

- `selector.lang` — language name, matched against the **first word of the
  fence info string** (`token.info`). The language is never matched against
  the code content, and inline `` `code` `` spans are never selected.
- `selector.kind` — `'fence'`, `'indented'` or `'both'` (default). Fenced
  and indented code blocks are handled separately; indented blocks carry no
  language, so they never match a `lang` selector.
- `selector.index` — optional 0-based index among the matched blocks, to
  target one specific occurrence. Without it, every match is planned.
- `content` — replacement string, or a function `(entry) => string`
  computing the replacement per block (e.g. from `entry.baseline`).

## Guarantees

`plan.apply()`:

- replaces **only** `token.content` of the selected `fence` / `code_block`
  tokens;
- preserves `token.info`, `token.map` (original source line numbers) and
  every unrelated token, including `code_inline` tokens;
- never runs the `options.highlight` callback: applied tokens are flagged
  via `token.meta.codeBlockPlan = { replaced: true }`, and the default fence
  renderer escapes their (already final) content directly instead of calling
  `highlight`;
- **refuses** (returns `false`) when the baseline changed — i.e. when a
  targeted token's `content` or `map` was modified after the plan was
  created, when another plan was applied first, or when the same plan is
  applied twice. A refused plan leaves all tokens exactly as they are
  (verification happens before any mutation).

## Inspecting a plan

```js
plan.size            // number of targeted blocks
plan.applied         // true after a successful apply()
plan.isBaselineIntact()  // re-check the baseline without applying
plan.entries         // [{ token, index, map, baseline, content }, ...]
```

Each entry records the block identity: the token reference, its `index` in
the token stream and a copy of its source `map`. `entry.content` may be
adjusted before `apply()` runs.

## Render verification

Because applied tokens skip the highlight callback, rendering the plan's
tokens (or the whole stream) after `apply()` yields the replacement content
escaped verbatim, with the language class still derived from the preserved
info string:

```js
// highlight callback count stays 0 for plan-replaced blocks
md.renderer.render(plan.entries.map(e => e.token), md.options, env)
// => '<pre><code class="language-js">const a = 42\n</code></pre>\n'
```

See `test/markdown-it/code_block_plan.test.mjs` for the full acceptance
suite (run it locally with
`node --test test/markdown-it/code_block_plan.test.mjs`).
