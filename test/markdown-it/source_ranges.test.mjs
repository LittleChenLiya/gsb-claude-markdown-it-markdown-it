import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'

const md = markdownit({ sourceRanges: true })

// flatten a token tree (depth-first)
function flatten (tokens, out = []) {
  for (const t of tokens) {
    out.push(t)
    if (t.children) flatten(t.children, out)
  }
  return out
}

// assert token type + source ranges + sliced original source
function assertToken (token, src, type, ranges) {
  assert.strictEqual(token.type, type)
  assert.deepStrictEqual(token.sourceRanges, ranges)
  for (const [start, end] of ranges) {
    assert.ok(start >= 0 && end >= start && end <= src.length,
      `${type}: range [${start}, ${end}) out of bounds`)
  }
}

// assert every token's ranges are covered by its ancestors
function assertCoverage (tokens) {
  const covers = (parent, child) =>
    parent.some(([a, b]) => child.every(([c, d]) => a <= c && d <= b))
  const walk = (list, ancestors) => {
    for (const t of list) {
      for (const anc of ancestors) {
        if (anc.sourceRanges && t.sourceRanges) {
          assert.ok(covers(anc.sourceRanges, t.sourceRanges),
            `${anc.type} ${JSON.stringify(anc.sourceRanges)} does not cover ${t.type} ${JSON.stringify(t.sourceRanges)}`)
        }
      }
      if (t.children) walk(t.children, [...ancestors, t])
    }
  }
  // block-level nesting
  const stack = []
  for (const t of tokens) {
    for (const anc of stack) {
      if (anc.sourceRanges && t.sourceRanges) {
        assert.ok(covers(anc.sourceRanges, t.sourceRanges),
          `${anc.type} does not cover ${t.type}`)
      }
    }
    if (t.nesting > 0) stack.push(t)
    if (t.nesting < 0) stack.pop()
    if (t.children) walk(t.children, [t])
  }
}

