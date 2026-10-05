// Explicit heading anchors plugin.
//
// Assigns every heading a unique, deterministic `id` attribute within a single
// parse. Headings with the same visible text get distinct ids (`foo`,
// `foo-2`, `foo-3`, ...) and the numbering is reset on every parse, so a
// second parse yields byte-identical results.
//
// User-provided ids are preserved: either an `id` attribute already present
// on the heading token (set by another plugin) or an explicit `{#id}` marker
// at the end of the heading text. Collisions between two user ids are
// reported with both source positions.
//
// Embedded fragments can carry an explicit `prefix`; generated ids and
// in-document fragment references (`#foo`) are then namespaced with it.

import type MarkdownIt from '../markdownit.ts'
import type StateCore from '../rules_core/state_core.ts'
import type Token from '../token.ts'

/** A heading position in the source document. */
export interface AnchorPosition {
  /** 1-based line number of the heading. */
  line: number
  /** Visible heading text (markdown stripped). */
  text: string
  /** Heading level, 1-6. */
  level: number
}

/** A collision between two explicit (user-provided) anchor ids. */
export interface AnchorConflict {
  /** The duplicated id. */
  id: string
  /** Position of the first heading using this id. */
  first: AnchorPosition
  /** Position of the second heading using this id. */
  second: AnchorPosition
}

/**
 * Per-parse anchor registry. A fresh registry is created for every parse, so
 * ids never leak from one parse into the next.
 */
export interface AnchorRegistry {
  /** All assigned ids, in order of appearance. */
  ids: string[]
  /** Assigned id by heading position. */
  byId: Map<string, AnchorPosition>
  /**
   * Base slug -> ordered list of assigned ids. The list reflects the
   * occurrence order of same-named headings: `slugs.get('foo')` returns
   * e.g. `['foo', 'foo-2']`.
   */
  slugs: Map<string, string[]>
  /** Explicit-id collisions detected during this parse. */
  conflicts: AnchorConflict[]
}

/** Options for the {@link anchors} plugin. */
export interface AnchorsOptions {
  /**
   * Custom slug function. Defaults to the Unicode-aware {@link slugify}.
   */
  slugify?: (text: string) => string

  /**
   * Prefix for embedded fragments. Every assigned id is prefixed and
   * in-document fragment references (`#foo`) are rewritten to `#<prefix>foo`.
   * May be a function receiving the current environment.
   *
   * @defaultValue `''`
   */
  prefix?: string | ((env: Record<string, unknown>) => string)

  /**
   * Parse explicit `{#id}` markers in heading text. When disabled, only `id`
   * attributes already present on the heading token are treated as user ids.
   *
   * @defaultValue `true`
   */
  explicit?: boolean

  /**
   * What to do when two explicit user ids collide. `'throw'` raises an
   * {@link Error} describing both positions; a callback receives the
   * {@link AnchorConflict}.
   *
   * @defaultValue `'throw'`
   */
  onConflict?: 'throw' | ((conflict: AnchorConflict) => void)

  /**
   * Key under which the {@link AnchorRegistry} is exposed on `env`. Set to
   * `false` to disable exposing the registry.
   *
   * @defaultValue `'anchors'`
   */
  envKey?: string | false
}

/**
 * Default slug function.
 *
 * Unicode rule:
 *
 * 1. NFKD-normalize and strip combining marks (`\p{M}`), then NFKC-normalize.
 *    This decomposes accented letters (`é` -> `e`) and folds compatibility
 *    ligatures (`ﬁ` -> `fi`), so diacritics do not survive into the slug.
 * 2. Lowercase (locale-independent).
 * 3. Replace every run of characters that are neither letters (`\p{L}`) nor
 *    numbers (`\p{N}`) with a single `-`. Non-Latin letters such as CJK or
 *    Cyrillic are kept as-is.
 * 4. Trim leading and trailing `-`.
 * 5. If the result is empty, fall back to the deterministic `heading`.
 *
 * @example
 * ```ts
 * slugify('Hello, World!') // 'hello-world'
 * slugify('Café')          // 'cafe'
 * slugify('Привет мир')    // 'привет-мир'
 * slugify('你好，世界')      // '你好-世界'
 * slugify('---')           // 'heading'
 * ```
 */
export function slugify (text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'heading'
}

/** Collect the visible text of inline tokens of the given types. */
function collectText (children: Token[], types: Set<string>): string {
  let text = ''
  for (const tok of children) {
    if (types.has(tok.type)) text += tok.content
  }
  return text
}

const HEADING_TEXT_TYPES = new Set(['text', 'text_special', 'code_inline'])
const MARKER_TEXT_TYPES = new Set(['text', 'text_special'])

