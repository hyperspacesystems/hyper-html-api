// GENERATED — do not edit. Bundled from sapjs/src/grid/codec/ via sapjs
// `node scripts/propagate.js --only hyper-html-api`. Edit the sapjs source and re-run.

// src/grid/codec/value.js
var NUMBER = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
var MAX_DIGITS = 15;
function significantDigits(text) {
  return text.replace(/^-/, "").replace(".", "").replace(/^0+/, "").replace(/0+$/, "").length;
}
function typed(text, forceText = false) {
  if (text === "") return null;
  if (forceText) return text;
  if (text === "TRUE") return true;
  if (text === "FALSE") return false;
  if (!NUMBER.test(text)) return text;
  const digits = significantDigits(text);
  if (digits > MAX_DIGITS) return text;
  const number = Number(text);
  if (!Number.isFinite(number) || number === 0 && digits > 0) return text;
  return number === 0 ? 0 : number;
}
function shown(value) {
  if (value === null || value === void 0) return "";
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  if (typeof value === "string") return value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`grid codec: ${String(value)} is not a finite number, a boolean or text`);
  }
  if (value === 0) return "0";
  const [mantissa, exponent] = value.toExponential(MAX_DIGITS - 1).split("e");
  const sign = mantissa[0] === "-" ? "-" : "";
  const digits = mantissa.replace("-", "").replace(".", "").replace(/0+$/, "");
  const point = Number(exponent) + 1;
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  const whole = digits.padEnd(point, "0").slice(0, point);
  const fraction = digits.slice(point);
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}
function cellValue(cell) {
  if (!cell || cell.hidden) return null;
  return typed(cell.v ?? cell.text, cell.t === true);
}

// src/grid/codec/write.js
var FORBIDDEN = /[\r\0]/;
var MAX_COUNT = 9999999;
var EMPTY_CELL = "<td></td>";
function clean(value, what) {
  const text = String(value);
  if (FORBIDDEN.test(text)) throw new TypeError(`grid codec: ${what} holds a carriage return or NUL`);
  return text;
}
var textEscape = (value) => clean(value, "cell text").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
var attrEscape = (value) => clean(value, "attribute value").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
var attr = (name, value) => ` ${name}="${attrEscape(value)}"`;
function count(value, min, what) {
  if (!Number.isInteger(value) || value < min || value > MAX_COUNT) {
    throw new RangeError(`grid codec: ${what} must be a whole number from ${min} to ${MAX_COUNT}`);
  }
  return value;
}
function cellHtml(cell) {
  if (!cell) return EMPTY_CELL;
  if (typeof cell.text !== "string") throw new TypeError("grid codec: cell text must be a string");
  if (cell.hidden && cell.text !== "") throw new TypeError("grid codec: a hidden cell holds no text");
  let attrs = "";
  if (cell.n) attrs += " n";
  if (cell.t) attrs += " t";
  if (cell.f !== void 0) attrs += attr("f", cell.f);
  if (cell.v !== void 0) attrs += attr("v", cell.v);
  if (cell.fmt !== void 0) attrs += attr("fmt", cell.fmt);
  if (cell.colspan !== void 0) attrs += ` colspan="${count(cell.colspan, 2, "colspan")}"`;
  if (cell.rowspan !== void 0) attrs += ` rowspan="${count(cell.rowspan, 2, "rowspan")}"`;
  if (cell.hidden) attrs += " hidden";
  if (cell.style !== void 0) attrs += attr("style", cell.style);
  return `<td${attrs}>${textEscape(cell.text)}</td>`;
}
function rowHtml(row) {
  const cells = row.cells.map(cellHtml);
  while (cells.length > 0 && cells[cells.length - 1] === EMPTY_CELL) cells.pop();
  const style = row.style !== void 0 ? attr("style", row.style) : "";
  return `<tr${attr("data-id", row.id)}${attr("data-pos", row.pos)}${style}>${cells.join("")}</tr>`;
}
function colHtml(col) {
  let attrs = attr("data-id", col.id) + attr("data-pos", col.pos);
  if (col.fmt !== void 0) attrs += attr("fmt", col.fmt);
  if (col.width !== void 0) attrs += ` style="width:${count(col.width, 0, "width")}px"`;
  return `<col${attrs}>`;
}
function tableHtml(sheet, { groupSize = 50 } = {}) {
  count(groupSize, 1, "groupSize");
  const rows = sheet.rows ?? [];
  const firstData = rows.findIndex((row) => !row.frozen);
  const frozen = firstData === -1 ? rows : rows.slice(0, firstData);
  const data = firstData === -1 ? [] : rows.slice(firstData);
  if (data.some((row) => row.frozen)) throw new TypeError("grid codec: frozen rows come before every other row");
  let html = "<table grid";
  if (sheet.freezeCols) html += ` freeze-cols="${count(sheet.freezeCols, 1, "freezeCols")}"`;
  if (sheet.stale) html += " stale";
  html += `><colgroup>${(sheet.cols ?? []).map(colHtml).join("")}</colgroup>
`;
  if (frozen.length > 0) html += `<thead>
${frozen.map(rowHtml).join("\n")}
</thead>`;
  const groups = Math.max(1, Math.ceil(data.length / groupSize));
  for (let g = 0; g < groups; g++) {
    const group = data.slice(g * groupSize, (g + 1) * groupSize);
    html += "<tbody>\n";
    if (group.length > 0) html += `${group.map(rowHtml).join("\n")}
`;
    html += "</tbody>";
  }
  return `${html}</table>`;
}

