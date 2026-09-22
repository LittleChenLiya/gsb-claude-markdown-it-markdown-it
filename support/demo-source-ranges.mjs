// Demo of the `sourceRanges` option: maps tokens back to the original
// markdown source as UTF-16 half-open ranges.
//
// Run with: node support/demo-source-ranges.mjs

import markdownit from '../src/index.ts'

const md = markdownit({ sourceRanges: true })

function showTokens (src, tokens, indent = '') {
  for (const token of tokens) {
    const ranges = token.sourceRanges
      ? token.sourceRanges.map(([a, b]) => `[${a}, ${b})`).join(' ')
      : 'null'
    const slices = token.sourceRanges
      ? token.sourceRanges.map(([a, b]) => JSON.stringify(src.slice(a, b))).join(' + ')
      : '(no source)'
    console.log(`${indent}${token.type.padEnd(18)} ${ranges.padEnd(18)} ${slices}`)
    if (token.children) showTokens(src, token.children, indent + '  ')
  }
}

function demo (title, src, parser = md) {
  console.log(`\n=== ${title} ===`)
  console.log('source:', JSON.stringify(src))
  showTokens(src, parser.parse(src, {}))
}

demo('entity, emphasis, emoji (😀 = 2 UTF-16 units)', '甲 &amp; _乙😀_')
demo('indented blockquote', '  > 引用\n  > 第二行')
demo('multi-line link', '[甲\n乙](http://a.com)')
demo('CRLF + escaped asterisk', '*甲\\*\r\n乙*')
demo('image and code span', '![甲](/i.png) and `code`')
demo('nested emphasis', '**_甲_**')

// Plugins can record source ranges for the tokens they create;
// tokens without recorded source get `null` (never a faked position).
const mdPlugin = markdownit({ sourceRanges: true })
mdPlugin.inline.ruler.push('percent', (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x25 /* % */) return false
  if (!silent) {
    // offsets are local to the inline input and translated automatically
    state.push('percent_tracked', '', 0).setSourceRange(state.pos, state.pos + 1)
    state.push('percent_untracked', '', 0)
  }
  state.pos++
  return true
})
demo('plugin tokens: tracked vs unknown source', 'a % b', mdPlugin)

console.log('\nDone.')
