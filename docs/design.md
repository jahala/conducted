# Design

Where the visual design lives, where its values come from, and what holds it.

## Where it lives

- **Tokens:** `apps/desktop/src/styles.css`, as Tailwind v4 `@theme static` variables with light and dark values (`light-dark()`). Colours, fonts, type scale, weights, tracking, radii, shadows and easings come only from these tokens. A low-contrast dark set sits under `data-contrast="low"` on `<html>`. Durations and layout sizes that are not on the 4px spacing scale are plain variables in the same file.
- **Panel sizes:** `apps/desktop/src/ui/layout-sizes.ts`, because the resizable panels take their sizes from script.
- **Fonts:** Geist and Geist Mono, variable `woff2` files from the official release (v1.9.1, github.com/vercel/geist-font) in `apps/desktop/src/assets/fonts/`, with their SIL Open Font License in `OFL.txt` beside them. The terminal keeps its own Menlo-first font list.
- **Components:** `apps/desktop/src/ui`. Screens build on these and never style raw colours.
- **Visual reference:** none yet beyond the running app shell. When screens are designed, their reference images go in a design folder under docs and are linked here.

## Where the values come from

The values are Conductor 0.92.1's, measured in `research/conductor/ui-dimensions.md` and adopted from its section 10 (D022, D023). They are stored under our own token names. Nothing is copied from Conductor's stylesheet or app bundle (D002). Where a measured colour fails WCAG AA, the nearest passing value in the same hue replaces it; the list is below.

- Type scale, with Conductor's names: `text-3xs` 10/12, `text-2xs` 11/14, `text-xs` 12/16, `text-sm` 14/20 (the body), `text-code` 13/20 (diff and file text), `text-base` 16/24, `text-lg` 18/28, `text-xl` 20/28, `text-2xl` 24/32 (size/line height in px). Each size carries Conductor's letter spacing.
- Weights: `font-light` 350 (tab list, composer text), `font-normal` 400, `font-book` 450 (outline and ghost buttons, sidebar names), `font-medium` 500 (buttons, tabs, labels, headings), `font-semibold` 600 (unread names, rare headers).
- Spacing: one step is 4px. Radii: `xs` 2, `sm` 4, `md` 6 (controls and rows), `lg` 8 (menus, popovers), `xl` 12 (composer, alert dialogs), `2xl` 16, `full`.
- Shadows: `xs` (chips, composer), `sm`, `popover` (menus, popovers, tooltips, with a 1px ring), `dialog`, `palette`, `toast`.
- Motion: 150ms with `cubic-bezier(0.4, 0, 0.2, 1)` by default; popovers 100ms; dialogs 200ms; the palette 180ms in and 130ms out; the composer resize 200ms on `ease-spring`. Reduced motion turns it all off.
- The primary button is Conductor's default button: the near-black fill (`primary-fill`), near-white in dark. The clay accent marks the one thing to look at: the active tab underline, the focused input edge, unread dots.

## Component dimensions

| Part                          | Size                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Left sidebar                  | 256px default, 192px to 480px, collapses to 0; 8px resize rail                                                           |
| Centre and right panel        | 65% and 35%, each at least 30%; the right panel collapses to 0 (Conductor asks for 70 and 35 and rescales)               |
| Right panel split             | 50% and 50%; the scripts panel is at least 20% and collapses to its 32px tab strip                                       |
| Title bar, headers, tab strip | 40px (`--titlebar-height`); scripts panel tabs 32px; traffic-light clearance 66px                                        |
| Tabs                          | chat tab 176px; other tabs 128px (80px to 160px); 2px accent underline when active; close button 20px                    |
| Sidebar rows                  | nav row 32px, workspace row 36px, section header 28px; 6px side padding and 6px radius                                   |
| Lists                         | file tree row 28px with 20px indent; changes row 28px; commit row 32px                                                   |
| Menus                         | item 32px (8px by 6px padding); content 4px padding, 8px radius, at least 128px wide                                     |
| Command palette               | 576px wide, at most 500px tall; input 44px; items 44px                                                                   |
| Dialogs                       | 512px default with 24px padding and 16px gap; sizes 384, 448, 512, 576, 672, 768, 896px                                  |
| Buttons                       | 24, 28, 32 (default) and 44px tall; icon buttons 24, 28 and 32px square                                                  |
| Inputs                        | input and select 32px; textarea at least 60px; checkbox 16px; switch 40 by 20px with a 16px thumb                        |
| Chat                          | column at most 896px with 28px side padding; user bubble at most 576px (768px on wide windows) with 12px by 16px padding |
| Composer                      | 12px radius, at least 152px tall; editor 88px to 188px; send button 24px                                                 |
| Settings                      | 256px nav; content at most 896px with 40px side padding; rows split by a 1px line and 20px space                         |
| Toasts                        | 356px wide                                                                                                               |
| Terminal and diff             | terminal 12px text at 1.2 line height with 8px padding; diff 13px on 20px lines                                          |
| Icons                         | 12px, 14px and 16px for nearly everything                                                                                |

