// Link target rewrite plan.
//
// Collects the real link targets of a parsed document (`link_open` tokens,
// `image` tokens and shared reference definitions from `env.references`),
// asks a caller-supplied mapping function for a new URL per target, and
// applies the result atomically: every target is validated up front and if
// any of them is rejected, nothing is modified.
//
// The rewrite works purely on the token stream:
//
// - code blocks, inline code and plain text are never touched, because only
//   `link_open` / `image` tokens and `env.references` entries carry targets;
// - link titles and the inline markup structure are preserved, only the
//   `href` / `src` attributes are reassigned via `Token#attrSet`;
// - a shared reference definition is rewritten exactly once (it is the single
//   owner of its URL), and every link/image token that references it keeps
//   pointing to the same definition through its `meta.label` association.
//
// No string replacement over the source Markdown is performed at any point.

import type Token from './token.ts'
import type { Env } from './types.ts'

/** Owner of a target carried directly by one token attribute. */
export interface LinkTargetTokenOwner {
  type: 'token'
  /** Index of the block-level token in the token stream. */
  tokenIndex: number
  /** Index inside `tokens[tokenIndex].children`, or `-1` for the token itself. */
  childIndex: number
  /** Attribute holding the target (`href` for links, `src` for images). */
  attr: 'href' | 'src'
}

/** Owner of a target carried by a shared reference definition. */
export interface LinkTargetReferenceOwner {
  type: 'reference'
  /** Normalized label of the definition in `env.references`. */
  label: string
}

export type LinkTargetOwner = LinkTargetTokenOwner | LinkTargetReferenceOwner

export interface LinkTarget {
  /** What carries the target: inline link, image, or reference definition. */
  kind: 'link' | 'image' | 'reference'
  /** Current (normalized) URL. */
  url: string
  /** Where the target lives. */
  owner: LinkTargetOwner
  /**
   * For `kind === 'reference'`: how many link/image tokens in the document
   * resolve to this definition. Those tokens stay associated with the
   * definition and are updated from it when the plan is applied.
   */
  refCount?: number
}

export interface PlannedRewrite extends LinkTarget {
  /** URL returned by the caller's mapping function. */
  newUrl: string
}

export interface RejectedTarget extends LinkTarget {
  /** Why the mapping function refused this target. */
  reason: string
}

export interface LinkRewritePlan {
  /** `true` when every collected target was accepted by the mapper. */
  ok: boolean
  /** `true` after the plan has been applied to the token stream. */
  applied: boolean
  /** Accepted targets with their new URLs (empty when `ok` is `false`). */
  rewrites: PlannedRewrite[]
  /** Targets the mapper refused (empty when `ok` is `true`). */
  rejected: RejectedTarget[]
  /** Token stream and environment this plan belongs to. */
  tokens: Token[]
  env: Env
}

/**
 * Mapping function supplied by the caller. Receives the current URL and the
 * collected target. Return the new URL as a non-empty string to accept the
 * target, or `null` / `undefined` / `false` / an empty string (or throw) to
 * reject it. A single rejection aborts the whole plan.
 */
export type LinkTargetMapper = (url: string, target: LinkTarget) => string | null | undefined | false

function tokenAt (tokens: Token[], tokenIndex: number, childIndex: number): Token {
  const token = tokens[tokenIndex]
  return childIndex < 0 ? token : (token.children as Token[])[childIndex]
}

/**
 * Walk the token stream and collect every real link target.
 *
 * Only `link_open` and `image` tokens (inside `inline` children) plus the
 * shared definitions in `env.references` participate. Reference links and
 * reference images do not own their URL - they are accounted to their
 * definition through `meta.label`, so a shared definition appears exactly
 * once in the result, with `refCount` telling how many tokens use it.
 */
