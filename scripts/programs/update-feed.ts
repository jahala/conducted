/**
 * @feature PLAT-28 Agent program manager: download, verify, update, prune
 * Owns: the daily update of every pinned copy of the agent programs. `claudeRelease` and
 * `codexRelease` read the newest versions, sizes and publisher digests from the vendors' own
 * release documents. `chooseSdkVersion` reads the Claude Code manifest's `sdkCompat` against the
 * SDK the sidecar pins. `planUpdate` writes the release feed and every copy that must agree with
 * it: the Rust pins, the sidecar's SDK pin, the cloud image's program table and its Dockerfile.
 * Behaviour: the feed is `apps/desktop/src-tauri/programs/release-feed.json`, which the program
 * manager reads (`read_release_manifest` in `apps/desktop/src-tauri/src/binaries.rs`); each asset's
 * size and SHA-256 are those of the file the vendor publishes. A checksum is never computed here,
 * because only the publisher's own manifest or GitHub release may name it. The full list of
 * pinned copies is in `docs/engineering.md`.
 * Must handle: a manifest or asset without a checksum or digest (stop, never invent one); a
 * program block the cloud image does not have (stop); the feed already current (change nothing);
 * an SDK newer than every wrapper the Claude Code release tested (keep the newer pin); no
 * `sdkCompat` (keep the pin).
 * Our design choice: the updater moves every pinned copy together, so the pull request it feeds
 * passes CI instead of leaving the feed and the Rust pin disagreeing.
 * Usage: GITHUB_TOKEN=... bun scripts/programs/update-feed.ts
 * Test first: reads Claude Code's darwin binaries from the publisher's manifest.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Where the app's feed, and each copy that must agree with it, live. */
export const FEED_PATH = "apps/desktop/src-tauri/programs/release-feed.json";
export const RUST_PATH = "apps/desktop/src-tauri/src/binaries.rs";
export const SIDECAR_PACKAGE_PATH = "packages/sidecar/package.json";
export const IMAGE_PATH = "apps/cloud/sandbox/image.ts";
export const DOCKERFILE_PATH = "apps/cloud/sandbox/Dockerfile";

const CLAUDE_RELEASES = "https://downloads.claude.ai/claude-code-releases";
const CODEX_RELEASE = "https://api.github.com/repos/openai/codex/releases/latest";
const SDK_REGISTRY = "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk";

/** One downloadable file of a release, as the app's feed holds it. */
export interface FeedAsset {
	url: string;
	size: number;
	sha256: string;
	format: string;
}

/** One pinned program and its per-CPU files. */
export interface ProgramRelease {
	version: string;
	darwinArm64: FeedAsset;
	darwinX64: FeedAsset;
}

/** The parts of Claude Code's release manifest the updater reads. */
export interface ClaudeManifest {
	version: string;
	platforms: Record<string, { checksum?: string; size?: number }>;
	sdkCompat?: { testedWrapperVersions?: string[] };
}

/** One asset of a GitHub release. */
export interface GithubAsset {
	name: string;
	size: number;
	digest?: string | null;
	browser_download_url: string;
}

/** The parts of a GitHub release the updater reads. */
export interface GithubRelease {
	tag_name: string;
	assets: GithubAsset[];
}

/** Codex's two Mac files, and the digest of the Linux file the cloud image installs. */
export interface CodexUpdate {
	release: ProgramRelease;
	linuxX64Sha256: string;
}

/** The SDK version the manifest says the sidecar may move to, and why. */
export interface SdkChoice {
	version: string;
	note: string;
}

/** One file to write, named from the repository root. */
export interface Update {
	path: string;
	text: string;
}

/** The current text of every file the updater may rewrite. */
export interface FeedInputs {
	feed: string;
	rust: string;
	sdkPackage: string;
	image: string;
	dockerfile: string;
}

const MAC_CODEX = {
	arm64: "codex-aarch64-apple-darwin.zst",
	x64: "codex-x86_64-apple-darwin.zst",
};
const LINUX_CODEX = "codex-x86_64-unknown-linux-musl.tar.gz";

