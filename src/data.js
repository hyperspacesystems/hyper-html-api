// Lean data entry: the DOM-bound engine + the data sugar, WITHOUT cms/upgrade.
// This is what `hyper-html-api/data` exports and what hyperclayjs vendors, so
// the `window.hyperclay.extractData/applyData` feature stays small (data
// extract/apply is a core primitive, not a cms one).
import { engine, extractData, applyData } from './dom-api.js'
import { schemaFor } from './engine/schema.js'

export { engine, extractData, applyData, schemaFor }

const HyperHtmlApiData = { engine, extractData, applyData, schemaFor }
export default HyperHtmlApiData
