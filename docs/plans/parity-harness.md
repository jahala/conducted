# Parity harness

The owner's goal: "a parity harness that proves each Conductor control, text, layout and flow is matched or has a decision". This plan says what each check compares, the data it reads, its tolerance, how a gap is closed, and the instrument check that must pass before any result is trusted.

Words used below:

- **Spec**: Conductor 0.92.1's user-facing inventories, committed as data under `tests/parity/spec/`. Wording and identifiers only, never code or prompt text (D002). Every entry keeps its bundle file and offset.
- **Map**: `tests/parity/map/<inventory>.json`. For each spec entry it says one of three things: **matched** (a catalogue state and the element in it that shows the entry), **decided** (a decision id from `docs/decisions.md` with a one-line reason), or **gap** (not resolved yet, with the screen it belongs to).
- **Dump**: what the states catalogue draws, read from Chromium: every visible string and control name per state, and the computed styles the layout check needs. It is built on GitHub, never on the owner's Mac.

## 1. The spec

`bun scripts/parity/spec.ts` builds the spec. It runs only where the main checkout's `.context/` holds the inventories and the bundle, and its output is committed. CI reads the committed files.

| Inventory                                                         | Source                                                                                                                      | Entries kept                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| text, label, aria_label, placeholder, title, tooltip, description | `.context/conductor-re/inventory/<kind>.tsv`                                                                                | All. The TSV's context column is code and is dropped.                                                                                                                                                                                                                                                                                                          |
| toast                                                             | `toast.tsv`                                                                                                                 | User-facing toasts only. The inventory's pattern also caught logger calls. A call counts as a toast when its receiver is an object the same bundle file calls with the toast library's own methods (`success`, `warning`, `loading`, `dismiss`) and never with a logger's (`warn`, `debug`). The others are listed by offset in `excluded.json`, without text. |
| route, test_id                                                    | `route.tsv`, `test_id.tsv`                                                                                                  | All.                                                                                                                                                                                                                                                                                                                                                           |
| literal                                                           | the bundle, looked up from our UI source                                                                                    | The inventory only catches strings written as `key:"..."`. A string Conductor picks in a condition, such as the composer's placeholder, is missed. Every string literal in our UI source that the bundle also holds as a literal, and that no inventory has, is added with its offset.                                                                         |
| sidecar_rpc_method, sidecar_tool_name                             | `sidecar_rpc_method.tsv`, `sidecar_tool_name.tsv`                                                                           | All. `sidecar_log_tag.tsv` is left out: log tags are neither shown nor a contract.                                                                                                                                                                                                                                                                             |
| tauri_command, tauri_plugin_command, tauri_event, sidecar_call    | `.context/day/conductor-ref/call-inventory.json`                                                                            | Names and the first call site's offset.                                                                                                                                                                                                                                                                                                                        |
| settings_key                                                      | `docs/research/conductor/services-map.md` 4.2.3.2, each key found in the bundle                                             | Keys the bundle holds as a literal; a key the bundle lacks is reported by the builder and left out.                                                                                                                                                                                                                                                            |
| table                                                             | `conductor-schema.sql` and `cache-schema.sql` in `.context/day/conductor-ref/`, offsets from the call inventory's SQL sites | Table names only. A table no frontend statement names has no offset and says so.                                                                                                                                                                                                                                                                               |

The `conductor-code` guard holds the rule that the spec carries no code: it runs over every committed file.

## 2. The map, and how a gap is resolved

`bun scripts/parity/seed.ts <dump.json>` seeds the map from a dump.

- An entry whose normalised text equals a name in the dump is matched to the first state, in catalogue order, that shows it, marked `"by": "seed"`. Normalising trims, collapses white space, and writes `…` as `...` and curly quotes as straight ones. A test id matches only a `data-testid`, and a route only a route a state opens.
- An entry that matches only after case folding or with its end punctuation dropped is matched with `"by": "seed-unsure"`. Each of those is checked by hand, then marked `"by": "hand"`, or made a gap marked `"by": "hand"` with a note saying what ours reads.
- Decisions are written by hand or by a named rule in `scripts/parity/rules.ts` (`"by": "rule:<name>"`). A rule names its decision and matches on what the entry is for, never on one odd string.
- Every other entry is a gap. A gap says whether our UI source holds the same string (**unshown**: no catalogue state draws it yet) or not (**missing**), and the screen it belongs to: the section of `ui-map.md` or of a coverage audit in `docs/coverage/` that cites the nearest bundle offset, within 20,000 characters.
- The seeder never overwrites an entry marked `"by": "hand"` or a decision.

A gap is closed in step 5 of the goal in one of two ways: fix our screen (and add the catalogue state that shows it, for an unshown gap), or add a decision to `docs/decisions.md` and name it in the map. Removing or hiding anything people see needs the owner's yes per item.