/** Claude Code's two Mac files, taken from the release's own manifest. */
export function claudeRelease(manifest: ClaudeManifest): ProgramRelease {
	const version = manifest.version;
	if (typeof version !== "string" || version === "") {
		throw new Error("Claude Code's manifest names no version");
	}
	const asset = (platform: string): FeedAsset => {
		const entry = manifest.platforms?.[platform];
		if (
			entry === undefined ||
			typeof entry.checksum !== "string" ||
			entry.checksum === "" ||
			typeof entry.size !== "number" ||
			entry.size <= 0
		) {
			throw new Error(`Claude Code ${version}'s manifest has no checksum and size for ${platform}`);
		}
		return {
			url: `${CLAUDE_RELEASES}/${version}/${platform}/claude`,
			size: entry.size,
			sha256: entry.checksum.toLowerCase(),
			format: "raw",
		};
	};
	return {
		version,
		darwinArm64: asset("darwin-arm64"),
		darwinX64: asset("darwin-x64"),
	};
}

/** Codex's two Mac files and its Linux digest, taken from the GitHub release it publishes. */
export function codexRelease(release: GithubRelease): CodexUpdate {
	const tag = release.tag_name ?? "";
	const version = tag.startsWith("rust-v") ? tag.slice("rust-v".length) : "";
	if (version === "") {
		throw new Error(`The Codex release tag ${tag} is not rust-v<version>`);
	}
	const asset = (name: string): GithubAsset => {
		const found = release.assets?.find((candidate) => candidate.name === name);
		if (found === undefined) {
			throw new Error(`Codex ${version}'s release has no asset ${name}`);
		}
		return found;
	};
	const sha256 = (entry: GithubAsset): string => {
		const digest = entry.digest ?? "";
		if (!digest.startsWith("sha256:")) {
			throw new Error(`Codex ${version}'s ${entry.name} has no sha256 digest in the release`);
		}
		return digest.slice("sha256:".length).toLowerCase();
	};
	const mac = (name: string): FeedAsset => {
		const entry = asset(name);
		return {
			url: entry.browser_download_url,
			size: entry.size,
			sha256: sha256(entry),
			format: "zstd",
		};
	};
	return {
		release: {
			version,
			darwinArm64: mac(MAC_CODEX.arm64),
			darwinX64: mac(MAC_CODEX.x64),
		},
		linuxX64Sha256: sha256(asset(LINUX_CODEX)),
	};
}

/** The SDK the sidecar may move to: the newest published wrapper the manifest tested. */
export function chooseSdkVersion(
	current: string,
	published: readonly string[],
	tested: readonly string[] | undefined,
): SdkChoice {
	const testedHere = tested ?? [];
	if (testedHere.length === 0) {
		return {
			version: current,
			note: `Claude Code's manifest states no tested SDK wrappers; the sidecar stays at ${current}.`,
		};
	}
	const testedAndPublished = testedHere
		.filter((version) => published.includes(version))
		.sort(compareVersions);
	const newest = testedAndPublished.at(-1);
	if (newest === undefined) {
		return {
			version: current,
			note: `No wrapper this Claude Code release tested is published; the sidecar stays at ${current}.`,
		};
	}
	const order = compareVersions(current, newest);
	if (order > 0) {
		return {
			version: current,
			note: `The sidecar pins ${current}, newer than every wrapper this Claude Code release tested (${newest}); keep it.`,
		};
	}
	if (order === 0) {
		return { version: current, note: `The sidecar's SDK ${current} is the newest tested wrapper.` };
	}
	const untested = published
		.filter((version) => compareVersions(version, newest) > 0)
		.sort(compareVersions)
		.at(-1);
	return {
		version: newest,
		note:
			untested === undefined
				? `Move the sidecar's SDK to ${newest}, the newest wrapper Claude Code tested.`
				: `SDK ${untested} is published but not among the wrappers Claude Code tested; move the sidecar's SDK to ${newest}, the newest tested wrapper.`,
	};
}

/** The feed with Claude's and Codex's releases replaced, every other program kept in place. */
export function mergeFeed(
	feed: Record<string, unknown>,
	claude: ProgramRelease,
	codex: ProgramRelease,
): Record<string, unknown> {
	return { ...feed, claude, codex };
}

/** The feed as the app ships it: tab-indented JSON with a trailing newline. */
export function renderFeed(feed: Record<string, unknown>): string {
	return `${JSON.stringify(feed, null, "\t")}\n`;
}

