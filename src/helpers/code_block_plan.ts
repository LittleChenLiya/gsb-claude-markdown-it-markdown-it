// Explicit replacement plan for block-level code tokens.
//
// A plan is created from a parsed token stream and captures the targeted
// code blocks together with their original `content` (the baseline).
// Applying the plan rewrites only `token.content` of the selected
// `fence` / `code_block` tokens; `info`, `map` and all unrelated tokens
// (including `code_inline`) are left untouched.
//
// Fence and indented code blocks are selected separately: a `lang`
// selector is matched against the fence info string only (never against
// the code content), and indented blocks carry no language at all.
//
// If any targeted token no longer matches its baseline (e.g. its content
// was edited after the plan was created, or another plan was applied
// first), `apply()` refuses and leaves every token unchanged.

import type Token from '../token.ts'

/**
 * Key of the `token.meta` flag set on tokens whose content was replaced
 * by an applied plan. The default fence renderer checks this flag and
 * skips the `options.highlight` callback for such tokens, because their
 * content is already final.
 */
export const CODE_BLOCK_PLAN_META = 'codeBlockPlan'

/** Block code category: fenced (`fence` token) or indented (`code_block` token). */
export type CodeBlockKind = 'fence' | 'indented'

/**
 * Selection criteria for {@link createCodeBlockPlan}.
 */
export interface CodeBlockSelector {
  /**
   * Language name, matched against the first word of the fence info
   * string. It is never matched against the code content. Indented code
   * blocks have no language, so they never match when `lang` is set.
   */
  lang?: string

  /**
   * Which block category to consider: `'fence'`, `'indented'` or
   * `'both'` (default). Fence and indented blocks are handled separately.
   */
  kind?: CodeBlockKind | 'both'

  /**
   * 0-based index among the matched blocks. When omitted, every matched
   * block is included in the plan.
   */
  index?: number
}

/**
 * One targeted code block: the original token identity (token reference,
 * position in the stream and source map) plus the captured baseline and
 * the replacement content.
 */
export interface CodeBlockPlanEntry {
  /** Targeted token (a `fence` or `code_block` token). */
  readonly token: Token

  /** Position of the token in the parsed token stream. */
  readonly index: number

  /** Copy of `token.map` (source line range) captured at plan creation. */
  readonly map: [number, number] | null

  /** `token.content` captured at plan creation; the baseline `apply()` checks. */
  readonly baseline: string

  /** Content written into the token when the plan is applied. */
  content: string
}

// Extract the language name (first word) from a fence info string.
function fenceLang (info: string): string {
  const trimmed = info.trim()
  if (!trimmed) { return '' }
  return trimmed.split(/(\s+)/g)[0]
}

function sameMap (a: [number, number] | null, b: [number, number] | null): boolean {
  if (a === null || b === null) { return a === b }
  return a[0] === b[0] && a[1] === b[1]
}

/**
 * An explicit, atomic replacement plan over a fixed set of code blocks.
 */
export class CodeBlockReplacementPlan {
  /** Targeted blocks, in token stream order. */
  readonly entries: CodeBlockPlanEntry[]

  /** True after the plan has been applied successfully. */
  applied = false

  constructor (entries: CodeBlockPlanEntry[]) {
    this.entries = entries
  }

  /** Number of targeted blocks. */
  get size (): number {
    return this.entries.length
  }

  /**
   * Check that every targeted token still matches the baseline captured
   * at plan creation (same content, type and source map).
   */
  isBaselineIntact (): boolean {
    for (const entry of this.entries) {
      if (entry.token.content !== entry.baseline) { return false }
      if (!sameMap(entry.token.map, entry.map)) { return false }
    }
    return true
  }

  /**
   * Apply the plan: rewrite `token.content` of every targeted token.
   *
   * Returns `false` and leaves all tokens untouched when the plan was
   * already applied or when the baseline no longer matches (the token
   * stream changed after the plan was created).
   */
  apply (): boolean {
    if (this.applied) { return false }
    if (!this.isBaselineIntact()) { return false }

    for (const entry of this.entries) {
      entry.token.content = entry.content
      entry.token.meta = {
        ...(entry.token.meta ?? {}),
        [CODE_BLOCK_PLAN_META]: { replaced: true }
      }
    }

    this.applied = true
    return true
  }
}

/**
 * Create an explicit replacement plan for the code blocks of a parsed
 * token stream.
 *
 * Only block-level `fence` and `code_block` tokens are considered;
 * `code_inline` tokens and all other tokens are never selected.
 *
 * @param tokens   token stream produced by `md.parse()`
 * @param selector which blocks to target (language / kind / occurrence)
 * @param content  replacement content, or a function computing it per entry
 */
export function createCodeBlockPlan (
  tokens: Token[],
  selector: CodeBlockSelector,
  content: string | ((entry: CodeBlockPlanEntry) => string)
): CodeBlockReplacementPlan {
  const kind = selector.kind ?? 'both'
  const allowFence = kind === 'fence' || kind === 'both'
  const allowIndented = kind === 'indented' || kind === 'both'
  const hasLang = typeof selector.lang === 'string'

  const matched: Array<{ token: Token, index: number }> = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (token.type === 'fence') {
      if (!allowFence) { continue }
      // Language comes from the info string, never from the code content.
      if (hasLang && fenceLang(token.info) !== selector.lang) { continue }
      matched.push({ token, index: i })
    } else if (token.type === 'code_block') {
      if (!allowIndented) { continue }
      // Indented code blocks have no language and never match `lang`.
      if (hasLang) { continue }
      matched.push({ token, index: i })
    }
  }

  const picked = typeof selector.index === 'number'
    ? matched.filter((_, i) => i === selector.index)
    : matched

  const entries: CodeBlockPlanEntry[] = picked.map(({ token, index }) => {
    const entry: CodeBlockPlanEntry = {
      token,
      index,
      map: token.map ? [token.map[0], token.map[1]] : null,
      baseline: token.content,
      content: ''
    }
    entry.content = typeof content === 'function' ? content(entry) : content
    return entry
  })

  return new CodeBlockReplacementPlan(entries)
}
