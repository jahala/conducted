# Parity harness

The owner's goal: "a parity harness that proves each Conductor control, text, layout and flow is matched or has a decision". This plan says what each check compares, the data it reads, its tolerance, how a gap is closed, and the instrument check that must pass before any result is trusted.

Words used below:

- **Spec**: Conductor 0.92.1's user-facing inventories, committed as data under `tests/parity/spec/`. Wording and identifiers only, never code or prompt text (D002). Every entry keeps its bundle file and offset.
- **Map**: `tests/parity/map/<inventory>.json`. For each spec entry it says one of three things: **matched** (a catalogue state and the element in it that shows the entry), **decided** (a decision id from `docs/decisions.md` with a one-line reason), or **gap** (not resolved yet, with the screen it belongs to).
- **Dump**: what the states catalogue draws, read from Chromium: every visible string and control name per state, and the computed styles the layout check needs. It is built on GitHub, never on the owner's Mac.

## 1. The spec

`bun scripts/parity/spec.ts` builds the spec. It runs only where the main checkout's `.context/` holds the inventories and the bundle, and its output is committed. CI reads the committed files.

| Inventory                                                           | Source                                                                                                                                          | Entries kept                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text, label, aria_label, placeholder, title, tooltip, description   | `.context/conductor-re/inventory/<kind>.tsv`                                                                                                    | All. The TSV's context column is code and is dropped.                                                                                                                                                                                                                                                                                                      |
| toast                                                               | `toast.tsv`                                                                                                                                     | User-facing toasts only. The inventory's pattern also caught logger calls. A call counts as a toast when its receiver is an object the same bundle file calls with the toast library's own methods (`success`, `warning`, `loading`, `dismiss`) and never with a logger's (`warn`, `debug`). The others are listed by offset in `excluded.json`, without text. |
| route, test_id                                                      | `route.tsv`, `test_id.tsv`                                                                                                                      | All.                                                                                                                                                                                                                                                                                                                                                       |
| literal                                                             | the bundle, looked up from our UI source                                                                                                        | The inventory only catches strings written as `key:"..."`. A string Conductor picks in a condition, such as the composer's placeholder, is missed. Every string literal in our UI source that the bundle also holds as a literal, and that no inventory has, is added with its offset.                                                                      |
| sidecar_rpc_method, sidecar_tool_name                               | `sidecar_rpc_method.tsv`, `sidecar_tool_name.tsv`                                                                                               | All. `sidecar_log_tag.tsv` is left out: log tags are neither shown nor a contract.                                                                                                                                                                                                                                                                         |
| tauri_command, tauri_plugin_command, tauri_event, sidecar_call      | `.context/day/conductor-ref/call-inventory.json`                                                                                                | Names and the first call site's offset.                                                                                                                                                                                                                                                                                                                    |
| settings_key                                                        | `docs/research/conductor/services-map.md` 4.2.3.2, each key found in the bundle                                                                 | Keys the bundle holds as a literal; a key the bundle lacks is reported by the builder and left out.                                                                                                                                                                                                                                                        |
| table                                                               | `conductor-schema.sql` and `cache-schema.sql` in `.context/day/conductor-ref/`, offsets from the call inventory's SQL sites                      | Table names only. A table no frontend statement names has no offset and says so.                                                                                                                                                                                                                                                                           |

The `conductor-code` guard holds the rule that the spec carries no code: it runs over every committed file.

## 2. The map, and how a gap is resolved

`bun scripts/parity/seed.ts <dump dir>` seeds the map from a dump.

- An entry whose normalised text equals a name in exactly one place of the dump is matched there, marked `"by": "seed"`. Normalising trims, collapses white space, and writes `…` as `...` and curly quotes as straight ones.
- An entry that matches only after case folding or with its end punctuation dropped, or that matches in several states with different roles, is matched with `"by": "seed-unsure"`. Each of those is checked by hand, then marked `"by": "hand"` or turned into a gap.
- Decisions are written by hand or by a named rule in `scripts/parity/rules.ts` (`"by": "rule:<name>"`). A rule names its decision and matches on what the entry is for, never on one odd string.
- Every other entry is a gap. A gap says whether our UI source holds the same string (**unshown**: no catalogue state draws it yet) or not (**missing**), and the screen it belongs to: the `ui-map.md` or `ui-dimensions.md` section that cites the nearest bundle offset, within 20,000 characters.
- The seeder never overwrites a `hand` entry or a decision.

A gap is closed in step 5 of the goal in one of two ways: fix our screen (and add the catalogue state that shows it, for an unshown gap), or add a decision to `docs/decisions.md` and name it in the map. Removing or hiding anything people see needs the owner's yes per item.

