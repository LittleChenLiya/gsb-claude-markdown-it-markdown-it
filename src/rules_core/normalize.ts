// Normalize input string

import type StateCore from './state_core.ts'

// https://spec.commonmark.org/0.29/#line-ending
const UNNORMALIZED_NEWLINE_RE = /\r\n?/g
const NULL_RE = /\0/g

export default function normalize (state: StateCore): void {
  let str

  if (state.md.options.sourceRanges) {
    // Normalize newlines and NULL characters, remembering the offset of
    // every normalized character in the original source, so token
    // positions can later be mapped back (CRLF counts as 2 UTF-16 units).
    const src = state.src
    const map: number[] = []
    let out = ''

    for (let i = 0; i < src.length; i++) {
      const ch = src.charCodeAt(i)

      if (ch === 0x0D /* \r */ || ch === 0x2028 || ch === 0x2029) {
        out += '\n'
        map.push(i)
        if (ch === 0x0D && src.charCodeAt(i + 1) === 0x0A /* \n */) { i++ }
      } else if (ch === 0x00) {
        out += '\uFFFD'
        map.push(i)
      } else {
        out += src[i]
        map.push(i)
      }
    }
    map.push(src.length)

    state.src = out
    state.srcMap = map
    return
  }

  // Normalize newlines
  str = state.src.replace(UNNORMALIZED_NEWLINE_RE, '\n')

  // Replace NULL characters
  str = str.replace(NULL_RE, '\uFFFD')

  state.src = str
}
