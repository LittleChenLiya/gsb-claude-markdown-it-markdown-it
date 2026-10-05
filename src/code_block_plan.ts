// Explicit replacement plan for block-level code tokens

import { unescapeAll } from './common/utils.ts'
import type Token from './token.ts'

/**
 * Kind of a block-level code token:
 *
 * - `'fence'` — a fenced code block (`` ``` `` or `~~~ `). Its language is
 *   taken from the info string.
 * - `'code_block'` — an indented code block, which has no language.
 *
 * Fenced and indented blocks are planned and applied separately.
 */
export type CodeBlockKind = 'fence' | 'code_block'

/**
 * Selects which code blocks a {@link CodeBlockPlan} captures.
 *
 * Blocks are identified by their token kind and, for fences, by the language
 * name (the first word of the info string). When several blocks share the
 * same kind and language, `index` selects one of them (zero-based, in source
 * order).
 */
export interface CodeBlockSelector {
  /** Restrict selection to fenced or indented blocks. Defaults to both. */
  kind?: CodeBlockKind

  /**
   * Language name to select (fence blocks only), e.g. `'js'`. The language
   * parameter is never treated as code content and is never modified.
   * Indented code blocks are never matched by a language selector.
   */
  lang?: string

  /**
   * Zero-based index of the block within the group of blocks sharing the same
   * kind and language. When omitted, every block in the group is selected.
   */
  index?: number
}

/**
 * A single planned replacement for one original code block.
 */
export interface CodeBlockReplacement {
  /** Token kind of the original block. */
  kind: CodeBlockKind

  /** Language name of the original fence block; `''` for indented blocks. */
  lang: string

  /** Zero-based index of the block within its kind+language group. */
  index: number

  /** Original content captured when the plan was created. Used as the baseline. */
  baseline: string

  /** New content written to the token when the plan is applied. */
  content: string
}

/**
 * Thrown by {@link CodeBlockPlan.apply} when a plan cannot be applied to the
 * current token stream.
 */
export class CodeBlockPlanError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'CodeBlockPlanError'
  }
}

/**
 * Return the block kind of a token, or `null` for tokens that are not
 * block-level code blocks. Inline code tokens are ignored.
 */
function blockKind (token: Token): CodeBlockKind | null {
  if (token.type === 'fence') { return 'fence' }
  if (token.type === 'code_block') { return 'code_block' }
  return null
}

/**
 * Return the language name of a code token. Fences use the first word of the
 * info string (the language parameter); indented blocks have no language.
 */
function blockLang (token: Token, kind: CodeBlockKind): string {
  if (kind !== 'fence') { return '' }
  const info = token.info ? unescapeAll(token.info).trim() : ''
  if (!info) { return '' }
  return info.split(/(\s+)/g)[0]
}

/**
 * Find the token of a single code block by kind, language and group index.
 */
function findBlock (
  tokens: Token[],
  kind: CodeBlockKind,
  lang: string,
  index: number
): Token | null {
  let counter = 0

  for (const token of tokens) {
    const tokenKind = blockKind(token)
    if (!tokenKind || tokenKind !== kind) { continue }

    const tokenLang = blockLang(token, tokenKind)
    if (tokenLang !== lang) { continue }

    if (counter === index) { return token }
    counter++
  }

  return null
}

/**
 * Build the human-readable description of a plan from its replacements.
 */
function describeReplacements (replacements: CodeBlockReplacement[]): string {
  const count = replacements.length
  const lines = [
    `Code block replacement plan (${count} replacement${count === 1 ? '' : 's'}):`
  ]

  replacements.forEach((replacement, i) => {
    const target = replacement.kind === 'fence'
      ? `fence "${replacement.lang}" #${replacement.index}`
      : `indented code_block #${replacement.index}`

    lines.push(
      `  ${i + 1}. ${target}: ` +
      `${replacement.baseline.length} -> ${replacement.content.length} chars`
    )
  })

  return lines.join('\n')
}

