# Design

Where the visual design lives, where its values come from, and what holds it.

## Where it lives

- **Tokens:** `apps/desktop/src/styles.css`, as Tailwind v4 `@theme static` variables with light and dark values (`light-dark()`). Colours, fonts, type scale, weights, tracking, radii, shadows and easings come only from these tokens. A low-contrast dark set sits under `data-contrast="low"` on `<html>`, the colour-vision palettes under `data-color-vision`, and the translucent sidebar surfaces under `data-vibrancy="on"`. Durations and layout sizes that are not on the 4px spacing scale are plain variables in the same file.
- **Panel sizes:** `apps/desktop/src/ui/layout-sizes.ts`, because the resizable panels take their sizes from script.
- **Fonts:** Geist and Geist Mono, variable `woff2` files from the official release (v1.9.1, github.com/vercel/geist-font) in `apps/desktop/src/assets/fonts/`, with their SIL Open Font License in `OFL.txt` beside them. The terminal keeps its own Menlo-first font list.
- **Map data:** the Passport world map's land is Made with Natural Earth: the 1:110m land polygons (public domain, naturalearthdata.com, release v5.1.2 of github.com/nvkelso/natural-earth-vector), in `apps/desktop/src/features/passport/land-outline.ts`. `bun scripts/map/land-outline.ts <ne_110m_land.geojson> <output.ts>` writes that file again.
- **Components:** `apps/desktop/src/ui`. Screens build on these and never style raw colours.
- **Visual reference:** none yet beyond the running app shell. When screens are designed, their reference images go in a design folder under docs and are linked here.

## Where the values come from

The values are Conductor 0.92.1's, measured in `research/conductor/ui-dimensions.md` and adopted from its section 10 (D022, D023). They are stored under our own token names. Nothing is copied from Conductor's stylesheet or app bundle (D002). Where a measured colour fails WCAG AA, the nearest passing value in the same hue replaces it; the list is below.

- Type scale, with Conductor's names: `text-3xs` 10/12, `text-2xs` 11/14, `text-xs` 12/16, `text-sm` 14/20 (the body), `text-code` 13/20 (diff and file text), `text-base` 16/24, `text-lg` 18/28, `text-xl` 20/28, `text-2xl` 24/32 (size/line height in px). Each size carries Conductor's letter spacing.
- Weights: `font-light` 350 (tab list, composer text), `font-normal` 400, `font-book` 450 (outline and ghost buttons, sidebar names), `font-medium` 500 (buttons, tabs, labels, headings), `font-semibold` 600 (unread names, rare headers).
- Spacing: one step is 4px. Radii: `xs` 2, `sm` 4, `md` 6 (controls and rows), `lg` 8 (menus, popovers), `xl` 12 (composer, alert dialogs), `2xl` 16, `full`.
- Markdown: chat replies and the file viewer's preview share the `.markdown` rules in `styles.css` (Conductor's small prose size: 14px on 24px lines, paragraphs 16px apart, headings 30, 20, 18 and 15px, inline code as a bordered chip). Code highlighting uses Conductor's Default code theme through the `code-*` tokens (`features/chat/code-theme.ts`).
- Shadows: `xs` (chips, composer), `sm`, `popover` (menus, popovers, tooltips, with a 1px ring), `dialog`, `palette`, `toast`.
- Motion: 150ms with `cubic-bezier(0.4, 0, 0.2, 1)` by default; popovers 100ms; dialogs 200ms; the palette 180ms in and 130ms out; the composer resize 200ms on `ease-spring`. Reduced motion turns it all off.
- The primary button is Conductor's default button: the near-black fill (`primary-fill`), near-white in dark. The clay accent marks the one thing to look at: the active tab underline, the focused input edge, unread dots.

## Component dimensions

