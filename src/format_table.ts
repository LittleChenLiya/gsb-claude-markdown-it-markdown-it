// GFM table source formatter.
//
// Locates a table by line number using markdown-it's own block parser (the
// same "table" rule that renders it), then rewrites only the table lines so
// that the separating pipes and their surrounding spaces line up in a
// monospace editor. Everything else in the document is kept byte-identical,
// and each cell keeps its original inline source (no HTML round-trip).
import MarkdownIt from './markdownit.ts'
/** Alignment of a single table column, derived from the delimiter row. */
type ColumnAlign = '' | 'left' | 'center' | 'right'
export interface FormatTableOptions {
  /**
   * 1-based line number anywhere inside the table to format
   * (header, delimiter or any body row).
   */
  line: number
}
/** Error thrown when the selected table cannot be safely reformatted. */
export class TableFormatError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'TableFormatError'
  }
}
// Combining marks and format controls (e.g. ZWJ) add no visible width.
const ZERO_WIDTH_RE = /[\p{Mn}\p{Me}\p{Cf}]/u
// East Asian fullwidth/wide characters occupy two monospace cells.
// Ranges follow the classic wcwidth() table (V8 regexes have no
// East_Asian_Width property).
function isWide (cp: number): boolean {
  return cp >= 0x1100 && (
    cp <= 0x115F || // Hangul Jamo
    cp === 0x2329 || cp === 0x232A || // LEFT/RIGHT-POINTING ANGLE BRACKET
    (cp >= 0x2E80 && cp <= 0xA4CF && cp !== 0x303F) || // CJK radicals .. Yi syllables
    (cp >= 0xAC00 && cp <= 0xD7A3) || // Hangul syllables
    (cp >= 0xF900 && cp <= 0xFAFF) || // CJK compatibility ideographs
    (cp >= 0xFE30 && cp <= 0xFE6F) || // CJK compatibility forms
    (cp >= 0xFF00 && cp <= 0xFF60) || // fullwidth forms
    (cp >= 0xFFE0 && cp <= 0xFFE6) || // fullwidth signs
    (cp >= 0x1F300 && cp <= 0x1F64F) || // emoji
    (cp >= 0x1F900 && cp <= 0x1F9FF) || // supplemental emoji
    (cp >= 0x20000 && cp <= 0x3FFFD) // CJK extension B and beyond
  )
}
/**
 * Display width of a string in monospace cells:
 * CJK/fullwidth characters count as 2, combining marks as 0.
 */
export function displayWidth (str: string): number {
  let width = 0
  for (const ch of str) {
    if (ZERO_WIDTH_RE.test(ch)) continue
    width += isWide(ch.codePointAt(0)!) ? 2 : 1
  }
  return width
}
// Split a table row on unescaped pipes, keeping the raw source of every cell
// (escape sequences like "\|" are preserved verbatim). Escape semantics
// match escapedSplit() in src/rules_block/table.ts.
function splitRow (line: string): string[] {
  const result: string[] = []
  let isEscaped = false
  let lastPos = 0
  for (let pos = 0; pos < line.length; pos++) {
    const ch = line.charCodeAt(pos)
    if (ch === 0x7c/* | */ && !isEscaped) {
      result.push(line.substring(lastPos, pos))
      lastPos = pos + 1
    }
    isEscaped = ch === 0x5c/* \ */
  }
  result.push(line.substring(lastPos))
  return result
}
// Extract trimmed cell sources from a table row, dropping the empty fragments
// before the leading and after the trailing pipe (same as the block rule).
function parseRow (line: string): string[] {
  const cells = splitRow(line.trim())
  if (cells.length && cells[0] === '') cells.shift()
  if (cells.length && cells[cells.length - 1] === '') cells.pop()
  return cells.map(cell => cell.trim())
}
// Parse the delimiter row into per-column alignments, using the same rules
// as the table block rule.
function parseAligns (line: string): ColumnAlign[] {
  const columns = line.trim().split('|')
  const aligns: ColumnAlign[] = []
  for (let i = 0; i < columns.length; i++) {
    const t = columns[i].trim()
    if (!t) {
      // allow empty columns before and after the table, but not in between
      if (i === 0 || i === columns.length - 1) continue
      throw new TableFormatError('invalid table delimiter row')
    }
    if (!/^:?-+:?$/.test(t)) throw new TableFormatError('invalid table delimiter row')
    if (t.endsWith(':')) {
      aligns.push(t.startsWith(':') ? 'center' : 'right')
    } else if (t.startsWith(':')) {
      aligns.push('left')
    } else {
      aligns.push('')
    }
  }
  return aligns
}
function delimiterCell (align: ColumnAlign, width: number): string {
  switch (align) {
    case 'left': return ':' + '-'.repeat(width - 1)
    case 'right': return '-'.repeat(width - 1) + ':'
    case 'center': return ':' + '-'.repeat(width - 2) + ':'
    default: return '-'.repeat(width)
  }
}
/**
 * Align the pipes of the GFM table containing the given line, leaving the
 * rest of the document untouched.
 *
 * @param src markdown source text
 * @param options see {@link FormatTableOptions}
 * @returns the source with the selected table reformatted
 * @throws {TableFormatError} when there is no table at the given line, when a
 *   body row has more cells than the header, or when the table is nested in a
 *   container (block quote / list) that this formatter does not support.
 */
