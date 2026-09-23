// Demo for the opt-in `directive` block rule.
//
// Usage: node support/demo-directive.mjs
//
// Prints the input, the token stream and the rendered HTML.

import markdownit from '../src/index.ts'

const input = [
  ':::note outer <img>',
  'Body is parsed as **markdown**.',
  '',
  ':::warning nested',
  '```',
  ':::',
  '```',
  ':::',
  ':::',
  '',
  ':::note unclosed container stays plain text',
  '',
  'following paragraph is kept',
  ''
].join('\n')

const md = markdownit().enable('directive')

console.log('=== INPUT ===')
console.log(input)

console.log('=== TOKENS ===')
for (const token of md.parse(input, {})) {
  const map = token.map ? token.map.join('-') : '-'
  const info = token.info ? ` info=${token.info}` : ''
  const title = token.meta && token.meta.title ? ` title=${JSON.stringify(token.meta.title)}` : ''
  console.log(`${token.type.padEnd(18)} level=${token.level} map=${map}${info}${title}`)
}

console.log('=== HTML ===')
console.log(md.render(input))

