# Changelog

## [0.11.3] - 2026-10-17

### Changed
- Stamp the conformance corpus with engine version 0.11.2



## [0.11.2] - 2026-10-16

### Fixed
- Text written into a pre, textarea or listing keeps its leading blank line: the writer adds the extra newline the HTML parser drops, as browsers do when they serialize (a leading CR or CRLF too; SVG and MathML textareas are left alone)
- writeDocument's read-back check compares that text exactly instead of excusing the lost newline

## [0.11.1] - 2026-10-16

### Fixed
- An empty list grows from its seed even when the row selector excludes seeds with `:not([cms-template])`



## [0.11.0] - 2026-10-16

### Added
- An empty list can grow from a seed row kept in a hidden seed bank; the new row goes into the list's own container
- writeDocument checks that the written document reads back as the data it was given, for the keys written
- An ES module build of the data engine for ClayJS

### Changed
- An attribute rule reads `""` when the attribute is present and empty and `null` when it is absent; writing `null` removes the attribute
- CMS scaffolds leave attribute fields absent unless the row selector requires them

### Fixed
- Boolean attributes such as `hidden` and `open` read and write the same way on the server and in the browser
- Writing into a browser page updates what textareas, inputs and options show, including in rows cloned from a row someone typed into
- copy-to-clayjs --check compares against a fresh build



## [0.10.1] - 2026-10-15

### Changed
- List writes now scale linearly
- Updated content-dom.js and region-capabilities.js from ClayJS

### Fixed
- A select with an excluded option keeps its selection in the content view



## [0.10.0] - 2026-10-03

### Added
- Caller-supplied rules option for writeDocument
- Write-query conformance face and cases
- The clayjs applyData sugar now accepts rules options

### Changed
- applyData validates writes on a cloned document before touching the live DOM

### Fixed
- File input and option state are preserved when cloning content



## [0.9.1] - 2026-09-30

### Fixed
- A descendant's own region marker is now checked on the element itself, synced from ClayJS



## [0.9.0] - 2026-09-27

### Added
- Content-only write path for the data API (writeDocument)
- writeDocument documentation in the README

### Changed
- Depend on hyper-morph ^1.0.0

### Fixed
- Write path handling of @type, rules-tag removal, attribute names, and SVG animation
- Conformance cases stored byte-exact so CRLF fixtures survive



## [0.8.1] - 2026-09-04

### Fixed
- `apply` no longer rewrites a property or attribute that already holds the value being written. Text writes have compared first for a while; property and attribute writes did not. That difference was not cosmetic: assigning `innerHTML` replaces every child node even when the string is identical, and setting an attribute to the value it already has still emits a mutation record. A caller that re-applies a whole document on every edit, which is what a CMS does on each keystroke, was tearing down every `@innerHTML` region on the page per keystroke, moving the caret out of it and restarting any embedded media inside it, and sending a record per rule to undo and live-sync listeners. Values that actually changed are written exactly as before.

## [0.8.0] - 2026-08-28

### Added
- Structural list row matching with identity lifecycle hooks

### Changed
- Update clay-data.js vendor path to clayjs/entries



## [0.7.0] - 2026-08-28

### Added
- `apply` takes two optional list hooks. `identifyRows(path, items)` runs before matching and names the existing node each incoming item belongs to, so a caller holding a stable handle on its own rows can tell two byte-identical rows apart. `onRowsApplied(path, nodes)` reports the node each item ended up on once the list has settled, including the empty array when a list settles empty. Both are absent by default, and a supplied node that is not currently in the list is ignored.
- `extract` takes `onRowsRead(path, nodes)`, reporting the node each item was read from, for both list syntaxes (`[selector, shape]` and `"selector[]"`). It lets a caller establish row identity from the read it builds its own UI from, before any `apply` has happened. Pass it only to a top-level `extract`: `apply` re-reads each existing row with a path that restarts at the row, so a nested list would be reported under a truncated path.

### Fixed
- Editing a row no longer replaces it with a clone of the first row. Rows are matched by a two-pass alignment that pairs every row it can, so a list creates a node only when it grows and destroys one only when it shrinks. One-field lists and scalar lists could not survive an edit at all before this.
- A plain edit on a list whose rows carry ids no longer warns about stripped id attributes. The template is cloned only when the list actually grew.
- Applying unchanged text no longer rewrites the text node. Every text rule used to replace its node on every apply, so a caller that re-applies a whole document (the CMS does, on each keystroke) produced a DOM mutation per text rule with nothing changed, and those reached mutation observers, undo and live sync. Scalar lists already compared before writing; this is that comparison everywhere else.
- A list whose item shape is a string rule (`[".r", "."]`) is matched as a string instead of as an object. `Object.keys('.')` is `["0"]`, so two items were compared by their first character and an edit could destroy the wrong row.
- `identifyRows` no longer leaves the rows around a locked one as ambiguous as they were. Uniqueness for the anchor pass is counted over the unlocked rows only, so locking one of two identical rows now lets the other match where it moved to.

### Changed

