# Conductor UI dimensions and design values

Scope: every design value in Conductor 0.92.1's web UI, measured so the rebuild can match it (D022). Values are recorded as numbers and rules in our own words. No stylesheet, code or asset is copied (D002). Companion to `ui-map.md`.

Legend:
- `R@N` is a character offset in `renderApp-DeUrsznk.js`. `M@N` is in `main-BE1h_1MP.js`. `CSS@N` is in `index-C0NH49rF.css`. `RCSS` is `renderApp-BgVPQyGe.css`. Re-find with `scripts/conductor-re/ctx.py`.
- Sizes are given as px and rem. 1rem is 16px. An app zoom setting scales the whole webview (`--webview-zoom`, default 1).
- VERIFIED is the default: the value was read in the bundle. INFERRED means the value was computed from padding plus line height, or reasoned from use, and was not seen as one number.
- Class names such as `h-8` are Tailwind v4 utilities. One spacing step is 4px (`--spacing: 0.25rem`, CSS@6674).

## 1. Theme scale

### 1.1 Fonts

| Element | Value | Evidence |
| --- | --- | --- |
| UI font | "Geist", then system-ui, sans-serif. Set at runtime; default state value is "Geist" | R@367181, applied near R@368808 |
| UI font before runtime | "SF Pro", system-ui, sans-serif | CSS@13504 (`:root`) |
| Geist file | Variable font, weights 300 to 700 | CSS@396236 (`@font-face`) |
| Mono font | "Geist Mono", monospace. Setting `mono_font`, default "Geist Mono"; the user can pick another | M@433885, R@368808 |
| Diff font | Same as mono font (`--diffs-font-family`) | R@368808 |
| Terminal font | User family (setting `terminal_font_family`, empty by default), then Menlo, Monaco, "Courier New", "Symbols Nerd Font Mono", monospace | R@2962512 |
| Other faces | iA Writer Mono (variable 100 to 900) and Georgia serif, both only for the optional "Tufte" markdown style. Symbols Nerd Font Mono for terminal glyphs | CSS@396525, CSS@411852 |
| Body text rendering | Ligature features `rlig` and `calt` on; chrome text is not selectable; inputs and editors are | CSS@13092 (`body`) |

In normal use two families appear: Geist and Geist Mono.

### 1.2 Type scale

Body text is `text-sm`: 14px on a 20px line (CSS@13092). Each size carries its own letter spacing.

| Token | Size px / rem | Line height px / rem | Letter spacing | Evidence |
| --- | --- | --- | --- | --- |
| text-3xs | 10 / 0.625 | 12 / 0.75 | 0.04em | CSS@8361 |
| text-2xs | 11 / 0.6875 | 14 / 0.875 | 0.02em | CSS@8444 |
| text-xs | 12 / 0.75 | 16 / 1 | 0.01em | CSS@6928, CSS@8529 |
| text-sm | 14 / 0.875 | 20 / 1.25 | 0 | CSS@6973 |
| text-md | 15 / 0.9375 | 22 / 1.375 | -0.005em | CSS@8591 |
| text-base | 16 / 1 | 24 / 1.5 | -0.01em | CSS@7022 |
| text-lg | 18 / 1.125 | 28 / 1.75 | -0.016em | CSS@7071 |
| text-xl | 20 / 1.25 | 28 / 1.75 | -0.02em | CSS@7121 |
| text-2xl | 24 / 1.5 | 32 / 2 | -0.024em | CSS@7170 |
| text-3xl | 30 / 1.875 | 36 / 2.25 | -0.03em | CSS@7217 |
| text-4xl | 36 / 2.25 | 40 / 2.5 | -0.036em | CSS@7269 |
| text-5xl | 48 / 3 | 48 (ratio 1) | -0.04em | CSS@7319 |
| Fixed sizes also used | 13px (diff, file text, toasts), 11px, 10px, 9px, 8px, 7px badges and counters | R@9714870, RCSS `.conductor-toast` |

Named line heights: tight 1.25, snug 1.375, normal 1.5, relaxed 1.625 (CSS@7609). Named tracking: tight -0.025em, normal 0.14px, wide 0.025px, wider 0.6px, widest 1.44px (CSS@7490 to 7584).

### 1.3 Weights

| Weight | Where | Evidence |
| --- | --- | --- |
| 350 | Tab list text, composer editor text | R@4392123, CSS@409164 |
| 400 | Default text | CSS@7390 |
| 450 | Outline, ghost and link buttons; unselected sidebar workspace names | near R@1851036, R@10427593 |
| 500 (medium) | Default and secondary buttons, tabs, labels, headings, selected names. By far the most used emphasis (195 uses) | count, section 8 |
| 600 (semibold) | Rare (18 uses): unread workspace names, some section headers | R@10427546 |
| 200, 700 | Defined, almost unused | CSS@7361, CSS@7467 |

### 1.4 Radii

The base is `--radius: 0.5rem` (8px, CSS@403261). Steps are derived from it.

| Token | px / rem | Uses | Evidence |
| --- | --- | --- | --- |
| rounded-xs | 2 / 0.125 | 6 | CSS@7696 |
| rounded-sm | 4 / 0.25 (radius minus 4px) | 65 | CSS@90197 |
| rounded (plain) | 4 / 0.25 | 39 | CSS@89144 |
| rounded-md | 6 / 0.375 (radius minus 2px) | 182, the default for controls and rows | CSS@90115 |
| rounded-lg | 8 / 0.5 | 66, popovers and menus | CSS@90075 |
| rounded-xl | 12 / 0.75 | 6, composer and alert dialogs | CSS@90249 |
| rounded-2xl | 16 / 1 | 3 | CSS@7773 |
| rounded-full | 9999px | 63, switches, dots, avatars | CSS@90034 |

### 1.5 Shadows

| Token | Value | Use | Evidence |
| --- | --- | --- | --- |
| shadow-xs | 0 1px 2px 0, black 5% | Small chips | CSS@156588 |
| shadow-sm / shadow | 0 1px 3px 0 and 0 1px 2px -1px, black 10% | Rare | CSS@156088 |
| shadow-md | 0 4px 6px -1px and 0 2px 4px -2px, black 10% | Popovers, menus, tooltips (42 uses) | CSS@155673 |
| shadow-lg | 0 10px 15px -3px and 0 4px 6px -4px, black 10% | Dialogs, switch thumb | CSS@155421 |
| shadow-xl | 0 20px 25px -5px and 0 8px 10px -6px, black 10% | Command palette | CSS@156335 |
| Composer | 0 1px 2px 0, black 5% | Composer box | R@9283081 |
| Toast | 0 4px 12px, black 10% | Toasts | RCSS `.conductor-toast[data-styled=true]` |
| Popover ring | 1px ring in `popover-ring` added to every popover | Popovers | R@2164866 |

