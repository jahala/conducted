/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: the image's pinned inputs and fixed paths: the base and sandbox images, the program
 * versions and the managed-program paths the sidecar reads, the app version and the folders the
 * entry script sets.
 * Behaviour: cloud-and-remote.md Part 1 (git, gh, the agent programs and our sidecar in the
 * sandbox), native-and-sidecar-map.md A9 and A6 (the app's managed programs live at
 * `agent-binaries/<program>/<version>/<program>` with a `bin/<program>` link, and the sidecar reads
 * `CONDUCTED_BIN_DIR` and `CONDUCTED_AGENT_BINARIES_DIR`). D088: a managed agent never falls back to
 * a PATH copy, so each program must sit exactly where the finder looks.
 * Must handle: a version the app pins changing (the image test compares this table with
 * `pinned_version` in binaries.rs); a plain `docker build` without the prefilled build folder (the
 * Dockerfile says to run the build script first).
 * Our design choice: the base is the Node image by digest, not a moving tag, so the same Dockerfile
 * builds the same image. Claude Code and Codex come from the vendors' own Linux releases; gh comes
 * from the GitHub CLI release the app pins; Cursor's SDK comes from npm at the version the app
 * installs on demand (D083, D123). Git and ripgrep are the Debian trixie builds.
 * Test first: `programPath("claude")` is
 * `/opt/conducted/agent-binaries/claude/2.1.308/claude`.
 */

/** The version the app pins, from `pinned_version` in `apps/desktop/src-tauri/src/binaries.rs`. */
export interface ImageProgram {
	version: string;
	/** The archive or package the binary comes from. */
	source: string;
}

export const IMAGE = {
	/** `node:24-trixie-slim`, the Debian trixie slim image, pinned by digest (read 2026-11-07). */
	base: "node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d",
	/** The sandbox helpers' image, pinned by digest, read 2026-11-07. */
	sandboxImage:
		"cloudflare/sandbox:1.0.3@sha256:fc1740c3cba26461f0ab1771287c84018ab2cca43a70ebb823087c85d780aaec",
	/** The app version the sidecar logs; the test keeps it equal to package.json. */
	appVersion: "0.3.3",
	/** Debian trixie's git and ripgrep. */
	gitVersion: "1:2.47.3-0+deb13u1",
	ripgrepVersion: "14.1.1-1+b4",
	programs: {
		claude: {
			version: "2.1.308",
			source: "npm:@anthropic-ai/claude-code-linux-x64@2.1.308",
		},
		codex: {
			version: "0.164.0",
			source: "github:openai/codex rust-v0.164.0 codex-x86_64-unknown-linux-musl.tar.gz",
		},
		gh: {
			version: "2.100.0",
			source: "github:cli/cli v2.100.0 gh_2.100.0_linux_amd64.tar.gz",
		},
	},
	/**
	 * Cursor's SDK, at the version the app installs on demand (AGENT-09, D083). The native package
	 * is the one the loader names for this image's platform and CPU; the packages are the app's
	 * release feed's exact tree (D123).
	 */
	cursorSdk: {
		version: "1.3.1",
		native: "@cursor/sdk-linux-x64",
		packages: [
			{ name: "@cursor/sdk", version: "1.3.1" },
			{ name: "@cursor/sdk-linux-x64", version: "1.3.1" },
			{ name: "@bufbuild/protobuf", version: "1.10.0" },
			{ name: "@connectrpc/connect", version: "1.7.0" },
			{ name: "@connectrpc/connect-web", version: "1.7.0" },
			{ name: "@statsig/js-client", version: "3.31.0" },
			{ name: "@statsig/client-core", version: "3.31.0" },
			{ name: "zod", version: "4.6.7" },
		],
	},
	/** The app's bin folder: the managed-program links and our three shell scripts. */
	binDir: "/opt/conducted/bin",
	/** The managed programs' folder, in the layout the sidecar's finder reads (PLAT-28). */
	agentBinariesDir: "/opt/conducted/agent-binaries",
	sidecarProgram: "/opt/conducted/conducted-sidecar",
	entryProgram: "/opt/conducted/entry",
	/** The folder the Worker mirrors a repository into. */
	workspace: "/workspace",
	/** The writable state the sidecar needs. */
	varDir: "/var/conducted",
	/** The port the entry listens on; the Worker's `getTcpPort(8080)` connects here. */
	port: 8080,
} as const;

export type ImageProgramName = keyof typeof IMAGE.programs;

/** The managed copy's path: `<agent-binaries>/<program>/<version>/<program>`. */
export function programPath(name: ImageProgramName): string {
	return `${IMAGE.agentBinariesDir}/${name}/${IMAGE.programs[name].version}/${name}`;
}

/** One version of Cursor's SDK tree: `<agent-binaries>/cursor/<version>`. */
export function cursorSdkFolder(): string {
	return `${IMAGE.agentBinariesDir}/cursor/${IMAGE.cursorSdk.version}`;
}

/** The `cursor/current` link the sidecar's loader reads, as binaries.rs leaves it (D083). */
export function cursorSdkCurrentLink(): string {
	return `${IMAGE.agentBinariesDir}/cursor/current`;
}
