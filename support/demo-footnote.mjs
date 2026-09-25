// Demo of the built-in footnote extension.
//
// Prints, for a sample document:
//  - the numbers assigned to each footnote (in order of first reference)
//  - the back-links generated for every reference
//  - diagnostics for missing and duplicate definitions
//  - id uniqueness when namespaced fragments are merged
//
// Usage: npm run demo:footnote   (or: node support/demo-footnote.mjs)

import markdownit from '../src/index.ts'

const src = [
  'First reference to b[^b], then to a[^a], then b again[^b].',
  'A reference without a definition[^missing].',
  '',
  '[^a]: note a',
  '[^b]: note b',
  '[^b]: duplicate definition of b',
  '[^unused]: never referenced',
  ''
].join('\n')

const md = markdownit()

console.log('=== input ===')
console.log(src)

// --- single fragment -------------------------------------------------------

const env = {}
const html = md.render(src, env)

console.log('\n=== html ===')
console.log(html)

console.log('=== numbering (order of first reference) ===')
for (const [i, note] of env.footnotes.list.entries()) {
  console.log(`  [${i + 1}] ${note.label} (${note.count} reference${note.count > 1 ? 's' : ''})`)
}

console.log('\n=== back-links (one per reference, in reference order) ===')
for (const m of html.matchAll(/href="#([^"]+)" class="footnote-backref"/g)) {
  console.log(`  footnote -> #${m[1]}`)
}

console.log('\n=== diagnostics ===')
if (env.footnoteDiagnostics) {
  for (const d of env.footnoteDiagnostics) {
    console.log(`  ${d.type}: ${d.name}`)
  }
} else {
  console.log('  (none)')
}

// --- namespaced fragments --------------------------------------------------

console.log('\n=== namespaced fragments (ids stay unique when merged) ===')
const fragment1 = md.render('see[^x]\n\n[^x]: note\n', { footnoteNamespace: 'part1' })
const fragment2 = md.render('see[^x]\n\n[^x]: note\n', { footnoteNamespace: 'part2' })
const ids = [...(fragment1 + fragment2).matchAll(/ id="([^"]+)"/g)].map(m => m[1])
for (const id of ids) { console.log(`  id: ${id}`) }
console.log(`  all ids unique: ${ids.length === new Set(ids).size}`)
