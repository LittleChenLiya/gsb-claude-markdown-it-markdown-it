import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import markdownit from '../../src/index.ts'

const { formatTable } = markdownit

// Collect trimmed inline contents of every table cell, row by row.
const parseCells = (src) => {
  const tokens = markdownit('zero').enable(['table', 'paragraph']).parse(src, {})
  const rows = []
  let current = null
  for (const token of tokens) {
    if (token.type === 'tr_open') {
      current = []
    } else if (token.type === 'tr_close') {
      rows.push(current)
      current = null
    } else if (token.type === 'inline' && current) {
      current.push(token.content)
    }
  }
  return rows
}

// Table with CJK, combining chars, a code span and an escaped pipe,
// sitting between two paragraphs that must not be touched.
const INPUT = [
  '第一段正文，不要动我。',
  '',
  '| 名称 | 说明 | 数量 |',
  '| :--- | :---: | ---: |',
  '| 苹果 | e\u0301clair 测试 | 12 |',
  '| `code` | a \\| b | |',
  '| 短行 |',
  '',
  '第二段正文，也不要动。'
].join('\n')

const EXPECTED = [
  '第一段正文，不要动我。',
  '',
  '| 名称   | 说明        | 数量 |',
  '| :----- | :---------: | ---: |',
  '| 苹果   | e\u0301clair 测试 | 12   |',
  '| `code` | a \\| b      |      |',
  '| 短行   |             |      |',
  '',
  '第二段正文，也不要动。'
].join('\n')

describe('formatTable', () => {
  it('aligns a table between paragraphs, leaving other text untouched', () => {
    assert.strictEqual(formatTable(INPUT, 4), EXPECTED)
  })

  it('accepts any line number inside the table', () => {
    for (const n of [3, 4, 5, 6, 7]) {
      assert.strictEqual(formatTable(INPUT, n), EXPECTED)
    }
    assert.strictEqual(formatTable(INPUT, [3, 7]), EXPECTED)
  })

  it('keeps cell contents identical before and after formatting', () => {
    assert.deepStrictEqual(parseCells(EXPECTED), parseCells(INPUT))
  })

  it('is idempotent when run twice', () => {
    const once = formatTable(INPUT, 4)
    assert.strictEqual(formatTable(once, 5), once)
  })

  it('supports CRLF line endings', () => {
    const crlf = INPUT.replace(/\n/g, '\r\n')
    const expected = EXPECTED.replace(/\n/g, '\r\n')
    const out = formatTable(crlf, 4)
    assert.strictEqual(out, expected)
    assert.ok(!/(?<!\r)\n/.test(out))
  })

  it('formats tables without explicit alignment', () => {
    const src = ['| a | b |', '|---|---|', '| 1 | 22 |'].join('\n')
    const expected = ['| a   | b   |', '| --- | --- |', '| 1   | 22  |'].join('\n')
    assert.strictEqual(formatTable(src, 1), expected)
  })

  it('pads short rows and keeps empty cells', () => {
    const src = ['| a | b |', '| - | - |', '| 1 |', '|  |  |'].join('\n')
    const expected = ['| a   | b   |', '| --- | --- |', '| 1   |     |', '|     |     |'].join('\n')
    assert.strictEqual(formatTable(src, 3), expected)
  })

  it('rejects rows with more cells than the header', () => {
    const src = ['| a | b |', '| - | - |', '| 1 | 2 | 3 |'].join('\n')
    assert.throws(() => formatTable(src, 3), /has 3 cells, expected at most 2/)
  })

  it('throws when no table contains the given lines', () => {
    assert.throws(() => formatTable(INPUT, 1), /no table at line 1/)
    assert.throws(() => formatTable(INPUT, 9), /no table at line 9/)
    assert.throws(() => formatTable(INPUT, 0), /invalid line number/)
    assert.throws(() => formatTable(INPUT, []), /no line numbers/)
  })

  it('throws when line numbers span more than one table', () => {
    const src = ['| a |', '| - |', '', '| b |', '| - |'].join('\n')
    assert.throws(() => formatTable(src, [1, 4]), /more than one table/)
  })
})
