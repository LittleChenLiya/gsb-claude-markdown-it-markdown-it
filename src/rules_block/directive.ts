// Block-level directive containers (:::name [title] ... :::), disabled by default

import type StateBlock from './state_block.ts'

// Directive name: ASCII letters, digits, '_' and '-', must start with a letter
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*/

const COLON = 0x3A /* : */
const BACKTICK = 0x60 /* ` */
const TILDE = 0x7E /* ~ */

// Current nesting depth per parse. The same StateBlock instance is reused by
// nested tokenize() calls (blockquote, list, directive itself), so a WeakMap
// keyed by state tracks depth without touching shared parser instances.
const depthMap = new WeakMap<StateBlock, number>()

interface OpenMarker {
  name: string
  title: string
}

// Match ':::name [title]' on the given line. Returns null if not matched.
function matchOpenMarker (state: StateBlock, line: number): OpenMarker | null {
  // indented 4+ spaces relative to current block context -> code block
  if (state.sCount[line] - state.blkIndent >= 4) { return null }

  let pos = state.bMarks[line] + state.tShift[line]
  const max = state.eMarks[line]

  if (pos + 3 > max) { return null }
  if (state.src.charCodeAt(pos) !== COLON ||
      state.src.charCodeAt(pos + 1) !== COLON ||
      state.src.charCodeAt(pos + 2) !== COLON) {
    return null
  }
  pos += 3

  const nameMatch = NAME_RE.exec(state.src.slice(pos, max))
  if (!nameMatch) { return null }

  const name = nameMatch[0]
  pos = state.skipSpaces(pos + name.length)

  // Title is the rest of the line, kept as plain text (escaped on render)
  const title = state.src.slice(pos, max).trim()

  return { name, title }
}

// Match a closing ':::' line (only trailing spaces allowed).
function isCloseMarker (state: StateBlock, line: number): boolean {
  if (state.sCount[line] - state.blkIndent >= 4) { return false }

  let pos = state.bMarks[line] + state.tShift[line]
  const max = state.eMarks[line]

  if (pos + 3 > max) { return false }
  if (state.src.charCodeAt(pos) !== COLON ||
      state.src.charCodeAt(pos + 1) !== COLON ||
      state.src.charCodeAt(pos + 2) !== COLON) {
    return false
  }

  pos = state.skipSpaces(pos + 3)
  return pos >= max
}

// If the line opens a fenced code block, return its marker & run length.
function matchFenceOpen (state: StateBlock, line: number): { marker: number, length: number } | null {
  if (state.sCount[line] - state.blkIndent >= 4) { return null }

  let pos = state.bMarks[line] + state.tShift[line]
  const max = state.eMarks[line]

  const marker = state.src.charCodeAt(pos)
  if (marker !== BACKTICK && marker !== TILDE) { return null }

  const start = pos
  pos = state.skipChars(pos, marker)
  const length = pos - start
  if (length < 3) { return null }

  // backtick fence info string must not contain backticks
  if (marker === BACKTICK && state.src.slice(pos, max).indexOf('`') >= 0) { return null }

  return { marker, length }
}

// Skip a fenced code block that starts at `line`. Returns the first line
// after the fence (or `endLine` if the fence is not closed).
function skipFence (state: StateBlock, line: number, endLine: number, marker: number, length: number): number {
  for (let next = line + 1; next < endLine; next++) {
    if (state.bMarks[next] + state.tShift[next] < state.eMarks[next] &&
        state.sCount[next] < state.blkIndent) {
      // non-empty line with negative indent ends the parent block
      break
    }

    if (state.sCount[next] - state.blkIndent >= 4) { continue }

    let pos = state.bMarks[next] + state.tShift[next]
    const max = state.eMarks[next]

    if (state.src.charCodeAt(pos) !== marker) { continue }

    const start = pos
    pos = state.skipChars(pos, marker)
    if (pos - start < length) { continue }

    pos = state.skipSpaces(pos)
    if (pos < max) { continue }

    return next + 1
  }
  return endLine
}

// Find the line of the closing ':::' matching an opener at `startLine`.
// Single linear pass: nested openers raise the depth, fenced code blocks
// are skipped whole, so ':::' inside code never closes a container.
// Returns -1 when the container is not closed.
function findCloseLine (state: StateBlock, startLine: number, endLine: number): number {
  let nested = 0
  let line = startLine + 1

  while (line < endLine) {
    if (!state.isEmpty(line) && state.sCount[line] < state.blkIndent) {
      // non-empty line with negative indent ends the parent block
      break
    }

    const fence = matchFenceOpen(state, line)
    if (fence) {
      line = skipFence(state, line, endLine, fence.marker, fence.length)
      continue
    }

    if (isCloseMarker(state, line)) {
      if (nested === 0) { return line }
      nested--
    } else if (matchOpenMarker(state, line)) {
      nested++
    }

    line++
  }

  return -1
}

export default function directive (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  const open = matchOpenMarker(state, startLine)
  if (!open) { return false }

  const depth = depthMap.get(state) || 0
  // Depth limit exceeded -> leave the marker as plain text
  if (depth >= state.md.options.directiveMaxDepth) { return false }

  const closeLine = findCloseLine(state, startLine, endLine)
  // Unclosed container -> fall back to plain text, following blocks are
  // parsed normally (nothing is swallowed).
  if (closeLine < 0) { return false }

  // Validation above is read-only, so silent mode never mutates state
  if (silent) { return true }

  const oldParentType = state.parentType
  state.parentType = 'directive'

  let token = state.push('directive_open', 'div', 1)
  token.info = open.name
  token.meta = { title: open.title }
  token.markup = ':::'
  token.map = [startLine, closeLine + 1]

  depthMap.set(state, depth + 1)
  state.md.block.tokenize(state, startLine + 1, closeLine)
  depthMap.set(state, depth)

  token = state.push('directive_close', 'div', -1)
  token.markup = ':::'
  token.map = [startLine, closeLine + 1]

  state.parentType = oldParentType
  state.line = closeLine + 1

  return true
}
