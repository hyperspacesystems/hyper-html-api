// A codec with no grid, to prove the @codec(name) plumbing: it reads an
// element's text in upper case and writes it back in lower case.
export const upper = {
  name: 'upper',
  read(adapter, node, ctx) {
    return { text: adapter.text(node).toUpperCase(), query: ctx.query ?? null }
  },
  write(adapter, node, value) {
    adapter.text(node, value.text.toLowerCase())
  },
  same(written, reread) {
    return String(written?.text ?? '').toLowerCase() === String(reread?.text ?? '').toLowerCase()
  },
  styles: [],
}