| Part                          | Size                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Left sidebar                  | 256px default, 192px to 480px, collapses to 0; 8px resize rail                                                                                                           |
| Centre and right panel        | 65% and 35%, each at least 30%; the right panel collapses to 0 (Conductor asks for 70 and 35 and rescales)                                                               |
| Right panel split             | 50% and 50%; the scripts panel is at least 20% and collapses to its 32px tab strip                                                                                       |
| Title bar, headers, tab strip | 40px (`--titlebar-height`); scripts panel tabs 32px; traffic-light clearance 66px                                                                                        |
| Tabs                          | chat tab 176px; other tabs 128px (80px to 160px); 2px accent underline when active; close button 20px                                                                    |
| Sidebar rows                  | nav row 32px, workspace row 36px, section header 28px; 6px side padding and 6px radius                                                                                   |
| Lists                         | file tree row 28px with 20px indent; changes row 28px; commit row 32px                                                                                                   |
| Menus                         | item 32px (8px by 6px padding); content 4px padding, 8px radius, at least 128px wide                                                                                     |
| Command palette               | 672px wide as measured on the owner's capture (the bundle's research says 576px), at most 500px tall; input 44px; items 44px                                             |
| Dialogs                       | 512px default with 24px padding and 16px gap; sizes 384, 448, 512, 576, 672, 768, 896px                                                                                  |
| Buttons                       | 24, 28, 32 (default) and 44px tall; icon buttons 24, 28 and 32px square                                                                                                  |
| Inputs                        | input and select 32px; textarea at least 60px; checkbox 16px; switch 40 by 20px with a 16px thumb                                                                        |
| Chat                          | column at most 896px with 28px side padding; user bubble aligned right, at most 576px (768px on wide windows) with 12px by 16px padding, in the `highlight-surface` fill |
| Chat rows                     | tool call and thinking rows 32px (6px by 8px, pulled out 8px), 12px icon; a finished turn folds runs of three or more into one row; tool output in the `well` fill       |
| Composer                      | 12px radius, at least 152px tall; editor 88px to 188px; send button 24px                                                                                                 |
| Settings                      | 256px nav; content at most 896px with 40px side padding; rows split by a 1px line and 20px space                                                                         |
| Toasts                        | 356px wide                                                                                                                                                               |
| Terminal and diff             | terminal 12px text at 1.2 line height with 8px padding; diff 13px on 20px lines                                                                                          |
| Icons                         | 12px, 14px and 16px for nearly everything                                                                                                                                |

## AA adjustments

Each row changes one measured value so the pair meets 4.5:1 for text or 3:1 for marks. The rest of Conductor's values are kept as measured.

| Token                                                   | Conductor (light / dark) | Ours (light / dark)   | Why                                                                                                |
| ------------------------------------------------------- | ------------------------ | --------------------- | -------------------------------------------------------------------------------------------------- |
| `fg-muted`                                              | #8e8885 / #a5a09c        | #6e6867 / #a5a09c     | Secondary text, 3.49 on canvas; ours passes on every surface, hover and active too                 |
| `fg-subtle`                                             | #a5a09c / #766f6b        | #6e6867 / #a09a97     | Placeholder text, 2.48 and 3.36 on muted. In light it now equals `fg-muted`                        |
| `sidebar-fg-muted`                                      | at 70% for headers       | at full strength      | Section headers, 2.76 light and 3.99 dark at 70%                                                   |
| `border-strong`                                         | #14100f1a / #ffffff33    | #14100f73 / #ffffff58 | Input edges, 1.24 and 1.85                                                                         |
| `accent`, `unread`                                      | #cca694 / #cca694        | #a2827d / #cca694     | Tab underline and unread dot, 2.22 on canvas; ours also passes on the hover tint                   |
| `accent-hover`                                          | none                     | #96746f / #ddc1b1     | Our value; dark text on it passes                                                                  |
| `on-danger`                                             | #fef1f1                  | #ffffff               | Destructive button label, 4.36 light                                                               |
| `danger-solid`                                          | #dc2828 / #f87272        | #dc2828 / #c62828     | #f87272 cannot carry a light label (2.50)                                                          |
| `success`, `git-added`                                  | #16a249                  | #12853c               | Success text, 3.33 on canvas                                                                       |
| `term-black`                                            | #2c2826 / #47423e        | #2c2826 / #908984     | Terminal text; the dark value is raised to meet 4.5:1 on the low-contrast panel                    |
| `term-green`                                            | #16a249 / #4ade80        | #12853c / #4ade80     | Terminal text, 3.33 light                                                                          |
| `term-yellow`                                           | #ffdc2e / #ffea80        | #887100 / #ffea80     | Terminal text, 3.50 light                                                                          |
| `term-bright-yellow`                                    | #ffe561 / #fff1ad        | #887100 / #fff1ad     | Terminal text, 3.14 light                                                                          |
| `term-magenta`                                          | #cb00eb / #e852ff        | #c300e2 / #e852ff     | Terminal text, 4.43 light                                                                          |
| `term-cyan`                                             | #098dae / #3ed8ef        | #087d9a / #3ed8ef     | Terminal text, 3.87 light                                                                          |
| `term-white`                                            | #eae8e6 / #eae8e6        | #78726c / #eae8e6     | Terminal text, 1.20 light                                                                          |
| `term-bright-red`                                       | #ef4343 / #fca6a6        | #d23b3b / #fca6a6     | Terminal text, 3.78 light                                                                          |
| `term-bright-green`                                     | #21c45d / #85efac        | #16843e / #85efac     | Terminal text, 3.14 light                                                                          |
| `term-bright-blue`                                      | #3c83f6 / #91c3fd        | #3370d3 / #91c3fd     | Terminal text, 3.64 light                                                                          |
| `term-bright-magenta`                                   | #e014ff / #f08fff        | #c211dd / #f08fff     | Terminal text, 3.68 light                                                                          |
| `term-bright-cyan`                                      | #07b6d5 / #7bebf9        | #057e93 / #7bebf9     | Terminal text, 3.15 light                                                                          |
| `term-bright-white`                                     | #f3f2f1 / #ffffff        | #78726b / #ffffff     | Terminal text, 1.18 light                                                                          |
| `success`, `git-added`, `status-review` (colour vision) | #16a249 / #4ade80        | #2463eb / #61a6fa     | Protanopia, deuteranopia and tritanopia turn success and added colours blue                        |
| `danger`, `git-removed` (colour vision)                 | #dc2828 / #f87272        | #b7430a / #fb923c     | Protanopia and deuteranopia turn danger and removed colours orange                                 |
| `danger-solid` (colour vision)                          | #dc2828 / #c62828        | #b7430a / #b7430a     | Filled destructive button; the white label passes                                                  |
| `link`                                                  | #a4847f                  | #8d6964               | Link text, 3.40 on canvas                                                                          |
| `info`                                                  | #0da2e7                  | #0c9adc               | A mark at 2.86 on canvas                                                                           |
| `status-progress`                                       | #e0bb00                  | #a28700               | Status icon, 1.78 on the sidebar                                                                   |
| `git-modified`                                          | #ffdc2e / #ffea80        | #a28700 / #ffea80     | A modified file's mark in the changes list, 1.35 on canvas in light                                |
| `status-review`                                         | #16a249                  | #169e47               | 2.87 on the sidebar hover tint                                                                     |
| `status-done`                                           | #cca694                  | #a2827d               | Status icon, 2.13 on the sidebar                                                                   |
| `status-canceled`                                       | #a5a09c                  | #8f8884               | Status icon, 2.48 on the sidebar. It is now close to backlog grey; its icon shape tells them apart |
| `code-comment`                                          | #a5a09c / #8e8885        | #78716d / #989390     | Code comments on the code fill, 2.48 light and 4.01 dark                                           |
| `code-function`                                         | #cb00eb                  | #c200e0               | Function names in code, 4.24 light                                                                 |
| `code-class`                                            | #e9560c                  | #c7490a               | Class and built-in names in code, 3.47 light                                                       |
| `callout-tip`                                           | #16a34a                  | #12853c               | The Tip callout's title, 3.3 on canvas                                                             |
| Tooltip fill                                            | popover at 50% with blur | solid `raised`        | A see-through fill cannot promise 4.5:1 over whatever is behind it                                 |

