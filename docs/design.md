# Design

Where the visual design lives and what holds it.

## Where it lives

- **Tokens:** `apps/desktop/src/styles.css`, as Tailwind v4 `@theme` variables with light and dark values (`light-dark()`). Colours, fonts, type scale, weights, radii and spacing come only from these tokens.
- **Components:** `apps/desktop/src/ui`. Screens build on these and never style raw colours.
- **Visual reference:** none yet beyond the running app shell. When screens are designed, their reference images go in a design folder under docs and are linked here.

## The owner's rules

These come from the owner and apply to every screen:

- Neutrals plus one assertive accent. The accent marks the one primary action, or the one thing to look at, on a screen. Error, warning and success colours are for function only.
- Text meets WCAG AA contrast in light and dark mode.
- A clear type hierarchy, by size and weight before colour, on one fixed scale. At most two font families: the system UI font and a monospace font.
- Elements that belong together share invisible columns and rows on one spacing scale.
- Work surfaces (navigation, forms, tables, settings) use familiar app patterns and stay calm. Empty, loading and error states are designed, never left to defaults. Keyboard focus is always visible.
- Motion is short and explains a change, or there is none.

## What holds them

| Rule                                                         | Guard                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Text and accent pairs meet AA in light and dark              | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| No hard-coded colours outside the tokens                     | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| One fixed type scale, exactly two font families              | `apps/desktop/src/ui/tokens.test.ts`                                                     |
| One accent per screen, function-only status colours, spacing | none yet: checked in review                                                              |
| Designed empty, loading and error states                     | `LoadableView` and `NotBuiltYet` in `apps/desktop/src/ui`; per screen, checked in review |
