// GFM table, https://github.github.com/gfm/#tables-extension-

import { isSpace } from '../common/utils.ts'
import type StateBlock from './state_block.ts'
import { SOURCE_MAP, type SourceMap } from '../common/source_map.ts'

// Limit the amount of empty autocompleted cells in a table,
// see https://github.com/markdown-it/markdown-it/issues/1000,
//
// Both pulldown-cmark and commonmark-hs limit the number of cells this way to ~200k.
// We set it to 65k, which can expand user input by a factor of x370
// (256x256 square is 1.8kB expanded into 650kB).
const MAX_AUTOCOMPLETED_CELLS = 0x10000

function getLine (state: StateBlock, line: number) {
  const pos = state.bMarks[line] + state.tShift[line]
  const max = state.eMarks[line]

  return state.src.slice(pos, max)
}

// Offset of the first character of `lineText` (a trimmed `getLine()` result)
// in the document source
function getLineOffset (state: StateBlock, line: number, rawLine: string) {
  const leadTrim = rawLine.length - rawLine.replace(/^\s+/, '').length
  return state.bMarks[line] + state.tShift[line] + leadTrim
}

// Source map for a trimmed table cell, cut out of the raw cell's map
function trimCellMap (cellMap: number[], rawCell: string): SourceMap {
  let start = 0
  while (start < rawCell.length && /\s/.test(rawCell.charAt(start))) start++
  let end = rawCell.length
  while (end > start && /\s/.test(rawCell.charAt(end - 1))) end--
  const map = cellMap.slice(start, end + 1)
  if (map.length === 0) {
    map.push(cellMap.length > 0 ? cellMap[cellMap.length - 1] + 1 : 0)
  }
  return map
}

function escapedSplit (str: string, srcMaps: number[][] | null = null, lineOffset = 0) {
  const result = []
  const max = str.length

  let pos = 0
  let ch = str.charCodeAt(pos)
  let isEscaped = false
  let lastPos = 0
  let current = ''
  let currentMap: number[] = []

  while (pos < max) {
    if (ch === 0x7c/* | */) {
      if (!isEscaped) {
        // pipe separating cells, '|'
        result.push(current + str.substring(lastPos, pos))
        if (srcMaps) {
          for (let i = lastPos; i < pos; i++) currentMap.push(lineOffset + i)
          // sentinel: offset of the separating '|'
          currentMap.push(lineOffset + pos)
          srcMaps.push(currentMap)
          currentMap = []
        }
        current = ''
        lastPos = pos + 1
      } else {
        // escaped pipe, '\|'
        current += str.substring(lastPos, pos - 1)
        if (srcMaps) {
          for (let i = lastPos; i < pos - 1; i++) currentMap.push(lineOffset + i)
        }
        lastPos = pos
      }
    }

    isEscaped = (ch === 0x5c/* \ */)
    pos++

    ch = str.charCodeAt(pos)
  }

  result.push(current + str.substring(lastPos))
  if (srcMaps) {
    for (let i = lastPos; i < max; i++) currentMap.push(lineOffset + i)
    // sentinel: offset just past the end of the line
    currentMap.push(lineOffset + max)
    srcMaps.push(currentMap)
  }

  return result
}

