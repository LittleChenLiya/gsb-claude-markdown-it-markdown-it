/**
 * Link target rewrite plan.
 *
 * Collects the *actual* link targets from a parsed token stream (inline
 * links, images and link reference definitions), asks a caller-supplied
 * mapper for a replacement URL of every distinct target, and applies the
 * result in one atomic pass.
 *
 * Scope rules:
 *
 * - Only parsed `link_open` / `image` tokens and `env.references` definitions
 *   are considered. URLs appearing inside code blocks, inline code and plain
 *   text are never touched: they are not link targets, and the token stream is
 *   traversed directly instead of string-replacing the Markdown source.
 * - A shared reference definition is rewritten exactly once. The definition
 *   in `env.references` is updated together with every token that references
 *   it (tokens carry a copy of the definition's href/src), so all references
 *   keep pointing at the same definition and stay associated with it.
 *
 * Atomicity:
 *
 * - The mapper is consulted for *every* collected target before anything is
 *   written. If it rejects a target (returns `null`/`undefined`/`false`) or
 *   throws, the whole plan is aborted and the token stream is left exactly as
 *   it was before the call.
 * - Applying a validated plan only changes the `href`/`src` attributes; link
 *   titles, alt text and the inline markup structure are preserved.
 */

import type Token from './token.ts'
import type { Env, Reference } from './types.ts'

/** Kind of parsed object that owns a collected target. */
export type LinkTargetKind = 'link' | 'image' | 'reference'

/**
 * One collected link target.
 *
 * For inline links and images, `tokens` holds the single `link_open` /
 * `image` token that owns the target. For reference definitions, `label`
 * names the definition and `tokens` lists every token that references it.
 */
export interface LinkTarget {
  /** `'link'` for inline links, `'image'` for images, `'reference'` for definitions. */
  kind: LinkTargetKind
  /** Reference label, only set when `kind === 'reference'`. */
  label: string | null
  /** Original target URL (the actual href/src, normalized by the parser). */
  url: string
  /** Tokens carrying this target (`link_open` / `image` tokens). */
  tokens: Token[]
}

/**
 * Caller-supplied mapping function. Return a new URL string to accept the
 * target, or `null`/`undefined`/`false` to reject the whole plan.
 */
export type LinkRewriteMapper = (url: string, target: LinkTarget) => string | null | undefined | false

/** A link rewrite plan that was fully validated and can be applied. */
export interface LinkRewritePlan {
  /** Collected targets, each accepted by the mapper. */
  targets: LinkTarget[]
  /**
   * Apply the plan. All targets were already accepted at plan creation, so
   * this only writes the new URLs onto the tokens / reference definitions;
   * link titles and inline markup structure are kept intact.
   */
  apply(): void
}

const attrNameFor = (token: Token): 'href' | 'src' =>
  token.type === 'link_open' ? 'href' : 'src'

/**
 * Walk the token stream and collect every actual link target.
 *
 * Reference definitions live in `env.references` keyed by label. Inline
 * `link_open` / `image` tokens that carry the same label are the *uses* of
 * that definition and are attached to the single definition target, so a
 * shared definition is never collected twice. Tokens without a label are
 * inline links / images and own their target directly.
 */
function collectTargets (tokens: Token[], env: Env): LinkTarget[] {
  const targets: LinkTarget[] = []
  const byLabel = new Map<string, LinkTarget>()

  const walk = (list: Token[]): void => {
    for (const token of list) {
      if (token.type === 'link_open' || token.type === 'image') {
        const value = token.attrGet(attrNameFor(token))
        if (typeof value === 'string') {
          const metaLabel = token.meta && typeof token.meta.label === 'string' ? token.meta.label : null
          const owned = metaLabel !== null ? byLabel.get(metaLabel) : undefined
          if (owned) {
            // A reference link/image: the definition owns the target, the
            // token is just one of its uses.
            owned.tokens.push(token)
          } else if (metaLabel !== null) {
            // First use of a reference definition: create the target from the
            // definition's href and attach this token as a use.
            const ref = (env.references as Record<string, Reference> | undefined)?.[metaLabel]
            if (ref) {
              const target: LinkTarget = { kind: 'reference', label: metaLabel, url: ref.href, tokens: [token] }
              byLabel.set(metaLabel, target)
              targets.push(target)
            } else {
              // Parsed documents never hit this; keep the token's own target.
              targets.push({
                kind: token.type === 'link_open' ? 'link' : 'image',
                label: null,
                url: value,
                tokens: [token]
              })
            }
          } else {
            targets.push({
              kind: token.type === 'link_open' ? 'link' : 'image',
              label: null,
              url: value,
              tokens: [token]
            })
          }
        }
      }

      // Inline tokens are nested in `children`; block tokens are a flat list,
      // so a single recursive pass covers the whole stream.
      if (token.children) { walk(token.children) }
    }
  }
  walk(tokens)

  // Definitions that no token references still own a target.
  const refs = env.references as Record<string, Reference> | undefined
  if (refs) {
    for (const [label, ref] of Object.entries(refs)) {
      if (!byLabel.has(label)) {
        targets.push({ kind: 'reference', label, url: ref.href, tokens: [] })
      }
    }
  }

  return targets
}

/**
 * Build a link target rewrite plan.
 *
 * Collects every actual target from `tokens` / `env`, then asks `mapper` for
 * a replacement URL of each target. The mapper is called exactly once per
 * collected target. If it rejects any of them (returns a non-string or
 * throws), this returns `null` without touching a single token.
 *
 * @returns a validated {@link LinkRewritePlan}, or `null` when rejected.
 */
export function planLinkRewrite (tokens: Token[], env: Env, mapper: LinkRewriteMapper): LinkRewritePlan | null {
  const targets = collectTargets(tokens, env)

  // Verification pass: consult the mapper for every target first. Nothing is
  // written until all targets are accepted, so a rejection leaves the token
  // stream in its original state.
  const replacements = new Map<LinkTarget, string>()
  for (const target of targets) {
    const next = mapper(target.url, target)
    if (typeof next !== 'string') {
      return null
    }
    replacements.set(target, next)
  }

  return {
    targets,

    apply (): void {
      for (const target of targets) {
        const next = replacements.get(target) as string

        if (target.kind === 'reference') {
          // Rewrite the shared definition exactly once ...
          const ref = (env.references as Record<string, Reference>)[target.label as string]
          ref.href = next
        }

        // ... and update every token carrying the target (inline links /
        // images, plus all uses of a shared reference definition). Titles,
        // alt text and markup structure are untouched.
        for (const token of target.tokens) {
          token.attrSet(attrNameFor(token), next)
        }
      }
    }
  }
}

export default planLinkRewrite
