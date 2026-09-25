// Demo for the heading_refs plugin: prints assigned anchors, resolved
// links and missing references of a sample document.
//
// Run with: npm run demo:heading-refs

import markdownit from '../src/index.ts'
import headingRefs from '../src/plugins/heading_refs.ts'

const md = markdownit({ html: true }).use(headingRefs, {
  docName: 'Home',
  docs: {
    Guide: { 'Getting Started': '/guide/#getting-started' }
  }
})

const src = [
  '# Hello',
  '',
  'Welcome! Read [[#hello]], [[#hello-2]], [[Guide#Getting Started]] and [[#Missing]].',
  '',
  '# Hello',
  '',
  '# Hello-2',
  '',
  '```',
  '[[#hello]] <- not a reference (inside a code fence)',
  '```',
  ''
].join('\n')

const env = {}
const html = md.render(src, env)

console.log('== Anchors ==')
for (const h of env.headingRefs.headings) {
  console.log(`#${h.anchor}  <-  "${h.text}" (h${h.level})`)
}

console.log('\n== Resolved links ==')
for (const m of html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)) {
  console.log(`${m[2]}  ->  ${m[1]}`)
}

console.log('\n== Missing references ==')
for (const d of env.headingRefs.diagnostics) {
  console.log(`${d.source}  (${d.reason})`)
}

console.log('\n== HTML ==')
console.log(html)
