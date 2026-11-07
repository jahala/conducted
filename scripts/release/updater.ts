/**
 * The release's update-feed parts that need no tools (PLAT-13, D079): the archive's name, where
 * GitHub serves each asset, the `latest.json` document Tauri's updater reads, the keychain items
 * that hold the updater key, and the `gh release create` command the workflow runs.
 *
 * Tauri's static feed format (v2.tauri.app/plugin/updater, "Static JSON File"): `version`,
 * `notes`, `pub_date` (RFC 3339) and `platforms["<os>-<arch>"]` with `url` and `signature`, where
 * the signature is the text of the archive's `.sig` file, never a path. The app reads the feed
 * from the newest release (`plugins.updater.endpoints` in tauri.conf.json).
 *
 * The key never appears in an argument list, a log or a file: `updaterKeyLookup` only names the
 * keychain item, and the release reads the value into a child's environment.
 */

/** The repository whose releases carry the app and its feed. */
const RELEASE_REPO = "jahala/conducted";

/** The feed's platform key for the one build the release makes (`aarch64-apple-darwin`). */
const FEED_PLATFORM = "darwin-aarch64";

/** The feed's file name, as the updater endpoint asks for it. */
export const FEED_FILE_NAME = "latest.json";

/** Each environment variable `tauri build` and `tauri signer sign` read, and its keychain service. */
export const UPDATER_KEY_ITEMS = {
	TAURI_SIGNING_PRIVATE_KEY: "conducted-updater-key",
	TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "conducted-updater-key-password",
} as const;

/** The keychain account both updater items are stored under. */
const UPDATER_KEY_ACCOUNT = "conducted";

/** The command that prints one updater keychain item's value on stdout. */
export function updaterKeyLookup(service: string): readonly string[] {
	return ["security", "find-generic-password", "-s", service, "-a", UPDATER_KEY_ACCOUNT, "-w"];
}

/** The update archive beside a built app, named as Tauri names it. */
export function updaterArchivePath(appPath: string): string {
	return `${appPath}.tar.gz`;
}

/** Where GitHub serves one asset of a version's release. */
export function releaseAssetUrl(version: string, assetName: string): string {
	return `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${encodeURIComponent(assetName)}`;
}

export interface UpdaterFeed {
	version: string;
	notes: string;
	pub_date: string;
	platforms: Record<string, { signature: string; url: string }>;
}

/** The `latest.json` document for one signed archive. */
export function updaterFeed(input: {
	version: string;
	notes: string;
	pubDate: Date;
	archiveName: string;
	/** The text of the archive's `.sig` file. */
	signature: string;
}): UpdaterFeed {
	return {
		version: input.version,
		notes: input.notes,
		pub_date: input.pubDate.toISOString(),
		platforms: {
			[FEED_PLATFORM]: {
				signature: input.signature.trim(),
				url: releaseAssetUrl(input.version, input.archiveName),
			},
		},
	};
}

/** Quotes one argument for a POSIX shell. */
function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** How the workflow publishes a release: its notes file and whether it is a dry run. */
export interface ReleaseCommandOptions {
	/** A file holding the release body, cut from `CHANGELOG.md`. */
	notesFile?: string;
	/** A pre-release tag publishes a pre-release. */
	prerelease?: boolean;
}

/**
 * The command that publishes a pushed tag's release with the given files. The workflow runs it
 * through `scripts/release/publish.ts`; nothing here runs it by itself.
 */
export function ghReleaseCommand(
	version: string,
	files: readonly string[],
	options: ReleaseCommandOptions = {},
): string {
	const tag = `v${version}`;
	return [
		"gh release create",
		tag,
		`--repo ${RELEASE_REPO}`,
		"--verify-tag",
		`--title ${tag}`,
		options.notesFile === undefined
			? `--notes ${tag}`
			: `--notes-file ${shellQuote(options.notesFile)}`,
		...(options.prerelease === true ? ["--prerelease"] : []),
		...files.map(shellQuote),
	].join(" ");
}
