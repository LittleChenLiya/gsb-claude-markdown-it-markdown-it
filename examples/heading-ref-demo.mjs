// Demo for the optional heading reference plugin.
// Run: node examples/heading-ref-demo.mjs
//
// Prints the assigned anchors, the resolved links and the missing
// references for a sample document (a ~90 second walkthrough).

import markdownit from '../src/index.ts'
import headingRef from '../src/plugins/heading_ref.ts'

const md = markdownit().use(headingRef, {
  // Pure data, no network access happens while parsing.
  documents: {
    Guide: 'https://example.com/guide',
    Specs: { href: 'https://example.com/specs', anchors: ['intro'] }
  }
})

const source = [
  '# Hello',
  '',
  'Welcome. Read [[#Hello]] again, jump to [[#Hello-2]],',
  'see the [[Guide#Install Notes]] or the [[Specs#Intro]].',
  'Missing ones: [[#Nowhere]] and [[Unknown#Ghost]].',
  '',
  '```',
  '[[Guide#Install Notes]] inside a fence is not a reference',
  '```',
  '',
  '# Hello',
  '',
  '# Hello-2',
  '',
  '# Full Width',
  ''
].join('\n')

const env = {}
const html = md.render(source, env)

console.log('=== Anchors (heading -> id) ===')
for (const anchor of env.headingRefs.anchors) {
  console.log('  #' + anchor)
}

console.log('')
console.log('=== Resolved links ===')
for (const link of env.headingRefs.resolved) {
  const doc = link.doc === '' ? '(this document)' : link.doc
  console.log(`  ${doc}#${link.heading} -> ${link.href}`)
}

console.log('')
console.log('=== Missing references (token diagnostics) ===')
for (const diag of env.headingRefs.diagnostics) {
  console.log(`  ${diag.raw} [${diag.reason}]`)
}

console.log('')
console.log('=== Rendered HTML ===')
console.log(html)