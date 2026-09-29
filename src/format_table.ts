// Format a single GFM table in a markdown source, selected by line number(s).
//
// The table is located with markdown-it's own block parser (the standard
// "table" rule), so detection behaves exactly like normal rendering.
// Only the table lines are rewritten: cell contents keep their original
// inline source (code spans, escaped pipes, emphasis, ...), column
// alignment meaning (left/center/right) is preserved, and all text
// outside the table is returned byte-for-byte unchanged.

import MarkdownIt from './markdownit.ts'

// Minimal parser used only to locate tables and read column alignments.
// Created lazily to keep module evaluation free of side effects
// (this module is also imported by markdownit.ts).
let md: MarkdownIt | null = null

function getParser (): MarkdownIt {
  if (!md) md = new MarkdownIt('zero').enable(['table', 'paragraph'])
  return md
}

// Wide/fullwidth code point ranges (East_Asian_Width W/F),
// spelled out because JS regexps don't support that property.
const RE_WIDE = /[\u1100-\u115F\u2329\u232A\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE66\uFE68-\uFE6B\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{2FFFD}\u{30000}-\u{3FFFD}]/u
const RE_MARK = /\p{M}/u

// Display width of a string: wide/fullwidth chars count as 2,
// combining marks as 0, everything else as 1.
function displayWidth (str: string): number {
  let width = 0
  for (const ch of str) {
    if (RE_MARK.test(ch)) continue
    width += RE_WIDE.test(ch) ? 2 : 1
  }
  return width
}

// Split a table row into raw cell sources on unescaped pipes, using the
// same escaping rules as the "table" block rule ("\|" does not split),
// but keeping the original text (backslashes are not stripped).
function splitRow (line: string): string[] {
  const cells: string[] = []
  let start = 0
  let isEscaped = false

  for (let pos = 0; pos < line.length; pos++) {
    const ch = line.charCodeAt(pos)
    if (ch === 0x7C/* | */ && !isEscaped) {
      cells.push(line.slice(start, pos))
      start = pos + 1
    }
    isEscaped = ch === 0x5C/* \ */
  }
  cells.push(line.slice(start))

  if (cells.length && cells[0] === '') cells.shift()
  if (cells.length && cells[cells.length - 1] === '') cells.pop()

  return cells.map(cell => cell.trim())
}

interface SourceLine {
  text: string
  eol: string
}

// Split source into lines, remembering each line's original terminator
// so unchanged parts of the document survive byte-for-byte (CRLF safe).
function splitSource (src: string): SourceLine[] {
  const parts = src.split(/(\r\n|\r|\n)/)
  const lines: SourceLine[] = []
  for (let i = 0; i < parts.length; i += 2) {
    lines.push({ text: parts[i], eol: parts[i + 1] ?? '' })
  }
  return lines
}

function delimiterCell (align: string, width: number): string {
  switch (align) {
    case 'left': return ':' + '-'.repeat(width - 1)
    case 'right': return '-'.repeat(width - 1) + ':'
    case 'center': return ':' + '-'.repeat(width - 2) + ':'
    default: return '-'.repeat(width)
  }
}

function formatRow (cells: string[], widths: number[]): string {
  return '| ' + cells.map((cell, i) => {
    return cell + ' '.repeat(widths[i] - displayWidth(cell))
  }).join(' | ') + ' |'
}

/**
 * Align the pipe separators of the table containing the given line
 * number(s). Everything outside the table is left untouched.
 *
 * @param src   Markdown source text.
 * @param lines 1-based line number (or numbers) inside the target table.
 * @returns The source with the selected table reformatted in place.
 */
export default function formatTable (src: string, lines: number | number[]): string {
  const wanted = (Array.isArray(lines) ? lines : [lines]).map(n => {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('formatTable: invalid line number ' + n)
    }
    return n - 1
  })

  const tokens = getParser().parse(src, {})

  // Collect tables as 0-based, end-exclusive line ranges + alignments.
  const tables: Array<{ start: number, end: number, aligns: string[] }> = []
  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i]
    if (open.type !== 'table_open' || !open.map) continue
    const aligns: string[] = []
    for (let j = i + 1; j < tokens.length && tokens[j].type !== 'table_close'; j++) {
      const token = tokens[j]
      if (token.type !== 'th_open') continue
      const style = token.attrs?.find(([name]) => name === 'style')
      aligns.push(style ? String(style[1]).replace(/^text-align:/, '') : '')
    }
    tables.push({ start: open.map[0], end: open.map[1], aligns })
  }

  // All requested lines must point into the same table.
  let target
  for (const line of wanted) {
    const found = tables.find(t => line >= t.start && line < t.end)
    if (!found) throw new Error('formatTable: no table at line ' + (line + 1))
    if (target && found !== target) {
      throw new Error('formatTable: line numbers span more than one table')
    }
    target = found
  }
  if (!target) throw new Error('formatTable: no line numbers given')

  const srcLines = splitSource(src)
  const columnCount = target.aligns.length

  // Header + body rows, padding short rows and rejecting extra cells.
  const rowLines = [target.start]
  for (let line = target.start + 2; line < target.end; line++) rowLines.push(line)

  const rows: string[][] = []
  for (const line of rowLines) {
    const cells = splitRow(srcLines[line].text.trim())
    if (cells.length > columnCount) {
      throw new Error('formatTable: row at line ' + (line + 1) +
        ' has ' + cells.length + ' cells, expected at most ' + columnCount)
    }
    while (cells.length < columnCount) cells.push('')
    rows.push(cells)
  }

  // Column widths: at least 3 so the delimiter row stays valid.
  const widths = target.aligns.map((_, i) => {
    return Math.max(3, ...rows.map(row => displayWidth(row[i])))
  })

  srcLines[target.start].text = formatRow(rows[0], widths)
  srcLines[target.start + 1].text = formatRow(
    target.aligns.map((align, i) => delimiterCell(align, widths[i])), widths)
  for (let i = 1; i < rows.length; i++) {
    srcLines[rowLines[i]].text = formatRow(rows[i], widths)
  }

  return srcLines.map(line => line.text + line.eol).join('')
}
