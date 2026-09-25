// Shared helpers for the built-in footnote extension

import type { Env, FootnoteDiagnostic, Footnotes } from '../types.ts'

/**
 * Get (and lazily create) the footnote state stored in `env.footnotes`.
 */
export function getFootnotes (env: Env): Footnotes {
  if (!env.footnotes) {
    env.footnotes = { refs: Object.create(null), list: [] }
  }
  return env.footnotes
}

/**
 * Report a footnote problem (missing/duplicate definition) to the caller
 * via `env.footnoteDiagnostics`.
 */
export function reportFootnoteDiagnostic (env: Env | undefined, diagnostic: FootnoteDiagnostic): void {
  if (!env) { return }
  if (!env.footnoteDiagnostics) {
    env.footnoteDiagnostics = []
  }
  env.footnoteDiagnostics.push(diagnostic)
}

/**
 * Prefix for generated HTML ids, derived from the caller-provided
 * `env.footnoteNamespace` (empty when no namespace is set).
 */
export function footnoteIdPrefix (env: Env | undefined): string {
  const namespace = env?.footnoteNamespace
  return typeof namespace === 'string' && namespace !== '' ? namespace + '-' : ''
}