export function collectLinkTargets (tokens: Token[], env: Env): LinkTarget[] {
  const targets: LinkTarget[] = []
  const refUseCount: Record<string, number> = Object.create(null)

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
    const token = tokens[tokenIndex]
    if (token.type !== 'inline' || !token.children) continue

    const children = token.children
    for (let childIndex = 0; childIndex < children.length; childIndex++) {
      const child = children[childIndex]

      let kind: 'link' | 'image'
      let attr: 'href' | 'src'
      if (child.type === 'link_open') {
        kind = 'link'
        attr = 'href'
      } else if (child.type === 'image') {
        kind = 'image'
        attr = 'src'
      } else {
        continue
      }

      const label = child.meta && typeof child.meta.label === 'string'
        ? child.meta.label
        : null
      if (label !== null) {
        // Reference link/image: the definition owns the target.
        refUseCount[label] = (refUseCount[label] || 0) + 1
        continue
      }

      targets.push({
        kind,
        url: String(child.attrGet(attr)),
        owner: { type: 'token', tokenIndex, childIndex, attr }
      })
    }
  }

  if (env.references) {
    for (const label of Object.keys(env.references)) {
      targets.push({
        kind: 'reference',
        url: env.references[label].href,
        owner: { type: 'reference', label },
        refCount: refUseCount[label] || 0
      })
    }
  }

  return targets
}

/**
 * Build a rewrite plan. The mapper is consulted for every collected target
 * before anything is changed; if any target is rejected the returned plan
 * has `ok: false` and applying it is a no-op, so the token stream and
 * `env.references` are guaranteed to stay untouched.
 */
export function planLinkRewrites (tokens: Token[], env: Env, mapUrl: LinkTargetMapper): LinkRewritePlan {
  const targets = collectLinkTargets(tokens, env)
  const rewrites: PlannedRewrite[] = []
  const rejected: RejectedTarget[] = []

  for (const target of targets) {
    let newUrl: string | null | undefined | false
    let reason = ''
    try {
      newUrl = mapUrl(target.url, target)
      if (typeof newUrl !== 'string' || newUrl.length === 0) {
        reason = 'mapper returned no replacement'
        newUrl = false
      }
    } catch (err) {
      reason = `mapper threw: ${(err as Error).message}`
      newUrl = false
    }

    if (newUrl === false || newUrl === null || typeof newUrl === 'undefined') {
      rejected.push({ ...target, reason: reason || 'mapper rejected the target' })
    } else {
      rewrites.push({ ...target, newUrl })
    }
  }

  const ok = rejected.length === 0
  return {
    ok,
    applied: false,
    // Atomicity: when anything was rejected, no rewrite is exposed at all.
    rewrites: ok ? rewrites : [],
    rejected,
    tokens,
    env
  }
}

/**
 * Apply a plan previously created by {@link planLinkRewrites}.
 *
 * Returns `false` without modifying anything when the plan is not `ok` or
 * was already applied. Otherwise each accepted target is reassigned exactly
 * once: token-owned targets via `Token#attrSet` (titles and all other
 * attributes stay as they are), and reference definitions through their
 * single entry in `env.references`, after which every link/image token
 * associated with the definition (via `meta.label`) is re-pointed to the
 * same new URL so all references keep resolving to it.
 */
export function applyLinkRewritePlan (plan: LinkRewritePlan): boolean {
  if (!plan.ok || plan.applied) return false

  const { tokens, env } = plan

  for (const rewrite of plan.rewrites) {
    if (rewrite.owner.type === 'token') {
      const owner = rewrite.owner
      tokenAt(tokens, owner.tokenIndex, owner.childIndex).attrSet(owner.attr, rewrite.newUrl)
    } else {
      const label = rewrite.owner.label
      // The shared definition is rewritten once, here ...
      const refs = env.references as Record<string, { href: string }>
      refs[label].href = rewrite.newUrl
      // ... and every token associated with it follows the definition.
      for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const token = tokens[tokenIndex]
        if (token.type !== 'inline' || !token.children) continue
        const children = token.children
        for (let childIndex = 0; childIndex < children.length; childIndex++) {
          const child = children[childIndex]
          if (child.type !== 'link_open' && child.type !== 'image') continue
          if (!child.meta || child.meta.label !== label) continue
          child.attrSet(child.type === 'link_open' ? 'href' : 'src', rewrite.newUrl)
        }
      }
    }
  }

  plan.applied = true
  return true
}

/**
 * Convenience wrapper: plan the rewrites and apply them when (and only
 * when) every target was accepted. Returns the plan for inspection.
 */
export function rewriteLinkTargets (tokens: Token[], env: Env, mapUrl: LinkTargetMapper): LinkRewritePlan {
  const plan = planLinkRewrites(tokens, env, mapUrl)
  applyLinkRewritePlan(plan)
  return plan
}
