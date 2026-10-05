// Explicit heading-anchor plugin for markdown-it
//
// Assigns a unique `id` to every heading:
//
//   - Heading text is converted to a slug with the documented Unicode rule.
//   - Repeated slugs are disambiguated by occurrence order (`foo`, `foo-2`,
//     `foo-3`, ...); heading references can target a specific occurrence.
//   - Explicit user ids are supported with the trailing `{#my-id}` syntax.
//     They are never rewritten, but every collision (including between two
//     user ids) is detected and reported with both locations.
//   - All bookkeeping lives in the per-parse `env`, so parsing the same
//     document twice always yields the same result; there is no module level
//     counter.
//   - Embedded snippets can pass an explicit `prefix` (option or env) that is
//     prepended to every id of that render scope.
//   - If a heading produces an empty slug, a deterministic `emptySlug`
//     fallback is used (`section` by default).

const STATE_KEY = Symbol('headingAnchorsState')

const EXPLICIT_RE = /\s*\{\s*#([A-Za-z0-9_-]+)\s*\}\s*$/

/**
 * Convert heading text to a slug.
 *
 * Unicode rule (deterministic, locale independent):
 *
 * 1. Normalize with NFKD and strip characters in Unicode category M
 *    (combining marks, `\p{M}`), i.e. remove accents but keep base letters
 *    (`café` -> `cafe`).
 * 2. Lowercase using the default Unicode case mapping (`Å` -> `å`).
 * 3. Keep Unicode letters (`\p{L}`), numbers (`\p{N}`), underscores and
 *    hyphens. CJK / Cyrillic / Greek / ... letters are kept as-is, so
 *    `标题` -> `标题`.
 * 4. Replace every maximal run of separators (Unicode whitespace `\p{Z}`,
 *    line/control characters `\p{C}` and every other punctuation/symbol
 *    `\p{P}`/`\p{S}`, which also covers emoji) with a single ASCII hyphen.
 * 5. Collapse consecutive hyphens and trim leading/trailing hyphens.
 *
 * This function is pure and exported so callers can preview slugs.
 *
 * @param {string} str
 * @returns {string}
 */
function slugify (str) {
  return str
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Read source-map line of a token (1-based; markdown-it stores 0-based).
 *
 * @param {import('markdown-it').Token} token
 * @returns {number | null}
 */
function lineOf (token) {
  return Array.isArray(token.map) ? token.map[0] + 1 : null
}

/**
 * Get the visible text of an inline token, dropping a trailing explicit id.
 *
 * @param {import('markdown-it').Token} inlineToken
 * @returns {{text: string, explicitId: string | null}}
 */
function readHeading (inlineToken) {
  const text = (inlineToken.children || [])
    .filter(tok => tok.type === 'text' || tok.type === 'code_inline')
    .map(tok => tok.content)
    .join('')
  const match = text.match(EXPLICIT_RE)
  if (!match) return { text, explicitId: null }
  return {
    text: text.slice(0, match.index).trimEnd(),
    explicitId: match[1]
  }
}

/**
 * Remove a trailing `{#id}` marker from an inline token's text children.
 *
 * @param {import('markdown-it').Token} inlineToken
 */
function stripExplicitMarker (inlineToken) {
  for (const child of inlineToken.children || []) {
    if (child.type !== 'text') continue
    if (EXPLICIT_RE.test(child.content)) {
      child.content = child.content.replace(EXPLICIT_RE, '')
      break
    }
  }
}

/**
 * @typedef {object} AnchorState
 * @property {string} prefix
 * @property {(str: string) => string} slugify
 * @property {string} emptySlug
 * @property {boolean} resolveReferences
 * @property {Map<string, object>} byId
 * @property {Map<string, object>} reserved
 * @property {Map<string, {count: number, occurrences: object[]}>} byName
 * @property {object[]} anchors
 * @property {string[]} unresolvedReferences
 * @property {object[]} collisions
 */

/**
 * Build fresh per-parse state on `env`. A new state is created for every
 * parse, so reusing an `env` across renders never leaks counters; after a
 * render the latest state is what `getAnchors` reads.
 *
 * @param {import('markdown-it').StateCore} state
 * @returns {AnchorState}
 */
function createState (state) {
  const env = state.env || (state.env = {})
  const options = state.md.headingAnchorsOptions || {}
  const prefix = String(env.headingAnchorsPrefix ?? options.prefix ?? '')
  const s = {
    prefix,
    slugify: options.slugify || slugify,
    emptySlug: options.emptySlug || 'section',
    resolveReferences: options.resolveReferences !== false,
    // ids already assigned during pass 2 -> anchor record
    byId: new Map(),
    // ids claimed by user ids during pass 1 but not yet exposed
    reserved: new Map(),
    // name (slug or raw explicit id) -> { count, occurrences: [anchor] }
    byName: new Map(),
    anchors: [],
    unresolvedReferences: [],
    collisions: []
  }
  env[STATE_KEY] = s
  return s
}

/**
 * @param {object} env
 * @returns {AnchorState | undefined}
 */
function readState (env) {
  return env && env[STATE_KEY]
}

/**
 * @param {{id: string, rawId: string, text: string, slug: string|null,
 *          line: number|null, level: number, explicit: boolean}} anchor
 * @param {AnchorState} s
 */
function register (anchor, s) {
  s.byId.set(anchor.id, anchor)
  s.anchors.push(anchor)
  const name = anchor.explicit ? anchor.rawId : anchor.slug
  let entry = s.byName.get(name)
  if (!entry) {
    entry = { count: 0, occurrences: [] }
    s.byName.set(name, entry)
  }
  entry.count += 1
  entry.occurrences.push(anchor)
}

/**
 * Find the next free id of the form `base`, `base-2`, `base-3`, ...
 *
 * @param {string} base
 * @param {AnchorState} s
 * @returns {string}
 */
function uniqueId (base, s) {
  if (!s.byId.has(base) && !s.reserved.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!s.byId.has(candidate) && !s.reserved.has(candidate)) return candidate
  }
}

/**
 * Heading traversal, assignment and reference rewriting.
 *
 * @param {import('markdown-it').StateCore} state
 */
function headingAnchorsRule (state) {
  const s = createState(state)
  const tokens = state.tokens

  // Pass 1: collect headings in document order and validate user ids.
  // User ids come from either a trailing `{#id}` marker or an `id` attribute
  // already placed on the heading_open token by another rule. They are put in
  // `reserved` so generated ids skip over them, but registered in pass 2
  // together with generated ids, keeping the anchor list in document order.
  const headings = []
  const claimId = (id, record) => {
    const existing = s.reserved.get(id)
    if (existing) {
      const collision = {
        id,
        first: { line: existing.line, level: existing.level, text: existing.text },
        second: { line: record.line, level: record.level, text: record.text },
        explicit: [existing.explicit, record.explicit]
      }
      s.collisions.push(collision)
      const err = new Error(
        `heading-anchors: duplicate id "#${id}" at lines ` +
        `${collision.first.line} and ${collision.second.line}`
      )
      err.code = 'HEADING_ANCHOR_DUPLICATE_ID'
      err.collisions = [collision]
      throw err
    }
    s.reserved.set(id, record)
  }

  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i]
    if (open.type !== 'heading_open') continue
    const inline = tokens[i + 1]

    const line = lineOf(open)
    const level = Number(open.tag.slice(1))
    const { text, explicitId } = readHeading(inline)
    // An id already placed on the token by another rule is a pre-existing
    // user id: it is kept as-is (no prefix, since it was assigned outside
    // this scope) and still participates in collision detection.
    const presetId = open.attrGet('id')
    const heading = {
      open,
      text,
      line,
      level,
      userId: explicitId !== null ? explicitId
        : typeof presetId === 'string' ? presetId : null,
      prefixed: explicitId !== null
    }
    headings.push(heading)

    if (heading.userId === null) continue
    if (explicitId !== null) stripExplicitMarker(inline)

    const finalId = heading.prefixed ? s.prefix + heading.userId : heading.userId
    heading.finalId = finalId
    claimId(finalId, {
      id: finalId,
      rawId: heading.userId,
      text,
      slug: null,
      line,
      level,
      explicit: true
    })
  }

  // Pass 2: assign and register ids in document order.
  for (const h of headings) {
    if (h.userId !== null) {
      register(s.reserved.get(h.finalId), s)
      h.open.attrSet('id', h.finalId)
      continue
    }
    let slug = s.slugify(h.text)
    if (!slug) slug = s.emptySlug
    const id = uniqueId(s.prefix + slug, s)
    register({
      id,
      rawId: s.prefix && id.startsWith(s.prefix)
        ? id.slice(s.prefix.length)
        : id,
      text: h.text,
      slug,
      line: h.line,
      level: h.level,
      explicit: false
    }, s)
    h.open.attrSet('id', id)
  }

  if (!s.resolveReferences) return

  // Pass 3: rewrite heading-reference links `#name` / `#name/2`.
  for (const tok of tokens) {
    if (tok.type === 'inline') rewriteReferences(tok, s)
  }
}

