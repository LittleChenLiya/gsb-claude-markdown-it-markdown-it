// Process footnote references ([^...])
//
// Runs after `escape` and `backticks` in the inline chain, so escaped
// (`\[^a]`) and code-quoted (`` `[^a]` ``) markers stay untouched.

import { reportFootnoteDiagnostic } from '../common/footnote.ts'
import type StateInline from './state_inline.ts'

export default function footnote_ref (state: StateInline, silent: boolean): boolean {
  const max = state.posMax
  const start = state.pos

  // should be at least 4 chars - "[^x]"
  if (start + 3 > max) { return false }

  if (state.src.charCodeAt(start) !== 0x5B/* [ */) { return false }
  if (state.src.charCodeAt(start + 1) !== 0x5E/* ^ */) { return false }

  let pos = start + 2
  while (pos < max) {
    const ch = state.src.charCodeAt(pos)
    if (ch === 0x20 || ch === 0x0A) { return false }
    if (ch === 0x5D /* ] */) { break }
    pos++
  }

  if (pos === start + 2) { return false } // no empty footnote labels
  if (pos >= max) { return false }
  pos++

  const label = state.src.slice(start + 2, pos - 1)
  const footnotes = state.env?.footnotes
  const id = footnotes ? footnotes.refs[':' + label] : undefined

  if (typeof id === 'undefined') {
    // No definition for this reference: keep the source text visible
    // and report the problem to the caller.
    if (!silent) {
      reportFootnoteDiagnostic(state.env, { type: 'missing-definition', name: label })
      const token = state.push('text', '', 0)
      token.content = state.src.slice(start, pos)
    }
    state.pos = pos
    state.posMax = max
    return true
  }

  if (!silent) {
    // Numbers are assigned in order of first reference
    let footnoteId = id
    if (footnoteId < 0) {
      footnoteId = footnotes!.list.length
      footnotes!.list[footnoteId] = { label, count: 0 }
      footnotes!.refs[':' + label] = footnoteId
    }

    // Reference occurrence index, used to give every reference its own
    // id and matching back-link
    const footnoteSubId = footnotes!.list[footnoteId].count
    footnotes!.list[footnoteId].count++

    const token = state.push('footnote_ref', '', 0)
    token.meta = { id: footnoteId, subId: footnoteSubId, label }
  }

  state.pos = pos
  state.posMax = max
  return true
}