export function formatTable (src: string, options: FormatTableOptions): string {
  const { line } = options
  if (!Number.isInteger(line) || line < 1) {
    throw new TableFormatError('line must be a positive 1-based line number, got ' + line)
  }
  // Locate the table with markdown-it's own block parser. Line numbers in
  // token maps match src.split('\n') because the core normalize rule only
  // rewrites line endings without adding or removing lines.
  const md = new MarkdownIt()
  const tokens = md.parse(src, {})
  const line0 = line - 1
  const tableToken = tokens.find(t =>
    t.type === 'table_open' && t.map !== null && t.map[0] <= line0 && line0 < t.map[1]
  )
  if (!tableToken || tableToken.map === null) {
    throw new TableFormatError('no table found at line ' + line)
  }
  const [startLine, endLine] = tableToken.map
  const lines = src.split('\n')
  const tableLines = lines.slice(startLine, endLine)
  const rows = tableLines.map(l => l.endsWith('\r') ? l.slice(0, -1) : l)
  if (rows.some(row => /^[ \t]*>/.test(row))) {
    throw new TableFormatError('tables inside block quotes are not supported')
  }
  const indent = /^[ \t]*/.exec(rows[0])![0]
  const aligns = parseAligns(rows[1])
  const columnCount = aligns.length
  const headerCells = parseRow(rows[0])
  const bodyRows = rows.slice(2).map((row, i) => {
    const cells = parseRow(row)
    if (cells.length > columnCount) {
      throw new TableFormatError(
        'row ' + (startLine + 3 + i) + ' has ' + cells.length +
        ' cells, but the header defines ' + columnCount
      )
    }
    return cells
  })
  const widths: number[] = []
  for (let i = 0; i < columnCount; i++) widths[i] = 3
  const consider = (cells: string[]) => {
    for (let i = 0; i < cells.length; i++) {
      widths[i] = Math.max(widths[i], displayWidth(cells[i]))
    }
  }
  consider(headerCells)
  bodyRows.forEach(consider)
  const formatRow = (cells: string[]) => {
    const padded: string[] = []
    for (let i = 0; i < columnCount; i++) {
      const cell = i < cells.length ? cells[i] : ''
      padded.push(cell + ' '.repeat(widths[i] - displayWidth(cell)))
    }
    return indent + '| ' + padded.join(' | ') + ' |'
  }
  const formatted = [
    formatRow(headerCells),
    indent + '| ' + aligns.map((align, i) => delimiterCell(align, widths[i])).join(' | ') + ' |',
    ...bodyRows.map(formatRow)
  ]
  // Restore the original line ending of each replaced line (CRLF-safe).
  const replacement = formatted.map((l, i) => l + (tableLines[i].endsWith('\r') ? '\r' : ''))
  lines.splice(startLine, endLine - startLine, ...replacement)
  return lines.join('\n')
}