/** One program's version in the Rust program manager's `pinned_version`, and nowhere else. */
export function withRustPin(source: string, program: "Claude" | "Codex", version: string): string {
	const start = source.indexOf("pub fn pinned_version(");
	const end = start === -1 ? -1 : source.indexOf("\n}", start);
	if (start === -1 || end === -1) {
		throw new Error("The Rust program manager has no pinned_version function");
	}
	const block = source.slice(start, end);
	const pattern = new RegExp(`(ManagedProgram::${program} => ")[^"]+(")`);
	if (!pattern.test(block)) {
		throw new Error(`pinned_version has no ${program} arm with a version`);
	}
	const replaced = block.replace(pattern, `$1${version}$2`);
	return `${source.slice(0, start)}${replaced}${source.slice(end)}`;
}

/** The exact version of `@anthropic-ai/claude-agent-sdk` the sidecar pins. */
export function currentSdkPin(packageText: string): string {
	const parsed = JSON.parse(packageText) as {
		dependencies?: Record<string, string>;
	};
	const version = parsed.dependencies?.["@anthropic-ai/claude-agent-sdk"];
	if (typeof version !== "string") {
		throw new Error("The sidecar package has no @anthropic-ai/claude-agent-sdk dependency");
	}
	return version;
}

/** The sidecar package with its SDK pin replaced in place, keeping its formatting. */
export function withSdkPin(packageText: string, version: string): string {
	const pattern = /("@anthropic-ai\/claude-agent-sdk":\s*")[^"]+(")/;
	if (!pattern.test(packageText)) {
		throw new Error("The sidecar package has no @anthropic-ai/claude-agent-sdk dependency");
	}
	return packageText.replace(pattern, `$1${version}$2`);
}

/** The cloud image's program table with Claude's and Codex's versions and sources replaced. */
export function withCloudPrograms(
	source: string,
	claude: ProgramRelease,
	codex: ProgramRelease,
): string {
	const claudeBlock = replaceProgram(source, "claude", {
		version: claude.version,
		source: `npm:@anthropic-ai/claude-code-linux-x64@${claude.version}`,
	});
	return replaceProgram(claudeBlock, "codex", {
		version: codex.version,
		source: `github:openai/codex rust-v${codex.version} ${LINUX_CODEX}`,
	});
}

function replaceProgram(
	source: string,
	program: string,
	value: { version: string; source: string },
): string {
	const pattern = new RegExp(
		`\\n(\\s*)${program}: \\{\\n\\s*version: "[^"]+",\\n\\s*source: "[^"]+",`,
	);
	if (!pattern.test(source)) {
		throw new Error(`The cloud image has no ${program} program block`);
	}
	return source.replace(
		pattern,
		(_match, indent: string) =>
			`\n${indent}${program}: {\n${indent}\tversion: "${value.version}",\n${indent}\tsource: "${value.source}",`,
	);
}

/** The Dockerfile with its Claude and Codex blocks at the new versions and digest. */
export function withDockerfileVersions(
	source: string,
	claude: string,
	codex: string,
	codexSha256: string,
): string {
	let section: "claude" | "codex" | null = null;
	return source
		.split("\n")
		.map((line) => {
			if (line.startsWith("# Claude Code ")) section = "claude";
			else if (line.startsWith("# Codex ")) section = "codex";
			else if (line.startsWith("# Cursor")) section = null;
			if (section === "claude") {
				return line
					.replace(/^# Claude Code \d+\.\d+\.\d+/, `# Claude Code ${claude}`)
					.replace(/(claude-code-linux-x64@)\d+\.\d+\.\d+/g, `$1${claude}`)
					.replace(/(agent-binaries\/claude\/)\d+\.\d+\.\d+/g, `$1${claude}`);
			}
			if (section === "codex") {
				return line
					.replace(/^# Codex \d+\.\d+\.\d+/, `# Codex ${codex}`)
					.replace(/(rust-v)\d+\.\d+\.\d+/g, `$1${codex}`)
					.replace(/(agent-binaries\/codex\/)\d+\.\d+\.\d+/g, `$1${codex}`)
					.replace(/^(\s*echo ")[0-9a-f]{64}( {2}\/tmp\/codex\.tar\.gz")/, `$1${codexSha256}$2`);
			}
			return line;
		})
		.join("\n");
}

/** Every file that changes, and its new text; an empty list when the pins are current. */
export function planUpdate(
	inputs: FeedInputs,
	claude: ProgramRelease,
	codex: CodexUpdate,
	sdkVersion: string,
): Update[] {
	const feed = JSON.parse(inputs.feed) as Record<string, unknown>;
	const changed: Update[] = [];
	const add = (path: string, before: string, after: string) => {
		if (after !== before) changed.push({ path, text: after });
	};
	add(FEED_PATH, inputs.feed, renderFeed(mergeFeed(feed, claude, codex.release)));
	add(
		RUST_PATH,
		inputs.rust,
		withRustPin(withRustPin(inputs.rust, "Claude", claude.version), "Codex", codex.release.version),
	);
	add(SIDECAR_PACKAGE_PATH, inputs.sdkPackage, withSdkPin(inputs.sdkPackage, sdkVersion));
	add(IMAGE_PATH, inputs.image, withCloudPrograms(inputs.image, claude, codex.release));
	add(
		DOCKERFILE_PATH,
		inputs.dockerfile,
		withDockerfileVersions(
			inputs.dockerfile,
			claude.version,
			codex.release.version,
			codex.linuxX64Sha256,
		),
	);
	return changed;
}

/** Which of two `x.y.z` versions is newer. */
export function compareVersions(a: string, b: string): number {
	const left = a.split(".").map(Number);
	const right = b.split(".").map(Number);
	for (let index = 0; index < 3; index++) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

async function fetchText(url: string, token?: string): Promise<string> {
	const headers: Record<string, string> = { Accept: "text/plain" };
	if (token !== undefined && token !== "") headers.Authorization = `Bearer ${token}`;
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
	return await response.text();
}

async function fetchJson<T>(url: string, accept: string, token?: string): Promise<T> {
	const headers: Record<string, string> = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28" };
	if (token !== undefined && token !== "") headers.Authorization = `Bearer ${token}`;
	const response = await fetch(url, { headers });
	if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
	return (await response.json()) as T;
}

async function main(): Promise<number> {
	const root = resolve(import.meta.dir, "../..");
	const inputs: FeedInputs = {
		feed: readFileSync(join(root, FEED_PATH), "utf8"),
		rust: readFileSync(join(root, RUST_PATH), "utf8"),
		sdkPackage: readFileSync(join(root, SIDECAR_PACKAGE_PATH), "utf8"),
		image: readFileSync(join(root, IMAGE_PATH), "utf8"),
		dockerfile: readFileSync(join(root, DOCKERFILE_PATH), "utf8"),
	};
	const token = process.env.GITHUB_TOKEN;
	const latest = (await fetchText(`${CLAUDE_RELEASES}/latest`)).trim();
	const manifest = await fetchJson<ClaudeManifest>(
		`${CLAUDE_RELEASES}/${latest}/manifest.json`,
		"application/json",
	);
	const codexFile = await fetchJson<GithubRelease>(
		CODEX_RELEASE,
		"application/vnd.github+json",
		token,
	);
	const registry = await fetchJson<{ versions?: Record<string, unknown> }>(
		SDK_REGISTRY,
		"application/vnd.npm.install-v1+json",
	);
	const claude = claudeRelease(manifest);
	const codex = codexRelease(codexFile);
	const published = Object.keys(registry.versions ?? {});
	const sdk = chooseSdkVersion(
		currentSdkPin(inputs.sdkPackage),
		published,
		manifest.sdkCompat?.testedWrapperVersions,
	);

	console.log(`Claude Code ${claude.version}, Codex ${codex.release.version}.`);
	console.log(sdk.note);

	const updates = planUpdate(inputs, claude, codex, sdk.version);
	if (updates.length === 0) {
		console.log("Every pinned copy is current; nothing changed.");
		return 0;
	}
	for (const update of updates) {
		writeFileSync(join(root, update.path), update.text);
		console.log(`Updated ${update.path}.`);
	}
	return 0;
}

if (import.meta.main) {
	try {
		process.exit(await main());
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
