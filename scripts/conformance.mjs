#!/usr/bin/env node
// Conformance corpus runner: the host-independent specification of the data API.
//
//   node scripts/conformance.mjs generate   rewrite every expectation from this checkout
//   node scripts/conformance.mjs check      regenerate into memory, fail on any diff
//
// The corpus exists because two engines now answer the same question: this one, and the Go
// port in htmlclay. Parity asserted once is a comment; asserted continuously it is a file.
// `check` runs in CI, so a change that moves the contract has to be a reviewed commit to the
// corpus rather than a surprise in someone's JSON.
//
// Three contracts per case, deliberately separate:
//   .parsed.json     what parseRelaxed() made of the rule source
//   .expected.json   what extract() returned          (ok cases)
//   .error.json      type, message and host status    (error cases)
//
// The parse contract is not optional. The seed fixtures feed strict JSON rule trees straight
// to extract(), so they exercise none of parseRelaxed — the largest and quirkiest file in the
// engine. A tokenizer bug that yields a different but still-extracting tree passes every
// extraction comparison ever written.

import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import adapter from "../src/adapters/cheerio.js";
import { extract, parseRelaxed, findRulesIn } from "../src/engine/index.js";
import { writeDocument, patchDocument, isPatchBody } from "../src/write.js";
import { readDocument, parseSheetQuery, documentRules } from "../src/read.js";
import { QueryRefused } from "../src/codecs/sheet.js";
import { WRITE_POLICY } from "../src/engine/write-policy.js";
import { isDeepStrictEqual } from "node:util";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// cases/ is the generic corpus every host runs today; sheet/ holds the sheet codec's
// read and patch faces, which a host adopts when it ports the codec.
const CASE_DIRS = [join(ROOT, "conformance", "cases"), join(ROOT, "conformance", "sheet")];
const MANIFEST = join(ROOT, "conformance", "MANIFEST.json");

const mode = process.argv[2];
if (mode !== "generate" && mode !== "check") {
  console.error("usage: conformance.mjs generate|check");
  process.exit(2);
}

// ---------- .meta ----------
// Flat `key: value` lines. Blank lines and # comments ignored.
//   tier:      1 both adapters agree | 2 host-specific | 3 documented divergence
//   face:      query (rules from .rules, as a ?data= value) | tag (rules from the document) | write (POST .data.json through the document's rules tag) | write-query (POST .data.json with caller-supplied .rules, ignoring any tag in the document) | read (readDocument: the document's tag, with query and view) | patch (patchDocument with the patch list in .data.json) | params (parseSheetQuery on the URL query string in `params`, then readDocument with the result) | body (isPatchBody on the request body in .data.json against the document's rules tag: writes .body.json { kind: "patch" | "data" })
//   query:     face=read only, the query as one line of JSON, e.g. {"sheet":"Budget","range":"A1:C3"}
//   view:      face=read only, e.g. digest
//   token:     face=tag only, the data-rules-name token to look up (default "api")
//   expect:    ok | error
//   skip:      <host>=<reason>, repeatable
//   note:      free text; on tier 3 it must state the direction of the divergence
function parseMeta(text) {
  const meta = { tier: 1, face: "query", expect: "ok", token: "api", skip: [], note: "" };
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(":");
    if (i < 0) throw new Error(`bad meta line: ${line}`);
    const key = t.slice(0, i).trim();
    const value = t.slice(i + 1).trim();
    if (key === "skip") meta.skip.push(value);
    else if (key === "tier") meta.tier = Number(value);
    else if (key === "query") meta.query = JSON.parse(value);
    else if (key === "params") meta.params = value;
    else meta[key] = value;
  }
  if (!["query", "tag", "write", "write-query", "read", "patch", "body", "params"].includes(meta.face)) throw new Error(`bad face: ${meta.face}`);
  if (!["ok", "error"].includes(meta.expect)) throw new Error(`bad expect: ${meta.expect}`);
  if (![1, 2, 3].includes(meta.tier)) throw new Error(`bad tier: ${meta.tier}`);
  return meta;
}

