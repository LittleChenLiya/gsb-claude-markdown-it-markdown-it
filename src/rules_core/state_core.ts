import Token from '../token.ts'
import type MarkdownIt from '../markdownit.ts'
import type { Env } from '../types.ts'

/** Mutable state passed through the core rules chain. */
class StateCore {
  declare src: string
  declare env: Env
  tokens: Token[] = []
  inlineMode = false
  declare md: MarkdownIt

  // Offsets of `\n` characters in the normalized source that came from
  // `\r\n` pairs, sorted ascending. Only collected when the
  // `sourceRanges` option is enabled, to translate ranges back to
  // original input offsets.
  crlfNormIndexes: number[] | null = null

  // re-export Token class to use in core rules
  Token = Token

  constructor (src: string, md: MarkdownIt, env: Env) {
    this.src = src
    this.env = env
    this.md = md // link to parser instance
  }
}

export default StateCore