/**
 * @param {import('markdown-it').Token} inlineToken
 * @param {AnchorState} s
 */
function rewriteReferences (inlineToken, s) {
  for (const child of inlineToken.children || []) {
    if (child.type !== 'link_open') continue
    const href = child.attrGet('href')
    if (typeof href !== 'string' || !href.startsWith('#')) continue
    // markdown-it percent-encodes destinations (e.g. "<#Foo Bar>" ->
    // "#Foo%20Bar"); decode for matching, ignoring malformed escapes.
    let raw = href.slice(1)
    try { raw = decodeURIComponent(raw) } catch { /* keep raw */ }
    const target = resolve(raw, s)
    if (target) {
      child.attrSet('href', '#' + target.id)
    } else {
      s.unresolvedReferences.push(href)
    }
  }
}

/**
 * Resolve a heading reference.
 *
 * - `foo`   -> first heading whose name is `foo`
 * - `foo/2` -> second heading whose name is `foo`
 *
 * Names match either a generated slug (`Foo!` -> `foo`) or a raw explicit
 * id. The occurrence number is 1-based document order. Prefixes are applied
 * automatically to the returned href.
 *
 * @param {string} ref
 * @param {AnchorState} s
 * @returns {object | null}
 */
function resolve (ref, s) {
  const m = /^(.+?)\/(\d+)$/.exec(ref)
  let name = ref
  let n = 1
  if (m) {
    name = m[1]
    n = Number(m[2])
  }
  let entry = s.byName.get(name)
  if (!entry) {
    // Allow referencing generated headings by their readable name.
    const slugged = s.slugify(name)
    if (slugged) entry = s.byName.get(slugged)
  }
  if (!entry || n < 1 || n > entry.count) return null
  return entry.occurrences[n - 1]
}