## AA adjustments

Each row changes one measured value so the pair meets 4.5:1 for text or 3:1 for marks. The rest of Conductor's values are kept as measured.

| Token                  | Conductor (light / dark) | Ours (light / dark)   | Why                                                                                                |
| ---------------------- | ------------------------ | --------------------- | -------------------------------------------------------------------------------------------------- |
| `fg-muted`             | #8e8885 / #a5a09c        | #6e6867 / #a5a09c     | Secondary text, 3.49 on canvas; ours passes on every surface, hover and active too                 |
| `fg-subtle`            | #a5a09c / #766f6b        | #6e6867 / #a09a97     | Placeholder text, 2.48 and 3.36 on muted. In light it now equals `fg-muted`                        |
| `sidebar-fg-muted`     | at 70% for headers       | at full strength      | Section headers, 2.76 light and 3.99 dark at 70%                                                   |
| `border-strong`        | #14100f1a / #ffffff33    | #14100f73 / #ffffff58 | Input edges, 1.24 and 1.85                                                                         |
| `accent`, `unread`     | #cca694 / #cca694        | #a2827d / #cca694     | Tab underline and unread dot, 2.22 on canvas; ours also passes on the hover tint                   |
| `accent-hover`         | none                     | #96746f / #ddc1b1     | Our value; dark text on it passes                                                                  |
| `on-danger`            | #fef1f1                  | #ffffff               | Destructive button label, 4.36 light                                                               |
| `danger-solid`         | #dc2828 / #f87272        | #dc2828 / #c62828     | #f87272 cannot carry a light label (2.50)                                                          |
| `success`, `git-added` | #16a249                  | #12853c               | Success text, 3.33 on canvas                                                                       |
| `link`                 | #a4847f                  | #8d6964               | Link text, 3.40 on canvas                                                                          |
| `info`                 | #0da2e7                  | #0c9adc               | A mark at 2.86 on canvas                                                                           |
| `status-progress`      | #e0bb00                  | #a28700               | Status icon, 1.78 on the sidebar                                                                   |
| `status-review`        | #16a249                  | #169e47               | 2.87 on the sidebar hover tint                                                                     |
| `status-done`          | #cca694                  | #a2827d               | Status icon, 2.13 on the sidebar                                                                   |
| `status-canceled`      | #a5a09c                  | #8f8884               | Status icon, 2.48 on the sidebar. It is now close to backlog grey; its icon shape tells them apart |
| Tooltip fill           | popover at 50% with blur | solid `raised`        | A see-through fill cannot promise 4.5:1 over whatever is behind it                                 |

Still open (APP-14): the sixteen terminal colours are kept as measured, and several light ones (yellow, white, bright green, bright cyan) fall under 4.5:1 on the light terminal background. Colour-vision variants, a search-highlight colour and the translucent sidebar surface are not built yet.

## The owner's rules

These come from the owner and apply to every screen:

- Neutrals plus one assertive accent. The accent marks the one primary action, or the one thing to look at, on a screen. Error, warning and success colours are for function only.
- Text meets WCAG AA contrast in light and dark mode.
- A clear type hierarchy, by size and weight before colour, on one fixed scale. At most two font families: Geist for the interface and Geist Mono for code.
- Elements that belong together share invisible columns and rows on one spacing scale.
- Work surfaces (navigation, forms, tables, settings) use familiar app patterns and stay calm. Empty, loading and error states are designed, never left to defaults. Keyboard focus is always visible, on buttons too (D023).
- Motion is short and explains a change, or there is none.

## What holds them

| Rule                                                              | Guard                                                                                    |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Text and mark pairs meet AA in light, dark and low-contrast dark  | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| The low-contrast set changes dark values only                     | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| No hard-coded colours outside the tokens                          | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| Conductor's type scale names, the five weights, exactly two fonts | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| Each font file exists and its licence ships with it               | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| Component sizes match the dimensions table                        | none yet: checked in review                                                              |
| One accent per screen, function-only status colours, spacing      | none yet: checked in review                                                              |
| Designed empty, loading and error states                          | `LoadableView` and `NotBuiltYet` in `apps/desktop/src/ui`; per screen, checked in review |