// ---------- reference host status ----------
// The JS servers classify failures by sniffing the message, not by type, and the two faces
// sniff differently. Recording the status per case is what makes the known 400-vs-500
// divergences pinnable instead of prose: 12 of 16 css-what message classes contain neither
// "JSON" nor "selector", so most malformed selectors are a 500 on every JS host today.
//   query face: hyperclay-local/src/main/utils/data-api.js  extractSiteDataLocal
//   tag face:   hyperclay-local/src/main/utils/data-api.js  mapApiTagError
function referenceStatus(err, face) {
  const name = err && err.name;
  const message = (err && err.message) || "";
  if (face === "tag") {
    if (["UnknownRulesVersion", "RulesParseError", "UnknownCodec", "CodecRefused"].includes(name)) return 400;
    return message.includes("selector") ? 400 : 500;
  }
  if (message.includes("JSON")) return 400;
  if (message.includes("selector")) return 400;
  return 500;
}

// ---------- write face ----------
// A write case pins what POST /_/api/<file> does: the bytes on disk afterwards
// (.after.html, compared byte for byte), the fresh extraction (.after.json),
// whether anything changed and whether the splice held (.write.json), or the
// error (.error.json, with the structured details a host puts in its body).
const WRITE_400 = ["NoRulesTag", "WriteRejected", "WriteRefused", "ShapeMismatch", "EmptyListInsert", "UnknownRulesVersion", "RulesParseError", "UnknownCodec", "CodecRefused"];

// Refusals a host answers with 409: the document is fine, but this kind of
// write cannot apply to it as it stands.
const CONFLICT_CODES = ["sheet-not-canonical", "sheet-write-unavailable"];

function writeStatus(err) {
  if (err && err.name === "CodecRefused" && CONFLICT_CODES.includes(err.code)) return 409;
  return WRITE_400.includes(err && err.name) ? 400 : 500;
}

// ---------- read and patch faces ----------
// QueryRefused comes from the vendored codec, whose class sets no name.
const SHEET_400 = ["QueryRefused", "CodecRefused", "UnknownCodec", "RulesParseError", "UnknownRulesVersion", "NoRulesTag"];

function sheetError(err) {
  const type = err instanceof QueryRefused ? "QueryRefused" : err.name;
  const status = type === "CodecRefused" && CONFLICT_CODES.includes(err.code) ? 409 : SHEET_400.includes(type) ? 400 : 500;
  const body = { type, message: err.message, status };
  if (typeof err.code === "string") body.code = err.code;
  return body;
}

function runReadCase(dir, name, meta, html) {
  const out = { meta, files: {} };
  let result;
  try {
    const query = meta.face === "params" ? parseSheetQuery(new URLSearchParams(meta.params ?? "")) ?? undefined : meta.query;
    result = readDocument(cheerio.load, html, { token: meta.token, query, view: meta.view });
  } catch (err) {
    out.files[`${name}.error.json`] = stable(sheetError(err));
    return out;
  }
  if (result.data === null) {
    out.files[`${name}.error.json`] = stable({
      type: "NoRulesTag", message: `no script[data-rules-name~="${meta.token}"]`, status: 400,
    });
    return out;
  }
  out.files[`${name}.expected.json`] = stable(result.data);
  return out;
}

// Which kind of write a host makes of this request body: a patch or a data write.
function runBodyCase(dir, name, meta, html) {
  const body = JSON.parse(readFileSync(join(dir, `${name}.data.json`), "utf8"));
  const found = documentRules(cheerio.load, html, { token: meta.token });
  const kind = isPatchBody(body, found ? found.rules : null) ? "patch" : "data";
  return { meta, files: { [`${name}.body.json`]: stable({ kind }) } };
}

