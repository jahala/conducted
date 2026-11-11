/**
 * The feed updater reads the publishers' own manifests and writes every pinned copy of the agent
 * program versions: the release feed, the Rust pins, the sidecar's SDK pin, and the cloud image's
 * table and Dockerfile. The samples are the publishers' answers saved on 2026-11-11.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	chooseSdkVersion,
	claudeRelease,
	codexRelease,
	mergeFeed,
	planUpdate,
	renderFeed,
	withCloudPrograms,
	withDockerfileVersions,
	withRustPin,
	withSdkPin,
} from "./update-feed.ts";

const samples = join(import.meta.dir, "samples");
const claudeManifest = JSON.parse(
	readFileSync(join(samples, "claude-manifest.json"), "utf8"),
) as never;
const codexReleaseFile = JSON.parse(
	readFileSync(join(samples, "codex-release.json"), "utf8"),
) as never;

const CLAUDE = claudeRelease(claudeManifest);
const CODEX = codexRelease(codexReleaseFile);

test("reads Claude Code's darwin binaries from the publisher's manifest", () => {
	expect(CLAUDE).toEqual({
		version: "2.1.322",
		darwinArm64: {
			url: "https://downloads.claude.ai/claude-code-releases/2.1.322/darwin-arm64/claude",
			size: 323702464,
			sha256: "a9d237949db816a0b7afd88a9a8e1df36b3a597a30f5a41d1c0539eb180a3450",
			format: "raw",
		},
		darwinX64: {
			url: "https://downloads.claude.ai/claude-code-releases/2.1.322/darwin-x64/claude",
			size: 338400544,
			sha256: "b513d15117cbf1bb05095dab41963fd394ff40de1fa99dcc6d7d1033bf292e9b",
			format: "raw",
		},
	});
});

test("refuses a Claude platform whose manifest has no checksum", () => {
	const manifest = {
		version: "2.1.322",
		platforms: { "darwin-arm64": { size: 1 }, "darwin-x64": { checksum: "ab", size: 1 } },
	};
	expect(() => claudeRelease(manifest)).toThrow("checksum");
});

test("reads Codex's darwin assets and the digest GitHub publishes", () => {
	expect(CODEX.release).toEqual({
		version: "0.167.1",
		darwinArm64: {
			url: "https://github.com/openai/codex/releases/download/rust-v0.167.1/codex-aarch64-apple-darwin.zst",
			size: 77535807,
			sha256: "c4c2695799c9d9d3681dfcb58d4ff5e8b383c0e92c984096cbb616376faeb2b8",
			format: "zstd",
		},
		darwinX64: {
			url: "https://github.com/openai/codex/releases/download/rust-v0.167.1/codex-x86_64-apple-darwin.zst",
			size: 84943319,
			sha256: "0168963577ca59779cb7ff9e00bfd08e7c7fcd6ef7d6b8609a684c7f89a730b5",
			format: "zstd",
		},
	});
	expect(CODEX.linuxX64Sha256).toBe(
		"64bcc99c32e434b4bcb0508a97df9b7aeecdb97e956d976fb13661096ec4e3e2",
	);
});

test("refuses a Codex asset with no sha256 digest from the release", () => {
	const release = {
		tag_name: "rust-v0.167.1",
		assets: [
			{
				name: "codex-aarch64-apple-darwin.zst",
				size: 1,
				digest: null,
				browser_download_url:
					"https://github.com/openai/codex/releases/download/rust-v0.167.1/codex-aarch64-apple-darwin.zst",
			},
		],
	};
	expect(() => codexRelease(release)).toThrow("digest");
});

test("keeps the other programs and their order when claude and codex are replaced", () => {
	const feed = {
		claude: { version: "old", darwinArm64: {}, darwinX64: {} },
		codex: { version: "old", darwinArm64: {}, darwinX64: {} },
		gh: { version: "2.100.0" },
		watchexec: { version: "2.3.2" },
		cursor: { version: "1.3.1" },
	};

	const merged = mergeFeed(feed, CLAUDE, CODEX.release);

	expect(Object.keys(merged)).toEqual(["claude", "codex", "gh", "watchexec", "cursor"]);
	expect(merged.claude).toEqual(CLAUDE);
	expect(merged.codex).toEqual(CODEX.release);
	expect(merged.gh).toEqual({ version: "2.100.0" });
});

test("renders the feed in the same indented shape the app ships", () => {
	const text = renderFeed({ claude: CLAUDE });
	expect(text).toContain('\t"claude": {');
	expect(text.endsWith("\n")).toBe(true);
	expect(JSON.parse(text)).toEqual({ claude: CLAUDE });
});

test("moves the SDK pin to the newest wrapper the manifest tested", () => {
	const tested = ["0.3.318", "0.3.319", "0.3.321"];
	const published = ["0.3.318", "0.3.321", "0.3.322"];

	const choice = chooseSdkVersion("0.3.318", published, tested);

	expect(choice.version).toBe("0.3.321");
	expect(choice.note).toContain("0.3.322");
});

test("keeps a newer SDK pin the manifest has not tested yet", () => {
	const choice = chooseSdkVersion("0.3.324", ["0.3.321", "0.3.324"], ["0.3.318", "0.3.321"]);
	expect(choice.version).toBe("0.3.324");
});

test("keeps the SDK pin when the manifest states no compatibility list", () => {
	const choice = chooseSdkVersion("0.3.318", ["0.3.318", "0.3.322"], undefined);
	expect(choice.version).toBe("0.3.318");
});

test("rewrites the Rust pin for one program and leaves the others", () => {
	const changed = withRustPin(RUST, "Claude", "2.1.322");

	expect(changed).toContain('\t\tManagedProgram::Claude => "2.1.322",');
	expect(changed).toContain('\t\tManagedProgram::Codex => "0.164.0",');
	expect(changed).toContain('ManagedProgram::Claude => "claude",');
});

test("rewrites the sidecar's exact SDK pin and nothing else", () => {
	const text = '{\n\t"dependencies": {\n\t\t"@anthropic-ai/claude-agent-sdk": "0.3.318"\n\t}\n}\n';
	const changed = withSdkPin(text, "0.3.321");
	expect(JSON.parse(changed).dependencies["@anthropic-ai/claude-agent-sdk"]).toBe("0.3.321");
	expect(withSdkPin(changed, "0.3.321")).toBe(changed);
});

test("rewrites the cloud image's version and source for claude and codex", () => {
	const text = [
		"\tprograms: {",
		"\t\tclaude: {",
		'\t\t\tversion: "2.1.308",',
		'\t\t\tsource: "npm:@anthropic-ai/claude-code-linux-x64@2.1.308",',
		"\t\t},",
		"\t\tcodex: {",
		'\t\t\tversion: "0.164.0",',
		'\t\t\tsource: "github:openai/codex rust-v0.164.0 codex-x86_64-unknown-linux-musl.tar.gz",',
		"\t\t},",
		"\t},",
	].join("\n");

	const changed = withCloudPrograms(text, CLAUDE, CODEX.release);

	expect(changed).toContain('version: "2.1.322"');
	expect(changed).toContain("claude-code-linux-x64@2.1.322");
	expect(changed).toContain('version: "0.167.1"');
	expect(changed).toContain("rust-v0.167.1");
});

test("rewrites the Dockerfile's Claude and Codex blocks with the new digests", () => {
	const text = [
		"# Claude Code 2.1.308, the version the app pins.",
		"RUN npm install @anthropic-ai/claude-code-linux-x64@2.1.308 \\",
		"\t&& install /tmp/claude/node_modules/@anthropic-ai/claude-code-linux-x64/claude /opt/conducted/agent-binaries/claude/2.1.308/claude \\",
		"\t&& ln -s /opt/conducted/agent-binaries/claude/2.1.308/claude /opt/conducted/bin/claude",
		"# Codex 0.164.0, the version the app pins.",
		"RUN set -eux; \\",
		"\tcurl -fsSL -o /tmp/codex.tar.gz https://github.com/openai/codex/releases/download/rust-v0.164.0/codex-x86_64-unknown-linux-musl.tar.gz; \\",
		'\techo "90dd0b03b28afcb7fa733a4f73b413db2916a47347efd43fb669cc1c774ee8e4  /tmp/codex.tar.gz" | sha256sum -c -; \\',
		"\tinstall /tmp/codex-x86_64-unknown-linux-musl /opt/conducted/agent-binaries/codex/0.164.0/codex; \\",
		"\tln -s /opt/conducted/agent-binaries/codex/0.164.0/codex /opt/conducted/bin/codex",
		"# Cursor's SDK 1.3.1, the version the app installs on demand.",
	].join("\n");

	const changed = withDockerfileVersions(
		text,
		"2.1.322",
		"0.167.1",
		"64bcc99c32e434b4bcb0508a97df9b7aeecdb97e956d976fb13661096ec4e3e2",
	);

	expect(changed).toContain("# Claude Code 2.1.322");
	expect(changed).toContain("claude-code-linux-x64@2.1.322");
	expect(changed).toContain("/agent-binaries/claude/2.1.322/claude");
	expect(changed).toContain("# Codex 0.167.1");
	expect(changed).toContain("rust-v0.167.1");
	expect(changed).toContain(
		'echo "64bcc99c32e434b4bcb0508a97df9b7aeecdb97e956d976fb13661096ec4e3e2  /tmp/codex.tar.gz"',
	);
	expect(changed).toContain("/agent-binaries/codex/0.167.1/codex");
	expect(changed).toContain("# Cursor's SDK 1.3.1");
});

test("changes nothing when every pinned copy is current", () => {
	const inputs = {
		feed: renderFeed(mergeFeed({ claude: null, codex: null }, CLAUDE, CODEX.release)),
		rust: withRustPin(withRustPin(RUST, "Claude", "2.1.322"), "Codex", "0.167.1"),
		sdkPackage: withSdkPin(
			'{\n\t"dependencies": {\n\t\t"@anthropic-ai/claude-agent-sdk": "0.3.321"\n\t}\n}\n',
			"0.3.321",
		),
		image: withCloudPrograms(IMAGE, CLAUDE, CODEX.release),
		dockerfile: withDockerfileVersions(DOCKERFILE, "2.1.322", "0.167.1", CODEX.linuxX64Sha256),
	};

	expect(planUpdate(inputs, CLAUDE, CODEX, "0.3.321")).toEqual([]);
});

test("names every pinned copy that a new version changes", () => {
	const inputs = {
		feed: renderFeed({ claude: null, codex: null }),
		rust: RUST,
		sdkPackage: '{"dependencies":{"@anthropic-ai/claude-agent-sdk":"0.3.318"}}',
		image: IMAGE,
		dockerfile: DOCKERFILE,
	};

	const paths = planUpdate(inputs, CLAUDE, CODEX, "0.3.321").map((update) => update.path);

	expect(paths).toContain("apps/desktop/src-tauri/programs/release-feed.json");
	expect(paths).toContain("apps/desktop/src-tauri/src/binaries.rs");
	expect(paths).toContain("packages/sidecar/package.json");
	expect(paths).toContain("apps/cloud/sandbox/image.ts");
	expect(paths).toContain("apps/cloud/sandbox/Dockerfile");
});

const RUST = [
	"pub fn as_str(self) -> &'static str {",
	"\tmatch self {",
	'\t\tManagedProgram::Claude => "claude",',
	"\t}",
	"}",
	"pub fn pinned_version(p: P) -> &'static str {",
	"\tmatch p {",
	'\t\tManagedProgram::Claude => "2.1.308",',
	'\t\tManagedProgram::Codex => "0.164.0",',
	"\t}",
	"}",
].join("\n");

const IMAGE = [
	"\tprograms: {",
	"\t\tclaude: {",
	'\t\t\tversion: "2.1.308",',
	'\t\t\tsource: "npm:@anthropic-ai/claude-code-linux-x64@2.1.308",',
	"\t\t},",
	"\t\tcodex: {",
	'\t\t\tversion: "0.164.0",',
	'\t\t\tsource: "github:openai/codex rust-v0.164.0 codex-x86_64-unknown-linux-musl.tar.gz",',
	"\t\t},",
	"\t},",
].join("\n");

const DOCKERFILE = [
	"# Claude Code 2.1.308, the version the app pins.",
	"RUN npm install @anthropic-ai/claude-code-linux-x64@2.1.308 \\",
	"\t&& install /tmp/claude/node_modules/@anthropic-ai/claude-code-linux-x64/claude /opt/conducted/agent-binaries/claude/2.1.308/claude \\",
	"\t&& ln -s /opt/conducted/agent-binaries/claude/2.1.308/claude /opt/conducted/bin/claude",
	"# Codex 0.164.0, the version the app pins.",
	"RUN set -eux; \\",
	"\tcurl -fsSL -o /tmp/codex.tar.gz https://github.com/openai/codex/releases/download/rust-v0.164.0/codex-x86_64-unknown-linux-musl.tar.gz; \\",
	'\techo "90dd0b03b28afcb7fa733a4f73b413db2916a47347efd43fb669cc1c774ee8e4  /tmp/codex.tar.gz" | sha256sum -c -; \\',
	"\tinstall /tmp/codex-x86_64-unknown-linux-musl /opt/conducted/agent-binaries/codex/0.164.0/codex; \\",
	"\tln -s /opt/conducted/agent-binaries/codex/0.164.0/codex /opt/conducted/bin/codex",
	"# Cursor's SDK 1.3.1, the version the app installs on demand.",
].join("\n");