## 3. The checks

Each is one command. `bun scripts/parity/check.ts <dump dir>` runs a, b, c and e and writes `report.json` and `report.md`; the flows are their own command.

| Check                   | Compares                                                                                                                                                                                                                                                                                                              | Fails on                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| a. Map completeness     | Spec ids against map ids; decision ids against `docs/decisions.md`; matched states against the catalogue's states.                                                                                                                                                                                                     | A spec entry with no map entry, a map entry with no spec entry, an unknown decision or state, and every gap.                 |
| b. Text and controls    | Per catalogue state, both ways. Conductor to ours: every matched entry's text is a name in its state (visible text, aria-label, placeholder, title or alt). Ours to Conductor: every visible string and control name in the state is matched by a spec entry in that state, is sample data, or is in `tests/parity/ours-only.json` with a decision id or the owner's keep ruling. | A matched entry missing from its state; a string of ours that is none of the three.                                          |
| c. Layout               | `tests/parity/layout.json`: elements `ui-dimensions.md` measures, each with its evidence, the catalogue state that shows it and a locator. Our computed styles against the measured values.                                                                                                                            | A value outside the tolerance, a locator that finds nothing, a state that does not render.                                   |
| d. Flows                | `bun scripts/parity/flows.ts`: one Chromium test per flow of `ui-map.md` and `services-map.md` the catalogue's app can drive, asserting each step's visible result.                                                                                                                                                  | A step whose visible result is not there.                                                                                    |
| e. Backend lists        | Conductor's sidecar methods and tools, Tauri commands, plugin commands, events, settings keys and tables against ours (protocol method tables, our app tools, the Tauri adapter's command map, the settings registry, the migrations). Both ways, by name, with renames and decisions in the map.                      | A Conductor name with no match, rename or decision, and a name of ours with no counterpart that is not in the map's ours-only list. |

Sample data is a string the catalogue's seeds write (the string literals of `apps/desktop/src/catalogue/`), or a formatted number, size, duration, time or count. Nothing else is skipped.

Our design choice: check b matches by name per state, not by selector. The selector in a matched entry tells a person where the element is and lets the layout check reuse it, but a moved element still counts as present. Exact positions are the layout check's job.

### Tolerance

- Lengths read from computed styles (padding, margin, gap, radius, border width, font size): within 0.5px of the measured value. Computed styles return the authored value, so any real difference is at least 1px.
- Rendered sizes read from the element's box (height, width, max width): within 1px, for sub-pixel rounding.
- Font weight: exact.
- A value `ui-dimensions.md` marks INFERRED is checked against the bundle before it goes into `layout.json`, and its entry names what was checked. INFERRED values that were not checked stay out.

### Stage 2

Stage 2 runs Conductor's own frontend on our backend. When it exists, its log of calls answered and refused plugs into check e as one more input (`--live <log>`): a name Conductor's frontend called that our backend refused is a gap even when the lists match. Until then check e compares the lists only.

## 4. The instrument check

Before any result is trusted, the harness must find three misses that the owner found by eye on the commit before #345 (29e65165):

1. The sidebar footer's "Add a project" button: an ours-only control in state `sidebar` (check b).
2. The composer's "Write something ..." placeholder: an ours-only string in `composer-empty`, and Conductor's composer placeholder missing there (check b).
3. Tool calls drawn as boxed cards: the tool-call row's padding, radius and height off Conductor's (check c, state `chat-working`).

`bun scripts/parity/instrument.ts <report.json>` fails unless the report holds all three. The `instrument` job in `.github/workflows/parity.yml` checks out 29e65165 in a `git worktree`, installs it, dumps its catalogue with this harness, runs the checks with this commit's spec and map, and runs the instrument script. The same three are listed for the current commit, where #345 fixed them.

Result: see section 6.

## 5. CI

`.github/workflows/parity.yml` runs on pull requests that touch the desktop, the harness or its data, and on demand. It builds the dump in Chromium, runs the checks and the flows, and uploads the gap report and the dump as the `parity-report` artefact (14 days). The `instrument` job runs beside it.

The job's mode is the workflow's `PARITY_MODE` setting:

- `report` (now): gaps are reported in the artefact and the run's summary, and do not fail the PR. A broken harness still fails: a state that does not render, a malformed map, an unknown decision id, or a failed instrument check.
- `enforce`: any gap fails the PR. The setting changes to `enforce` once step 5 of the goal has worked the gaps down to zero, in the PR that closes the last one.

## 6. Results

Filled in when the first CI run has finished.