### Sorting the gaps

Every entry that is not matched falls in one of four classes. The report counts each class (`## Gaps by class`), and a later run sorts the same way by these rules:

- **a. Decided.** The entry belongs to something a decision leaves out: team features (D004, kept out by D018), Conductor's own service, hosted computers, phone relay, staff tools and Muse Code (D025), GitHub App sign-in (D029), Linear's account sign-in (D035), Conductor's assets (D002), or strings that are not wording (D086). The title of a system dialog, which macOS draws outside the page, is decided too: D132 names the test that asserts it (by hand). Cloud workspaces are not decided: D075 builds them, so their entries are class d with a CLOUD row. It is written as `"status": "decided"` in one of two ways:
  - A named rule in `scripts/parity/rules.ts` when the entry's own words say what it is for: a route of an organisation, routine or onboarding page; a team word (organisation, teammate, single sign-on, shared access, poke); a word naming Conductor's service (Conductor Pro, account, API, Roundhouse, billing, PostHog, Sentry); a bundled sound or logo path; a key name; a backend name of telemetry, the phone relay or hosted computers.
  - By hand (`"by": "hand"`) for a whole bundle region whose component a person read and found to be one left-out feature, such as the Internal settings page, the profile and activity page, the sharing dialog or the hosted sandbox's details. Only missing UI entries are decided this way: a string our UI source also holds is something of ours, so it stays a gap.
- **b. Unshown.** Our UI source holds the string but no catalogue state draws it (`"reason": "unshown"`). It closes when a catalogue state draws the screen it is on, or when the map names an existing state that already draws it.
- **c. Wording or placement.** One of our screens does the same job in other words or in another place. A person marks it `"class": "wording"` with a note naming our string, and closes it by changing our screen to Conductor's wording, so the next seed matches it. Our product name stands for Conductor's: the harness reads "Conductor" as "Conducted" when it compares (D012).
- **d. Feature.** Everything else that is missing: a control, message or behaviour we lack. Its owner (below) names the row that builds it; the gap report lists them by screen.

### Owning a gap

A gap of any class names who closes it: `"backlog"` is the row of `docs/plans/backlog.md` that builds or draws it, and `"item"` is that row's checklist item in `docs/plans/items/`, by its exact text. `"owner"` says how the owner was found. Owned is still a gap, so nothing pretends to be built: the report's "Gaps by class" table counts each class as owned by a row and item, by a row only, or with no owner. Check a fails as broken when a map names a row the backlog lacks, an item that row does not hold, or an item with no row.

`bun scripts/parity/owners.ts` writes the owners. Like the spec builder, it reads the inventories in the main checkout's `.context/`, and its output is committed. It tries, in order:

1. `rule:cite`: the item's research column cites the entry: `inventory text R@N`, `inventory label #N` (rows counted from 0), `inventory:toast row N` (counted from 1), or `inventory:rpc|sidecar|sql|tool <name>`.
2. `rule:quote`: the item quotes the entry's text, or a quote of at least 14 characters holds it. A one-word quote ("Resolve", "You") is the weakest evidence here.
3. `rule:name`: a backend name of six characters or more appears as a whole word in the item.
4. `rule:neighbour`, row only: a UI entry takes the row when every item-owned gap within 1,000 characters in the same bundle file has that one row. Measured on the item-owned gaps, leaving each out in turn: within 500 characters 84% of 206 agree, 1,000 85% of 258, 2,000 83% of 282, 5,000 76% of 272.

The first item in file order wins (`ui.tsv`, then `system.tsv`). An owner a person wrote, `"owner": "hand"`, is never overwritten; backend names are owned by hand when the name alone says which row runs it. An entry deliberately out is decided instead (D004, D018, D025, D029, D035, D086), and an entry with no item and no clear row stays without an owner, listed in the gap report.

## 3. The checks

Each is one command. `bun scripts/parity/check.ts <dump.json> [--flows <flows.json>] [--live <live.json>]` runs a, b, c and e (`--no-dump` runs a and e only) and writes `report.json` and `report.md`; the flows are their own command.