describe('sourceRanges option', function () {
  it('entity, emphasis and emoji (甲 &amp; _乙😀_)', function () {
    const src = '甲 &amp; _乙😀_'
    assert.strictEqual(src.length, 13) // 😀 takes 2 UTF-16 code units
    const tokens = md.parse(src, {})
    const all = flatten(tokens)
    assertToken(all[0], src, 'paragraph_open', [[0, 13]])
    assertToken(all[1], src, 'inline', [[0, 13]])
    const children = all[1].children
    // text tokens merged together with the entity, ranges merged as well;
    // the merged range covers the whole `&amp;` entity
    assertToken(children[0], src, 'text', [[0, 8]])
    assert.strictEqual(children[0].content, '甲 & ')
    assert.strictEqual(src.slice(0, 8), '甲 &amp; ')
    assertToken(children[1], src, 'em_open', [[8, 9]])
    assert.strictEqual(src.slice(8, 9), '_')
    assertToken(children[2], src, 'text', [[9, 12]])
    assert.strictEqual(src.slice(9, 12), '乙😀')
    assertToken(children[3], src, 'em_close', [[12, 13]])
    assertToken(all[all.length - 1], src, 'paragraph_close', [[0, 13]])
    assertCoverage(tokens)
  })
  it('entity range covers the whole entity', function () {
    const src = '&amp;'
    const tokens = md.parse(src, {})
    const text = flatten(tokens).find(t => t.type === 'text')
    assertToken(text, src, 'text', [[0, 5]])
    assert.strictEqual(src.slice(0, 5), '&amp;')
  })
  it('indented blockquote accounts for removed indent and markers', function () {
    const src = '  > 引用\n  > 第二行'
    const tokens = md.parse(src, {})
    assertToken(tokens[0], src, 'blockquote_open', [[0, 14]])
    assertToken(tokens[1], src, 'paragraph_open', [[0, 14]])
    const inline = tokens[2]
    // content comes from two disjoint source regions (marker/indent removed)
    assertToken(inline, src, 'inline', [[4, 7], [11, 14]])
    const children = inline.children
    assertToken(children[0], src, 'text', [[4, 6]])
    assert.strictEqual(src.slice(4, 6), '引用')
    assertToken(children[1], src, 'softbreak', [[6, 7]])
    assertToken(children[2], src, 'text', [[11, 14]])
    assert.strictEqual(src.slice(11, 14), '第二行')
    assertToken(tokens[tokens.length - 1], src, 'blockquote_close', [[0, 14]])
    assertCoverage(tokens)
  })
  it('multi-line link', function () {
    const src = '[甲\n乙](http://a.com)'
    const tokens = md.parse(src, {})
    const children = tokens[1].children
    assertToken(children[0], src, 'link_open', [[0, 1]])
    assert.strictEqual(src.slice(0, 1), '[')
    assertToken(children[1], src, 'text', [[1, 2]])
    assertToken(children[2], src, 'softbreak', [[2, 3]])
    assertToken(children[3], src, 'text', [[3, 4]])
    assertToken(children[4], src, 'link_close', [[4, 19]])
    assert.strictEqual(src.slice(4, 19), '](http://a.com)')
    assertCoverage(tokens)
  })
  it('CRLF normalization and escaped asterisk', function () {
    const src = '*甲\\*\r\n乙*'
    const tokens = md.parse(src, {})
    const children = tokens[1].children
    assertToken(children[0], src, 'em_open', [[0, 1]])
    // escaped star: range covers the backslash and the star
    assertToken(children[1], src, 'text', [[1, 4]])
    assert.strictEqual(src.slice(1, 4), '甲\\*')
    // softbreak covers the whole CRLF, not just the normalized LF
    assertToken(children[2], src, 'softbreak', [[4, 6]])
    assert.strictEqual(src.slice(4, 6), '\r\n')
    assertToken(children[3], src, 'text', [[6, 7]])
    assert.strictEqual(src.slice(6, 7), '乙')
    assertToken(children[4], src, 'em_close', [[7, 8]])
    assert.strictEqual(src.slice(7, 8), '*')
    assertCoverage(tokens)
  })
  it('image, code span and nested emphasis', function () {
    const src = '![甲](/i.png)'
    const image = md.parse(src, {})[1].children[0]
    assertToken(image, src, 'image', [[0, 12]])
    assert.strictEqual(src.slice(0, 12), src)
    assertToken(image.children[0], src, 'text', [[2, 3]])
    assert.strictEqual(src.slice(2, 3), '甲')

    const src2 = '`code`'
    const code = md.parse(src2, {})[1].children[0]
    assertToken(code, src2, 'code_inline', [[0, 6]])

    const src3 = '**_甲_**'
    const children = md.parse(src3, {})[1].children
    assertToken(children[1], src3, 'strong_open', [[0, 2]])
    assertToken(children[2], src3, 'em_open', [[2, 3]])
    assertToken(children[3], src3, 'text', [[3, 4]])
    assertToken(children[4], src3, 'em_close', [[4, 5]])
    assertToken(children[5], src3, 'strong_close', [[5, 7]])
  })
  it('plugin tokens without source info get null', function () {
    const mdPlugin = markdownit({ sourceRanges: true })
    mdPlugin.core.ruler.push('test_block', (state) => {
      const token = new state.Token('test_block', '', 0)
      state.tokens.push(token)
    })
    mdPlugin.inline.ruler.push('test_inline', (state, silent) => {
      if (state.src.charCodeAt(state.pos) !== 0x25 /* % */) return false
      if (!silent) { state.push('test_inline', '', 0) }
      state.pos++
      return true
    })
    const tokens = mdPlugin.parse('a % b', {})
    assert.strictEqual(tokens[tokens.length - 1].sourceRanges, null)
    const inline = tokens.find(t => t.type === 'inline')
    assert.strictEqual(inline.children[1].type, 'test_inline')
    assert.strictEqual(inline.children[1].sourceRanges, null)
  })
  it('plugins can record ranges with setSourceRange', function () {
    const mdPlugin = markdownit({ sourceRanges: true })
    mdPlugin.inline.ruler.push('test_inline', (state, silent) => {
      if (state.src.charCodeAt(state.pos) !== 0x25 /* % */) return false
      if (!silent) {
        // offsets are local to the inline input, translated automatically
        state.push('test_inline', '', 0).setSourceRange(state.pos, state.pos + 1)
      }
      state.pos++
      return true
    })
    const src = 'xy % zw'
    const inline = mdPlugin.parse(src, {}).find(t => t.type === 'inline')
    assertToken(inline.children[1], src, 'test_inline', [[3, 4]])
    assert.strictEqual(src.slice(3, 4), '%')
  })
  it('disabled by default: no ranges, identical HTML', function () {
    const mdOff = markdownit()
    const fixtures = [
      '甲 &amp; _乙😀_',
      '  > 引用\n  > 第二行',
      '[甲\n乙](http://a.com)',
      '*甲\\*\r\n乙*',
      '![甲](/i.png)',
      '`code`',
      '**_甲_**'
    ]
    for (const src of fixtures) {
      for (const token of flatten(mdOff.parse(src, {}))) {
        assert.strictEqual(token.sourceRanges, null)
      }
      // enabling the option must not change the rendered HTML
      assert.strictEqual(md.render(src), mdOff.render(src))
    }
  })
})