The sixteen terminal colours draw text, so each one meets 4.5:1 on both terminal backgrounds (canvas and panel) in light, dark and low-contrast dark. The light ANSI slots that fell short take the nearest passing value in the same hue, and the dark black is raised for the same reason; every changed pair is in the table above. Search matches use the measured highlight pair (`search-highlight` and `search-highlight-fg`). The transparency setting switches the sidebar surfaces to `--color-sidebar-translucent` through `data-vibrancy="on"`.

## Ours, placed in Conductor's layout

The owner ruled that the UI is exactly Conductor's: a control Conductor also has sits where Conductor puts it, a look that carries no feature goes, and a feature of ours sits in the most logical place within Conductor's layout and visual language (D098). One line per feature of ours, with where it went and why:

- Claude Remote Control (D019): a "Remote Control" item in the composer's "+" menu, after Plan mode, and, while on, a chip after the mode chips that opens its status; Conductor turns chat modes on from "+" and shows a mode that is on as a chip ("Auto-accept edits"). Its settings page stays under Agents & environment, since it is about agent chats.
- Helper programs and the Cursor SDK rows: on Advanced, beside the managed agent programs, because Conductor's Advanced holds the app's technical paths and programs.
- The Linear key form: behind "Connect" on Account's Linear row, where Conductor connects Linear.
- The GitHub token field, the sign-in method and "Check again": in the "GitHub" dialog that Account's GitHub row opens ("Manage" or "Connect"), where Conductor keeps its GitHub authentication choices.
- "Add to backlog" for local projects: the outlined "Add to backlog ⌥↵" button beside Create in the new-workspace dialog, Conductor's own look for its cloud version, with its switch on Experimental and the saved workspaces on the Backlog page.
- The agent switch in the model picker: the Agent and Model submenus above Effort, and the agent's name beside each model in search, inside Conductor's picker frame.
- The optional message on the approval card's "No": one more full-width row right under "No", drawn as Conductor's question card draws its "Other…" row, since the message goes only with "No".
- "Yes always" where Conductor offers no second choice, and a choice the second one displaced: more full-width rows in the approval card's one column of choices.
- Archived Home rows' actions (Unarchive, Clear & unarchive, Open in Finder, Copy path): at the right end of the 44px row, drawn as Conductor draws the same actions on its unarchive toast.
- The Checks tab's PR summary and reviewers list: the summary under the inline title editor at the top, the reviewers after Comments, both in Conductor's section style.
- "Open diff" for a turn: an item in the turn's "···" menu, so the footer row ends with the file chips as Conductor's does.
- "Copy summary" for a turn: in the same "···" menu, next to "Copy final message".
- The Connections page (the local port range): in More, after Advanced, with the other rarely changed technical pages; Conductor has no such page.
- Pairing with the user's cloud Worker (CLOUD-07): a "Cloud Workspaces" block on Connections, below the port range, because it connects this Mac to a Worker; Conductor's cloud is a hosted team feature with no self-hosted Worker to pair with.
- The Experimental and Advanced pages are Conductor's; the rows of ours on them (the backlog switch, the big terminal command list, the program rows above) sit in Conductor's row style.
- The MCP servers block and "Search providers" on Agents: the search at the right of the agent tabs, the servers under the tabs, as Conductor's providers page lists its parts.
- The onboarding agent check and first project: under the step list, above Continue, while their step is current, in Conductor's left column.
- Create project's description and "Creates folder" line: in Conductor's places, worded for our flow, which creates the folder first and offers the GitHub repository after.
- The plan file link: at the start of the plan bar's one row, before "Sending to"; Conductor's bar has only its controls and shows the plan in the chat's plan card.
- The chat history's search field: at the top of Conductor's closed-chats popover, for a workspace with many closed chats.
- The Loadout slot's choices (model, effort, fast mode, Remove): a menu on the slot, where Conductor opens its chat-bound model picker; the first slot takes Claude Code models only, since new chats start with Claude Code. Pi's models: a column after OpenCode.
- Review model: Conductor's picker, holding the review effort and fast mode, lists Claude Code's models only, since a review chat starts from the default chat config, whose agent is Claude Code.
- The Default models rows Conductor keeps inside its pickers and ours cannot reach: the Codex thinking level for reviews right after Review model, the default Codex thinking level after Codex personality, and "Models shown in the picker" last.
- "Clear" for a shortcut: a ghost button after Reset on the Keyboard shortcuts row, since Conductor's row has no way to unbind a shortcut.
- Importing a dotenv file into the variables: a banner above the Environment table. Conductor's env files load their variables when an agent starts; ours are a list to import from, so the import needs its own control.
- Removing a variable asks first ("Remove variable?"), since its value leaves the Keychain for good; Conductor's Delete removes it at once.
- Four documented variables of ours (the AWS access key pair, CODEX_ACCESS_TOKEN and OPENAI_API_KEY): after Conductor's eighteen behind "Show documented variables (N)", because our provider forms store keys under those names.