| Check                | Compares                                                                                                                                                                                                                                                                                                                                                                                                         | Fails on                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| a. Map completeness  | Spec ids against map ids; decision ids against `docs/decisions.md`; matched states against the catalogue's states.                                                                                                                                                                                                                                                                                               | A spec entry with no map entry, a map entry with no spec entry, an unknown decision or state, and every gap.                        |
| b. Text and controls | Per catalogue state, both ways. Conductor to ours: every matched entry's text is a name in its state (visible text, aria-label, placeholder, title or alt). Ours to Conductor: every visible string and control name in the state has the text of a matched spec entry, fits one of Conductor's templates, is sample data, or is in `tests/parity/ours-only.json` with a decision id or the owner's keep ruling. | A matched entry missing from its state; a string of ours that is none of the three.                                                 |
| c. Layout            | `tests/parity/layout.json`: elements `ui-dimensions.md` measures, each with its evidence, the catalogue state that shows it and a locator. Our computed styles against the measured values.                                                                                                                                                                                                                      | A value outside the tolerance, a locator that finds nothing, a state that does not render.                                          |
| d. Flows             | `bun scripts/parity/flows.ts`: one Chromium test per flow of `ui-map.md` and `services-map.md` the catalogue's app can drive, asserting each step's visible result.                                                                                                                                                                                                                                              | A step whose visible result is not there.                                                                                           |
| e. Backend lists     | Conductor's sidecar methods and tools, Tauri commands, plugin commands, events, settings keys and tables against ours (protocol method tables, our app tools, the Tauri adapter's command map, the settings registry, the migrations). Both ways, by name, with renames and decisions in the map.                                                                                                                | A Conductor name with no match, rename or decision, and a name of ours with no counterpart that is not in the map's ours-only list. |

Templates are Conductor's wording with values in it ("{} tool calls"), read from the bundle's template literals in the places the inventories read strings (`tests/parity/spec/templates.json`, 185). They are not an inventory: nothing has to map them, they only recognise our strings.