// src/grid/codec/scan.js
var CodecMiss = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CodecMiss";
  }
};
var MAX_COUNT_DIGITS = 7;
var NO_SINK = {};
var ATTR_REFS = /&amp;|&quot;|[&\r\0]/g;
var TEXT_REFS = /&amp;|&lt;|&gt;|[&>\r\0]/g;
var ATTR_DECODED = { "&amp;": "&", "&quot;": '"' };
var TEXT_DECODED = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };
var cursor = 0;
function miss(why, at) {
  throw new CodecMiss(`grid codec: ${why} at ${at}`);
}
function decode(raw, refs, decoded, at) {
  return raw.replace(refs, (match) => decoded[match] ?? miss(`character ${JSON.stringify(match)} outside the grammar`, at));
}
function expect(src, i, literal) {
  if (!src.startsWith(literal, i)) miss(`expected ${JSON.stringify(literal)}`, i);
  return i + literal.length;
}
function skipSpace(src, i) {
  for (; ; ) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 10 && c !== 9) return i;
    i++;
  }
}
function flag(src, i, literal) {
  if (!src.startsWith(literal, i)) return false;
  const next = src.charCodeAt(i + literal.length);
  return next === 32 || next === 62;
}
function readAval(src, i) {
  const end = src.indexOf('"', i);
  if (end === -1) miss("open attribute value", i);
  cursor = end + 1;
  return decode(src.slice(i, end), ATTR_REFS, ATTR_DECODED, i);
}
function readCount(src, i, min) {
  let end = i;
  while (end - i <= MAX_COUNT_DIGITS) {
    const c = src.charCodeAt(end);
    if (c < 48 || c > 57) break;
    end++;
  }
  const digits = src.slice(i, end);
  if (digits.length === 0 || digits.length > MAX_COUNT_DIGITS) miss("bad count", i);
  if (digits.length > 1 && digits[0] === "0") miss("count with a leading zero", i);
  const value = Number(digits);
  if (value < min) miss(`count below ${min}`, i);
  cursor = end;
  return value;
}
function readCol(src, i) {
  i = expect(src, i, '<col data-id="');
  const col = { id: readAval(src, i) };
  i = expect(src, cursor, ' data-pos="');
  col.pos = readAval(src, i);
  i = cursor;
  if (src.startsWith(' fmt="', i)) {
    col.fmt = readAval(src, i + 6);
    i = cursor;
  }
  if (src.startsWith(' style="width:', i)) {
    col.width = readCount(src, i + 14, 0);
    i = expect(src, cursor, 'px"');
  }
  cursor = expect(src, i, ">");
  return col;
}
function readCell(src, i) {
  i = expect(src, i, "<td");
  const cell = {};
  let bare = true;
  if (flag(src, i, " n")) {
    cell.n = true;
    i += 2;
    bare = false;
  }
  if (flag(src, i, " t")) {
    cell.t = true;
    i += 2;
    bare = false;
  }
  if (src.startsWith(' f="', i)) {
    cell.f = readAval(src, i + 4);
    i = cursor;
    bare = false;
  }
  if (src.startsWith(' v="', i)) {
    cell.v = readAval(src, i + 4);
    i = cursor;
    bare = false;
  }
  if (src.startsWith(' fmt="', i)) {
    cell.fmt = readAval(src, i + 6);
    i = cursor;
    bare = false;
  }
  if (src.startsWith(' colspan="', i)) {
    cell.colspan = readCount(src, i + 10, 2);
    i = expect(src, cursor, '"');
    bare = false;
  }
  if (src.startsWith(' rowspan="', i)) {
    cell.rowspan = readCount(src, i + 10, 2);
    i = expect(src, cursor, '"');
    bare = false;
  }
  if (flag(src, i, " hidden")) {
    cell.hidden = true;
    i += 7;
    bare = false;
  }
  if (src.startsWith(' style="', i)) {
    cell.style = readAval(src, i + 8);
    i = cursor;
    bare = false;
  }
  i = expect(src, i, ">");
  const lt = src.indexOf("<", i);
  if (lt === -1) miss("open cell", i);
  const text = decode(src.slice(i, lt), TEXT_REFS, TEXT_DECODED, i);
  cursor = expect(src, lt, "</td>");
  if (cell.hidden && text !== "") miss("a hidden cell with text", i);
  if (bare && text === "") return null;
  return Object.assign({ text }, cell);
}
function readRow(src, i, frozen) {
  i = expect(src, i, '<tr data-id="');
  const row = { id: readAval(src, i) };
  i = expect(src, cursor, ' data-pos="');
  row.pos = readAval(src, i);
  i = cursor;
  if (frozen) row.frozen = true;
  if (src.startsWith(' style="', i)) {
    row.style = readAval(src, i + 8);
    i = cursor;
  }
  i = expect(src, i, ">");
  row.cells = [];
  while (!src.startsWith("</tr>", i)) {
    row.cells.push(readCell(src, i));
    i = cursor;
  }
  if (row.cells.length > 0 && row.cells[row.cells.length - 1] === null) miss("a row that ends with an empty cell", i);
  cursor = i + 5;
  return row;
}
function readGroup(src, i, frozen, sink, index) {
  const start = i;
  const close = frozen ? "</thead>" : "</tbody>";
  i = expect(src, i, frozen ? "<thead>" : "<tbody>");
  for (; ; ) {
    i = skipSpace(src, i);
    if (src.startsWith(close, i)) break;
    const rowStart = i;
    const row = readRow(src, i, frozen);
    i = cursor;
    sink.row?.(row, rowStart, i, index++);
  }
  cursor = i + close.length;
  sink.group?.(start, cursor, frozen);
  return index;
}
function scanGrid(src, at, sink = NO_SINK) {
  let i = expect(src, at, "<table grid");
  const table = {};
  if (src.startsWith(' freeze-cols="', i)) {
    table.freezeCols = readCount(src, i + 14, 1);
    i = expect(src, cursor, '"');
  }
  if (flag(src, i, " stale")) {
    table.stale = true;
    i += 6;
  }
  i = expect(src, i, ">");
  sink.table?.(table);
  i = skipSpace(src, i);
  if (src.startsWith("<colgroup>", i)) {
    i += 10;
    for (; ; ) {
      i = skipSpace(src, i);
      if (src.startsWith("</colgroup>", i)) break;
      const col = readCol(src, i);
      i = cursor;
      sink.col?.(col);
    }
    i = skipSpace(src, i + 11);
  }
  let index = 0;
  if (src.startsWith("<thead>", i)) {
    index = readGroup(src, i, true, sink, index);
    i = skipSpace(src, cursor);
  }
  while (src.startsWith("<tbody>", i)) {
    index = readGroup(src, i, false, sink, index);
    i = skipSpace(src, cursor);
  }
  return expect(src, i, "</table>");
}