- **A list now reuses its existing rows whatever the incoming data looks like.** The rule is structural, not similarity-based: a row is rebuilt from the template only when the list grew. Editing a row is the everyday case, but the same holds when you replace a list wholesale with entirely unrelated items. Those items are written into the rows already there, and **anything a row carried that the rules do not describe stays on the page** (an image, nested markup, a listener, widget state). Previously a sufficiently different row scored below the similarity threshold and was rebuilt clean.

  This is the intended behaviour and the reason for the change, but it is a real difference for a caller who was relying on a wholesale replace to produce fresh rows. Such a caller should clear the list first (apply `[]`, then the new items), which removes every node and rebuilds from the template.

  A list rule with no item shape (`['.r']`) is affected the same way: every row now matches, where before none did.



## [0.6.5] - 2026-08-21

### Changed
- Synced package-lock.json to the published dependency versions
- Updated hyper-html-api package contents



## [Unreleased]

## [0.16.0] - 2026-11-14

### Added
- A sheet patch with `{ sheet, delete: true }` now deletes a tab.

### Fixed
- Seeded rows are cloned into place and keep their hidden seed.

## [0.15.2] - 2026-11-13

### Fixed
- Writing a site value with `writeSite` keeps the page's rules version.

## [0.15.1] - 2026-11-13

### Changed
- No user-facing changes.

## [0.15.0] - 2026-11-12

### Added
- `readDocument` reads a document, reading canonical sheet grids directly from bytes and falling back to the full tree whenever the result could differ.
- Document rules version 2 adds codec keys.
- Patch bodies are now classified.

## [0.14.0] - 2026-11-11

### Added
- Rules can use `[*]` to apply to all matches.
- The site module adds `projectSite` and `writeSite` for reading and writing shared site data.

### Changed
- The Block editor host contract is now `blockeditor` instead of `page`.

### Fixed
- Shared site values are read key by key, and a missing element is told apart from an absent attribute.
- Documents upgrade when the new version adds an empty nested list inside a row: the list grows from the page's seeds instead of the upgrade refusing.
- During an upgrade, a field the owner left empty inside a list row stays empty instead of taking the new template's sample value.
- During an upgrade, a field or list that the new version adds inside a list item starts empty.

## [0.13.0] - 2026-10-30

### Added
- `@--name` rules read and write one CSS custom property, such as `html@--color-accent`, changing only that declaration in the element's style attribute and leaving every other declaration alone. An empty value removes it.
- `checkCustomPropertyValue` is exported from the engine, so a typed value can be checked with the same rule a guarded write uses.
- Guarded writes (`writeDocument`, `applyData`) accept a style change when it touches only custom properties whose values are safe: no unclosed quote or bracket, no mismatched bracket, no comment, no control characters, and nothing that loads a resource, closes the declaration or carries markup. Raw `style`, `<style>`, `<script>` and `<link>` writes stay refused.

### Changed
- Setting a custom property to the value it already has does nothing, so posting a read back unchanged never errors, as with every other rule form.
- Cheerio and the DOM return the same value for a custom property, since both adapters share one text parser.
- Custom property names are matched exactly, so a differently cased name cannot get a refused value through the check.
- The engine reads a style attribute the way the browser does, closing a bracket only with its own kind.

### Fixed
- Upgrading a document that has been used keeps form values the data writes as properties (input value, checkbox, textarea, select) in the upgraded markup, instead of refusing the upgrade as data loss.
- A custom property value with an unclosed quote or bracket, a mismatched bracket or a comment is refused, so it cannot swallow the declarations that follow it.
- A comment before a declaration's name no longer hides that declaration from the check.

## [0.12.0] - 2026-10-22

### Added
- `readPageDocument` and `writePageDocument` in `hyper-html-api/page` read and write pages through a page store, so the HTML you get back and the store always match.
- Page writes that are missing, out of date or invalid are refused with `revision-required`, `revision-stale` or `invalid-content`, and change nothing.

### Changed
- License: relicensed to MIT-0 (MIT No Attribution). Same rights, attribution no longer required.
- Documents without a page store keep working through `writeDocument`.
- Importing the main entry does not pull in Yjs.

## [0.6.4] - 2026-08-16

### Changed
- Updated ecosystem dependencies to their latest versions



## [0.6.3] - 2026-08-15

### Added
- `hyper-html-api` package to the workspace



## [0.6.2] - 2026-08-14

### Fixed
- Boolean props (`@checked`, `@selected`, `@disabled`, `@readOnly`, `@paused`) now read the string `"false"` as false. `Boolean("false")` is true, so a form-state or attribute round-trip delivering `"false"` checked the box instead of clearing it.



## [0.6.1] - 2026-08-14

### Added
- Initial hyper-html-api implementation.



## [0.5.2] - 2026-08-11

### Added
- Declared `kind`, `status`, and `url` fields in the `hyper` key

### Changed
- Synced ecosystem dependencies to their latest versions



## [0.5.0] - 2026-06-16

### Changed
- Refactor upgrade system with better separation of concerns


