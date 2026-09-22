// Normalize input string

import type StateCore from './state_core.ts'

// https://spec.commonmark.org/0.29/#line-ending
const UNNORMALIZED_NEWLINE_RE = /\r\n?/g
const NULL_RE = /\0/g

export default function normalize (state: StateCore): void {
  let str

  // Normalize newlines
  if (state.md.options.sourceRanges) {
    // Track positions of removed `\r` characters, so source ranges can
    // be translated back to offsets in the original input.
    const crlf: number[] = []
    str = state.src.replace(UNNORMALIZED_NEWLINE_RE, (match, offset: number) => {
      if (match.length === 2) { crlf.push(offset - crlf.length) }
      return '\n'
    })
    state.crlfNormIndexes = crlf
  } else {
    str = state.src.replace(UNNORMALIZED_NEWLINE_RE, '\n')
  }

  // Replace NULL characters
  str = str.replace(NULL_RE, '\uFFFD')

  state.src = str
}