// Appended rows are named n1, n2, ... so the bytes are the same on every run
// and on every host.
function runPatchCase(dir, name, meta, html) {
  const out = { meta, files: {} };
  const patch = JSON.parse(readFileSync(join(dir, `${name}.data.json`), "utf8"));
  let next = 0;
  let result;
  try {
    result = patchDocument(cheerio.load, html, patch, { token: meta.token, newId: () => `n${++next}` });
  } catch (err) {
    out.files[`${name}.error.json`] = stable(sheetError(err));
    return out;
  }
  out.files[`${name}.after.html`] = result.html;
  out.files[`${name}.write.json`] = stable({ changed: result.changed, stale: result.stale });
  out.files[`${name}.after.json`] = stable(readDocument(cheerio.load, result.html, { token: meta.token }).data);
  return out;
}

function writeDetails(err) {
  if (err.name === "WriteRefused") return err.refusals;
  if (err.name === "WriteRejected") return { unknownKeys: err.unknownKeys, unmatched: err.unmatched };
  if (err.name === "ShapeMismatch") return err.mismatches;
  if (err.name === "EmptyListInsert") return err.path;
  return null;
}

function runWriteCase(dir, name, meta, html) {
  const out = { meta, files: {} };
  const data = JSON.parse(readFileSync(join(dir, `${name}.data.json`), "utf8"));
  let result;
  let rules;
  try {
    const options = { token: meta.token };
    if (meta.face === "write-query") {
      rules = parseRelaxed(readFileSync(join(dir, `${name}.rules`), "utf8"));
      out.files[`${name}.parsed.json`] = stable(rules);
      options.rules = rules;
    }
    result = writeDocument(cheerio.load, html, data, options);
  } catch (err) {
    const body = { type: err.name, message: err.message, status: writeStatus(err), details: writeDetails(err) };
    if (err.name === "CodecRefused") body.code = err.code;
    out.files[`${name}.error.json`] = stable(body);
    return out;
  }
  out.files[`${name}.after.html`] = result.html;
  out.files[`${name}.write.json`] = stable({ changed: result.changed, spliced: result.spliced });
  const $ = cheerio.load(result.html);
  const after = meta.face === "write-query" ? rules : findRulesIn(adapter, $.root(), meta.token).rules;
  out.files[`${name}.after.json`] = stable(extract(adapter, $.root(), after));
  return out;
}

// ---------- run one case ----------
function runCase(dir, name) {
  const meta = parseMeta(readFileSync(join(dir, `${name}.meta`), "utf8"));
  const html = readFileSync(join(dir, `${name}.html`), "utf8");
  if (meta.face === "write" || meta.face === "write-query") return runWriteCase(dir, name, meta, html);
  if (meta.face === "read") return runReadCase(dir, name, meta, html);
  if (meta.face === "patch") return runPatchCase(dir, name, meta, html);
  if (meta.face === "body") return runBodyCase(dir, name, meta, html);
  if (meta.face === "params") return runReadCase(dir, name, meta, html);
  const $ = cheerio.load(html);
  const root = $.root();
  const out = { meta, files: {} };

  let rules;
  let version = "1";
  try {
    if (meta.face === "tag") {
      const found = findRulesIn(adapter, root, meta.token);
      if (!found) {
        // A missing tag is not an engine error: the host turns null into its own 400 body.
        out.files[`${name}.error.json`] = stable({
          type: "NoRulesTag", message: `no script[data-rules-name~="${meta.token}"]`, status: 400,
        });
        return out;
      }
      rules = found.rules;
      version = found.version;
    } else {
      rules = parseRelaxed(readFileSync(join(dir, `${name}.rules`), "utf8"));
    }
  } catch (err) {
    out.files[`${name}.error.json`] = stable({
      type: err.name, message: err.message, status: referenceStatus(err, meta.face),
    });
    return out;
  }

  // The parse succeeded, so the parse contract is pinned even when extraction goes on to fail.
  out.files[`${name}.parsed.json`] = stable(rules);

  try {
    out.files[`${name}.expected.json`] = stable(extract(adapter, root, rules, { version }));
  } catch (err) {
    out.files[`${name}.error.json`] = stable({
      type: err.name, message: err.message, status: referenceStatus(err, meta.face),
    });
  }
  return out;
}