### 1.6 Layers (z-index)

| Layer | Value | Uses | Evidence |
| --- | --- | --- | --- |
| Sticky headers, tab layers | 10 | 32 | count |
| Sidebar, split handles | 20 | 11 | R@10287258, R@10068240 |
| Sidebar resize rail | 30 | 3 | R@10290849 |
| Overlays, dialogs, popovers, palette | 50 | 59 | R@1843748, R@2739115 |
| Special | 1000, 9999, 2147483646 and above for dev tools | 5 | CSS@20626 |

### 1.7 Motion

| Element | Value | Evidence |
| --- | --- | --- |
| Default transition | 150ms, cubic-bezier(0.4, 0, 0.2, 1) | CSS@8179 |
| Named easings | in (0.4, 0, 1, 1); out (0, 0, 0.2, 1); in-out (0.4, 0, 0.2, 1) | CSS@7885 to 7958 |
| Popovers, menus, selects, tooltips | Fade plus scale from 0.95, 100ms (100ms is the most used duration, 43 uses) | R@2164866 |
| Dialog and overlay | Fade, 200ms. Alert dialog also scales from 0.95 | R@1845826, R@1915779 |
| Command palette | In: 180ms ease-out, from 12px above and transparent. Out: 130ms ease-in, to 8px above | CSS@398584, CSS@398792 |
| Composer resize | 200ms, cubic-bezier(0.25, 1, 0.5, 1) | R@9282737, CSS@409164 |
| Composer background and border | 200ms, cubic-bezier(0.25, 0.1, 0.25, 1) | R@9283081 |
| Buttons | Shadow transition 150ms ease-out; pressed state is an inset black 10% fill | near R@1851036 |
| Switch | 150ms track colour and thumb slide | R@5430049 |
| Spinners and pulses | spin 1s linear; pulse 2s; slow pulse 2.4s | CSS@7999 |
| Reduced motion | Many effects are wrapped in motion-safe or motion-reduce variants | R@9519197 |

### 1.8 Breakpoints and containers

| Element | Value | Evidence |
| --- | --- | --- |
| Width breakpoints | 640px (40rem), 768px (48rem), 1024px (64rem), 1280px (80rem), 1536px (96rem) | CSS `@media` counts |
| Composer container | At 520px or narrower, model labels and some actions collapse into a menu; 400px is a second step | CSS@411084 |
| Container widths | xs 320, sm 384, md 448, lg 512, xl 576, 2xl 672, 3xl 768, 4xl 896, 5xl 1024 (px) | CSS@6691 |

## 2. Colours

### 2.1 Structure

- Neutrals are one warm grey ramp (hue 15 to 30, saturation under 12%). Fifteen steps are used: #ffffff, #fdfcfc, #fafaf9, #f3f2f1, #eae8e6, #d2cecb, #bcb6b3, #a5a09c, #8e8885, #766f6b, #5f5854, #47423e, #2c2826, #211e1c, #1c1917, #141110. Translucent neutrals are #14100f (light) and white (dark) at 5%, 10%, 20%, 60%, 70%, 80% and 90%.
- The one accent is a clay or copper tint, a second warm ramp: #faf7f5, #f3ece7, #e9d9ce, #ddc1b1, **#cca694**, #a4847f, #836967, #795f5d, #7d5e59, #594545, #413030, #2a1e1d. #cca694 marks the active tab underline, the focused input border, unread dots, plan mode and "done". The same ramp also colours warning, highlight, link and tip surfaces.
- Primary actions do not use the accent. The default button is a near-black fill in light mode and a near-white fill in dark mode (`bg-foreground text-background`).
- Status colours are functional only: red destructive, green success and "in review", amber "in progress", blue info and todo-in-progress, plus a rust "internal" colour for staff-only UI.
- Text roles by use count: muted-foreground 734, foreground 210, destructive 87, sidebar-muted-foreground 41, popover-foreground 39.
- Themes: light, dark, "Low-contrast dark mode" (a flag on dark), and colour-vision variants (section 2.6).

### 2.2 Theme tokens, light and dark

