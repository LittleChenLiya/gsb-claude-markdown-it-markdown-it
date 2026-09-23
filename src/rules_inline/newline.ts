// Proceess '\n'

import { isSpace } from '../common/utils.ts'
import type StateInline from './state_inline.ts'

export default function newline (state: StateInline, silent: boolean): boolean {
  const start = state.pos
  let pos = state.pos

  if (state.src.charCodeAt(pos) !== 0x0A/* \n */) { return false }

  const pmax = state.pending.length - 1
  const max = state.posMax
  let token

  // '  \n' -> hardbreak
  // Lookup in pending chars is bad practice! Don't copy to other rules!
  // Pending string is stored in concat mode, indexed lookups will cause
  // convertion to flat mode.
  if (!silent) {
    if (pmax >= 0 && state.pending.charCodeAt(pmax) === 0x20) {
      if (pmax >= 1 && state.pending.charCodeAt(pmax - 1) === 0x20) {
        // Find whitespaces tail of pending chars.
        let ws = pmax - 1
        while (ws >= 1 && state.pending.charCodeAt(ws - 1) === 0x20) ws--

        state.pending = state.pending.slice(0, ws)
        token = state.push('hardbreak', 'br', 0)
      } else {
        state.pending = state.pending.slice(0, -1)
        token = state.push('softbreak', 'br', 0)
      }
    } else {
      token = state.push('softbreak', 'br', 0)
    }
  }

  pos++

  // skip heading spaces for next line
  while (pos < max && isSpace(state.src.charCodeAt(pos))) { pos++ }

  state.pos = pos
  if (token) { state.setSourceRange(token, start, pos) }
  return true
}
