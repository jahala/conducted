/**
 * @feature PLAT-42 Homebrew cask that follows the latest release
 * Owns: `caskText`, which turns a release's version, the published disk image's sha256 and the
 * app's minimum macOS version into the Ruby cask, and the command the release runs to print it.
 * Behaviour: docs/plans/release-pipeline.md item 6. The cask installs `Conducted.app` from the
 * release's `Conducted.dmg`, on an Apple-silicon Mac (native-and-sidecar-map A1), and `zap`s only
 * the app's own files: its Application Support folder, caches, preferences, WebKit storage and the
 * `~/.conducted` settings folder (PLAT-27, core/app-paths.ts). It never names Conductor's folders.
 * `auto_updates true` because the app installs its own updates with Tauri's updater (D079).
 * Our design choice: `bundle.macOS.minimumSystemVersion` is read from `tauri.conf.json`; Tauri's
 * documented default of 10.13 applies when the key is absent, which is the version macOS is told
 * the bundle supports. Homebrew wants a release name, so the version is mapped to it.
 * Test first: writes the whole cask for a version and its sha256.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readTag } from "./tag.ts";

export interface CaskInput {
	version: string;
	/** The published `.dmg`'s sha256, lowercase hex. */
	sha256: string;
	/** The minimum macOS version, for example "10.13". */
	minimumMacos: string;
}

/** Homebrew's release name for each macOS version Tauri's config can name. */
const HOMEBREW_MACOS: Readonly<Record<string, string>> = {
	"10.13": "high_sierra",
	"10.14": "mojave",
	"10.15": "catalina",
	"11.0": "big_sur",
	"12.0": "monterey",
	"13.0": "ventura",
	"14.0": "sonoma",
	"15.0": "sequoia",
	"26.0": "tahoe",
};

/**
 * Homebrew's release name for a macOS version, or null when it has none. A minor version uses its
 * major release's name, so "14.1" is Sonoma.
 */
export function homebrewMacosName(version: string): string | null {
	const [major = "", minor = "0"] = version.trim().split(".");
	return HOMEBREW_MACOS[`${major}.${minor}`] ?? HOMEBREW_MACOS[`${major}.0`] ?? null;
}

/** Tauri's default when `tauri.conf.json` names no minimum system version. */
const TAURI_DEFAULT_MINIMUM_MACOS = "10.13";

/** The minimum macOS version `tauri.conf.json` gives the bundle, or Tauri's default. */
export function minimumSystemVersion(config: unknown): string {
	const value = (config as { bundle?: { macOS?: { minimumSystemVersion?: unknown } } })?.bundle
		?.macOS?.minimumSystemVersion;
	return typeof value === "string" && value.trim() !== ""
		? value.trim()
		: TAURI_DEFAULT_MINIMUM_MACOS;
}

/** The version a tag or version names, or null for anything but a stable release. */
export function caskVersion(value: string): string | null {
	const release = readTag(value.startsWith("v") ? value : `v${value}`);
	return release !== null && !release.prerelease ? release.version : null;
}

/** The sha256 of one file, lowercase hex. */
export function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The whole `Casks/conducted.rb` text for one release. */
export function caskText(input: CaskInput): string {
	const macos = homebrewMacosName(input.minimumMacos);
	if (macos === null) {
		throw new Error(`Homebrew has no name for macOS ${input.minimumMacos}.`);
	}
	return `cask "conducted" do
  version "${input.version}"
  sha256 "${input.sha256}"

  url "https://github.com/jahala/conducted/releases/download/v#{version}/Conducted.dmg"
  name "Conducted"
  desc "Run coding agents in parallel, each in its own git worktree"
  homepage "https://jahala.github.io/conducted/"

  depends_on arch: :arm64
  depends_on macos: ">= :${macos}"

  app "Conducted.app"

  auto_updates true

  zap trash: [
    "~/Library/Application Support/build.conducted.app",
    "~/Library/Caches/build.conducted.app",
    "~/Library/Preferences/build.conducted.app.plist",
    "~/Library/WebKit/build.conducted.app",
    "~/.conducted",
  ]
end
`;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const version = args[0] === undefined ? null : caskVersion(args[0]);
	const dmg = args[1];
	if (version === null || dmg === undefined) {
		console.error("Usage: bun scripts/release/cask.ts <version> <dmg-path>");
		console.error("The version must be a stable release, such as 0.3.2 or v0.3.2.");
		process.exit(64);
	}
	const config = JSON.parse(
		readFileSync(join(import.meta.dir, "../../apps/desktop/src-tauri/tauri.conf.json"), "utf8"),
	) as unknown;
	process.stdout.write(
		caskText({ version, sha256: sha256File(dmg), minimumMacos: minimumSystemVersion(config) }),
	);
}