Light is `:root, .light` (CSS@400245). Dark is `.dark` (CSS@403276). Translucent values are written as hex with alpha.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| background | #ffffff | #141110 | Main canvas, centre panel |
| sheet-surface | #fdfcfc | #1c1917 | Right panel surface, right-panel terminal |
| sidebar-background | #fafaf9 | #211e1c | Sidebar, headers and tab strips (drawn at 60% opacity over the window) |
| card | #ffffff | #2c2826 | Cards |
| popover | #ffffff | #2c2826 | Menus, popovers |
| muted | #fafaf9 | #211e1c | Composer, user bubble, code blocks |
| accent | #fafaf9 | #2c2826 | Neutral hover or active fill (not the brand accent) |
| secondary | #fafaf9 | #211e1c | Secondary button |
| foreground | #2c2826 | #eae8e6 | Body text, default button fill |
| card-foreground | #211e1c | #f3f2f1 | Card text |
| popover-foreground | #211e1c | #eae8e6 | Menu text |
| accent-foreground | #2c2826 | #f3f2f1 | Text on accent fill |
| secondary-foreground | #2c2826 | #f3f2f1 | Text on secondary |
| muted-foreground | #8e8885 | #a5a09c | Secondary text |
| faint | #a5a09c | #766f6b | Placeholder, faint text |
| helper | #a5a09c | #a5a09c | Helper text |
| primary | #413030 | #f3f2f1 | Checkbox fill, terminal selection |
| primary-foreground | #f3f2f1 | #2c2826 | Text on primary |
| ring | #2c2826 | #bcb6b3 | Focus ring |
| border | #eae8e6 | #ffffff1a | Borders |
| separator | #eae8e6 | #2c2826 | Panel dividers, tab strip lines |
| input / input-border | #14100f1a | #ffffff33 | Input borders, unchecked switch |
| overlay | #000000 | #000000 | Dialog scrim, drawn at 50% with 4px blur |
| sidebar-foreground | #14100fb3 | #ffffffe6 | Sidebar text |
| sidebar-muted-foreground | #14100f99 | #ffffff99 | Sidebar names and labels |
| sidebar-accent | #14100f0d | #ffffff0d | Sidebar hover and selected row |
| sidebar-accent-foreground | #14100fcc | #ffffffe6 | Sidebar selected text |
| sidebar-border | #14100f1a | #ffffff1a | Sidebar borders |
| sidebar-primary | #2c2826 | #eae8e6 | Sidebar primary |
| sidebar-primary-foreground | #f3f2f1 | #ffffff | Text on it |
| sidebar-ring | #a5a09c | #bcb6b3 | Sidebar focus |
| sidebar-blue | #2463eb | #61a6fa | Port forwarding icon |
| popover-accent | #14100f0d | #ffffff0d | Menu item highlight |
| popover-ring | #211e1c0d | #ffffff1a | 1px ring round popovers |
| composer-background | #fafaf980 | #211e1c | Composer surround |
| switch-background | #2c2826 | #eae8e6 | Switch on track |
| switch-foreground | #ffffff | #2c2826 | Switch thumb |
| special | #cca694 | #cca694 | Accent: focused input border |
| highlight-muted | #cca694 | #ddc1b1 | Accent: active tab underline |
| border-highlight | #a4847f | #cca694 | Accent border |
| unread | #a4847f | #cca694 | Unread dot and icons |
| plan-border | #cca694 | #836967 | Plan mode border |
| highlight | #faf7f5 | #2a1e1d | Highlight surface |
| highlight-foreground | #594545 | #f3ece7 | Text on highlight |
| warning | #faf7f5 | #413030 | Warning surface |
| warning-foreground | #594545 | #f3ece7 | Warning text |
| warning-foreground-secondary | #a4847f | #ddc1b1 | Warning secondary text |
| warning-border | #e9d9ce | #594545 | Warning border |
| link | #faf7f5 | #2a1e1d | Link chip surface |
| link-foreground | #a4847f | #cca694 | Link text |
| link-elevated | #f3ece7 | #413030 | Link chip hover |
| tip | #ffffff | #413030 | Tip surface |
| tip-border | #faf7f5 | #594545 | Tip border |
| tip-secondary | #f8f7f6 | #795f5d | Tip badge surface |
| tip-secondary-border | #f3ece7 | #a4847f | Tip badge border |
| tip-muted | #7d5e59 | #f0edea | Tip badge text |
| tip-foreground | #413030 | #ffffff | Tip text |
| destructive | #dc2828 | #f87272 | Error text and destructive fill |
| destructive-foreground | #fef1f1 | #fef1f1 | Text on destructive fill |
| success / positive | #16a249 | #4ade80 (positive stays #16a249) | Success |
| success-foreground / positive-foreground | #f2fdf5 | #f2fdf5 | Text on success fill |
| positive-muted | #f2fdf5 | #143923 | Success surface |
| info | #0da2e7 | #3c83f6 | Info |
| info-foreground | #e7f6fe | #e7f0fe | Text on info |
| internal | #993f29 | #e29878 | Staff-only UI |
| checks-pending | #9a6700 | #d29922 | Pending CI checks |
| app-switcher-bg | #ffffff | #d2cecb | App switcher |
| prose-border | #d2cecb | #47423e | Markdown rules and tables |

