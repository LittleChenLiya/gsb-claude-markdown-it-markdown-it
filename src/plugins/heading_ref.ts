// Optional plugin: heading anchors + [[document#heading]] references.
//
// 1. A core rule collects all headings, derives an anchor id from the
//    visible plain text of each heading and stores it as the `id`
//    attribute of the `heading_open` token.
// 2. An inline rule recognizes `[[document#heading]]` (and `[[#heading]]`
//    for the current document) and emits a placeholder token.
// 3. The core rule then resolves every placeholder into a link, so forward
//    references (to headings that appear later in the source) work.
//    Unresolvable references are kept as literal text and reported through
//    token diagnostics (`token.meta.diagnostics`).
//
// The caller-provided document index is plain data; the plugin never
// performs network access while parsing.

import Token from '../token.ts'
import type MarkdownIt from '../markdownit.ts'
import type StateCore from '../rules_core/state_core.ts'
import type StateInline from '../rules_inline/state_inline.ts'

/** A document entry in the caller-provided index. */
export interface HeadingRefDocument {
  /** Base URL of the document, the heading anchor is appended to it. */
  href: string
  /** Optional list of known anchors; when present, membership is checked. */
  anchors?: string[]
}

/** Options accepted by the heading reference plugin. */
export interface HeadingRefOptions {
  /**
   * Index of external documents, mapping a document title to either a URL
   * string or a {@link HeadingRefDocument} object. Pure data, never fetched.
   */
  documents?: Record<string, string | HeadingRefDocument>
  /** Title of the document being rendered, for `[[Title#heading]]` self links. */
  currentDocument?: string
  /** Custom slug function, defaults to {@link defaultSlugify}. */
  slugify?: (text: string) => string
}

/** Diagnostic left on tokens for references that could not be resolved. */
export interface HeadingRefDiagnostic {
  code: 'unresolved-heading-ref'
  /** Document part of the reference ('' for same-document references). */
  doc: string
  /** Heading part of the reference, as written. */
  heading: string
  /** Raw source of the reference, e.g. `[[Guide#Install]]`. */
  raw: string
  reason: 'unknown-document' | 'missing-anchor'
}

/** Summary of a reference that was successfully resolved to a link. */
export interface HeadingRefResolved {
  doc: string
  heading: string
  href: string
}

/** Per-render report stored in `env.headingRefs`. */
export interface HeadingRefEnv {
  anchors: string[]
  resolved: HeadingRefResolved[]
  diagnostics: HeadingRefDiagnostic[]
}

/**
 * Default slug function: NFKC normalize, lowercase, turn whitespace runs
 * into `-`, drop every other character that is not a letter, number,
 * mark, `_` or `-`. Empty results become `section`.
 */
export function defaultSlugify (text: string): string {
  const slug = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}\p{M}_-]/gu, '')
  return slug === '' ? 'section' : slug
}

// Visible plain text of a heading, used as slug input:
// - text and code_inline tokens contribute their content verbatim
// - images contribute their alternative text (recursively)
// - softbreaks contribute a single space
// - html_inline (tags, inline styles, comments) contributes nothing
function visibleText (tokens: Token[] | null): string {
  let result = ''
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'text':
      case 'code_inline':
        result += token.content
        break
      case 'image':
        result += visibleText(token.children)
        break
      case 'softbreak':
        result += ' '
        break
      case 'html_inline':
        break
      default:
        if (token.children) result += visibleText(token.children)
    }
  }
  return result
}

interface ParsedRef {
  doc: string
  heading: string
  raw: string
}

// Inline rule: recognize [[document#heading]] and [[#heading]].
function headingRefInline (state: StateInline, silent: boolean): boolean {
  const start = state.pos

  if (state.src.charCodeAt(start) !== 0x5B/* [ */) return false
  if (state.src.charCodeAt(start + 1) !== 0x5B/* [ */) return false

  // No nested links
  if (state.linkLevel > 0) return false

  const end = state.src.indexOf(']]', start + 2)
  if (end < 0 || end + 2 > state.posMax) return false

  const inner = state.src.slice(start + 2, end)
  if (inner.includes('[') || inner.includes(']') || inner.includes('\n')) return false

  const hash = inner.indexOf('#')
  if (hash < 0) return false

  const doc = inner.slice(0, hash).trim()
  const heading = inner.slice(hash + 1).trim()
  if (heading === '') return false

  if (!silent) {
    const token = state.push('heading_ref', '', 0)
    const ref: ParsedRef = { doc, heading, raw: state.src.slice(start, end + 2) }
    token.meta = { ...ref }
  }

  state.pos = end + 2
  return true
}

