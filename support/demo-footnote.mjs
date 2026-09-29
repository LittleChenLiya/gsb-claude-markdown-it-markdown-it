// Demo for the bundled footnote plugin.
//
// Run with: npm run demo:footnote
//
// Renders a sample document and prints the assigned footnote numbering,
// the generated backlinks and the collected diagnostics.

import markdownit from '../src/index.ts'

const md = markdownit().use(markdownit.footnote)

const src = [
  'First reference to b[^b], then one to a[^a], and b again[^b].',
  'This one has no definition[^missing].',
  '',
  '[^a]: note a',
  '[^b]: note b',
  '[^b]: duplicate definition of b (ignored)',
  '[^unused]: never referenced, not rendered',
  ''
].join('\n')

const env = {}
const html = md.render(src, env)

console.log('=== Rendered HTML ===')
console.log(html)

console.log('=== Numbering (order of first reference) ===')
env.footnotes.list.forEach((entry, i) => {
  console.log(`[${i + 1}] ^${entry.label} (referenced ${entry.count}x)`)
})

console.log('=== Backlinks ===')
for (const match of html.matchAll(/<a href="#([^"]+)" class="footnote-backref">/g)) {
  console.log(`#${match[1]}`)
}

console.log('=== Diagnostics ===')
if (env.footnotes.diagnostics.length === 0) {
  console.log('(none)')
} else {
  for (const diagnostic of env.footnotes.diagnostics) {
    console.log(`${diagnostic.type}: ${diagnostic.message}`)
  }
}