// Two spaces and a trailing newline, so a diff is readable and git-friendly. The BYTE contract
// the Go port matches lives in the engine's own output, not here — this file is the corpus's
// storage format, and Go compares parsed structures for these.
function stable(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

// ---------- drive ----------
const cases = CASE_DIRS.filter((dir) => existsSync(dir)).flatMap((dir) =>
  readdirSync(dir)
    .filter(f => f.endsWith(".meta"))
    .map(f => ({ dir, name: f.slice(0, -".meta".length) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
);
const names = cases.map((c) => c.name);

if (names.length === 0) {
  console.error("conformance: no cases found in " + CASE_DIRS.join(", "));
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const cheerioPkg = JSON.parse(
  readFileSync(join(ROOT, "node_modules", "cheerio", "package.json"), "utf8"),
);
const manifest = stable({
  engine: pkg.version,
  cheerio: cheerioPkg.version,
  cases: names.length,
  note:
    "Versions the expectations were generated against. Parity means parity with THIS pair; " +
    "regenerate deliberately, never as a side effect of an install.",
});

let failures = 0;
const extractionVectors = JSON.parse(readFileSync(join(ROOT, 'conformance', 'sheet-guard-extraction.json'), 'utf8'));
for (const entry of extractionVectors.cases) {
  for (const [view, expected] of [[undefined, entry.data], ['digest', entry.island.api]]) {
    const actual = readDocument(cheerio.load, entry.html, { view }).data;
    if (!isDeepStrictEqual(actual, expected)) {
      console.error(`conformance: sheet-guard-extraction ${entry.name} ${view ?? 'api'} differs`);
      failures++;
    }
  }
}
const wanted = new Map([[MANIFEST, manifest]]);
wanted.set(join(ROOT, "conformance", "write-policy.json"), stable(WRITE_POLICY));

for (const { dir, name } of cases) {
  let result;
  try {
    result = runCase(dir, name);
  } catch (err) {
    console.error(`conformance: case "${name}" could not run: ${err.message}`);
    failures++;
    continue;
  }
  for (const [file, body] of Object.entries(result.files)) wanted.set(join(dir, file), body);

  // An outcome file that no longer applies has to go, or a case that stops erroring keeps a
  // stale .error.json on disk and check() passes while the contract has silently moved.
  const outcomes = [
    `${name}.parsed.json`, `${name}.expected.json`, `${name}.error.json`,
    `${name}.after.html`, `${name}.after.json`, `${name}.write.json`, `${name}.body.json`,
  ];
  for (const file of outcomes) {
    const path = join(dir, file);
    if (wanted.has(path) || !existsSync(path)) continue;
    if (mode === "generate") {
      unlinkSync(path);
      console.log(`  removed stale ${file}`);
    } else {
      console.error(`conformance: ${file} exists but this checkout does not produce it`);
      failures++;
    }
  }
}

for (const [path, body] of wanted) {
  const rel = path.slice(ROOT.length + 1);
  if (mode === "generate") {
    writeFileSync(path, body);
    continue;
  }
  const actual = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (actual === body) continue;
  failures++;
  console.error(`conformance: ${rel} differs`);
  if (actual === null) console.error("  (missing on disk)");
  else {
    const a = actual.split("\n"), b = body.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`  line ${i + 1}:\n    on disk: ${a[i] ?? "(none)"}\n    now:     ${b[i] ?? "(none)"}`);
        break;
      }
    }
  }
}

if (mode === "generate") {
  console.log(`conformance: wrote ${wanted.size} files across ${names.length} cases`);
  process.exit(failures ? 1 : 0);
}
if (failures) {
  console.error(
    `\nconformance: ${failures} difference(s). If this change is intended, run ` +
      `\`npm run conformance:generate\` and commit the corpus alongside the code.`,
  );
  process.exit(1);
}
console.log(`conformance: ${names.length} cases match`);