export default function table (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  // should have at least two lines
  if (startLine + 2 > endLine) { return false }

  let nextLine = startLine + 1

  if (state.sCount[nextLine] < state.blkIndent) { return false }

  // if it's indented more than 3 spaces, it should be a code block
  if (state.sCount[nextLine] - state.blkIndent >= 4) { return false }

  // first character of the second line should be '|', '-', ':',
  // and no other characters are allowed but spaces;
  // basically, this is the equivalent of /^[-:|][-:|\s]*$/ regexp

  let pos = state.bMarks[nextLine] + state.tShift[nextLine]
  if (pos >= state.eMarks[nextLine]) { return false }

  const firstCh = state.src.charCodeAt(pos++)
  if (firstCh !== 0x7C/* | */ && firstCh !== 0x2D/* - */ && firstCh !== 0x3A/* : */) { return false }

  if (pos >= state.eMarks[nextLine]) { return false }

  const secondCh = state.src.charCodeAt(pos++)
  if (secondCh !== 0x7C/* | */ && secondCh !== 0x2D/* - */ && secondCh !== 0x3A/* : */ && !isSpace(secondCh)) {
    return false
  }

  // if first character is '-', then second character must not be a space
  // (due to parsing ambiguity with list)
  if (firstCh === 0x2D/* - */ && isSpace(secondCh)) { return false }

  while (pos < state.eMarks[nextLine]) {
    const ch = state.src.charCodeAt(pos)

    if (ch !== 0x7C/* | */ && ch !== 0x2D/* - */ && ch !== 0x3A/* : */ && !isSpace(ch)) { return false }

    pos++
  }

  let lineText = getLine(state, startLine + 1)
  let columns = lineText.split('|')
  const aligns = []
  for (let i = 0; i < columns.length; i++) {
    const t = columns[i].trim()
    if (!t) {
      // allow empty columns before and after table, but not in between columns;
      // e.g. allow ` |---| `, disallow ` ---||--- `
      if (i === 0 || i === columns.length - 1) {
        continue
      } else {
        return false
      }
    }

    if (!/^:?-+:?$/.test(t)) { return false }
    if (t.charCodeAt(t.length - 1) === 0x3A/* : */) {
      aligns.push(t.charCodeAt(0) === 0x3A/* : */ ? 'center' : 'right')
    } else if (t.charCodeAt(0) === 0x3A/* : */) {
      aligns.push('left')
    } else {
      aligns.push('')
    }
  }

  const rawHeaderLine = getLine(state, startLine)
  lineText = rawHeaderLine.trim()
  if (lineText.indexOf('|') === -1) { return false }
  if (state.sCount[startLine] - state.blkIndent >= 4) { return false }
  const trackRanges = state.md.options.sourceRanges
  let headerMaps: number[][] | null = null
  if (trackRanges) {
    headerMaps = []
    columns = escapedSplit(lineText, headerMaps, getLineOffset(state, startLine, rawHeaderLine))
  } else {
    columns = escapedSplit(lineText)
  }
  if (columns.length && columns[0] === '') { columns.shift(); headerMaps?.shift() }
  if (columns.length && columns[columns.length - 1] === '') { columns.pop(); headerMaps?.pop() }

  // header row will define an amount of columns in the entire table,
  // and align row should be exactly the same (the rest of the rows can differ)
  const columnCount = columns.length
  if (columnCount === 0 || columnCount !== aligns.length) { return false }

  if (silent) { return true }

  const oldParentType = state.parentType
  state.parentType = 'table'

  // use 'blockquote' lists for termination because it's
  // the most similar to tables
  const terminatorRules = state.md.block.ruler.getRules('blockquote')

  const token_to = state.push('table_open', 'table', 1)
  const tableLines: [number, number] = [startLine, 0]
  token_to.map = tableLines

  const token_tho = state.push('thead_open', 'thead', 1)
  token_tho.map = [startLine, startLine + 1]

  const token_htro = state.push('tr_open', 'tr', 1)
  token_htro.map = [startLine, startLine + 1]

  for (let i = 0; i < columns.length; i++) {
    const token_ho = state.push('th_open', 'th', 1)
    if (aligns[i]) {
      token_ho.attrs = [['style', `text-align:${aligns[i]}`]]
    }

    const token_il = state.push('inline', '', 0)
    token_il.content = columns[i].trim()
    token_il.children = []
    if (trackRanges) {
      token_ho.setSourceRange(state.bMarks[startLine], state.eMarks[startLine])
      token_il[SOURCE_MAP] = trimCellMap(headerMaps![i], columns[i])
    }

    state.push('th_close', 'th', -1)
  }

  state.push('tr_close', 'tr', -1)
  state.push('thead_close', 'thead', -1)

  let tbodyLines: [number, number] | undefined
  let autocompletedCells = 0

  for (nextLine = startLine + 2; nextLine < endLine; nextLine++) {
    if (state.sCount[nextLine] < state.blkIndent) { break }

    let terminate = false
    for (let i = 0, l = terminatorRules.length; i < l; i++) {
      if (terminatorRules[i](state, nextLine, endLine, true)) {
        terminate = true
        break
      }
    }

    if (terminate) { break }
    const rawLine = getLine(state, nextLine)
    lineText = rawLine.trim()
    if (!lineText) { break }
    if (state.sCount[nextLine] - state.blkIndent >= 4) { break }
    let rowMaps: number[][] | null = null
    if (trackRanges) {
      rowMaps = []
      columns = escapedSplit(lineText, rowMaps, getLineOffset(state, nextLine, rawLine))
    } else {
      columns = escapedSplit(lineText)
    }
    if (columns.length && columns[0] === '') { columns.shift(); rowMaps?.shift() }
    if (columns.length && columns[columns.length - 1] === '') { columns.pop(); rowMaps?.pop() }

    // note: autocomplete count can be negative if user specifies more columns than header,
    // but that does not affect intended use (which is limiting expansion)
    autocompletedCells += columnCount - columns.length
    if (autocompletedCells > MAX_AUTOCOMPLETED_CELLS) { break }

    if (nextLine === startLine + 2) {
      const token_tbo = state.push('tbody_open', 'tbody', 1)
      token_tbo.map = tbodyLines = [startLine + 2, 0]
    }

    const token_tro = state.push('tr_open', 'tr', 1)
    token_tro.map = [nextLine, nextLine + 1]

    for (let i = 0; i < columnCount; i++) {
      const token_tdo = state.push('td_open', 'td', 1)
      if (aligns[i]) {
        token_tdo.attrs = [['style', `text-align:${aligns[i]}`]]
      }

      const token_il = state.push('inline', '', 0)
      token_il.content = columns[i] ? columns[i].trim() : ''
      token_il.children = []
      if (trackRanges) {
        token_tdo.setSourceRange(state.bMarks[nextLine], state.eMarks[nextLine])
        token_il[SOURCE_MAP] = columns[i] ? trimCellMap(rowMaps![i], columns[i]) : [state.eMarks[nextLine]]
      }

      state.push('td_close', 'td', -1)
    }
    state.push('tr_close', 'tr', -1)
  }

  if (tbodyLines) {
    state.push('tbody_close', 'tbody', -1)
    tbodyLines[1] = nextLine
  }

  state.push('table_close', 'table', -1)
  tableLines[1] = nextLine

  state.parentType = oldParentType
  state.line = nextLine
  return true
}
