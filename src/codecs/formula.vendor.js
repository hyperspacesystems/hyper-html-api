// GENERATED — do not edit. Bundled from sapjs/src/grid/formula/text.js via sapjs
// `node scripts/propagate.js --only hyper-html-api`. Edit the sapjs source and re-run.

// src/grid/formula/text.js
var NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
var ERROR = /^#(?:[A-Za-z0-9/]+[!?]|[Nn]\/[Aa])/;
var WORD = /^[A-Za-z_][A-Za-z0-9_.]*/;
var COLUMN = /^[A-Za-z]{1,3}/;
var ROW = /^\d+/;
var isDigit = (ch) => ch !== void 0 && ch >= "0" && ch <= "9";
var isLetter = (ch) => ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z";
var isSpace = (ch) => ch === " " || ch === "	" || ch === "\r" || ch === "\n";
var isWordChar = (ch) => ch !== void 0 && /[A-Za-z0-9_.]/.test(ch);
var invalid = (start, end) => ({ token: { type: "invalid", start, end: Math.max(end, start + 1) }, next: Math.max(end, start + 1) });
function readString(src, start) {
  let i = start + 1;
  let value = "";
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      if (src[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      return { token: { type: "str", value, start, end: i + 1 }, next: i + 1 };
    }
    value += ch;
    i += 1;
  }
  return invalid(start, src.length);
}
function readError(src, start) {
  const match = ERROR.exec(src.slice(start));
  if (!match) return invalid(start, start + 1);
  const end = start + match[0].length;
  return { token: { type: "err", code: match[0].toUpperCase(), start, end }, next: end };
}
function readCoord(src, i, sheet, origin = i) {
  const start = origin;
  let absCol = false;
  if (src[i] === "$") {
    absCol = true;
    i += 1;
  }
  const colMatch = COLUMN.exec(src.slice(i));
  if (colMatch) {
    const col = colMatch[0].toUpperCase();
    i += colMatch[0].length;
    let absRow = false;
    if (src[i] === "$") {
      absRow = true;
      i += 1;
    }
    const rowMatch2 = ROW.exec(src.slice(i));
    if (rowMatch2) {
      i += rowMatch2[0].length;
      if (isWordChar(src[i])) return invalid(start, i);
      return {
        token: { type: "cell", sheet, col, row: Number(rowMatch2[0]), absCol, absRow, start, end: i },
        next: i
      };
    }
    if (absRow) return invalid(start, i);
    return { token: { type: "col", sheet, col, absCol, start, end: i }, next: i };
  }
  if (absCol) {
    const absRowMatch = ROW.exec(src.slice(i));
    if (!absRowMatch) return invalid(start, i);
    i += absRowMatch[0].length;
    if (isWordChar(src[i])) return invalid(start, i);
    return { token: { type: "row", sheet, row: Number(absRowMatch[0]), absRow: true, start, end: i }, next: i };
  }
  const rowMatch = ROW.exec(src.slice(i));
  if (rowMatch) {
    i += rowMatch[0].length;
    if (isWordChar(src[i])) return invalid(start, i);
    return { token: { type: "row", sheet, row: Number(rowMatch[0]), absRow: false, start, end: i }, next: i };
  }
  return invalid(start, start + 1);
}
function readQuoted(src, start) {
  let i = start + 1;
  let name = "";
  while (i < src.length) {
    if (src[i] === "'") {
      if (src[i + 1] === "'") {
        name += "'";
        i += 2;
        continue;
      }
      return { name, next: i + 1 };
    }
    name += src[i];
    i += 1;
  }
  return null;
}
function readWordOrRef(src, start) {
  if (src[start] === "'") {
    const quoted = readQuoted(src, start);
    if (!quoted || src[quoted.next] !== "!") return invalid(start, quoted ? quoted.next : src.length);
    return readCoord(src, quoted.next + 1, quoted.name, start);
  }
  const word = WORD.exec(src.slice(start));
  if (word && src[start + word[0].length] === "!") {
    const end2 = start + word[0].length;
    return readCoord(src, end2 + 1, word[0], start);
  }
  if (src[start] === "$") return readCoord(src, start, null);
  if (!word) return invalid(start, start + 1);
  const end = start + word[0].length;
  if (src[end] === "(") {
    return { token: { type: "name", value: word[0].toUpperCase(), start, end }, next: end };
  }
  const upper = word[0].toUpperCase();
  if (upper === "TRUE" || upper === "FALSE") {
    return { token: { type: "bool", value: upper === "TRUE", start, end }, next: end };
  }
  return readCoord(src, start, null);
}
function readNumber(src, start) {
  const match = NUMBER.exec(src.slice(start));
  const end = start + match[0].length;
  if (src[end] === ":" && isDigit(src[end + 1])) {
    const row = ROW.exec(src.slice(end + 1));
    const rowEnd = end + 1 + row[0].length;
    return {
      tokens: [
        { type: "row", sheet: null, row: Number(match[0]), absRow: false, start, end },
        { type: "punct", value: ":", start: end, end: end + 1 },
        { type: "row", sheet: null, row: Number(row[0]), absRow: false, start: end + 1, end: rowEnd }
      ],
      next: rowEnd
    };
  }
  return { tokens: [{ type: "num", value: Number(match[0]), start, end }], next: end };
}
function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (isSpace(ch)) {
      i += 1;
      continue;
    }
    const prev = tokens[tokens.length - 1];
    if (prev?.type === "punct" && prev.value === ":" && tokens[tokens.length - 2]?.type === "row" && (isDigit(ch) || ch === "$")) {
      const scanned = readCoord(src, i, null);
      tokens.push(scanned.token);
      i = scanned.next;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "," || ch === ":" || ch === "%") {
      tokens.push({ type: "punct", value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (ch === '"') {
      const scanned = readString(src, i);
      tokens.push(scanned.token);
      i = scanned.next;
      continue;
    }
    if (ch === "#") {
      const scanned = readError(src, i);
      tokens.push(scanned.token);
      i = scanned.next;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>") {
      tokens.push({ type: "op", value: two, start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>".includes(ch)) {
      tokens.push({ type: "op", value: ch, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (isDigit(ch) || ch === "." && isDigit(src[i + 1])) {
      const scanned = readNumber(src, i);
      for (const token of scanned.tokens) tokens.push(token);
      i = scanned.next;
      continue;
    }
    if (ch === "$" || ch === "'" || isLetter(ch) || ch === "_") {
      const scanned = readWordOrRef(src, i);
      tokens.push(scanned.token);
      i = scanned.next;
      continue;
    }
    tokens.push({ type: "invalid", start: i, end: i + 1 });
    i += 1;
  }
  return tokens;
}
var BINARY = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5
};
var UNARY = 6;
var POSTFIX = 7;
var ParseError = class extends Error {
  constructor(at) {
    super("#ERROR!");
    this.at = at;
  }
};
var peek = (state) => state.tokens[state.index];
var next = (state) => {
  const token = state.tokens[state.index];
  state.index += 1;
  return token;
};
var fail = (state, token) => {
  throw new ParseError(token ? token.start : state.end);
};
var isCoordinate = (token) => token.type === "cell" || token.type === "col" || token.type === "row";
var refEnd = (token) => {
  if (token.type === "cell") {
    return { col: token.col, row: token.row, absCol: token.absCol, absRow: token.absRow };
  }
  if (token.type === "col") {
    return { col: token.col, row: null, absCol: token.absCol, absRow: false };
  }
  return { col: null, row: token.row, absCol: false, absRow: token.absRow };
};
function parseReference(state, first) {
  const colon = peek(state);
  if (!colon || colon.type !== "punct" || colon.value !== ":") {
    if (first.type !== "cell") fail(state, first);
    const ref = {
      type: "ref",
      sheet: first.sheet ?? null,
      col: first.col,
      row: first.row,
      absCol: first.absCol,
      absRow: first.absRow,
      span: [first.start, first.end]
    };
    state.refs.push(ref);
    return ref;
  }
  next(state);
  const second = next(state);
  if (!second || !isCoordinate(second)) fail(state, second);
  const from = refEnd(first);
  const to = refEnd(second);
  if (from.col === null !== (to.col === null)) fail(state, second);
  if (from.row === null && to.row !== null) fail(state, second);
  const sheet = first.sheet ?? second.sheet ?? null;
  if (first.sheet && second.sheet && first.sheet !== second.sheet) fail(state, second);
  const range = { type: "range", from, to, sheet, span: [first.start, second.end] };
  state.refs.push(range);
  return range;
}
function parsePrefix(state) {
  const token = next(state);
  if (!token) fail(state, token);
  switch (token.type) {
    case "num":
      return { type: "num", value: token.value, span: [token.start, token.end] };
    case "str":
      return { type: "str", value: token.value, span: [token.start, token.end] };
    case "bool":
      return { type: "bool", value: token.value, span: [token.start, token.end] };
    case "err":
      return { type: "err", code: token.code, span: [token.start, token.end] };
    case "cell":
    case "col":
    case "row":
      return parseReference(state, token);
    case "op": {
      if (token.value !== "-" && token.value !== "+") fail(state, token);
      const arg = parseExpr(state, UNARY);
      return { type: "unary", op: token.value, arg, span: [token.start, arg.span[1]] };
    }
    case "punct": {
      if (token.value !== "(") fail(state, token);
      const inner = parseExpr(state, 0);
      const close = next(state);
      if (!close || close.type !== "punct" || close.value !== ")") fail(state, close);
      return inner;
    }
    case "name": {
      const open = next(state);
      if (!open || open.type !== "punct" || open.value !== "(") fail(state, open);
      const args = [];
      const after = peek(state);
      if (after && after.type === "punct" && after.value === ")") {
        const close = next(state);
        return { type: "call", name: token.value, args, span: [token.start, close.end] };
      }
      for (; ; ) {
        args.push(parseExpr(state, 0));
        const separator = next(state);
        if (!separator || separator.type !== "punct") fail(state, separator);
        if (separator.value === ")") {
          return { type: "call", name: token.value, args, span: [token.start, separator.end] };
        }
        if (separator.value !== ",") fail(state, separator);
      }
    }
    default:
      fail(state, token);
  }
}
function parseExpr(state, minPower) {
  let left = parsePrefix(state);
  for (; ; ) {
    const token = peek(state);
    if (!token) break;
    if (token.type === "punct" && token.value === "%") {
      if (POSTFIX <= minPower) break;
      next(state);
      left = { type: "postfix", op: "%", arg: left, span: [left.span[0], token.end] };
      continue;
    }
    if (token.type !== "op") break;
    const power = BINARY[token.value];
    if (power === void 0 || power <= minPower) break;
    next(state);
    const right = parseExpr(state, token.value === "^" ? power - 1 : power);
    left = {
      type: "binary",
      op: token.value,
      left,
      right,
      span: [left.span[0], right.span[1]]
    };
  }
  return left;
}
function parse(src) {
  const state = { tokens: tokenize(src), index: 0, refs: [], end: src.length };
  try {
    const ast = parseExpr(state, 0);
    const rest = peek(state);
    if (rest) fail(state, rest);
    return { ast, refs: state.refs };
  } catch (error) {
    if (error instanceof ParseError) return { error: "#ERROR!", at: error.at };
    throw error;
  }
}
var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64);
  return n - 1;
}
function colText(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    out = LETTERS[(n - 1) % 26] + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
function frameFrom(sheets) {
  const frame = /* @__PURE__ */ new Map();
  for (const s of sheets) {
    frame.set(s.id, {
      id: s.id,
      name: s.name,
      rows: s.rows,
      cols: s.cols,
      rowAt: new Map(s.rows.map((id, i) => [id, i])),
      colAt: new Map(s.cols.map((id, i) => [id, i]))
    });
  }
  return frame;
}
var byName = (frame, name) => {
  const low = name.toLowerCase();
  for (const s of frame.values()) if (s.name.toLowerCase() === low) return s;
  return null;
};
function endIds(sheet, end) {
  const row = end.row === null ? null : sheet.rows[end.row - 1] ?? void 0;
  const col = end.col === null ? null : sheet.cols[colIndex(end.col)] ?? void 0;
  return { row, col };
}
function bind(f, homeId, frame) {
  const parsed = parse(f.slice(1));
  if (parsed.error) return null;
  const home = frame.get(homeId);
  const refs = parsed.refs.map((node) => {
    const sheet = node.sheet === null ? home : byName(frame, node.sheet);
    if (sheet === null) return { unbound: true, name: node.sheet };
    if (node.type === "ref") {
      const { row, col } = endIds(sheet, node);
      return { s: sheet.id, r0: row, c0: col, r1: row, c1: col, cell: true };
    }
    const a = endIds(sheet, node.from);
    const b = endIds(sheet, node.to);
    return { s: sheet.id, r0: a.row, c0: a.col, r1: b.row, c1: b.col, cell: false };
  });
  return { f, parsed, refs };
}
var enc = (id) => id === void 0 ? 0 : id;
var dec = (id) => id === 0 ? void 0 : id;
var idsOf = (bound) => bound.refs.map((ref) => ref.dead ? null : ref.unbound ? ["~", ref.name] : [ref.s, enc(ref.r0), enc(ref.c0), enc(ref.r1), enc(ref.c1)]);
function fromIds(f, ids) {
  const parsed = parse(f.slice(1));
  if (parsed.error || parsed.refs.length !== ids.length) return null;
  const refs = parsed.refs.map((node, i) => {
    const id = ids[i];
    if (id === null) return { dead: true };
    if (id[0] === "~") return { unbound: true, name: id[1] };
    return { s: id[0], r0: dec(id[1]), c0: dec(id[2]), r1: dec(id[3]), c1: dec(id[4]), cell: node.type === "ref" };
  });
  return { f, parsed, refs };
}
var cornersUnordered = (ids) => JSON.stringify(ids.map((ref) => ref === null || ref[0] === "~" ? ref : [ref[0], ...[ref[1], ref[3]].sort(), ...[ref[2], ref[4]].sort()]));
function axisSpan(first, last, beforeAt, beforeList, afterAt) {
  let a = afterAt.get(first);
  let b = afterAt.get(last);
  if (a !== void 0 && b !== void 0) return a <= b ? [a, b] : [b, a];
  const i0 = beforeAt?.get(first);
  const i1 = beforeAt?.get(last);
  if (i0 === void 0 || i1 === void 0) return null;
  const lo = Math.min(i0, i1);
  const hi = Math.max(i0, i1);
  let top = i0 <= i1 ? a : b;
  let bottom = i0 <= i1 ? b : a;
  if (top === void 0) {
    for (let i = lo; i <= hi && top === void 0; i++) top = afterAt.get(beforeList[i]);
  }
  if (bottom === void 0) {
    for (let i = hi; i >= lo && bottom === void 0; i--) bottom = afterAt.get(beforeList[i]);
  }
  if (top === void 0 || bottom === void 0) return null;
  return top <= bottom ? [top, bottom] : [bottom, top];
}
var quoteName = (name) => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}[0-9]+$/.test(name) ? name : `'${name.split("'").join("''")}'`;
function floatText(node, ref, prefix, from, to, was, sheet) {
  const one = (id, typed, afterAt, beforeAt, beforeList, afterLen) => {
    if (id === void 0) return typed;
    const at = afterAt.get(id);
    if (at !== void 0) return at;
    if (node.type === "ref") return "dead";
    const i = beforeAt?.get(id);
    if (i === void 0) return "dead";
    for (let k = i + 1; k < beforeList.length; k++) {
      const next2 = afterAt.get(beforeList[k]);
      if (next2 !== void 0) return next2;
    }
    return afterLen;
  };
  const axis = (a, b, typedA, typedB, afterAt, beforeAt, beforeList, afterLen) => {
    if (a === null && b === null) return [null, null];
    if (a !== void 0 && b !== void 0 && a !== null && b !== null) {
      if (node.type === "ref") return afterAt.has(a) ? [afterAt.get(a), afterAt.get(a)] : ["dead", "dead"];
      return axisSpan(a, b, beforeAt, beforeList, afterAt) ?? ["dead", "dead"];
    }
    const end2 = (id, typed) => id === null ? null : one(id, typed, afterAt, beforeAt, beforeList, afterLen);
    return [end2(a, typedA), end2(b, typedB)];
  };
  const rowOf = (part) => part.row === null ? null : part.row - 1;
  const colOf = (part) => part.col === null ? null : colIndex(part.col);
  const rows = axis(ref.r0, ref.r1, rowOf(from), rowOf(to), sheet.rowAt, was?.rowAt, was?.rows, sheet.rows.length);
  const cols = axis(ref.c0, ref.c1, colOf(from), colOf(to), sheet.colAt, was?.colAt, was?.cols, sheet.cols.length);
  if (rows.includes("dead") || cols.includes("dead")) return "#REF!";
  const end = (part, r, c) => (c === null ? "" : (part.absCol ? "$" : "") + colText(c)) + (r === null ? "" : (part.absRow ? "$" : "") + (r + 1));
  if (node.type === "ref") return prefix + end(from, rows[0], cols[0]);
  return prefix + end(from, rows[0], cols[0]) + ":" + end(to, rows[1], cols[1]);
}
function refText(node, ref, homeId, before, after) {
  if (ref.dead) return "#REF!";
  if (ref.unbound) return null;
  const sheet = after.get(ref.s);
  if (sheet === void 0) return "#REF!";
  const was = before?.get(ref.s);
  const prefix = ref.s === homeId && node.sheet === null ? "" : `${quoteName(sheet.name)}!`;
  const half = (x, y) => x === null !== (y === null);
  const floats = ref.r0 === void 0 || ref.c0 === void 0 || ref.r1 === void 0 || ref.c1 === void 0 || half(ref.r0, ref.r1) || half(ref.c0, ref.c1);
  const from = node.type === "ref" ? node : node.from;
  const to = node.type === "ref" ? node : node.to;
  if (floats) return floatText(node, ref, prefix, from, to, was, sheet);
  let rows = null;
  let cols = null;
  if (ref.r0 !== null) {
    rows = ref.cell ? sheet.rowAt.has(ref.r0) ? [sheet.rowAt.get(ref.r0), sheet.rowAt.get(ref.r0)] : null : axisSpan(ref.r0, ref.r1, was?.rowAt, was?.rows, sheet.rowAt);
    if (rows === null) return "#REF!";
  }
  if (ref.c0 !== null) {
    cols = ref.cell ? sheet.colAt.has(ref.c0) ? [sheet.colAt.get(ref.c0), sheet.colAt.get(ref.c0)] : null : axisSpan(ref.c0, ref.c1, was?.colAt, was?.cols, sheet.colAt);
    if (cols === null) return "#REF!";
  }
  const end = (part, r, c) => (c === null ? "" : (part.absCol ? "$" : "") + colText(c)) + (r === null ? "" : (part.absRow ? "$" : "") + (r + 1));
  if (node.type === "ref") return prefix + end(from, rows[0], cols[0]);
  return prefix + end(from, rows ? rows[0] : null, cols ? cols[0] : null) + ":" + end(to, rows ? rows[1] : null, cols ? cols[1] : null);
}
function print(bound, homeId, before, after) {
  const src = bound.f.slice(1);
  let out = "";
  let at = 0;
  bound.parsed.refs.forEach((node, i) => {
    const typed = src.slice(node.span[0], node.span[1]);
    const text = refText(node, bound.refs[i], homeId, before, after);
    out += src.slice(at, node.span[0]) + (text === null ? typed : text);
    at = node.span[1];
  });
  return "=" + out + src.slice(at);
}
function standard(f, homeId, frame) {
  const bound = bind(f, homeId, frame);
  if (bound === null) return f;
  const src = print(bound, homeId, frame, frame).slice(1);
  let out = "";
  let at = 0;
  for (const token of tokenize(src)) {
    if (token.type !== "name" && token.type !== "bool") continue;
    out += src.slice(at, token.start) + (token.type === "name" ? token.value : token.value ? "TRUE" : "FALSE");
    at = token.end;
  }
  return "=" + out + src.slice(at);
}
function idForm(bound) {
  const src = bound.f.slice(1);
  let out = "";
  let at = 0;
  bound.parsed.refs.forEach((node, i) => {
    const ref = bound.refs[i];
    const text = ref.dead ? "#REF!" : `{${[ref.s, ref.r0, ref.c0, ref.r1, ref.c1].map((id) => id === void 0 ? "?" : id === null ? "" : id).join("|")}}`;
    out += src.slice(at, node.span[0]) + text;
    at = node.span[1];
  });
  return "=" + out + src.slice(at);
}
function lossy(bound, after) {
  return bound.refs.some((ref) => {
    if (ref.dead || ref.unbound) return false;
    const sheet = after.get(ref.s);
    if (sheet === void 0) return true;
    const gone = (id, at) => id !== null && id !== void 0 && !at.has(id);
    return gone(ref.r0, sheet.rowAt) || gone(ref.r1, sheet.rowAt) || gone(ref.c0, sheet.colAt) || gone(ref.c1, sheet.colAt);
  });
}
function slotsOf(f, homeId, frame) {
  const bound = bind(f, homeId, frame);
  if (bound === null) return null;
  const src = f.slice(1);
  const marks = [];
  bound.parsed.refs.forEach((node, i) => marks.push({ span: node.span, ref: bound.refs[i] }));
  for (const token of tokenize(src)) if (token.type === "err" && token.code === "#REF!") marks.push({ span: [token.start, token.end], ref: { dead: true } });
  marks.sort((a, b) => a.span[0] - b.span[0]);
  let skeleton = "";
  let at = 0;
  for (const mark of marks) {
    skeleton += src.slice(at, mark.span[0]) + "";
    at = mark.span[1];
  }
  skeleton += src.slice(at);
  const key = (ref) => {
    if (ref.dead) return "#REF!";
    if (ref.unbound) return `~${ref.name}`;
    const mark = (id) => id === void 0 ? "?" : id === null ? "" : id;
    return [ref.s, ...[mark(ref.r0), mark(ref.r1)].sort(), ...[mark(ref.c0), mark(ref.c1)].sort()].join("|");
  };
  return { skeleton, keys: marks.map((m) => key(m.ref)), marks, src, bound };
}
function printOne(node, ref, homeId, frame, typed) {
  const fake = { f: "=" + "x".repeat(node.span[0]) + typed, parsed: { refs: [node] }, refs: [ref] };
  const text = print(fake, homeId, null, frame).slice(1 + node.span[0]);
  return text;
}
function restoreSlots(currentF, homeId, frame, original, forwardKeys, beforeKeys = null) {
  const now = slotsOf(currentF, homeId, frame);
  if (now === null || now.skeleton !== original.skeleton || now.keys.length !== forwardKeys.length) return null;
  const src = now.src;
  let out = "";
  let at = 0;
  now.marks.forEach((mark, i) => {
    let text = src.slice(mark.span[0], mark.span[1]);
    if ((now.keys[i] === forwardKeys[i] || beforeKeys !== null && beforeKeys[i] === forwardKeys[i]) && original.keys[i] !== forwardKeys[i]) {
      const node = original.nodes[i];
      const ref = original.refs[i];
      text = node === null || ref.dead ? "#REF!" : printOne(node, ref, homeId, frame, original.src.slice(node.span[0], node.span[1]));
    }
    out += src.slice(at, mark.span[0]) + text;
    at = mark.span[1];
  });
  return "=" + out + src.slice(at);
}
function originalSlots(f, homeId, frame) {
  const s = slotsOf(f, homeId, frame);
  if (s === null) return null;
  const nodes = [];
  const refs = [];
  let j = 0;
  for (const mark of s.marks) {
    if (mark.ref.dead && !s.bound.refs.includes(mark.ref)) {
      nodes.push(null);
      refs.push({ dead: true });
      continue;
    }
    nodes.push(s.bound.parsed.refs[j]);
    refs.push(s.bound.refs[j]);
    j += 1;
  }
  return { skeleton: s.skeleton, keys: s.keys, nodes, refs, src: s.src };
}
function shiftRows(f, delta) {
  if (delta === 0) return f;
  const src = f.slice(1);
  const parsed = parse(src);
  if (parsed.error) return f;
  let out = "";
  let at = 0;
  for (const node of parsed.refs) {
    const text = src.slice(node.span[0], node.span[1]);
    let moved = "";
    let from = 0;
    let dead = false;
    for (const token of tokenize(text)) {
      if (token.type !== "cell" && token.type !== "row") continue;
      if (token.absRow || token.row === void 0 || token.row === null) continue;
      const digits = /\d+$/.exec(text.slice(token.start, token.end));
      if (digits === null) continue;
      const row = token.row + delta;
      if (row < 1) dead = true;
      const end = token.end;
      moved += text.slice(from, end - digits[0].length) + String(row);
      from = end;
    }
    out += src.slice(at, node.span[0]) + (dead ? "#REF!" : moved + text.slice(from));
    at = node.span[1];
  }
  return "=" + out + src.slice(at);
}
function topLeftOf(range) {
  const parsed = parse(range);
  const node = parsed.error ? null : parsed.refs[0];
  if (!node) return { row: 0, col: 0 };
  const ends = node.type === "ref" ? [node] : [node.from, node.to];
  const rows = ends.map((end) => end.row).filter((row) => typeof row === "number");
  const cols = ends.map((end) => end.col).filter((col) => typeof col === "string");
  return { row: rows.length > 0 ? Math.min(...rows) - 1 : 0, col: cols.length > 0 ? Math.min(...cols.map(colIndex)) : 0 };
}
function areaOf(text) {
  if (typeof text !== "string") return null;
  const parsed = parse(text);
  if (parsed.error || parsed.refs.length !== 1) return null;
  const node = parsed.refs[0];
  if (node.span[0] !== 0 || node.span[1] !== text.length) return null;
  const ends = node.type === "ref" ? [node, node] : [node.from, node.to];
  const rows = ends.map((end) => typeof end.row === "number" ? end.row - 1 : null);
  const cols = ends.map((end) => typeof end.col === "string" ? colIndex(end.col) : null);
  const area = {
    sheet: node.sheet ?? null,
    top: rows[0] === null ? 0 : Math.min(...rows.filter((row) => row !== null)),
    bottom: rows.includes(null) ? null : Math.max(...rows),
    left: cols[0] === null ? 0 : Math.min(...cols.filter((col) => col !== null)),
    right: cols.includes(null) ? null : Math.max(...cols)
  };
  if (area.top < 0 || (area.bottom ?? 0) > 9999998 || (area.right ?? 0) > 16383 || area.left > 16383 || area.top > 9999998) return null;
  return area;
}
function moveAnchored(f, homeId, before, after, rows, cols) {
  const src = f.slice(1);
  const parsed = parse(src);
  if (parsed.error) return f;
  const place = (ids, at2, index) => index >= ids.length ? index : at2.get(ids[index]) ?? -1;
  let out = "";
  let at = 0;
  for (const node of parsed.refs) {
    const text = src.slice(node.span[0], node.span[1]);
    const was = node.sheet === null ? before.get(homeId) : byName(before, node.sheet);
    const now = was ? after.get(was.id) : null;
    let moved = "";
    let from = 0;
    let dead = false;
    if (was && now) {
      for (const token of tokenize(text)) {
        if (token.type !== "cell" && token.type !== "row" && token.type !== "col") continue;
        const raw = text.slice(token.start, token.end);
        const hasCol = token.type !== "row";
        const hasRow = token.type !== "col";
        const digits = hasRow ? /\d+$/.exec(raw)[0] : "";
        const length = (hasCol ? (token.absCol ? 1 : 0) + token.col.length : 0) + (hasRow ? (token.absRow ? 1 : 0) + digits.length : 0);
        const c = hasCol ? token.absCol ? place(was.cols, now.colAt, colIndex(token.col)) : colIndex(token.col) + cols : 0;
        const r = hasRow ? token.absRow ? place(was.rows, now.rowAt, token.row - 1) : token.row - 1 + rows : 0;
        if (c < 0 || r < 0) dead = true;
        const coord = (hasCol ? `${token.absCol ? "$" : ""}${colText(Math.max(c, 0))}` : "") + (hasRow ? `${token.absRow ? "$" : ""}${r + 1}` : "");
        moved += text.slice(from, token.end - length) + coord;
        from = token.end;
      }
    }
    out += src.slice(at, node.span[0]) + (dead ? "#REF!" : moved + text.slice(from));
    at = node.span[1];
  }
  return "=" + out + src.slice(at);
}
function meaning(f, homeId, frame) {
  const bound = bind(f, homeId, frame);
  if (bound === null) return `!${f}`;
  const src = f.slice(1);
  let out = "";
  let at = 0;
  bound.parsed.refs.forEach((node, i) => {
    const ref = bound.refs[i];
    const from = node.type === "ref" ? node : node.from;
    const to = node.type === "ref" ? node : node.to;
    const end = (id, typed) => id === void 0 ? `~${typed}` : id === null ? "" : id;
    const corners = ref.unbound ? [`~${ref.name.toLowerCase()}`, ...[from.row ?? "", to.row ?? ""].sort(), ...[from.col ?? "", to.col ?? ""].sort()] : [ref.s, ...[end(ref.r0, from.row), end(ref.r1, to.row)].sort(), ...[end(ref.c0, from.col), end(ref.c1, to.col)].sort()];
    const lock = (one) => `${one.absCol ? "$" : ""}:${one.absRow ? "$" : ""}`;
    const key = [node.type, ...corners, ...[lock(from), lock(to)].sort()].join("|");
    out += src.slice(at, node.span[0]) + `${key}`;
    at = node.span[1];
  });
  return out + src.slice(at);
}
export {
  areaOf,
  bind,
  cornersUnordered,
  frameFrom,
  fromIds,
  idForm,
  idsOf,
  lossy,
  meaning,
  moveAnchored,
  originalSlots,
  parse,
  print,
  restoreSlots,
  shiftRows,
  slotsOf,
  standard,
  tokenize,
  topLeftOf
};
