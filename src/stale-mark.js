// The stale mark: one element a host's data write leaves in the head of a document
// whose computed values it could not recalculate (calculator documents plan, M1b).
// Every ClayJS save strips `no-save`, so the first page that recalculates and saves
// removes it. HTML Clay's Go port is internal/dataapi/stalemark.go; keep both in step.
export const STALE_MARK = '<meta name="clay-stale" clay="no-save">'

export function hasStaleMark(src) {
  return src.includes(STALE_MARK)
}

// The mark goes before </head>; else just after an unclosed <head ...>; else, wrapped
// in a head of its own, before <body ...>. A document with none of these tags is
// returned unchanged (its write still answers stale). `load` is cheerio.load.
export function withStaleMark(load, src) {
  if (hasStaleMark(src)) return src
  // parse5 reads a leading byte order mark as text, which leaves the head and body
  // without a location; parse past it, as HTML Clay's port does.
  const bom = src.charCodeAt(0) === 0xfeff ? 1 : 0
  const $ = load(bom ? src.slice(1) : src, { sourceCodeLocationInfo: true })
  const head = $('head').get(0)?.sourceCodeLocation
  if (head?.endTag) return insertAt(src, bom + head.endTag.startOffset, STALE_MARK)
  if (head?.startTag) return insertAt(src, bom + head.startTag.endOffset, STALE_MARK)
  const body = $('body').get(0)?.sourceCodeLocation
  if (body?.startTag) return insertAt(src, bom + body.startTag.startOffset, `<head>${STALE_MARK}</head>`)
  return src
}

function insertAt(src, at, text) {
  return src.slice(0, at) + text + src.slice(at)
}