// src/grid/codec/cut.js
var MARKER = /^[A-Za-z0-9_-]+$/;
var holeHtml = (marker, n) => `<table grid data-hole="${marker}-${n}"></table>`;
function holeMarker(src) {
  for (; ; ) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const marker = `h${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    if (!src.includes(marker)) return marker;
  }
}
function checkMarker(marker, src) {
  if (!MARKER.test(marker)) throw new Error("grid codec: a hole marker is letters, digits, - and _ only");
  if (src.includes(marker)) throw new Error("grid codec: the hole marker occurs in the document");
}
function cutGrids(src, marker) {
  checkMarker(marker, src);
  const regions = [];
  const parts = [];
  let from = 0;
  let at = 0;
  for (; ; ) {
    const start = src.indexOf("<table grid", at);
    if (start === -1) break;
    let end;
    try {
      end = scanGrid(src, start);
    } catch (error) {
      if (!(error instanceof CodecMiss)) throw error;
      at = start + 1;
      continue;
    }
    parts.push(src.slice(from, start), holeHtml(marker, regions.length));
    regions.push({ start, end });
    from = end;
    at = end;
  }
  parts.push(src.slice(from));
  return { rest: parts.join(""), regions };
}
function joinGrids(rest, marker, src, regions, bytes = []) {
  const parts = [];
  let from = 0;
  regions.forEach((region, n) => {
    const hole = holeHtml(marker, n);
    const at = rest.indexOf(hole, from);
    if (at === -1) throw new Error(`grid codec: hole ${n} is missing`);
    parts.push(rest.slice(from, at), bytes[n] ?? src.slice(region.start, region.end));
    from = at + hole.length;
  });
  parts.push(rest.slice(from));
  return parts.join("");
}

// src/grid/codec/read.js
var RENDERS = ["values", "formulas", "cells"];
var A1 = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/;
var MAX_COLUMN = 16384;
var QueryRefused = class extends Error {
  constructor(code, message) {
    super(message);
    this.name = "QueryRefused";
    this.code = code;
  }
};
function gridModel(src, at) {
  const sheet = { cols: [], rows: [] };
  scanGrid(src, at, {
    table: (table) => Object.assign(sheet, table),
    col: (col) => sheet.cols.push(col),
    row: (row) => sheet.rows.push(row)
  });
  return sheet;
}
function cellJson(cell) {
  if (!cell || cell.hidden) return null;
  const v = cellValue(cell);
  const plain = cell.f === void 0 && cell.v === void 0 && cell.fmt === void 0 && cell.style === void 0 && cell.colspan === void 0 && cell.rowspan === void 0;
  if (plain) return v;
  const out = {};
  if (cell.f !== void 0) out.f = cell.f;
  out.v = v;
  if (cell.text !== shown(v)) out.text = cell.text;
  if (cell.fmt !== void 0) out.fmt = cell.fmt;
  if (cell.style !== void 0) out.style = cell.style;
  if (cell.colspan !== void 0) out.colspan = cell.colspan;
  if (cell.rowspan !== void 0) out.rowspan = cell.rowspan;
  return out;
}
function rowJson(row) {
  const cells = row.cells.map(cellJson);
  while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
  return { id: row.id, cells };
}
function tabJson(sheet) {
  const tab = { cols: sheet.cols.map((col) => col.id), rows: sheet.rows.map(rowJson) };
  if (sheet.stale) tab.stale = true;
  return tab;
}
function tabIndex(sheet) {
  return {
    rows: sheet.rows.length,
    cols: sheet.cols.length,
    frozenRows: sheet.rows.filter((row) => row.frozen).length
  };
}
function columnNumber(letters) {
  let n = 0;
  for (const letter of letters) n = n * 26 + (letter.charCodeAt(0) - 64);
  return n;
}
function parseCell(text, range) {
  const match = A1.exec(text);
  const column = match ? columnNumber(match[1]) : 0;
  if (!match || column > MAX_COLUMN) {
    throw new QueryRefused("bad_range", `range ${JSON.stringify(range)} is not an A1 cell or rectangle such as B2 or A1:C3`);
  }
  return { row: Number(match[2]) - 1, col: column - 1 };
}
function parseRange(range) {
  if (typeof range !== "string") throw new QueryRefused("bad_range", "range must be text such as A1:C3");
  const parts = range.split(":");
  if (parts.length > 2) throw new QueryRefused("bad_range", `range ${JSON.stringify(range)} has more than one colon`);
  const start = parseCell(parts[0], range);
  const end = parts.length === 2 ? parseCell(parts[1], range) : start;
  if (end.row < start.row || end.col < start.col) {
    throw new QueryRefused("bad_range", `range ${JSON.stringify(range)} is reversed: write the top left cell first`);
  }
  return { r0: start.row, c0: start.col, r1: end.row, c1: end.col };
}
function readRange(sheet, range, render = "values") {
  if (!RENDERS.includes(render)) {
    throw new QueryRefused("bad_render", `render must be one of ${RENDERS.join(", ")}`);
  }
  const { r0, c0, r1, c1 } = parseRange(range);
  const lastRow = Math.min(r1, sheet.rows.length - 1);
  const lastCol = Math.min(c1, sheet.cols.length - 1);
  const rows = sheet.rows.slice(r0, lastRow + 1);
  const width = Math.max(0, lastCol - c0 + 1);
  if (render === "cells") {
    return {
      cols: sheet.cols.slice(c0, lastCol + 1).map((col) => col.id),
      rows: rows.map((row) => rowJson({ id: row.id, cells: row.cells.slice(c0, c0 + width) }))
    };
  }
  const pick = render === "formulas" ? (cell) => cell && !cell.hidden && cell.f !== void 0 ? cell.f : cellValue(cell) : cellValue;
  return {
    values: rows.map((row) => Array.from({ length: width }, (_, i) => pick(row.cells[c0 + i] ?? null)))
  };
}

// src/grid/codec/canonical.js
var MAX_COUNT2 = 9999999;
var domAdapter = {
  name: (node) => node.localName,
  attr: (node, name) => node.getAttribute(name),
  children: (node) => Array.from(node.children),
  text: (node) => node.textContent
};
var has = (adapter, node, name) => adapter.attr(node, name) !== null;
var cleanText = (text) => text.replace(/\r\n?/g, "\n").replace(/\0/g, "");
function count2(value, min) {
  if (value === null || !/^[0-9]{1,7}$/.test(value.trim())) return void 0;
  const n = Number(value.trim());
  return n >= min && n <= MAX_COUNT2 ? n : void 0;
}
function cellModel(adapter, td) {
  const cell = { text: cleanText(adapter.text(td)) };
  let bare = true;
  const set = (key, value) => {
    if (value === void 0 || value === null || value === false) return;
    cell[key] = value;
    bare = false;
  };
  set("n", has(adapter, td, "n"));
  set("t", has(adapter, td, "t"));
  for (const key of ["f", "v", "fmt"]) {
    const value = adapter.attr(td, key);
    set(key, value === null ? void 0 : cleanText(value));
  }
  set("colspan", count2(adapter.attr(td, "colspan"), 2));
  set("rowspan", count2(adapter.attr(td, "rowspan"), 2));
  if (has(adapter, td, "hidden")) {
    set("hidden", true);
    cell.text = "";
  }
  const style = adapter.attr(td, "style");
  set("style", style === null ? void 0 : cleanText(style));
  return bare && cell.text === "" ? null : cell;
}
function rowModel(adapter, tr, frozen) {
  const row = { id: cleanText(adapter.attr(tr, "data-id") ?? ""), pos: cleanText(adapter.attr(tr, "data-pos") ?? "") };
  if (frozen) row.frozen = true;
  const style = adapter.attr(tr, "style");
  if (style !== null) row.style = cleanText(style);
  row.cells = adapter.children(tr).filter((node) => adapter.name(node) === "td" || adapter.name(node) === "th").map((td) => cellModel(adapter, td));
  return row;
}
function colModel(adapter, node) {
  const col = { id: cleanText(adapter.attr(node, "data-id") ?? ""), pos: cleanText(adapter.attr(node, "data-pos") ?? "") };
  const fmt = adapter.attr(node, "fmt");
  if (fmt !== null) col.fmt = cleanText(fmt);
  const width = /width:\s*([0-9]{1,7})px/.exec(adapter.attr(node, "style") ?? "");
  if (width) col.width = Number(width[1]);
  return col;
}
function treeModel(adapter, table) {
  const sheet = { cols: [], rows: [] };
  const freezeCols = count2(adapter.attr(table, "freeze-cols"), 1);
  if (freezeCols !== void 0) sheet.freezeCols = freezeCols;
  if (has(adapter, table, "stale")) sheet.stale = true;
  const frozen = [];
  const data = [];
  for (const part of adapter.children(table)) {
    const name = adapter.name(part);
    if (name === "colgroup") {
      for (const col of adapter.children(part)) if (adapter.name(col) === "col") sheet.cols.push(colModel(adapter, col));
    } else if (name === "col") {
      sheet.cols.push(colModel(adapter, part));
    } else if (name === "thead" || name === "tbody" || name === "tfoot") {
      const into = name === "thead" ? frozen : data;
      for (const tr of adapter.children(part)) if (adapter.name(tr) === "tr") into.push(rowModel(adapter, tr, name === "thead"));
    } else if (name === "tr") {
      data.push(rowModel(adapter, part, false));
    }
  }
  sheet.rows = [...frozen, ...data];
  return sheet;
}
function canonicalGrid(adapter, table, options) {
  return tableHtml(treeModel(adapter, table), options);
}

// src/grid/codec/styles.js
var STYLE_PROPERTIES = [
  "font-weight",
  "font-style",
  "text-decoration",
  "color",
  "background",
  "background-color",
  "text-align",
  "white-space",
  "border",
  "border-top",
  "border-right",
  "border-bottom",
  "border-left"
];
var ALLOWED = new Set(STYLE_PROPERTIES);
var VALUE = /^(?:[a-zA-Z0-9#%.,+ -]|(?:rgb|rgba|hsl|hsla)\([0-9.,%+ -]*\))+$/;
function filterStyle(css) {
  if (typeof css !== "string") return void 0;
  const kept = /* @__PURE__ */ new Map();
  for (const declaration of css.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().replace(/\s+/g, " ");
    if (!ALLOWED.has(property) || value === "" || !VALUE.test(value)) continue;
    kept.set(property, value);
  }
  if (kept.size === 0) return void 0;
  return Array.from(kept, ([property, value]) => `${property}:${value}`).join(";");
}
var isCanonicalStyle = (css) => typeof css === "string" && filterStyle(css) === css;

// src/grid/codec/order-keys.js
var DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var VALID_KEY = /^[0-9A-Za-z]*[1-9A-Za-z]$/;
var isKey = (key) => typeof key === "string" && VALID_KEY.test(key);
function midpoint(a, b) {
  if (b !== null) {
    let n = 0;
    while ((a[n] || "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round((da + db) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}
function keyBetween(a = null, b = null) {
  if (a !== null && !isKey(a)) throw new TypeError(`grid codec: invalid order key ${a}`);
  if (b !== null && !isKey(b)) throw new TypeError(`grid codec: invalid order key ${b}`);
  if (a !== null && b !== null && a >= b) throw new RangeError(`grid codec: order key ${a} is not before ${b}`);
  return midpoint(a ?? "", b);
}

// src/grid/codec/patch.js
var GROUP_SIZE = 50;
function randomId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return `r${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`;
}
function content(value) {
  if (value === null) return {};
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new QueryRefused("bad_value", `${value} is not a finite number`);
    return { text: shown(value), n: true };
  }
  if (typeof value === "boolean") return { text: shown(value) };
  if (typeof value !== "string") throw new QueryRefused("bad_value", "a value is a number, true, false, text or null");
  if (value.includes("\0")) throw new QueryRefused("bad_value", "text holds a NUL character");
  const text = value.replace(/\r\n?/g, "\n");
  if (text.startsWith("=")) return { text: "", f: text };
  return typed(text) === text || text === "" ? { text } : { text, t: true };
}
function setCell(old, value) {
  const cell = { text: "", ...content(value) };
  for (const key of ["fmt", "colspan", "rowspan", "style"]) if (old && old[key] !== void 0) cell[key] = old[key];
  return Object.keys(cell).length === 1 && cell.text === "" ? null : cell;
}
function checkGrid(values, what) {
  if (!Array.isArray(values) || values.length === 0 || !values.every((row) => Array.isArray(row))) {
    throw new QueryRefused("bad_patch", `${what} is a non-empty array of rows, each an array of values`);
  }
}
function readGrid(src) {
  const grid = { cols: [], rows: [], groups: [], startEnd: 0, table: null };
  grid.end = scanGrid(src, 0, {
    table: (table) => {
      grid.table = table;
    },
    col: (col) => grid.cols.push(col),
    row: (row2, start, end) => grid.rows.push({ row: row2, start, end }),
    group: (start, end, frozen) => grid.groups.push({ start, end, frozen, rows: 0 })
  });
  grid.startEnd = src.indexOf(">") + 1;
  let row = 0;
  for (const group of grid.groups) {
    while (row < grid.rows.length && grid.rows[row].start < group.end) {
      group.rows++;
      row++;
    }
  }
  return grid;
}
function applyRange(grid, op, edited) {
  checkGrid(op.values, "values");
  const { r0, c0, r1, c1 } = parseRange(op.range);
  const height = op.values.length;
  const width = Math.max(...op.values.map((row) => row.length));
  const single = r0 === r1 && c0 === c1;
  if (!single && (height !== r1 - r0 + 1 || op.values.some((row) => row.length !== c1 - c0 + 1))) {
    throw new QueryRefused("bad_patch", `values must be ${r1 - r0 + 1} rows of ${c1 - c0 + 1} for range ${op.range}`);
  }
  if (r0 + height > grid.rows.length || c0 + width > grid.cols.length) {
    throw new QueryRefused("outside_sheet", `range ${op.range} reaches past the sheet's rows or columns; append new rows instead`);
  }
  let cells = 0;
  op.values.forEach((values, i) => {
    const index = r0 + i;
    const row = edited.get(index) ?? { ...grid.rows[index].row, cells: [...grid.rows[index].row.cells] };
    values.forEach((value, j) => {
      const col = c0 + j;
      const old = row.cells[col] ?? null;
      if (old && old.hidden) throw new QueryRefused("covered_cell", `range ${op.range} writes into a merged cell's covered position`);
      while (row.cells.length <= col) row.cells.push(null);
      row.cells[col] = setCell(old, value);
      cells++;
    });
    edited.set(index, row);
  });
  return cells;
}
function lastKey(grid, appended) {
  if (appended.length > 0) return appended[appended.length - 1].pos;
  for (let i = grid.rows.length - 1; i >= 0; i--) if (isKey(grid.rows[i].row.pos)) return grid.rows[i].row.pos;
  return null;
}
function patchGrid(src, ops, { newId = randomId } = {}) {
  if (!Array.isArray(ops) || ops.length === 0) throw new QueryRefused("bad_patch", "patch is a non-empty list of operations");
  const grid = readGrid(src);
  const ids = /* @__PURE__ */ new Set([...grid.rows.map(({ row }) => row.id), ...grid.cols.map((col) => col.id)]);
  const edited = /* @__PURE__ */ new Map();
  const appended = [];
  let cells = 0;
  for (const op of ops) {
    if (op && typeof op.range === "string" && op.append === void 0) {
      cells += applyRange(grid, op, edited);
    } else if (op && op.append !== void 0 && op.range === void 0) {
      checkGrid(op.append, "append");
      for (const values of op.append) {
        if (values.length > grid.cols.length) throw new QueryRefused("outside_sheet", "an appended row has more values than the sheet has columns");
        let id = newId();
        while (ids.has(id)) id = newId();
        ids.add(id);
        const row = { id, pos: keyBetween(lastKey(grid, appended), null), cells: values.map((value) => setCell(null, value)) };
        cells += row.cells.filter(Boolean).length;
        appended.push(row);
      }
    } else {
      throw new QueryRefused("bad_patch", "an operation is { range, values } or { append }");
    }
  }
  const edits = [];
  const { freezeCols } = grid.table;
  edits.push({ start: 0, end: grid.startEnd, bytes: `<table grid${freezeCols ? ` freeze-cols="${freezeCols}"` : ""} stale>` });
  for (const [index, row] of edited) edits.push({ start: grid.rows[index].start, end: grid.rows[index].end, bytes: rowHtml(row) });
  if (appended.length > 0) {
    const last = grid.groups[grid.groups.length - 1];
    let room = last && !last.frozen ? GROUP_SIZE - last.rows : 0;
    let at = last && !last.frozen ? last.end - "</tbody>".length : grid.end - "</table>".length;
    let rest = appended;
    if (room > 0) {
      edits.push({ start: at, end: at, bytes: rest.slice(0, room).map((row) => `${rowHtml(row)}
`).join("") });
      rest = rest.slice(room);
    }
    at = grid.end - "</table>".length;
    let bytes = "";
    for (let i = 0; i < rest.length; i += GROUP_SIZE) {
      bytes += `<tbody>
${rest.slice(i, i + GROUP_SIZE).map((row) => `${rowHtml(row)}
`).join("")}</tbody>`;
    }
    if (bytes) edits.push({ start: at, end: at, bytes });
  }
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let from = 0;
  for (const edit of edits) {
    out += src.slice(from, edit.start) + edit.bytes;
    from = edit.end;
  }
  out += src.slice(from);
  return { bytes: out, changed: { cells, rows: appended.length } };
}