Sample data is what the catalogue's seeds write: the string literals of the checked app's `src/catalogue/`, and each line of a multi-line template there (a sample reply or file, with Markdown's line marks dropped, when the line has two words or code punctuation), without the text its ready checks look for and without any string our UI source also holds (that is our wording). The parts of a sample path count, and so does a piece of a sample value at least 12 letters and digits long, which covers a path split over two elements or a line of a sample reply. A shorter word must be a whole sample value, so a label of ours cannot hide inside sample prose. Formatted numbers, sizes, durations, times and counts are skipped too, and so is an environment variable's name (capitals and digits joined by underscores, such as `ANTHROPIC_API_KEY`), which is an identifier both apps show as it is. Nothing else is.

Our design choice: check b matches by name per state, not by selector. The selector in a matched entry tells a person where the element is and lets the layout check reuse it, but a moved element still counts as present. Exact positions are the layout check's job.

### Tolerance

- Lengths read from computed styles (padding, margin, gap, radius, border width, font size): within 0.5px of the measured value. Computed styles return the authored value, so any real difference is at least 1px.
- Rendered sizes read from the element's box (height, width, max width): within 1px, for sub-pixel rounding.
- Font weight: exact.
- A value `ui-dimensions.md` marks INFERRED is checked against the bundle before it goes into `layout.json`, and its entry names what was checked. INFERRED values that were not checked stay out.

### Stage 2

Stage 2 runs Conductor's own frontend on our real backend (D099, `scripts/conductor-reference/live.ts`). Its log, `.context/shots/conductor-live/live.json`, lists every name Conductor's frontend called and what answered: our backend (`answered`), our backend with an error (`failed`), nobody (`refused`), a decision that leaves the feature out (`decided`), or the translator alone (`translator`). `--live <live.json>` adds it to check e:

- A name our backend refused is a gap (`backend-live-refused`) even when the lists match, and so is a name the translator answered without our backend (`backend-live-translator`).
- A decision the decision logs lack is broken (`live-unknown-decision`), and so is a name the spec does not list (`live-unlisted`): the spec is behind the frontend.
- A missing log is broken (`live-missing`). The log stays on this Mac, so CI runs check e on the lists only.

## 4. The instrument check

Before any result is trusted, the harness must find three misses that the owner found by eye on the commit before #345 (29e65165):

1. The sidebar footer's "Add a project" button: an ours-only control in state `sidebar` (check b).
2. The composer's "Write something ..." placeholder: an ours-only string in `composer-empty`, and Conductor's composer placeholder ("Ask to make changes, @mention files, run /commands", renderApp @9294579, in the literal inventory) missing from the state the map puts it in (check b).
3. Tool calls drawn as boxed cards: the tool-call row's padding, radius and height off Conductor's (check c, state `chat-working`).

`bun scripts/parity/instrument.ts <report.json>` fails unless the report holds all three. The `instrument` job in `.github/workflows/parity.yml` checks out 29e65165 in a `git worktree`, installs it, dumps its catalogue with this harness, runs the checks with this commit's spec and map, and runs the instrument script. The map names states 29e65165 does not have yet (such as `chat-tool-calls`), so that run reports them as broken `unknown-state` findings; the instrument job reads the report and ignores the check's exit code.

Result: see section 6.

## 5. CI

`.github/workflows/parity.yml` runs on pull requests that touch the desktop, the harness or its data, and on demand. It builds the dump in Chromium, runs the checks and the flows, and uploads the gap report and the dump as the `parity-report` artefact (14 days). The `instrument` job runs beside it.

The job's mode is the workflow's `PARITY_MODE` setting:

- `report` (now): gaps are reported in the artefact and the run's summary, and do not fail the PR. A broken harness still fails: a state that does not render, a malformed map, an unknown decision id, or a failed instrument check.
- `enforce`: any gap fails the PR. The setting changes to `enforce` once step 5 of the goal has worked the gaps down to zero, in the PR that closes the last one.

## 6. Results

First runs on #347, 7 November 2026. The full gap list is `docs/reports/parity-gaps-2026-11-07.md`.

- Instrument check: passed on run 42313260322 and every run after it. On 29e65165 the harness reports all four parts of the three misses: "Add a project" ours only in `sidebar`; "Write something ..." ours only in `composer-empty`; Conductor's composer placeholder missing from `chat-finished`, where the map puts it; and the tool-call row at padding 0 (Conductor 6), radius 8 (4) and height 36 (32). The same run also finds the sidebar nav block, nav row, workspace row, composer box, settings nav item and git panel tab off Conductor's there, which #345 changed. On the current commit none of the three is reported, and all 13 layout entries are within the tolerance.
- The first run found three of the four parts before the map existed; the fourth needs the composer placeholder matched to a state, which the seeding added. Before trusting a result, a reader should know the reverse direction's sample-data rules were then tightened (section 3), and the instrument check still passed after.
- Counts at c8860c66: 3,814 entries, 703 matched, 57 decided, 3,054 gaps (891 unshown, 2,163 missing); 1,209 ours-only strings (256 distinct); 141 backend names of ours unmatched; 5 of 7 drivable flows pass, and 3 add-project flows are not drivable.

- Step 5's first pass (#363), from run 42330292848's dump of e996940e: 1,007 matched, 847 decided, 771 unshown, 6 wording, 1,183 feature gaps; 64 catalogue states; 514 distinct strings of ours unaccounted for, listed for the owner in the gap report; all 7 drivable flows pass. The instrument check passed on every run.
- Step 5's second pass (#366), from run 42333992371's dump of 3871650d, with the spec rebuilt (3,821 entries): 1,018 matched, 847 decided, 770 unshown, 6 wording, 1,180 feature gaps; 68 catalogue states; 507 distinct strings of ours unaccounted for; all 7 drivable flows pass; the instrument check passed.
- Step 5's third pass (#372), from run 42347440362's dump of 6816ddba: 1,073 matched, 865 decided, 718 unshown, 0 wording, 1,165 feature gaps. Of the 1,883 gaps, 709 are owned by a backlog row and its item, 298 by a row only, and 876 have no owner (section 2, "Owning a gap"). 81 catalogue states; 536 distinct strings of ours unaccounted for; all 7 drivable flows pass; the instrument check passed.

- Stage 2's first live run (D099), 7 November 2026, at 376cd755: Conductor's frontend drew 78 of the 81 catalogue states on our real backend (the other three have no Conductor screen), and our own UI drew all 81 on the same backend and data. Conductor called 93 names; one name can have calls with several outcomes. Our backend answered calls of 60 names, a decision answered 12 (D025: its account, its logging, crash reporting and analytics, and two Help menu items), the translator alone answered 8 (its app identity, its database's name, three native settings with no counterpart of ours, `is_cef_runtime`), and 11 had calls refused, most often our keychain (1,351 calls, which the run never lets through), HTTP to Conductor's own servers (618), the phone relay (312), file watching (175), remote-workspace sync and port-forward events (78 each), its model catalog (78) and `fs|rename` (45). Check e with `--live` adds 19 gaps (11 refused, 8 translator) and nothing broken. The pairs and every difference found are in `.context/shots/conductor-live/` (`differences.md`); the run also found that our Rust `fs_read_text` answers a missing file with code `io` where our UI expects `fs_not_found`.

Not checked yet:

- Stage 2's after-steps: states that differ only by an after-step (a menu, a typed draft, a running turn) show their base screen in the live run, as in stage 1.
- The three add-project paths: the catalogue's scripted git does not answer `rev-parse --show-toplevel` for a new folder, and no state queues a folder-dialog answer or scripts `gh` and clone.
- Layout beyond the 13 elements in `layout.json`; colours and motion.
- Backend renames: a Conductor name whose counterpart of ours has another name is a gap until someone maps the two.
- Left-out features outside the regions read so far: the rules in `rules.ts` catch those whose words name them, and a person decides the rest by bundle region (section 2, "Sorting the gaps").