const EXPLICIT_MARKER_RE = /\{#([^}\s]+)\}/g

/** Find the last explicit `{#id}` marker in heading text. */
function findExplicitMarker (children: Token[]): string | null {
  const text = collectText(children, MARKER_TEXT_TYPES)
  let found: string | null = null
  let match: RegExpExecArray | null
  EXPLICIT_MARKER_RE.lastIndex = 0
  while ((match = EXPLICIT_MARKER_RE.exec(text)) !== null) {
    found = match[1]
  }
  return found
}

/**
 * Remove `{#...}` markers from text nodes. Handles markers that span
 * multiple text nodes. Trims stray whitespace left by a removed trailing
 * or leading marker.
 */
function stripExplicitMarkers (children: Token[]): void {
  const textNodes: Token[] = []
  let inside = false
  for (const tok of children) {
    if (!MARKER_TEXT_TYPES.has(tok.type)) continue
    textNodes.push(tok)
    let content = tok.content
    if (inside) {
      const close = content.indexOf('}')
      if (close < 0) {
        tok.content = ''
        continue
      }
      content = content.slice(close + 1)
      inside = false
    }
    content = content.replace(/\{#[^{}]*\}/g, '')
    const openIdx = content.lastIndexOf('{#')
    if (openIdx >= 0 && content.indexOf('}', openIdx) < 0) {
      inside = true
      content = content.slice(0, openIdx)
    }
    tok.content = content
  }
  for (let i = 0; i < textNodes.length; i++) {
    if (textNodes[i].content) {
      textNodes[i].content = textNodes[i].content.trimStart()
      break
    }
  }
  for (let i = textNodes.length - 1; i >= 0; i--) {
    if (textNodes[i].content) {
      textNodes[i].content = textNodes[i].content.trimEnd()
      break
    }
  }
}

function formatConflict (conflict: AnchorConflict): string {
  const { id, first, second } = conflict
  return [
    `markdown-it-anchors: duplicate explicit anchor id "${id}"`,
    `  first heading at line ${first.line}: ${JSON.stringify(first.text)}`,
    `  second heading at line ${second.line}: ${JSON.stringify(second.text)}`
  ].join('\n')
}

/**
 * Explicit heading anchors plugin.
 *
 * @example
 * ```js
 * import MarkdownIt from 'markdown-it'
 *
 * const md = new MarkdownIt().use(MarkdownIt.anchors)
 * md.render('# Hello\n# Hello')
 * // '<h1 id="hello">Hello</h1>\n<h1 id="hello-2">Hello</h1>\n'
 * ```
 */
export function anchors (md: MarkdownIt, options: AnchorsOptions = {}): void {
  const slugifyFn = options.slugify ?? slugify
  const explicit = options.explicit ?? true
  const onConflict = options.onConflict ?? 'throw'
  const envKey = options.envKey === undefined ? 'anchors' : options.envKey

  const rule = (state: StateCore): void => {
    // Fresh registry for every parse: no global state, second parse is
    // identical to the first.
    const registry: AnchorRegistry = {
      ids: [],
      byId: new Map(),
      slugs: new Map(),
      conflicts: []
    }

    const prefix = typeof options.prefix === 'function'
      ? options.prefix(state.env as Record<string, unknown>)
      : (options.prefix ?? '')

    const tokens = state.tokens

    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]
      if (open.type !== 'heading_open') continue

      const inline = tokens[i + 1]
      if (!inline || inline.type !== 'inline' || !inline.children) continue

      const level = Number(open.tag.slice(1)) || 1

      // User-provided id: either an existing id attribute or an explicit
      // `{#id}` marker. Markers are stripped before collecting the visible
      // text so the slug and the reported position text stay clean.
      let explicitId: string | null = open.attrGet('id') as string | null
      if (explicit && explicitId == null) {
        explicitId = findExplicitMarker(inline.children)
        if (explicitId != null) stripExplicitMarkers(inline.children)
      } else if (explicit) {
        // Still strip markers so they do not leak into the visible text.
        stripExplicitMarkers(inline.children)
      }

      const text = collectText(inline.children, HEADING_TEXT_TYPES)
      const position: AnchorPosition = {
        line: open.map ? open.map[0] + 1 : 0,
        text,
        level
      }

      const baseSlug = slugifyFn(text)
      let id: string

      if (explicitId != null) {
        id = prefix + explicitId
        if (registry.byId.has(id)) {
          const conflict: AnchorConflict = {
            id,
            first: registry.byId.get(id)!,
            second: position
          }
          registry.conflicts.push(conflict)
          if (onConflict === 'throw') {
            throw new Error(formatConflict(conflict))
          }
          onConflict(conflict)
        }
      } else {
        const base = prefix + baseSlug
        if (!registry.byId.has(base)) {
          id = base
        } else {
          let n = 2
          while (registry.byId.has(`${base}-${n}`)) n++
          id = `${base}-${n}`
        }
      }

      open.attrSet('id', id)
      registry.ids.push(id)
      registry.byId.set(id, position)
      if (!registry.slugs.has(baseSlug)) registry.slugs.set(baseSlug, [])
      registry.slugs.get(baseSlug)!.push(id)
    }

    // Rewrite in-document fragment references so they keep working with a
    // fragment prefix. Without a prefix the references are already correct.
    if (prefix) {
      for (const block of tokens) {
        if (block.type !== 'inline' || !block.children) continue
        for (const tok of block.children) {
          if (tok.type !== 'link_open') continue
          const href = tok.attrGet('href')
          if (typeof href !== 'string' || !href.startsWith('#') || href === '#') continue
          const fragment = href.slice(1)
          if (registry.byId.has(prefix + fragment)) {
            tok.attrSet('href', `#${prefix}${fragment}`)
          }
        }
      }
    }

    if (envKey !== false) {
      ;(state.env as Record<string, unknown>)[envKey] = registry
    }
  }

  // Run after all default core rules so heading children are fully parsed
  // and joined. `push` also keeps working if a previous plugin disabled a
  // default rule such as `text_join`.
  md.core.ruler.push('heading_anchors', rule)
}

export default anchors