// src/grid/codec/digest.js
var OFFSET = 2166136261;
var PRIME = 16777619;
function fnv1a(text, hash = OFFSET) {
  const step = (byte) => {
    hash = Math.imul(hash ^ byte, PRIME) >>> 0;
  };
  for (const char of text) {
    let code = char.codePointAt(0);
    if (code >= 55296 && code <= 57343) code = 65533;
    if (code < 128) {
      step(code);
    } else if (code < 2048) {
      step(192 | code >> 6);
      step(128 | code & 63);
    } else if (code < 65536) {
      step(224 | code >> 12);
      step(128 | code >> 6 & 63);
      step(128 | code & 63);
    } else {
      step(240 | code >> 18);
      step(128 | code >> 12 & 63);
      step(128 | code >> 6 & 63);
      step(128 | code & 63);
    }
  }
  return hash >>> 0;
}
var hex = (hash) => hash.toString(16).padStart(8, "0");
function cellInput(cell) {
  if (!cell || cell.hidden) return "";
  return cell.f ?? cell.v ?? cell.text;
}
var columnId = (cols, index) => cols[index]?.id || `#${index}`;
function columnIds(sheet) {
  return sheet.cols.map((col, index) => col?.id || `#${index}`);
}
function rowDigest(row, cols) {
  let filled = 0;
  let mass = 0;
  let inputs = OFFSET;
  let columns = 0;
  const occupied = [];
  row.cells.forEach((cell, index) => {
    const input = cellInput(cell);
    inputs = fnv1a(`${input}\0`, inputs);
    if (input === "") return;
    filled++;
    mass += input.trim().length;
    columns = (columns ^ fnv1a(columnId(cols, index))) >>> 0;
    occupied.push(index);
  });
  return filled === 0 ? null : [row.id, filled, mass, hex(inputs), hex(columns), maskHex(occupied)];
}
function maskHex(indexes) {
  const nibbles = [];
  for (const index of indexes) {
    const at = index >> 2;
    while (nibbles.length <= at) nibbles.push(0);
    nibbles[at] |= 1 << (index & 3);
  }
  while (nibbles.length > 1 && nibbles[nibbles.length - 1] === 0) nibbles.pop();
  return nibbles.length ? nibbles.reverse().map((n) => n.toString(16)).join("") : "0";
}
function maskIndexes(mask) {
  const indexes = [];
  for (let i = 0; i < mask.length; i++) {
    const nibble = parseInt(mask[mask.length - 1 - i], 16);
    for (let bit = 0; bit < 4; bit++) if (nibble & 1 << bit) indexes.push(i * 4 + bit);
  }
  return indexes;
}
var occupiedIds = (mask, cols) => maskIndexes(mask).map((index) => cols[index] || `#${index}`);
var positional = (cols, index) => !cols[index] || cols[index] === `#${index}`;
function rowChange(before, after, beforeCols = [], afterCols = []) {
  if (!after) return "destruction";
  if (after[1] < before[1]) return "destruction";
  const nowIds = new Set(occupiedIds(after[5], afterCols));
  const nowIndexes = new Set(maskIndexes(after[5]));
  const cleared = maskIndexes(before[5]).some((index) => positional(beforeCols, index) ? !nowIndexes.has(index) : !nowIds.has(beforeCols[index]));
  if (cleared) return "destruction";
  const columnsSame = before[4] === after[4] || beforeCols.every((_, index) => positional(beforeCols, index));
  if (before[3] === after[3] && columnsSame && before[5] === after[5]) return "same";
  return "modification";
}
function gridDigest(sheet) {
  return sheet.rows.map((row) => rowDigest(row, sheet.cols)).filter(Boolean);
}
function tabDigest(sheet) {
  return { cols: columnIds(sheet), rows: gridDigest(sheet) };
}
export {
  CodecMiss,
  MAX_DIGITS,
  QueryRefused,
  RENDERS,
  STYLE_PROPERTIES,
  attrEscape,
  canonicalGrid,
  cellHtml,
  cellInput,
  cellJson,
  cellValue,
  colHtml,
  columnIds,
  cutGrids,
  domAdapter,
  filterStyle,
  fnv1a,
  gridDigest,
  gridModel,
  hex,
  holeHtml,
  holeMarker,
  isCanonicalStyle,
  joinGrids,
  maskHex,
  maskIndexes,
  parseRange,
  patchGrid,
  readRange,
  rowChange,
  rowDigest,
  rowHtml,
  scanGrid,
  shown,
  significantDigits,
  tabDigest,
  tabIndex,
  tabJson,
  tableHtml,
  textEscape,
  treeModel,
  typed
};
