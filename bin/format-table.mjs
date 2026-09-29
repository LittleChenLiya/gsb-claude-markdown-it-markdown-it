#!/usr/bin/env node
/* eslint no-console:0 */
// Align the pipes of a GFM table selected by line number, leaving the rest
// of the document untouched.
import fs from 'node:fs'
import argparse from 'argparse'
import markdownit from 'markdown-it'
const cli = new argparse.ArgumentParser({
  prog: 'markdown-it-format-table',
  add_help: true,
  description: 'Align the pipes of the GFM table at the given 1-based line number.'
})
cli.add_argument('-l', '--line', {
  help: '1-based line number anywhere inside the table (header, delimiter or body row)',
  required: true
})
cli.add_argument('file', {
  help: 'File to read (stdin when omitted or "-")',
  nargs: '?',
  default: '-'
})
cli.add_argument('-o', '--output', {
  help: 'File to write (stdout when omitted or "-")',
  default: '-'
})
const options = cli.parse_args()
const line = Number(options.line)
if (!Number.isInteger(line) || line < 1) {
  console.error('Invalid --line: ' + options.line)
  process.exit(2)
}
function readFile (filename, encoding, callback) {
  if (filename === '-') {
    const chunks = []
    process.stdin.on('data', function (chunk) { chunks.push(chunk) })
    process.stdin.on('end', function () {
      return callback(null, Buffer.concat(chunks).toString(encoding))
    })
  } else {
    fs.readFile(filename, encoding, callback)
  }
}
readFile(options.file, 'utf8', function (err, input) {
  if (err) {
    if (err.code === 'ENOENT') {
      console.error('File not found: ' + options.file)
      process.exit(2)
    }
    console.error(err.message || String(err))
    process.exit(1)
  }
  let output
  try {
    output = markdownit.formatTable(input, { line })
  } catch (e) {
    console.error(e.message || String(e))
    process.exit(1)
  }
  if (options.output === '-') {
    process.stdout.write(output)
  } else {
    fs.writeFileSync(options.output, output)
  }
})
