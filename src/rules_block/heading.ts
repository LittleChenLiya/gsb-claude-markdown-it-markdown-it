// heading (#, ##, ...)

import { isSpace, asciiTrim } from '../common/utils.ts'
import type StateBlock from './state_block.ts'

export default function heading (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine]
  let max = state.eMarks[startLine]

  // if it's indented more than 3 spaces, it should be a code block
  if (state.sCount[startLine] - state.blkIndent >= 4) { return false }

  let ch = state.src.charCodeAt(pos)

  if (ch !== 0x23/* # */ || pos >= max) { return false }

  // count heading level
  let level = 1
  ch = state.src.charCodeAt(++pos)
  while (ch === 0x23/* # */ && pos < max && level <= 6) {
    level++
    ch = state.src.charCodeAt(++pos)
  }

  if (level > 6 || (pos < max && !isSpace(ch))) { return false }

  if (silent) { return true }

  // Let's cut tails like '    ###  ' from the end of string

  max = state.skipSpacesBack(max, pos)
  const tmp = state.skipCharsBack(max, 0x23, pos) // #
  if (tmp > pos && isSpace(state.src.charCodeAt(tmp - 1))) {
    max = tmp
  }

  state.line = startLine + 1

  const token_o = state.push('heading_open', `h${level}`, 1)
  token_o.markup = '########'.slice(0, level)
  token_o.map = [startLine, state.line]

  const token_i = state.push('inline', '', 0)
  token_i.content = asciiTrim(state.src.slice(pos, max))
  token_i.map = [startLine, state.line]
  token_i.children = []

  if (state.md.options.sourceRanges) {
    // content is a plain slice of src, so the map is identity + offset,
    // adjusted for trimmed characters
    const lead = token_i.content === '' ? max - pos : state.src.slice(pos, max).indexOf(token_i.content)
    const contentMap: number[] = []
    for (let i = pos + lead; i <= pos + lead + token_i.content.length; i++) {
      contentMap.push(i)
    }
    token_i.contentMap = contentMap
  }

  const token_c = state.push('heading_close', `h${level}`, -1)
  token_c.markup = '########'.slice(0, level)

  return true
}
