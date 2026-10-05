// Local, dependency-free demo. Run from the repository worktree root with:
//
//   node plugins/heading-anchors/example.mjs
//
// It loads markdown-it directly from the TypeScript sources (Node's built-in
// type stripping); against a published markdown-it build use:
//
//   import MarkdownIt from 'markdown-it'
//
import MarkdownIt from '../../src/index.ts'
import headingAnchors, { getAnchors } from './index.mjs'

const md = new MarkdownIt().use(headingAnchors)

// 1. Same-name headings get distinct ids; references can pick the occurrence.
const doc = `# API

See the [first API](#api) and the [second API](#api/2).

## API`

const env = {}
console.log('--- rendered document ---')
console.log(md.render(doc, env))

// 2. Per-parse metadata, in document order.
console.log('--- anchors ---')
for (const a of getAnchors(env).anchors) {
  console.log(`line ${String(a.line).padStart(2)}  #${a.id}`)
}

// 3. Embedded snippet rendered with an explicit prefix for this parse only.
const snippetEnv = { headingAnchorsPrefix: 'snip-1--' }
console.log('--- embedded snippet (prefixed) ---')
console.log(md.render('# Notes\n\n[jump](#notes)', snippetEnv))

// 4. Unicode slugs and the deterministic empty-slug fallback.
console.log('--- unicode + empty slug ---')
console.log(md.render('# 标题 café 😀\n\n# !!!'))

// 5. Explicit user id collision reports both positions.
console.log('--- collision ---')
try {
  md.render('# First {#dup}\n\npara\n\n# Second {#dup}')
} catch (err) {
  console.log(`${err.code}: ${err.message}`)
  console.log(err.collisions[0])
}

// 6. Parsing again yields byte-identical output (no global counter).
const second = md.render(doc, {})
const first = md.render(doc, {})
console.log('--- determinism ---')
console.log('two parses identical:', first === second)