/**
 * Explicit replacement plan for block-level code tokens.
 *
 * A plan is created from a parsed token stream with
 * {@link CodeBlockPlan.fromTokens}. It records the identity (kind, language,
 * index) and the baseline content of every selected code block. Assign new
 * content to {@link CodeBlockReplacement.content} and call
 * {@link CodeBlockPlan.apply} to write it back into the token stream.
 *
 * Applying a plan only touches the `content` property of the matched tokens.
 * The `info` string (language parameters), `map` (source line numbers),
 * `markup`, attributes and every unrelated token are preserved. The plan never
 * renders, so syntax highlighter callbacks are not invoked, and inline code
 * tokens are never modified.
 *
 * The baseline guard makes application fail loudly when the token stream
 * changed since the plan was created: if any selected block is missing or its
 * content no longer matches the recorded baseline, {@link CodeBlockPlan.apply}
 * throws a {@link CodeBlockPlanError} and leaves the token stream untouched.
 */
class CodeBlockPlan {
  /** Planned replacements, one per selected original code block. */
  replacements: CodeBlockReplacement[]

  /**
   * Error thrown when a plan cannot be applied to the current token stream.
   */
  static Error = CodeBlockPlanError

  constructor (replacements: CodeBlockReplacement[]) {
    this.replacements = replacements
  }

  /**
   * Human-readable description of the planned replacements.
   */
  get description (): string {
    return this.describe()
  }

  /**
   * Capture a plan from a parsed token stream, selecting code blocks by
   * language and original block identity.
   *
   * The plan records the current content of each selected block as its
   * baseline. Assign new content to {@link CodeBlockReplacement.content} and
   * call {@link CodeBlockPlan.apply} to write it back.
   */
  static fromTokens (tokens: Token[], selector: CodeBlockSelector = {}): CodeBlockPlan {
    const replacements: CodeBlockReplacement[] = []
    const counters: Record<string, number> = {}

    for (const token of tokens) {
      const kind = blockKind(token)
      if (!kind) { continue }
      if (selector.kind && kind !== selector.kind) { continue }

      const lang = blockLang(token, kind)
      if (selector.lang !== undefined && lang !== selector.lang) { continue }

      const key = `${kind}\0${lang}`
      const index = counters[key] ?? 0
      counters[key] = index + 1

      if (selector.index !== undefined && index !== selector.index) { continue }

      replacements.push({
        kind,
        lang,
        index,
        baseline: token.content,
        content: token.content
      })
    }

    return new CodeBlockPlan(replacements)
  }

  /**
   * Apply the plan to a token stream.
   *
   * Every replacement is first located by kind/language/index and its current
   * content is compared against the recorded baseline. Only when all
   * replacements match are the new contents written; otherwise a
   * {@link CodeBlockPlanError} is thrown and the token stream is left
   * untouched.
   */
  apply (tokens: Token[]): this {
    // Locate every target and verify its baseline before touching anything,
    // so a failed application leaves the token stream untouched.
    const targets: Token[] = []

    for (const replacement of this.replacements) {
      const token = findBlock(tokens, replacement.kind, replacement.lang, replacement.index)

      if (!token) {
        throw new CodeBlockPlanError(
          `Cannot apply code block plan: ${replacement.kind} block` +
          `${replacement.lang ? ` "${replacement.lang}"` : ''} ` +
          `#${replacement.index} not found in token stream`
        )
      }

      if (token.content !== replacement.baseline) {
        throw new CodeBlockPlanError(
          `Cannot apply code block plan: baseline of ${replacement.kind} block` +
          `${replacement.lang ? ` "${replacement.lang}"` : ''} ` +
          `#${replacement.index} changed since the plan was created`
        )
      }

      targets.push(token)
    }

    // All baselines match; write the new contents. Only `content` is touched,
    // info/map/markup/attrs and unrelated tokens stay intact.
    for (let i = 0; i < this.replacements.length; i++) {
      targets[i].content = this.replacements[i].content
    }

    return this
  }

  /**
   * Return a human-readable multi-line description of the planned
   * replacements.
   */
  describe (): string {
    return describeReplacements(this.replacements)
  }
}

export default CodeBlockPlan