import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'
import { mergeSourceRanges } from '../../src/token.ts'

function flatten (tokens, out = []) {
  for (const t of tokens) {
    out.push(t)
    if (t.children) flatten(t.children, out)
  }
  return out
}

// Print every token with its source ranges and the original text they
// point to. This is the repeatable demo of the mapping.
function dump (src, tokens) {
  return flatten(tokens).map((t) => {
    const indent = '  '.repeat(Math.max(0, t.level))
    const ranges = t.sourceRanges
      ? t.sourceRanges.map(([s, e]) => '[' + s + ', ' + e + ') ' + JSON.stringify(src.slice(s, e))).join(' + ')
      : 'null'
    return indent + t.type + '  ' + ranges
  }).join('\n')
}

function parse (src, options) {
  const md = markdownit({ ...options, sourceRanges: true })
  const tokens = md.parse(src, {})
  return { md, tokens }
}

function findToken (tokens, type, content) {
  return flatten(tokens).find(t => t.type === type && (content === undefined || t.content === content))
}

describe('sourceRanges option', function () {
  it('entity, emoji and emphasis', function () {
    const src = '甲 &amp; _乙😀_'
    // disable text_join to inspect the entity token before it is merged
    const md = markdownit({ sourceRanges: true })
    md.core.ruler.disable('text_join')
    const tokens = md.parse(src, {})
    console.log('\n' + JSON.stringify(src) + '\n' + dump(src, tokens))

    // the emoji takes two UTF-16 code units
    assert.strictEqual('😀'.length, 2)

    // &amp; range covers the whole entity, not the decoded '&'
    const entity = findToken(tokens, 'text_special')
    assert.deepStrictEqual(entity.sourceRanges, [[2, 7]])
    assert.strictEqual(src.slice(2, 7), '&amp;')

    // emphasis markers are included, parent covers children
    const emOpen = findToken(tokens, 'em_open')
    const emClose = findToken(tokens, 'em_close')
    assert.deepStrictEqual(emOpen.sourceRanges, [[8, 13]])
    assert.deepStrictEqual(emClose.sourceRanges, [[8, 13]])
    assert.strictEqual(src.slice(8, 13), '_乙😀_')

    const inner = findToken(tokens, 'text', '乙😀')
    assert.deepStrictEqual(inner.sourceRanges, [[9, 12]])
    // emoji occupies offsets 10..12 (two UTF-16 units)
    assert.strictEqual(src.slice(10, 12), '😀')
  })

  it('indented blockquote strips indent from ranges', function () {
    const src = '  > 甲 _乙_\n  > 丙'
    const { tokens } = parse(src)
    console.log('\n' + JSON.stringify(src) + '\n' + dump(src, tokens))

    assert.strictEqual(src.indexOf('甲'), 4)
    assert.deepStrictEqual(findToken(tokens, 'text', '甲 ').sourceRanges, [[4, 6]])
    assert.deepStrictEqual(findToken(tokens, 'em_open').sourceRanges, [[6, 9]])
    assert.strictEqual(src.slice(6, 9), '_乙_')
    assert.strictEqual(src.indexOf('丙'), 14)
    assert.deepStrictEqual(findToken(tokens, 'text', '丙').sourceRanges, [[14, 15]])

    // block tokens cover their whole lines
    const bq = findToken(tokens, 'blockquote_open')
    assert.deepStrictEqual(bq.sourceRanges, [[0, src.length]])
    assert.strictEqual(src.slice(bq.sourceRanges[0][0], bq.sourceRanges[0][1]), src)
  })

  it('multiline link', function () {
    const src = '[甲\n乙](http://example.com "t")'
    const { tokens } = parse(src)
    console.log('\n' + JSON.stringify(src) + '\n' + dump(src, tokens))

    const linkOpen = findToken(tokens, 'link_open')
    const linkClose = findToken(tokens, 'link_close')
    assert.deepStrictEqual(linkOpen.sourceRanges, [[0, src.length]])
    assert.deepStrictEqual(linkClose.sourceRanges, [[0, src.length]])

    assert.deepStrictEqual(findToken(tokens, 'text', '甲').sourceRanges, [[1, 2]])
    assert.deepStrictEqual(findToken(tokens, 'text', '乙').sourceRanges, [[3, 4]])
    const softbreak = findToken(tokens, 'softbreak')
    assert.deepStrictEqual(softbreak.sourceRanges, [[2, 3]])
    assert.strictEqual(src.slice(2, 3), '\n')
  })

  it('CRLF counts as two UTF-16 units', function () {
    const src = '甲\r\n_乙_'
    const { tokens } = parse(src)
    console.log('\n' + JSON.stringify(src) + '\n' + dump(src, tokens))

    assert.deepStrictEqual(findToken(tokens, 'text', '甲').sourceRanges, [[0, 1]])
    const softbreak = findToken(tokens, 'softbreak')
    assert.deepStrictEqual(softbreak.sourceRanges, [[1, 3]])
    assert.strictEqual(src.slice(1, 3), '\r\n')
    assert.deepStrictEqual(findToken(tokens, 'em_open').sourceRanges, [[3, 6]])
    assert.deepStrictEqual(findToken(tokens, 'text', '乙').sourceRanges, [[4, 5]])
  })

  it('escaped asterisk and text merge', function () {
    const src = '甲\\*乙'
    // full pipeline: the escape token is merged into surrounding text
    const { tokens } = parse(src)
    console.log('\n' + JSON.stringify(src) + '\n' + dump(src, tokens))

    const text = findToken(tokens, 'text', '甲*乙')
    assert.deepStrictEqual(text.sourceRanges, [[0, 4]])
    assert.strictEqual(src.slice(0, 4), '甲\\*乙')

    // before joining, the escape token covers both backslash and asterisk
    const md = markdownit({ sourceRanges: true })
    md.core.ruler.disable('text_join')
    const rawTokens = md.parse(src, {})
    const escaped = findToken(rawTokens, 'text_special', '*')
    assert.deepStrictEqual(escaped.sourceRanges, [[1, 3]])
    assert.strictEqual(src.slice(1, 3), '\\*')
  })

  it('nested emphasis, code span and image', function () {
    const src = '_甲 *乙*_ `丙` ![丁😀](u)'
    const { tokens } = parse(src)
    console.log('\n' + JSON.stringify(src) + '\n' + dump(src, tokens))

    const ems = flatten(tokens).filter(t => t.type === 'em_open')
    assert.deepStrictEqual(ems[0].sourceRanges, [[0, 7]])
    assert.deepStrictEqual(ems[1].sourceRanges, [[3, 6]])
    // parent covers child
    assert.ok(ems[0].sourceRanges[0][0] <= ems[1].sourceRanges[0][0])
    assert.ok(ems[0].sourceRanges[0][1] >= ems[1].sourceRanges[0][1])

    const code = findToken(tokens, 'code_inline')
    assert.deepStrictEqual(code.sourceRanges, [[8, 11]])
    assert.strictEqual(src.slice(8, 11), '`丙`')

    const image = findToken(tokens, 'image')
    assert.deepStrictEqual(image.sourceRanges, [[12, 21]])
    assert.strictEqual(src.slice(12, 21), '![丁😀](u)')
    const alt = findToken(tokens, 'text', '丁😀')
    assert.deepStrictEqual(alt.sourceRanges, [[14, 17]])
    assert.strictEqual(src.slice(14, 17), '丁😀')
  })

  it('plugin tokens without source get null', function () {
    const md = markdownit({ sourceRanges: true })
    md.core.ruler.push('inject', function (state) {
      const token = new state.Token('text', '', 0)
      token.content = 'injected'
      state.tokens.push(token)
    })
    const tokens = md.parse('甲', {})
    const injected = findToken(tokens, 'text', 'injected')
    assert.strictEqual(injected.sourceRanges, null)
    console.log('\nplugin token without source -> ' + JSON.stringify(injected.sourceRanges))
  })

  it('plugin API: mapRange + addSourceRange', function () {
    const md = markdownit({ sourceRanges: true })
    md.inline.ruler.push('mark', function (state, silent) {
      if (state.src.charCodeAt(state.pos) !== 0x3D /* = */) return false
      if (!silent) {
        const token = state.push('mark', '', 0)
        token.content = 'mark'
        const range = state.mapRange(state.pos, state.pos + 1)
        if (range) token.addSourceRange(range[0], range[1])
      }
      state.pos++
      return true
    })
    const src = '甲 = 乙'
    const tokens = md.parse(src, {})
    const mark = findToken(tokens, 'mark')
    assert.deepStrictEqual(mark.sourceRanges, [[2, 3]])
    assert.strictEqual(src.slice(2, 3), '=')
  })

  it('discontinuous merges produce multiple ordered ranges', function () {
    // unit-level: mergeSourceRanges sorts and coalesces
    assert.deepStrictEqual(mergeSourceRanges([[5, 6]], [[0, 1]]), [[0, 1], [5, 6]])
    assert.deepStrictEqual(mergeSourceRanges([[0, 2]], [[2, 5]]), [[0, 5]])
    assert.deepStrictEqual(mergeSourceRanges(null, [[1, 2]]), [[1, 2]])
    assert.strictEqual(mergeSourceRanges(null, null), null)

    // integration: two plugin-created text tokens with discontinuous
    // ranges are merged by text_join into one token with two ranges
    const md = markdownit({ sourceRanges: true })
    md.core.ruler.before('text_join', 'inject_ranges', function (state) {
      const inline = state.tokens.find(t => t.type === 'inline')
      const t1 = new state.Token('text', '', 0)
      t1.content = 'X'
      t1.addSourceRange(0, 1)
      const t2 = new state.Token('text', '', 0)
      t2.content = 'Y'
      t2.addSourceRange(10, 11)
      inline.children.push(t1, t2)
    })
    const tokens = md.parse('ab', {})
    const texts = flatten(tokens).filter(t => t.type === 'text')
    assert.strictEqual(texts.length, 1)
    assert.strictEqual(texts[0].content, 'abXY')
    assert.deepStrictEqual(texts[0].sourceRanges, [[0, 2], [10, 11]])
  })

  it('option off: identical HTML, no ranges, unchanged map contract', function () {
    const fixtures = [
      '甲 &amp; _乙😀_',
      '  > 甲 _乙_\n  > 丙',
      '[甲\n乙](http://example.com "t")',
      '甲\r\n_乙_',
      '甲\\*乙',
      '_甲 *乙*_ `丙` ![丁😀](u)',
      '# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
      '1. 甲\n   1. 乙\n\n```js\ncode\n```\n'
    ]

    const mdOff = markdownit()
    const mdOn = markdownit({ sourceRanges: true })

    for (const src of fixtures) {
      // HTML output is completely unaffected by the option
      assert.strictEqual(mdOn.render(src), mdOff.render(src))

      const tokensOff = mdOff.parse(src, {})
      const tokensOn = mdOn.parse(src, {})

      // no ranges when disabled
      assert.ok(flatten(tokensOff).every(t => t.sourceRanges === null))

      // line-number map contract is unchanged
      const mapsOff = flatten(tokensOff).map(t => t.map)
      const mapsOn = flatten(tokensOn).map(t => t.map)
      assert.deepStrictEqual(mapsOn, mapsOff)
    }
  })

  it('table cells are mapped', function () {
    const src = '| 甲 | 乙 |\n|---|---|\n| 丙 | 丁 |'
    const { tokens } = parse(src)
    console.log('\n' + JSON.stringify(src) + '\n' + dump(src, tokens))

    assert.deepStrictEqual(findToken(tokens, 'text', '甲').sourceRanges, [[2, 3]])
    assert.deepStrictEqual(findToken(tokens, 'text', '乙').sourceRanges, [[6, 7]])
    assert.deepStrictEqual(findToken(tokens, 'text', '丙').sourceRanges, [[22, 23]])
    assert.deepStrictEqual(findToken(tokens, 'text', '丁').sourceRanges, [[26, 27]])
  })
})
