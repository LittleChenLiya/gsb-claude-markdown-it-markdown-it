// Process footnote block definition `[^name]: content`
//
// Definitions are collected during the block phase (before any inline
// parsing happens), so references work both before and after the definition.

import { isSpace } from '../common/utils.ts'
import { getFootnotes, reportFootnoteDiagnostic } from '../common/footnote.ts'
import type StateBlock from './state_block.ts'

// Consume the definition body (the remainder of the first line plus all
// indented continuation lines) and tokenize it with the block parser.
//
// The first line is re-sliced so its content starts right after `[^name]:`,
// then the whole range is parsed with the regular block rules, giving
// multi-paragraph footnotes, nested lists, etc. for free.
function tokenizeDefinition (state: StateBlock, startLine: number, endLine: number, pos: number): void {
  const max = state.eMarks[startLine]

  const oldBMark = state.bMarks[startLine]
  const oldTShift = state.tShift[startLine]
  const oldSCount = state.sCount[startLine]
  const oldParentType = state.parentType

  const posAfterColon = pos
  const initial = state.sCount[startLine] + pos - (state.bMarks[startLine] + state.tShift[startLine])
  let offset = initial

  while (pos < max) {
    const ch = state.src.charCodeAt(pos)

    if (isSpace(ch)) {
      if (ch === 0x09) {
        offset += 4 - offset % 4
      } else {
        offset++
      }
    } else {
      break
    }

    pos++
  }

  state.tShift[startLine] = pos - posAfterColon
  state.sCount[startLine] = offset - initial

  state.bMarks[startLine] = posAfterColon
  state.blkIndent += 4
  state.parentType = 'footnote'

  if (state.sCount[startLine] < state.blkIndent) {
    state.sCount[startLine] += state.blkIndent
  }

  state.md.block.tokenize(state, startLine, endLine)

  state.parentType = oldParentType
  state.blkIndent -= 4
  state.tShift[startLine] = oldTShift
  state.sCount[startLine] = oldSCount
  state.bMarks[startLine] = oldBMark
}

export default function footnote_def (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine]
  const max = state.eMarks[startLine]

  // line should be at least 5 chars - "[^x]:"
  if (start + 4 > max) { return false }

  if (state.src.charCodeAt(start) !== 0x5B/* [ */) { return false }
  if (state.src.charCodeAt(start + 1) !== 0x5E/* ^ */) { return false }

  let pos = start + 2
  while (pos < max) {
    const ch = state.src.charCodeAt(pos)
    if (ch === 0x20) { return false }
    if (ch === 0x5D /* ] */) { break }
    pos++
  }

  if (pos === start + 2) { return false } // no empty footnote labels
  if (pos + 1 >= max || state.src.charCodeAt(pos + 1) !== 0x3A /* : */) { return false }
  if (silent) { return true }

  const label = state.src.slice(start + 2, pos)
  pos += 2 // skip "]:"

  const footnotes = getFootnotes(state.env)
  const key = ':' + label

  if (typeof footnotes.refs[key] !== 'undefined') {
    // Duplicate definition: the first one stays in effect. Report this one
    // and discard its tokens, so its content can't create phantom references.
    reportFootnoteDiagnostic(state.env, { type: 'duplicate-definition', name: label })

    const savedTokens = state.tokens
    const savedLevel = state.level
    state.tokens = []
    tokenizeDefinition(state, startLine, endLine, pos)
    state.tokens = savedTokens
    state.level = savedLevel
    return true
  }

  footnotes.refs[key] = -1

  // Mark the place the definition took in the token stream. The content
  // tokens between the markers are moved to the end of the document by
  // the `footnote_tail` core rule (and dropped entirely if never referenced).
  const openToken = state.push('footnote_reference_open', '', 1)
  openToken.meta = { label }

  tokenizeDefinition(state, startLine, endLine, pos)

  openToken.map = [startLine, state.line]

  const closeToken = state.push('footnote_reference_close', '', -1)
  closeToken.meta = { label }

  return true
}
