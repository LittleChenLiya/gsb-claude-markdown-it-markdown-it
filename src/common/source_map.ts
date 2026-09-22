// Helpers to track how parsed content maps back to the original source.
//
// Everything here is used only when the `sourceRanges` option is enabled.
//
// A "source map" is a `number[]` with `content.length + 1` entries, where
// entry `i` is the offset (in the string the content was cut from) of the
// source character that produced content character `i`. Characters inserted
// by the parser itself (e.g. spaces from partially expanded tabs) point at
// the offset of the character they were expanded from. The last entry is the
// offset just past the last source character.

import type Token from '../token.ts'
import type { SourceRange } from '../token.ts'
import type StateBlock from '../rules_block/state_block.ts'
import { isSpace } from './utils.ts'

/** Maps offsets in a content string to offsets in the string it was cut from. */
export type SourceMap = number[]

/**
 * Internal key used to carry a {@link SourceMap} from block rules (which cut
 * inline content out of the document) to the inline parser.
 */
export const SOURCE_MAP: unique symbol = Symbol('markdown-it-source-map')

function isAsciiTrimmable (c: number) {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d
}

/**
 * Merge overlapping or adjacent ranges, returning a sorted list of disjoint
 * ones. Input is not modified.
 */
export function mergeRanges (ranges: SourceRange[]): SourceRange[] {
  if (ranges.length < 2) { return ranges.slice() }

  const sorted = ranges.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const result: SourceRange[] = []
  let start = sorted[0][0]
  let end = sorted[0][1]

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] <= end) {
      if (sorted[i][1] > end) { end = sorted[i][1] }
    } else {
      result.push([start, end])
      start = sorted[i][0]
      end = sorted[i][1]
    }
  }
  result.push([start, end])
  return result
}

/**
 * Translate ranges in content coordinates through a source map. Ranges that
 * span source gaps (e.g. indentation or `>` markers removed between lines)
 * are split into multiple ordered ranges.
 */
export function mapRanges (map: SourceMap, ranges: SourceRange[]): SourceRange[] {
  const result: SourceRange[] = []

  for (const [from, to] of ranges) {
    let start = map[from]
    let prev = map[from]

    for (let i = from + 1; i < to; i++) {
      const cur = map[i]
      if (cur > prev + 1) {
        result.push([start, prev + 1])
        start = cur
      }
      prev = cur
    }

    result.push([start, to > from ? prev + 1 : map[to]])
  }

  return mergeRanges(result)
}

/** Source map for a plain `src.slice(start, end)`. */
export function buildSliceMap (start: number, end: number): SourceMap {
  const map = new Array(end - start + 1)
  for (let i = 0; i <= end - start; i++) { map[i] = start + i }
  return map
}

/**
 * Source map for the content produced by `StateBlock.getLines()` with the
 * same arguments. Kept separate from `getLines()` to avoid any overhead in
 * the default (non-tracking) code path.
 */
export function buildLinesMap (state: StateBlock, begin: number, end: number, indent: number, keepLastLF: boolean): SourceMap {
  const map: number[] = []

  for (let line = begin; line < end; line++) {
    let lineIndent = 0
    const lineStart = state.bMarks[line]
    let first = lineStart
    let last

    if (line + 1 < end || keepLastLF) {
      last = state.eMarks[line] + 1
    } else {
      last = state.eMarks[line]
    }

    while (first < last && lineIndent < indent) {
      const ch = state.src.charCodeAt(first)

      if (isSpace(ch)) {
        if (ch === 0x09) {
          lineIndent += 4 - (lineIndent + state.bsCount[line]) % 4
        } else {
          lineIndent++
        }
      } else if (first - lineStart < state.tShift[line]) {
        // patched tShift masked characters to look like spaces (blockquotes, list markers)
        lineIndent++
      } else {
        break
      }

      first++
    }

    if (lineIndent > indent) {
      // partially expanded tab: synthetic spaces point at the tab itself
      for (let i = lineIndent - indent; i > 0; i--) { map.push(first - 1) }
    }

    for (let pos = first; pos < last; pos++) { map.push(pos) }
  }

  // sentinel: offset just past the last mapped character
  map.push(map.length > 0 ? map[map.length - 1] + 1 : state.bMarks[begin])

  return map
}

