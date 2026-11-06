/**
 * @feature catalogue The text that marks catalogue code
 * Owns: one string the catalogue writes onto every page it draws. The release build check
 * (scripts/catalogue/check-bundle.ts) fails when the built app contains it, which would mean the
 * catalogue was bundled into the app that ships.
 * Test first: scripts/catalogue/check-bundle.test.ts flags a bundle that contains the marker.
 */
export const CATALOGUE_MARKER = "conducted-states-catalogue";