/**
 * Return anchor information collected during the last render with `env`.
 *
 * @param {object} env
 * @returns {{anchors: Array<object>, unresolvedReferences: string[],
 *           collisions: Array<object>}}
 */
function getAnchors (env) {
  const s = readState(env)
  if (!s) {
    return { anchors: [], unresolvedReferences: [], collisions: [] }
  }
  return {
    anchors: s.anchors.map(a => ({ ...a })),
    unresolvedReferences: [...s.unresolvedReferences],
    collisions: [...s.collisions]
  }
}

/**
 * Heading-anchor plugin for markdown-it.
 *
 * Options:
 * - `prefix`            (string)  prepended to every id of this scope.
 * - `emptySlug`         (string, default `section`) fallback for empty
 *                                 slugs.
 * - `slugify`           (function) custom slug function.
 * - `resolveReferences` (boolean, default true) rewrite `#name[/n]` links.
 *
 * Per-render overrides: `env.headingAnchorsPrefix`.
 *
 * @this {import('markdown-it')}
 * @param {object} [options]
 */
export default function headingAnchorsPlugin (md, options = {}) {
  md.headingAnchorsOptions = options
  md.core.ruler.after('inline', 'heading_anchors', headingAnchorsRule)
}

export { slugify, getAnchors, headingAnchorsRule }