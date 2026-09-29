import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import MarkdownIt from '../../src/index.ts'

const { formatTable, displayWidth, TableFormatError } = MarkdownIt

// Cell contents of every th/td in document order, as parsed by markdown-it.
function tableCells (src) {
  const tokens = new MarkdownIt().parse(src, {})
  const result = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'th_open' || tokens[i].type === 'td_open') {
      assert.strictEqual(tokens[i + 1].type, 'inline')
      result.push(tokens[i + 1].content)
    }
  }
  return result
}

// text-align styles of every th/td in document order ('' when absent).
function tableAligns (src) {
  const tokens = new MarkdownIt().parse(src, {})
  const result = []
  for (const token of tokens) {
    if (token.type === 'th_open' || token.type === 'td_open') {
      const style = token.attrs && token.attrs.find(([name]) => name === 'style')
      result.push(style ? style[1] : '')
    }
  }
  return result
}

// Display widths of the table lines inside a document.
function tableLineWidths (src) {
  const tokens = new MarkdownIt().parse(src, {})
  const table = tokens.find(t => t.type === 'table_open')
  assert.ok(table, 'expected a table')
  return src.split('\n')
    .slice(table.map[0], table.map[1])
    .map(line => displayWidth(line.replace(/\r$/, '')))
}

const DOC = [
  '前文第一段，保持原样。',
  '',
  '| 名称 | 说明 | 备注 |',
  '|:--|:-:|--:|',
  '| 中文 | é组合 | `a\\|b` |',
  '| short | x |  |',
  '',
  '后文第二段，也要原样保留。',
  ''
].join('\n')

const BEFORE_TABLE = '前文第一段，保持原样。\n\n'
const AFTER_TABLE = '\n后文第二段，也要原样保留。\n'

describe('formatTable', function () {
  it('aligns pipes and keeps surrounding text byte-identical', function () {
    const out = formatTable(DOC, { line: 4 })

    // text before and after the table is untouched
    assert.ok(out.startsWith(BEFORE_TABLE))
    assert.ok(out.endsWith(AFTER_TABLE))

    // all table lines line up in a monospace grid
    const widths = tableLineWidths(out)
    assert.ok(widths.every(w => w === widths[0]), 'table lines should have equal display width')

    // delimiter row keeps left/center/right meaning
    const delimiter = out.split('\n')[3]
    assert.match(delimiter, /^\| :-+ \| :-+: \| -+: \|$/)

    // cell contents and alignments survive the reformat
    assert.deepStrictEqual(tableCells(out), tableCells(DOC))
    assert.deepStrictEqual(tableAligns(out), tableAligns(DOC))
  })

  it('accepts a line number anywhere inside the table', function () {
    const expected = formatTable(DOC, { line: 3 })
    for (const line of [3, 4, 5, 6]) {
      assert.strictEqual(formatTable(DOC, { line }), expected)
    }
  })

  it('is idempotent', function () {
    const once = formatTable(DOC, { line: 3 })
    const twice = formatTable(once, { line: 3 })
    assert.strictEqual(twice, once)
    assert.deepStrictEqual(tableCells(twice), tableCells(DOC))
  })

  it('handles CRLF line endings', function () {
    const crlf = DOC.replace(/\n/g, '\r\n')
    const out = formatTable(crlf, { line: 4 })

    // no lone LF introduced, surrounding text untouched
    assert.strictEqual(out.replace(/\r\n/g, ''), formatTable(DOC, { line: 4 }).replace(/\n/g, ''))
    assert.ok(out.startsWith(BEFORE_TABLE.replace(/\n/g, '\r\n')))
    assert.ok(out.endsWith(AFTER_TABLE.replace(/\n/g, '\r\n')))

    const widths = tableLineWidths(out)
    assert.ok(widths.every(w => w === widths[0]))
    assert.deepStrictEqual(tableCells(out), tableCells(crlf))
  })

  it('pads empty cells and short rows', function () {
    const src = [
      '| a | b |',
      '|---|---|',
      '|  | x |',
      '| only |',
      ''
    ].join('\n')
    const out = formatTable(src, { line: 1 })

    assert.strictEqual(out, [
      '| a    | b   |',
      '| ---- | --- |',
      '|      | x   |',
      '| only |     |',
      ''
    ].join('\n'))

    // short row autocompleted cells parse the same before and after
    assert.deepStrictEqual(tableCells(out), tableCells(src))
    assert.strictEqual(formatTable(out, { line: 1 }), out)
  })

  it('rejects rows with more cells than the header', function () {
    const src = [
      '| a | b |',
      '|---|---|',
      '| 1 | 2 | 3 |',
      ''
    ].join('\n')
    assert.throws(() => formatTable(src, { line: 2 }), TableFormatError)
    assert.throws(() => formatTable(src, { line: 2 }), /header defines/)
  })

  it('preserves left, center and right alignment', function () {
    const src = [
      '| l | c | r | n |',
      '|:--|:-:|--:|---|',
      '| 1 | 2 | 3 | 4 |',
      ''
    ].join('\n')
    const out = formatTable(src, { line: 1 })

    assert.strictEqual(out.split('\n')[1], '| :-- | :-: | --: | --- |')
    assert.deepStrictEqual(tableAligns(out), [
      'text-align:left', 'text-align:center', 'text-align:right', '',
      'text-align:left', 'text-align:center', 'text-align:right', ''
    ])
    assert.strictEqual(formatTable(out, { line: 1 }), out)
  })

  it('keeps escaped pipes and code spans verbatim', function () {
    const src = [
      '| code | plain |',
      '|------|-------|',
      '| `a\\|b` | x\\|y |',
      ''
    ].join('\n')
    const out = formatTable(src, { line: 1 })

    assert.ok(out.includes('| `a\\|b` | x\\|y  |'))
    assert.deepStrictEqual(tableCells(out), tableCells(src))
    assert.strictEqual(formatTable(out, { line: 1 }), out)
  })

  it('throws when there is no table at the given line', function () {
    assert.throws(() => formatTable(DOC, { line: 1 }), TableFormatError)
    assert.throws(() => formatTable(DOC, { line: 1 }), /no table found/)
    assert.throws(() => formatTable(DOC, { line: 0 }), TableFormatError)
  })

  it('handles a table at the end of file without trailing newline', function () {
    const src = '| a |\n|---|\n| b |'
    const out = formatTable(src, { line: 3 })
    assert.strictEqual(out, '| a   |\n| --- |\n| b   |')
  })
})