Right-panel overrides (`.sheet-canvas`, CSS@397341): `muted` becomes foreground mixed 5% into sidebar-background (light #f0f0ee, dark #2b2826) and `accent` 8% (light #eae9e8, dark #312e2c). These are the active-tab fill in the git panel.

Low-contrast dark mode (`html.dark.low-contrast-dark`, CSS@397815) replaces: background #1f1c1a, sheet-surface #24211e, foreground #c5c2be, highlight #3f3331, highlight-foreground #e3dad3, muted #2f2b28, secondary #2f2b28, card #37322f, accent #37322f, card, accent and secondary foregrounds #d0ccc8, sidebar-background #292623.

### 2.3 Status, todo and git colours

| Token | Light | Dark |
| --- | --- | --- |
| status-backlog / hover | #8e8885 / #5f5854 | #8e8885 / #bcb6b3 |
| status-in-progress / hover | #e0bb00 / #b89900 | #ffdc2e / #ffe561 |
| status-in-review / hover | #16a249 / #157f3c | #4ade80 / #85efac |
| status-done / hover | #cca694 / #a4847f | #cca694 / #ddc1b1 |
| status-canceled / hover | #a5a09c / #8e8885 | #a5a09c / #bcb6b3 |
| todo-in-progress | #2463eb | #61a6fa |
| todo-completed | #16a249 | #4ade80 |
| todo-pending | #766f6b | #a5a09c |
| git-green (added count) | #16a249 | #4ade80 |
| git-red (removed count) | #dc2828 | #f87272 |
| git-yellow | #ffdc2e | #ffea80 |
| git-gray | #a5a09c | #a5a09c |

### 2.4 Diff colours

| Token | Value (both modes) | Rule |
| --- | --- | --- |
| git-new-line (added base) | #1bc559 | Base colour for added lines |
| git-new-line-bg | added base at 10% | Line background |
| git-new-line-border | added base at 60% | Gutter marker |
| git-new-line-highlight | added base at 20% | Changed word highlight |
| git-removed-line (removed base) | #e60000 | Same three mixes at 10%, 60%, 20% |
| git-selection | #99daff (light only) | Selected diff lines |
| Diff library themes | "Pierre" family, 10 variants: Dark, Dark Soft, Dark Vibrant, Dark Protanopia and Deuteranopia, Dark Tritanopia, and the same five for light. Default pierre-dark and pierre-light | R@892877 |
| Diff background | Follows `background` (`--diffs-dark-bg`) | CSS@398186 |

Evidence: CSS@401928 to 402215, R@319308 (the mixes are generated at 10%, 60%, 20%).

### 2.5 Terminal ANSI palette

The terminal background is `background` in the centre and `sheet-surface` in the right panel. Text and cursor are `foreground`. Selection is `primary` with `primary-foreground` (R@2962512, CSS@397341).

| Colour | Light | Dark | Bright light | Bright dark |
| --- | --- | --- | --- | --- |
| black | #2c2826 | #47423e | #766f6b | #a5a09c |
| red | #dc2828 | #f87272 | #ef4343 | #fca6a6 |
| green | #16a249 | #4ade80 | #21c45d | #85efac |
| yellow | #ffdc2e | #ffea80 | #ffe561 | #fff1ad |
| blue | #2463eb | #61a6fa | #3c83f6 | #91c3fd |
| magenta | #cb00eb | #e852ff | #e014ff | #f08fff |
| cyan | #098dae | #3ed8ef | #07b6d5 | #7bebf9 |
| white | #eae8e6 | #eae8e6 | #f3f2f1 | #ffffff |

### 2.6 Code highlighting and colour-vision variants

- Code themes offered: Default, Catppuccin Latte (light), Catppuccin Macchiato, Catppuccin Mocha, Tokyo Night, Gruvbox Dark, Solarized Dark (R@361878). Highlighting uses Shiki for code blocks and the Pierre themes for diffs.
- The Default code theme is built from Conductor's own palette (R@365136, INFERRED to be the default selection):

| Role | Light (HSL) | Dark (HSL) |
| --- | --- | --- |
| text | 25 8% 16% | 30 8% 91% |
| background | 30 9% 95% | 24 9% 12% |
| comment (italic) | 23 5% 63% | 22 4% 54% |
| keyword, operator | 0 72% 51% | 0 91% 71% |
| string | 360 13% 31% | 22 39% 78% |
| number, attribute | 221 83% 53% | 213 94% 68% |
| function, title | 292 100% 46% | 292 100% 66% |
| class | 20 90% 48% | 27 96% 61% |
| tag | 142 72% 29% | 142 69% 58% |

- "Accessible colors" setting (R@319308): Deuteranopia/Protanopia turns every success and added colour blue (light hsl(221 83% 53%), dark hsl(213 94% 68%)) and every destructive and removed colour orange (light hsl(20 90% 48%), dark hsl(27 96% 61%)). Tritanopia turns success and added colours blue and leaves red as is.

### 2.7 Other colour rules

- Scrollbars: 8px wide, transparent track, thumb `foreground` at 20%, radius 5px (CSS@14262).
- Text selection: no custom colour; the OS default is used.
- Toasts have their own neutral set: light white surface, hsl(0 0% 93%) border, hsl(0 0% 9%) text; dark black surface, hsl(0 0% 20%) border, hsl(0 0% 99%) text (RCSS `.conductor-toast-viewport`).

## 3. App shell

| Element | Value | Evidence |
| --- | --- | --- |
| Left sidebar default width | 256px (16rem) | M@433255 |
| Left sidebar min / max | 192px (12rem) / 480px (30rem); also capped at 40% of the window | R@10559456, R@10538345 |
| Left sidebar collapsed | 0 (hidden completely); width is remembered in setting `left_panel_width` | R@10287172 |
| Sidebar surface | sidebar-background at 60%, 1px right border in sidebar-border | R@10287258 |
| Sidebar resize rail | 8px wide, centred on the right edge, above content | R@10290849 |
| Sidebar top strip | 32px tall including 8px top padding; left padding 16px plus traffic-light clearance plus 4px | R@10538552 |
| Sidebar top-right controls | 8px from top, 14px from right, 8px apart | R@10538816 |
| Traffic-light clearance | 66px divided by app zoom; 13px plus 53px divided by zoom when native lights are scaled; 0 in full screen | CSS@13628 |
| Sidebar toggle (sidebar closed) | 12px from top, 16px plus clearance plus 4px from left, 16px icon | R@10292678 |
| Title bar height | 40px, the height of the centre and panel headers. INFERRED; Conductor has no separate title bar element | R@10128177 |
| Centre panel | Default 70%, min 30% | R@10204786 |
| Right panel | Default 35%, min 30%, collapsible to 0. The defaults add up to 105%, so the panel library rescales them (INFERRED about 67% and 33%) | R@5025923 |
| Right panel split | Git panel on top, default 50%, min 0. Scripts and terminal panel below, default 50%, min 20%, collapses to 32px | R@5025415, R@5025619, R@5024262 |
| Panel drag handle | 1px separator line, 4px hit area; minimum hit target 20px with a mouse and 30px with touch | R@2125082, R@5025415 |
| Centre split handle (tab groups) | 1px line, 8px hit area, line turns ring colour on hover | R@10068240 |
| Workspace header | 40px tall, 16px side padding, bottom border, sidebar-background fill | R@10128177 |
| Centre tab strip | 40px tall, 16px left padding, bottom separator border, sidebar-background fill | R@10096876 |
| Tab list | 40px tall, 8px gap, weight 350 | R@4392123 |
| Tab | 40px tall, 2px top padding, text-sm medium, muted text; active: foreground text and a 2px bottom border in highlight-muted (the accent) | R@4392700 |
| Tab label | 8px side padding, text-xs medium, truncates | R@4394070 |
| Chat tab width | 176px (11rem), fixed | R@10076048 |
| Terminal, file and browser tab width | 128px (8rem), min 80px, max 160px | R@10078271 |
| Tab close button | 20px square with 12px icon, shown on hover | R@4395170 |
| Git panel header | 40px tall, 16px left and 8px right padding | R@2249833 |
| Git panel tab bar | 40px tall, 8px padding, 4px gap. Tabs are small ghost buttons (28px); the active one has the accent (neutral) fill | R@2554131 |
| Scripts panel tab strip | 32px tall tabs, text-xs medium labels with 8px padding and 6px gap, active tab 2px bottom accent border | R@5010867 |
| Terminal body | 8px padding round the terminal, inner radius 6px | R@11694622, R@11695043 |
| Status or footer bar | None in the user UI. A developer metrics bar exists only in internal builds. INFERRED from its absence | ui-map.md section 6 |
| Settings view | Left nav 256px with 6px side padding; top bar 40px with 40px side padding; content scrolls with 40px side padding, 24px top, 32px bottom; content max width 896px (56rem) | R@11776249, R@11781265, R@11781403 |

## 4. Lists and rows

Row heights marked INFERRED are padding plus the 20px line of text-sm or the 16px icon.

| Element | Value | Evidence |
| --- | --- | --- |
| Sidebar nav row (Home, Create, Search) | 6px padding on all sides, 8px gap, 6px radius, 16px icon box. Height 32px INFERRED | R@10407551 |
| Sidebar nav block | Column with 2px gap, 6px padding, bottom border | R@10407150 |
| Workspace row | 8px top and bottom, 6px right, left 6px, 12px or 20px by nesting depth, 6px radius. First line is 20px tall with 6px gap; leading icon 16px with 2px top offset. Height 36px INFERRED | R@10438956, R@10441050, R@10441767 |
| Workspace row states | Hover and selected fill sidebar-accent; selected text sidebar-accent-foreground. Name weight 450 by default, 500 selected, 600 unread (weight mapping INFERRED) | R@10438815, R@10427501 |
| Workspace row extras | Diff counts text-xs; "Draft" pill text-3xs with 4px by 2px padding; badge icons 12px | R@10430669, R@10429339 |
| Sidebar section header | 6px padding, 8px gap, 6px radius; title text-xs medium in sidebar-muted-foreground at 70%. Height 28px INFERRED | R@10458024, R@10459644 |
| Sidebar section block | 6px sides, 6px top, 12px bottom; rows 4px apart | R@10462269, R@10464029 |
| File tree row | 28px tall, 20px indent per level | R@2538905 |
| Changes list row | 4px top and bottom, 12px sides, 8px outer margin, 6px gap, 6px radius, text-sm, 16px icon. Height 28px INFERRED | R@2618240 |
| Changes section header | 32px tall | R@2624650 |
| Changes filter row | 28px tall, muted fill, 12px sides, 6px radius | R@2623838 |
| Commit or turn row | 32px tall, 12px sides, 4px outer margin, 8px gap | R@2627338 |
| Command palette | Max width 576px (36rem), max height 500px, top edge at 50% minus 250px, 6px radius, 1px border, shadow-xl, sidebar-background fill | R@2739115 |
| Command palette input | 44px tall, text-sm, 12px side padding, bottom border, 20px search icon | R@2740717, R@2740482 |
| Command palette item | 8px sides, 12px top and bottom, 20px icon. Height 44px INFERRED. Groups have 8px side padding | R@2739641 |
| Other command lists | Item 8px by 4px, 4px radius. Height 28px INFERRED | R@2743055 |
| Menu content | 4px padding, 8px radius, 1px ring, shadow-md, min width 128px | R@2164866 |
| Menu item | 8px sides, 6px top and bottom, 8px gap, 6px radius, text-sm, 16px icon in muted colour. Height 32px INFERRED | R@2175774 |
| Menu shortcut hint | text-xs, widest tracking, muted, 16px left padding | R@2179737 |
| Select popup item | 6px top and bottom, 8px left, 32px right (check mark room) | R@1953830 |
| Menu separator | 1px, 4px vertical margin, bleeds 4px each side | R@1954742 |
| Popover widths in use | 288px most common, also 224, 256, 320, 384, 448px; padding 12px or 16px | count of `w-72` and others |
| Dialog default | Max width 512px (32rem), 24px padding, 16px gap, 6px radius, 1px border, shadow-lg; centred with 32px space above and below, or top at the larger of 32px and 50% minus 250px | R@1845826, R@1845594 |
| Dialog title and text | Title text-xl (20px) medium, line height 1, tight tracking; description text-sm muted; footer buttons right aligned, 8px apart | R@1847905, R@1847544 |
| Dialog widths in use | Small 384px (5 uses), medium 448px (4), large 512px, the default (12), extra large 576px (6), 672px (3), 768px (3), 896px (1), 520px fixed (2), 525px fixed (2) | tally of `DialogContent` classes |
| Alert dialog | Max width 512px, 24px padding, 16px gap, 12px radius, title text-lg (18px) medium | R@1915779, R@1917960 |
| Side sheet | 75% wide, max 384px | R@10685558 |
| Settings page | Title text-2xl (24px) medium with 8px below; sections 24px apart | R@8708792, R@8708408 |
| Settings row | 1px top border and 20px top padding; rows 20px apart; label and control 32px apart; title row min 28px, medium; description text-sm muted 2px below; detail text-xs 4px below | R@8702401 to R@8703070, R@8699027 |
| Settings nav item | 8px sides, 6px top and bottom, 12px gap, 6px radius, text-sm. Height 32px INFERRED | R@11772346 |
| Toast | 356px wide, 16px padding, 8px gap, 8px radius, 1px border, 13px text, title weight 500; action button 24px tall with 8px padding; close button 20px circle | RCSS `.conductor-toast` |

## 5. Chat and composer

| Element | Value | Evidence |
| --- | --- | --- |
| Message column | Max width 896px (56rem), centred, 28px side padding | R@9613315 |
| Turn block | 28px sides, 8px top and bottom, 4px gap | R@9595770 |
| Gap between messages in a turn | 4px | R@9595236 |
| User message | Extra 12px top and bottom | R@9594110 |
| User bubble | Right aligned; max width 576px, 768px on windows 1024px and wider; 12px top and bottom, 16px sides; 4px radius; muted fill; text-sm with preserved line breaks; colour change 300ms | R@9519197, R@9519641 |
| Assistant text | Markdown at 14px on a 24px line (ratio 1.714); paragraphs 16px apart | CSS@39516, R@8131838, R@9738096 |
| Tool call row (collapsed) | 8px gap, 6px top and bottom, 8px sides pulled out by 8px so text aligns, 4px radius, hover fill muted at 50%. Height 32px INFERRED | R@8747084 |
| Tool output block | Mono text-xs medium, 12px padding, 6px radius, 1px border, accent (neutral) fill. Errors use destructive at 10% fill and 20% border | R@8748778, R@8751079 |
| Tool detail text | text-xs muted, 20px left indent, 8px above | R@8750013 |
| Code block in chat | text-sm, min height 35px, muted fill, 6px radius | R@5780293 |
| Composer placement | Fixed to the bottom of the chat, 16px side padding, same 896px column | R@9608517 |
| Composer box | Muted fill, 1px border, 12px radius, shadow 0 1px 2px black 5%. Padding 16px top, 16px right, 12px bottom, 18px left. Min height 152px | R@9315568, R@9283081 |
| Composer box, minimized | 16px sides, 12px top and bottom, no min height | R@9315568 |
| Editor area | Min height 88px, max height 188px then scrolls; minimized min 28px | R@9282737 |
| Editor text | Weight 350; min height 48px, 20px when minimized; height change 200ms | CSS@409164 |
| Toolbar row | 40px reserved under the editor. Mode controls sit 12px from the bottom left with 2px gaps; send area 28px tall, 12px from the bottom right, 6px gaps | R@9316557, R@9281326, R@9281399 |
| Composer toggles | 24px square; active state is a round foreground fill | R@8909768 |
| Send and stop button | 24px square (icon size xs), 4px radius, foreground fill, 16px icon | R@8912900 |
| Placeholder colour | faint | CSS@410986 |

## 6. Controls

### 6.1 Buttons

Base: inline flex, 8px gap, 6px radius, disabled at 50% opacity, icons do not shrink (near R@1851036).

| Size | Height | Side padding | Text | Gap | Radius |
| --- | --- | --- | --- | --- | --- |
| default | 32px (2rem) | 12px | text-sm | 8px | 6px |
| xs | 24px (1.5rem) | 8px | text-xs | 6px | 4px |
| sm | 28px (1.75rem) | 10px | text-xs | 6px | 6px |
| lg | 44px (2.75rem) | 32px | inherits | 8px | 8px |
| icon | 32 by 32px | none | text-sm | none | 6px |
| iconSm | 28 by 28px | none | text-xs | none | 6px |
| iconXs | 24 by 24px | none | text-xs | none | 4px |

Variants: default (foreground fill, weight 500), destructive, outline (1px input border, weight 450), outlineDestructive, secondary, ghost (foreground at 90%, hover sidebar-accent, weight 450), link (foreground at 70%). Buttons switch off their focus ring (`focus-visible:ring-none`), so keyboard focus on a button is not visible in Conductor.

Toggle button: default 32px tall, 8px sides, text-sm, 6px radius; small 24px tall, text-xs, 4px radius (R@5648982).

### 6.2 Inputs and selection controls

| Element | Value | Evidence |
| --- | --- | --- |
| Text input | 32px tall, 12px sides, 8px top and bottom, text-sm, 6px radius, 1px input border; on focus the border turns `special` (the accent), no ring | R@1862662 |
| Textarea | Min height 60px, same padding and focus rule | R@8142806 |
| Select trigger | 32px tall, 12px left, 10px right, 4px gap, 6px radius, 12px chevron | R@1949122 |
| Label | text-sm medium, line height 1 | R@1863262 |
| Checkbox | 16px (small 14px); check icon 14px (small 12px); 4px radius; primary border; checked fill primary | R@2159012 |
| Switch | Track 40 by 20px, fully round; thumb 16px with shadow-lg, moves 21px when on and sits 1px in when off; on track switch-background, off track input; 150ms | R@5430049 |
| Slider | Track 6px tall, primary at 20%; thumb 16px with primary border at 50% | R@10660150 |
| Badge | 8px sides, 2px top and bottom, text-xs mono uppercase, 0.6px tracking, 6px radius, 1px border. Height 22px INFERRED | R@1963130 |
| Tooltip | text-xs, 0.025px tracking, 8px left, 4px top and bottom, 8px right (4px when it shows a shortcut), 4px radius, popover at 50% with 12px backdrop blur, 1px ring, shadow-md, 100ms | R@493798 |
| Shortcut chip | 16px tall, min 20px wide, 4px sides, 10px text, 4px radius, muted fill, 1px border | R@11762084 |
| Alert | 8px radius, 1px border, 16px padding; icon at 16px from top and left; text indented 28px | R@2512736 |
| Skeleton | Pulse, 6px radius, muted fill | R@1863807 |

### 6.3 Icons, borders and focus

| Element | Value | Evidence |
| --- | --- | --- |
| Icon set | Lucide for UI icons; Material file icons for file types | ui-map.md section 8 |
| Icon sizes by use | 12px: 304 uses. 16px: 302. 14px: 270. 20px: 48. 24px: 25 (mostly button boxes) | counts of `size-*` and `h-N w-N` |
| Border width | 1px almost everywhere (`border` 145, `border-t` 50, `border-b` 47); 2px only for active tab underlines | count |
| Focus ring, common | 1px ring in `ring` colour (38 uses); inset 1px in dense lists (13) | count |
| Focus ring, larger controls | 2px ring with 2px offset on tabs, switches and checkboxes (28 and 18 uses) | R@4392700, R@5430049 |
| Inputs | Accent border instead of a ring | R@1862662 |
| Opacity steps | 0 and 100 for hover reveal; 50 for disabled; 60, 70, 80 for de-emphasis | count |

## 7. Diff and terminal

| Element | Value | Evidence |
| --- | --- | --- |
| Diff font size / line height | 13px / 20px. These are the diff library's defaults; Conductor sets only the font family (INFERRED from no override found) | R@1040418, R@368808 |
| Diff line-number column | Min width 3 characters | R@1071010 |
| Diff gaps | 8px block and inline gap; 6px scrollbar gutter; tab width 2 | R@1039781, R@1056262 |
| File text view | Mono 13px, 16px padding | R@9714870 |
| Editor gutter (CodeMirror) | Line numbers 5px left, 3px right padding, min 20px wide (library default) | R@4800279 |
| Terminal font size | 12px default, setting `terminal_font_size` | M@433706 |
| Terminal line height | 1.2 (14.4px at 12px) | R@4363754 |
| Terminal cursor | Block, blinking; outline when unfocused | R@4363743 |
| Terminal output kept | Setting `terminal_scrollback_limit_bytes`, default 10,000,000 bytes | M@303718 |

## 8. Rhythm in use

Counted over the unique class strings in both bundles (6,583 class lists). The bundle stores each component once, so a count is the number of places a class is written, not how often it shows on screen.

| Group | Most used (count) |
| --- | --- |
| Padding | px-2 (140), py-1.5 (84), px-3 (69), py-2 (64), py-1 (49), px-4 (48), px-1.5 (48), p-4 (44), p-1 (42), p-3 (34), px-1 (32), pr-2 (26), pl-2 (25), py-3 (24), py-0.5 (21) |
| Gap | gap-2 (282), gap-1 (151), gap-1.5 (112), gap-3 (69), space-y-2 (45), space-y-1 (30), gap-0.5 (24), space-y-4 (22), gap-4 (17) |
| Text size | text-xs (343), text-sm (297), 10px (17), 8px (9), text-lg (8), text-base (8), text-2xs (7), 13px (6), 11px (6), text-2xl (6) |
| Height | h-full (126), h-4 (54), h-3.5 (44), h-7 (41), h-10 (41), h-3 (38), h-8 (34), h-6 (34), h-5 (20), h-9 (15) |
| Icon size | size-3 (249), size-4 (241), size-3.5 (221), size-5 (40), size-6 (19) |
| Radius | rounded-md (182), rounded-lg (66), rounded-sm (65), rounded-full (63) |
| Weight | medium (195), normal (26), semibold (18), 450 (5) |
| Duration | 100ms (43), 150ms (15), 200ms (10) |

The rhythm is 4px, 6px and 8px for padding and gaps; 28px, 32px and 40px for control and header heights; 12px to 16px for icons; text-xs and text-sm for nearly all text.

## 9. Contrast check of Conductor's pairs

Method: WCAG 2.x relative luminance; translucent colours blended onto their real background first. The calculator was checked on known cases: black on white gives 21.0 and #767676 on white gives 4.54. Text needs 4.5:1; marks, icons and input edges need 3:1. Script: `/tmp/oslo-dims/contrast.py` (scratch, not kept).

Pairs that fail:

| Mode | Pair | Ratio | Needs | Use |
| --- | --- | --- | --- | --- |
| light | muted-foreground on background | 3.49 | 4.5 | Secondary text (the most used text colour) |
| light | muted-foreground on sidebar-background or muted | 3.35 | 4.5 | Secondary text on side panels and composer |
| light | muted-foreground on sidebar hover | 3.01 | 4.5 | Hovered rows |
| light | sidebar-muted-foreground at 70% on sidebar | 2.76 | 4.5 | Sidebar section headers |
| dark | same | 3.99 | 4.5 | same |
| low-contrast dark | same | 3.88 | 4.5 | same |
| light | faint on muted | 2.48 | 4.5 | Composer placeholder |
| dark | faint on muted | 3.36 | 4.5 | same |
| low-contrast dark | faint on muted | 2.84 | 4.5 | same |
| light | destructive-foreground on destructive | 4.36 | 4.5 | Destructive button label |
| dark | destructive-foreground on destructive | 2.50 | 4.5 | same |
| light | success on background | 3.33 | 4.5 | Success text, added-line counts |
| light | warning-foreground-secondary on warning | 3.18 | 4.5 | Warning secondary text |
| light | link-foreground on link / on background | 3.18 / 3.40 | 4.5 | Link text |
| light | highlight-muted and special (#cca694) on background | 2.22 | 3.0 | Active tab underline, focused input border |
| light | status-in-progress on sidebar | 1.78 | 3.0 | Status icon |
| light | status-done on sidebar | 2.13 | 3.0 | Status icon |
| light | input on background | 1.24 | 3.0 | Input border |
| dark | input on background | 1.85 | 3.0 | Input border |

`border` (1.22 light, 1.30 dark) also falls under 3:1, but it marks decorative dividers, which WCAG does not cover.

Pairs that pass include: foreground on every surface (13.6 to 15.4), dark-mode muted text (5.6 to 7.3), sidebar names (4.86 light, 6.74 dark), error text (4.80, 6.84), the focus ring (14.6, 9.38) and the unread dot (3.25, 7.46).

## 10. Tokens to adopt

Our names are those in `apps/desktop/src/styles.css`. "Adjusted" marks a value changed from Conductor's to meet AA, as D022 requires; each adjustment is the nearest passing colour in the same hue, checked against every background the token sits on.

### 10.1 Colours, mapped to existing names

| Our token | Light | Dark | Conductor source | Note |
| --- | --- | --- | --- | --- |
| --color-canvas | #ffffff | #141110 | background | |
| --color-surface | #fafaf9 | #211e1c | sidebar-background | Sidebar, headers, tab strips |
| --color-raised | #ffffff | #2c2826 | popover, card | |
| --color-hover | #14100f0d | #ffffff0d | sidebar-accent, popover-accent | 5% tint, not a solid colour |
| --color-active | #eae9e8 | #312e2c | right-panel accent mix (8%) | Active segmented tab; selected sidebar row uses --color-hover |
| --color-overlay | #00000080 | #00000080 | overlay at 50% | Add a 4px backdrop blur |
| --color-border | #eae8e6 | #ffffff1a | border | Decorative only |
| --color-border-strong | #14100f73 | #ffffff56 | input (#14100f1a, #ffffff33) | Adjusted: alpha raised to 45% and 34% to reach 3:1 (3.06 light, 3.05 dark) |
| --color-fg | #2c2826 | #eae8e6 | foreground | |
| --color-fg-muted | #716b69 | #a5a09c | muted-foreground (#8e8885) | Light adjusted; passes 4.5 on canvas, surface and hover |
| --color-fg-subtle | #78726d | #958e8a | faint (#a5a09c, #766f6b) | Both adjusted. In light it is now almost the same as fg-muted |
| --color-accent | #a4847f | #cca694 | special, highlight-muted, unread | Light adjusted to Conductor's own darker clay step (3.40 on canvas). Marks only: tab underline, focused input, unread |
| --color-accent-hover | #8d6964 | #ddc1b1 | border-highlight ramp | Light value is ours (next clay step down) |
| --color-on-accent | #14100f | #141110 | none | Conductor never puts text on the accent; 5.57 and 8.46 |
| --color-focus | #2c2826 | #bcb6b3 | ring | |
| --color-danger | #dc2828 | #f87272 | destructive | |
| --color-danger-solid | #dc2828 | #c62828 | destructive | Dark adjusted: #f87272 cannot carry light text |
| --color-on-danger | #ffffff | #ffffff | destructive-foreground (#fef1f1) | Adjusted: 4.80 light, 5.62 dark |
| --color-warning | #9a6700 | #d29922 | checks-pending | Text colour; 4.66 on surface, 6.57 dark |
| --color-success | #12853c | #4ade80 | success | Light adjusted from #16a249 |

### 10.2 New colour tokens

| New token | Light | Dark | Conductor source | Note |
| --- | --- | --- | --- | --- |
| --color-panel | #fdfcfc | #1c1917 | sheet-surface | Right panel and its terminal |
| --color-separator | #eae8e6 | #2c2826 | separator | Panel and tab strip lines |
| --color-sidebar-fg | #14100fb3 | #ffffffe6 | sidebar-foreground | |
| --color-sidebar-fg-muted | #14100f99 | #ffffff99 | sidebar-muted-foreground | Use at full strength for section headers, never at 70% |
| --color-primary-fill | #2c2826 | #eae8e6 | foreground as button fill | Default button fill; label is --color-canvas |
| --color-check | #413030 | #f3f2f1 | primary | Checkbox fill, terminal selection; text on it #f3f2f1 / #2c2826 |
| --color-switch-on | #2c2826 | #eae8e6 | switch-background | Thumb #ffffff / #2c2826 |
| --color-popover-ring | #211e1c0d | #ffffff1a | popover-ring | 1px ring on popovers |
| --color-warning-surface | #faf7f5 | #413030 | warning | Text #594545 / #f3ece7, border #e9d9ce / #594545 |
| --color-highlight-surface | #faf7f5 | #2a1e1d | highlight | Text #594545 / #f3ece7 |
| --color-link | #8d6964 | #cca694 | link-foreground | Light adjusted from #a4847f |
| --color-unread | #a4847f | #cca694 | unread | Mark, passes 3:1 |
| --color-info | #0da2e7 | #3c83f6 | info | Marks only |
| --color-internal | #993f29 | #e29878 | internal | Only if staff UI is kept |
| --color-status-backlog | #8e8885 | #8e8885 | status-backlog | |
| --color-status-progress | #ab8f00 | #ffdc2e | status-in-progress | Light adjusted from #e0bb00 |
| --color-status-review | #16a249 | #4ade80 | status-in-review | Passes as a mark |
| --color-status-done | #a4847f | #cca694 | status-done | Light adjusted from #cca694 |
| --color-status-canceled | #a5a09c | #a5a09c | status-canceled | Under 3:1 in light (2.48); pair it with a shape or label |
| --color-git-added / --color-git-removed | #12853c / #dc2828 | #4ade80 / #f87272 | git-green, git-red | Count text; light added adjusted |
| --color-diff-added | #1bc559 | #1bc559 | git-new-line | Line fill 10%, marker 60%, word 20% |
| --color-diff-removed | #e60000 | #e60000 | git-removed-line | Same mixes |
| --color-term-* (16) | table 2.5 | table 2.5 | terminal-* | Terminal ANSI colours |

Low-contrast dark mode, if we offer it, takes the replacements in section 2.2 as a third token set.

### 10.3 Type, weight, radius, shadow, motion and layout

| Our token | Value | Conductor source | Note |
| --- | --- | --- | --- |
| --font-sans | "Geist", system-ui, sans-serif | R@367181 | Conflicts with our "system UI font, no font files ship" rule; see open points |
| --font-mono | "Geist Mono", ui-monospace, monospace | M@433885 | Same conflict |
| --text-2xs | 11px, line 14px, tracking 0.02em | text-2xs | New |
| --text-xs | 12px, line 16px, tracking 0.01em | text-xs | Same size as ours today |
| --text-sm | 14px, line 20px, tracking 0 | text-sm | Body text. Ours today is 13px |
| --text-code | 13px, line 20px | diff and file view | New |
| --text-base | 16px, line 24px, tracking -0.01em | text-base | Ours today is 14px and is the body; body moves to --text-sm |
| --text-lg | 18px, line 28px, tracking -0.016em | text-lg | Alert dialog titles |
| --text-xl | 20px, line 28px, tracking -0.02em | text-xl | Dialog titles |
| --text-2xl | 24px, line 32px, tracking -0.024em | text-2xl | Settings page titles. Ours today is 32px |
| --font-weight-normal / medium / semibold | 400 / 500 / 600 | as named | Keep |
| --font-weight-book | 450 | font-450 | New: ghost and outline buttons, sidebar names |
| --font-weight-light | 350 | font-[350] | Optional: tab list and composer text |
| --radius-xs | 2px | rounded-xs | New |
| --radius-sm | 4px | rounded-sm | Same |
| --radius-md | 6px | rounded-md | Same; default for controls and rows |
| --radius-lg | 8px | rounded-lg | Ours today is 10px |
| --radius-xl | 12px | rounded-xl | New: composer, alert dialog |
| --radius-full | 9999px | rounded-full | Same |
| --shadow-xs | 0 1px 2px 0 black 5% | shadow-xs | New: composer, chips |
| --shadow-popover | 0 4px 6px -1px black 10%, 0 2px 4px -2px black 10%, plus 1px popover-ring | shadow-md plus ring | Replaces ours |
| --shadow-dialog | 0 10px 15px -3px black 10%, 0 4px 6px -4px black 10% | shadow-lg | New |
| --shadow-palette | 0 20px 25px -5px black 10%, 0 8px 10px -6px black 10% | shadow-xl | New |
| --default-transition-duration | 150ms | CSS@8179 | Ours today is 120ms |
| --default-transition-timing-function | cubic-bezier(0.4, 0, 0.2, 1) | CSS@8214 | |
| --ease-out | cubic-bezier(0, 0, 0.2, 1) | CSS@7921 | Ours today is (0.2, 0, 0, 1) |
| --ease-spring | cubic-bezier(0.25, 1, 0.5, 1) | composer | New: composer resize |
| --duration-popover | 100ms | popovers | New |
| --duration-dialog | 200ms | dialogs | New |
| --traffic-lights-clearance | 66px | CSS@13628 | Ours today is 80px |
| --titlebar-height | 40px | header height, INFERRED | Ours today is 44px |

### 10.4 Component dimensions for docs/design.md

- Left sidebar: 256px default, 192px min, 480px max and at most 40% of the window, collapses to 0; 8px resize rail.
- Centre and right panels: 70 and 35 (rescaled by the panel library), each at least 30%; right panel collapses to 0.
- Right panel split: 50 and 50; bottom panel at least 20%, collapses to its 32px tab strip.
- Headers and tab strips: 40px; scripts panel tabs 32px.
- Tabs: chat 176px; other tabs 128px (80 to 160px); active tab has a 2px accent underline; close button 20px.
- Sidebar rows: nav row 32px, workspace row 36px, section header 28px, all with 6px side padding and 6px radius.
- File tree row 28px with 20px indent; changes row 28px.
- Menus: item 32px (8px by 6px padding), content padding 4px, radius 8px.
- Command palette: 576px wide, at most 500px tall, input 44px, items 44px.
- Dialogs: 512px default with 24px padding and 16px gap; sizes 384, 448, 512, 576, 672, 768px.
- Buttons: 24, 28, 32 and 44px tall; icon buttons 24, 28 and 32px.
- Inputs and selects 32px; textarea at least 60px; checkbox 16px; switch 40 by 20px with 16px thumb.
- Chat column 896px with 28px side padding; user bubble at most 576px (768px on wide windows) with 12px by 16px padding.
- Composer: 12px radius, 152px min height, editor 88px to 188px, send button 24px.
- Settings: 256px nav, content at most 896px with 40px side padding; rows separated by a 1px line and 20px space.
- Toasts 356px wide.
- Terminal 12px text at 1.2 line height with 8px padding; diff 13px on 20px lines.
- Icons 12px, 14px and 16px for nearly everything.

## 11. Open points and what is not verified

- Rendered heights marked INFERRED were computed, not measured in a running app. A screenshot pass against the running Conductor would confirm them.
- The 70 and 35 panel defaults add up to 105%. How the panel library resolves this was not traced.
- The title bar height of 40px is inferred from the header heights.
- Diff text size 13px and line height 20px are the diff library's defaults; no override was found by searching for `--diffs-font-size` and `--diffs-line-height` in both bundles.
- Font files: Conductor ships Geist and Geist Mono. Matching the look (D022) means bundling these fonts, which conflicts with "No font files ship with the app" in `docs/design.md` and the header of `styles.css`. Direction: take Geist and Geist Mono from their official release under the SIL Open Font License, never from Conductor's bundle, and update the two docs. This needs the owner's agreement.
- Weights: Conductor uses 350, 450, 500 and 600 where our header allows three. Direction: add 450, since ghost buttons and sidebar names depend on it; 350 is optional.
- Type names: Conductor's body is `text-sm` (14px) where ours is `text-base`. Direction: adopt Conductor's names and sizes so the measurements above port one to one.
- Focus: Conductor hides the focus ring on buttons. Our rule keeps focus visible, so our buttons keep a ring (1px `focus`, as Conductor uses elsewhere).
- The status-canceled grey stays under 3:1 in light mode; pair it with its icon shape or a label rather than darkening it into backlog grey.