/**
 * Adjust a source map after `asciiTrim()` was applied to the content it was
 * built for. `rawContent` is the content before trimming.
 */
export function trimMap (map: SourceMap, rawContent: string): SourceMap {
  let start = 0
  for (; start < rawContent.length; start++) {
    if (!isAsciiTrimmable(rawContent.charCodeAt(start))) { break }
  }
  let end = rawContent.length
  while (end > start && isAsciiTrimmable(rawContent.charCodeAt(end - 1))) { end-- }
  return map.slice(start, end + 1)
}

/**
 * Assign `sourceRanges` to a finished block token stream. Tokens with a line
 * `map` are seeded with the corresponding full source lines (which include
 * list/blockquote markers and indentation), then ranges are propagated
 * bottom-up so container tokens cover everything between them and their
 * closing tokens.
 *
 * Must be called while the block state's `bMarks`/`eMarks` still describe
 * the original (nested-parsing-unmodified) line offsets, i.e. right after
 * the top-level `tokenize()` call. Ranges are in offsets of the normalized
 * source; CRLF compensation happens later.
 */
export function assignBlockRanges (state: StateBlock): void {
  const tokens = state.tokens
  const { bMarks, eMarks } = state

  for (const token of tokens) {
    if (token.map) {
      token.sourceRanges = [[bMarks[token.map[0]], eMarks[token.map[1] - 1]]]
    }
  }

  const stack: Array<{ token: Token, children: SourceRange[] }> = []

  for (const token of tokens) {
    if (token.nesting > 0) {
      stack.push({ token, children: [] })
      continue
    }

    if (token.nesting < 0) {
      const frame = stack.pop()
      if (!frame) { continue } // unbalanced stream (plugin tokens), ignore

      const ranges: SourceRange[] = []
      if (frame.token.sourceRanges) { ranges.push(...frame.token.sourceRanges) }
      ranges.push(...frame.children)
      if (token.sourceRanges) { ranges.push(...token.sourceRanges) }

      const merged = mergeRanges(ranges)
      if (merged.length > 0) {
        frame.token.sourceRanges = merged
        // the closing tag covers the tail of the element; explicit closing
        // markers (e.g. `>`) sit on the last line of the element, which the
        // opener's seeded range already includes
        // (copy the range, tokens must not share mutable range objects)
        const last = merged[merged.length - 1]
        token.sourceRanges = [[last[0], last[1]]]
        if (stack.length > 0) { stack[stack.length - 1].children.push(...merged) }
      }
      continue
    }

    // leaf token: contribute its range to the enclosing container
    if (stack.length > 0 && token.sourceRanges) {
      stack[stack.length - 1].children.push(...token.sourceRanges)
    }
  }
}

// Number of `\r\n` pairs (given as sorted offsets of the resulting `\n` in
// the normalized source) strictly before `pos`.
function countCrlfBefore (crlf: number[], pos: number): number {
  let lo = 0
  let hi = crlf.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (crlf[mid] < pos) { lo = mid + 1 } else { hi = mid }
  }
  return lo
}

/**
 * Convert token `sourceRanges` from normalized-source offsets (after
 * `\r\n` -> `\n` normalization) to offsets in the original input string.
 * A range boundary next to a removed `\r` is extended to include it, so a
 * token covering a line ending covers the whole `\r\n`.
 */
export function shiftRangesToOriginal (tokens: Token[], crlf: number[]): void {
  for (const token of tokens) {
    if (token.sourceRanges) {
      for (const range of token.sourceRanges) {
        range[0] += countCrlfBefore(crlf, range[0])
        range[1] += countCrlfBefore(crlf, range[1])
      }
    }
    if (token.children) { shiftRangesToOriginal(token.children, crlf) }
  }
}