## The owner's rules

These come from the owner and apply to every screen:

- Neutrals plus one assertive accent. The accent marks the one primary action, or the one thing to look at, on a screen. Error, warning and success colours are for function only.
- Text meets WCAG AA contrast in light and dark mode.
- A clear type hierarchy, by size and weight before colour, on one fixed scale. At most two font families: Geist for the interface and Geist Mono for code.
- Elements that belong together share invisible columns and rows on one spacing scale.
- Work surfaces (navigation, forms, tables, settings) use familiar app patterns and stay calm. Empty, loading and error states are designed, never left to defaults. Keyboard focus is always visible, on buttons too (D023).
- Motion is short and explains a change, or there is none.

## What holds them

| Rule                                                                                       | Guard                                                                                    |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Text and mark pairs meet AA in light, dark and low-contrast dark                           | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| The same pairs meet AA in every colour-vision variant, and the terminal colours meet 4.5:1 | `apps/desktop/src/ui/app-14.test.tsx`                                                    |
| The low-contrast set changes dark values only                                              | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| No hard-coded colours outside the tokens                                                   | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| Conductor's type scale names, the five weights, exactly two fonts                          | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| Each font file exists and its licence ships with it                                        | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| Component sizes match the dimensions table                                                 | none yet: checked in review                                                              |
| One accent per screen, function-only status colours, spacing                               | none yet: checked in review                                                              |
| Designed empty, loading and error states                                                   | `LoadableView` and `NotBuiltYet` in `apps/desktop/src/ui`; per screen, checked in review |