// Core rule: assign heading anchors, then resolve placeholder tokens.
// Runs after the whole document is parsed, so forward references work.
function makeCoreRule (options: HeadingRefOptions) {
  const slugify = options.slugify ?? defaultSlugify
  const documents = options.documents ?? {}
  const currentDocument = options.currentDocument

  return function headingRefResolve (state: StateCore): void {
    // Pass 1: collect headings and assign unique anchors.
    const used = new Set<string>()
    const anchors: string[] = []

    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i]
      if (token.type !== 'heading_open') continue

      const inline = state.tokens[i + 1]
      const text = inline && inline.type === 'inline' ? visibleText(inline.children) : ''

      let slug = slugify(text)
      if (used.has(slug)) {
        // Keep incrementing (-2, -3, ...) until the anchor is unoccupied,
        // which also avoids real anchors that share the same name.
        let counter = 2
        while (used.has(`${slug}-${counter}`)) counter++
        slug = `${slug}-${counter}`
      }
      used.add(slug)
      anchors.push(slug)
      token.attrSet('id', slug)
    }

    const anchorSet = new Set(anchors)

    // Pass 2: resolve heading_ref placeholders into links or diagnostics.
    const resolved: HeadingRefResolved[] = []
    const diagnostics: HeadingRefDiagnostic[] = []

    const resolve = (doc: string, slug: string): { href: string | null, reason?: HeadingRefDiagnostic['reason'] } => {
      if (doc === '' || doc === currentDocument) {
        return anchorSet.has(slug)
          ? { href: `#${slug}` }
          : { href: null, reason: 'missing-anchor' }
      }

      if (!Object.hasOwn(documents, doc)) {
        return { href: null, reason: 'unknown-document' }
      }

      const entry = documents[doc]
      const href = typeof entry === 'string' ? entry : entry.href
      const known = typeof entry === 'string' ? undefined : entry.anchors
      if (known && !known.includes(slug)) {
        return { href: null, reason: 'missing-anchor' }
      }
      return { href: `${href}#${slug}` }
    }

    for (const token of state.tokens) {
      if (token.type !== 'inline' || !token.children) continue

      const children = token.children
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.type !== 'heading_ref') continue

        const meta = child.meta as unknown as ParsedRef
        const slug = slugify(meta.heading)
        const { href, reason } = resolve(meta.doc, slug)

        if (href !== null) {
          const open = new Token('link_open', 'a', 1)
          open.attrSet('href', href)
          open.level = child.level

          const text = new Token('text', '', 0)
          text.content = meta.raw.slice(2, -2)
          text.level = child.level + 1

          const close = new Token('link_close', 'a', -1)
          close.level = child.level

          children.splice(i, 1, open, text, close)
          i += 2
          resolved.push({ doc: meta.doc, heading: meta.heading, href })
        } else {
          const diagnostic: HeadingRefDiagnostic = {
            code: 'unresolved-heading-ref',
            doc: meta.doc,
            heading: meta.heading,
            raw: meta.raw,
            reason: reason ?? 'missing-anchor'
          }
          // Keep the source as literal text and leave the diagnostic
          // on the token for callers to inspect.
          child.type = 'text'
          child.content = meta.raw
          child.meta = { diagnostics: [diagnostic] }
          diagnostics.push(diagnostic)
        }
      }
    }

    const report: HeadingRefEnv = { anchors, resolved, diagnostics }
    state.env.headingRefs = report
  }
}

/**
 * Optional heading reference plugin.
 *
 * @example
 * ```js
 * import MarkdownIt from 'markdown-it'
 * import headingRef from 'markdown-it/src/plugins/heading_ref.ts'
 *
 * const md = new MarkdownIt().use(headingRef, {
 *   documents: { Guide: 'https://example.com/guide' }
 * })
 * ```
 */
export default function headingRefPlugin (md: MarkdownIt, options?: HeadingRefOptions): void {
  const opts = options ?? {}

  md.inline.ruler.push('heading_ref', headingRefInline)
  md.core.ruler.push('heading_ref_resolve', makeCoreRule(opts))

  // Fallback renderer, only used if the core rule is disabled.
  md.renderer.rules.heading_ref = (tokens, idx) => {
    const meta = tokens[idx].meta as unknown as ParsedRef | null
    return md.utils.escapeHtml(meta?.raw ?? '')
  }
}