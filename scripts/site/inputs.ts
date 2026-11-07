/**
 * Reads what the product page is built from, in a checkout: the templates, stylesheet and images in
 * docs/site, the app's own Geist fonts and their licence (apps/desktop/src/assets/fonts, D023), and
 * CHANGELOG.md. One home for these paths, shared by the build (scripts/site/build.ts) and the link
 * guard (scripts/guards/site.ts). The latest release is the caller's to pass.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LatestRelease, SiteInput } from "./site.ts";

export const SITE_DIR = "docs/site";
export const FONT_DIR = "apps/desktop/src/assets/fonts";
export const FONT_FILES = ["Geist-Variable.woff2", "GeistMono-Variable.woff2", "OFL.txt"] as const;
const IMAGE = /\.(png|webp|jpe?g|svg)$/;

export function readSiteInput(
	root: string,
	latest: LatestRelease | null,
): { ok: true; input: SiteInput } | { ok: false; errors: string[] } {
	const required = [
		`${SITE_DIR}/index.html`,
		`${SITE_DIR}/changelog.html`,
		`${SITE_DIR}/style.css`,
		"CHANGELOG.md",
		...FONT_FILES.map((name) => `${FONT_DIR}/${name}`),
	];
	const missing = required.filter((path) => !existsSync(join(root, path)));
	if (missing.length > 0) {
		return { ok: false, errors: missing.map((path) => `${path} is missing; the site needs it`) };
	}
	const text = (path: string) => readFileSync(join(root, path), "utf8");
	const imageDir = join(root, SITE_DIR, "images");
	const images = new Map<string, Uint8Array>();
	if (existsSync(imageDir)) {
		for (const name of readdirSync(imageDir).sort()) {
			if (IMAGE.test(name)) images.set(name, readFileSync(join(imageDir, name)));
		}
	}
	const fonts = new Map<string, Uint8Array>(
		FONT_FILES.map((name) => [name, readFileSync(join(root, FONT_DIR, name))]),
	);
	return {
		ok: true,
		input: {
			index: text(`${SITE_DIR}/index.html`),
			changelogPage: text(`${SITE_DIR}/changelog.html`),
			css: text(`${SITE_DIR}/style.css`),
			images,
			fonts,
			changelog: text("CHANGELOG.md"),
			latest,
		},
	};
}
