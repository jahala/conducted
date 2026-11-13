/**
 * Collects what the app ships for the third-party notices (issue #577, D148), from the package
 * managers' own data and the packages' own files. The I/O lives here; `notices.ts` writes the file.
 *
 * - npm: `pnpm licenses list --prod` for each workspace package whose code ships, which is pnpm's
 *   list of everything installed for its `dependencies` (and their optional dependencies). Three
 *   build tools put their own code into the web UI too, and are listed with the reason
 *   (`BUILD_TOOL_CODE`). A package that names an `os` or `cpu` is left out: pnpm installs it only on
 *   some machines, and what it holds is a native program found at run time, never bundled.
 *   `bundles.build.test.ts` builds every bundle and proves each package in it is listed.
 * - Rust: `cargo metadata` for the release target, walked from the app's crate along normal
 *   dependencies (procedural macros included, build and dev dependencies not).
 * - Other: Bun's runtime, which every compiled sidecar program carries, with Bun's own licence file
 *   for the pinned version (kept beside this file), and the Geist fonts the web UI bundles.
 *
 * Each package's licence and notice files are the files in its root whose names start with
 * LICENSE, LICENCE, COPYING, COPYRIGHT, NOTICE, UNLICENSE or PATENTS, plus a file its manifest
 * names (`SEE LICENSE IN <file>`, Cargo's `license-file`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { RELEASE_TARGET } from "../../apps/desktop/src-tauri/release/bundle.ts";
import { appError, err, ok, type Result } from "../../packages/shared/src/result.ts";
import { NOT_DECLARED, type NoticeEntry, type NoticeFile } from "./notices.ts";

/** Runs one program and returns its standard output, or an error value with its own words. */
export type RunCommand = (argv: readonly string[], cwd: string) => Result<string>;

export const runCommand: RunCommand = (argv, cwd) => {
	const [program, ...args] = argv;
	if (program === undefined) return err(appError("notices_command_empty", "No command to run."));
	const result = spawnSync(program, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (result.error !== undefined) {
		return err(
			appError("notices_command_failed", `Could not run ${program}: ${result.error.message}`),
		);
	}
	if (result.status !== 0) {
		return err(
			appError(
				"notices_command_failed",
				`${argv.join(" ")} failed (exit ${result.status}):\n${result.stderr.trim()}`,
			),
		);
	}
	return ok(result.stdout);
};

/** The parts of the app, in the order the file names them. */
const PARTS = ["app binary", "web UI", "sidecar", "cloud"] as const;
type Part = (typeof PARTS)[number];

/** The workspace packages whose `dependencies` ship, and the part each one is. */
const SHIPPED_WORKSPACES: readonly { filter: string; part: Part }[] = [
	{ filter: "@conducted/desktop", part: "web UI" },
	{ filter: "@conducted/sidecar", part: "sidecar" },
	// The Worker the app deploys and the sandbox image's entry, both carried in Contents/Resources.
	{ filter: "@conducted/cloud", part: "cloud" },
];

/** Build tools, installed as development dependencies, whose own code the build puts into a part. */
const BUILD_TOOL_CODE: readonly { filter: string; name: string; part: Part; why: string }[] =
	[
		{
			filter: "@conducted/desktop",
			name: "tailwindcss",
			part: "web UI",
			why: "its base styles and theme are compiled into the stylesheet",
		},
		{
			filter: "@conducted/desktop",
			name: "vite",
			part: "web UI",
			why: "its module preload helper is in the bundle",
		},
		{
			filter: "@conducted/desktop",
			name: "rolldown",
			part: "web UI",
			why: "its runtime is in the bundle",
		},
	];

/** The Geist fonts, kept in the repository (docs/design.md, Fonts). */
const FONTS = {
	name: "Geist",
	version: "1.9.1",
	licence: "OFL-1.1",
	file: "apps/desktop/src/assets/fonts/OFL.txt",
} as const;

/** Bun's licence for the pinned version, kept beside this file: `bun-<version>-LICENSE.md`. */
const bunLicencePath = (root: string, version: string): string =>
	join(root, "scripts/notices", `bun-${version}-LICENSE.md`);
const bunLicenceSource = (version: string): string =>
	`https://github.com/oven-sh/bun/blob/bun-v${version}/LICENSE.md`;

const LICENCE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicen[cs]e|patents)/i;

/** Every file under `dir`, as paths relative to it, in name order. */
function filesUnder(dir: string, prefix = ""): string[] {
	const found: string[] = [];
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) found.push(...filesUnder(path, `${prefix}${name}/`));
		else found.push(`${prefix}${name}`);
	}
	return found;
}

/** The licence and notice files in a package's root, plus `named` files its manifest points at. */
function licenceFiles(dir: string, named: readonly string[] = []): NoticeFile[] {
	const names = new Set<string>();
	for (const name of readdirSync(dir)) {
		if (!LICENCE_FILE.test(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			for (const inner of filesUnder(path)) names.add(`${name}/${inner}`);
		} else names.add(name);
	}
	for (const name of named) {
		if (existsSync(join(dir, name)) && statSync(join(dir, name)).isFile()) names.add(name);
	}
	return [...names]
		.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
		.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}

interface PackageJson {
	name?: string;
	version?: string;
	license?: unknown;
	licenses?: unknown;
	os?: unknown;
	cpu?: unknown;
}

/** The licence a package.json declares, in its own words. */
function declaredNpmLicence(manifest: PackageJson): string {
	const { license, licenses } = manifest;
	if (typeof license === "string" && license.trim() !== "") return license.trim();
	if (license !== undefined && license !== null) return JSON.stringify(license);
	if (licenses !== undefined && licenses !== null) return JSON.stringify(licenses);
	return NOT_DECLARED;
}

/** The file a `SEE LICENSE IN <file>` licence names, if any. */
function seeLicenceFile(licence: string): string[] {
	const match = /^SEE LICEN[CS]E IN (\S+)$/i.exec(licence);
	return match?.[1] === undefined ? [] : [match[1]];
}

/** Paths of the packages one `pnpm licenses list --json` answer names. */
function pathsInLicenceList(json: string, source: string): Result<string[]> {
	try {
		const parsed = JSON.parse(json) as Record<string, { name: string; paths: string[] }[]>;
		return ok(Object.values(parsed).flatMap((group) => group.flatMap((pkg) => pkg.paths)));
	} catch (error) {
		return err(appError("notices_pnpm_unreadable", `${source} did not print JSON.`, error));
	}
}

function readManifest(path: string): Result<PackageJson> {
	try {
		return ok(JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as PackageJson);
	} catch (error) {
		return err(
			appError("notices_manifest_unreadable", `Could not read ${path}/package.json.`, error),
		);
	}
}

/** Adds a package to `byKey`, joining the parts when it ships in more than one. */
function addEntry(byKey: Map<string, NoticeEntry>, entry: NoticeEntry): void {
	const key = `${entry.ecosystem} ${entry.name} ${entry.version}`;
	const known = byKey.get(key);
	if (known === undefined) {
		byKey.set(key, entry);
		return;
	}
	const parts = new Set([...known.shipsIn, ...entry.shipsIn]);
	byKey.set(key, {
		...known,
		shipsIn: PARTS.filter((part) => parts.has(part)),
		...(entry.note === undefined ? {} : { note: entry.note }),
	});
}

function npmEntry(path: string, manifest: PackageJson, part: Part): Result<NoticeEntry> {
	if (manifest.name === undefined || manifest.version === undefined) {
		return err(
			appError("notices_manifest_incomplete", `${path}/package.json has no name or version.`),
		);
	}
	const licence = declaredNpmLicence(manifest);
	return ok({
		ecosystem: "npm",
		name: manifest.name,
		version: manifest.version,
		licence,
		shipsIn: [part],
		files: licenceFiles(path, seeLicenceFile(licence)),
	});
}

/** The npm packages every shipped part carries, from pnpm's data. */
function collectNpm(root: string, run: RunCommand): Result<NoticeEntry[]> {
	const byKey = new Map<string, NoticeEntry>();
	for (const { filter, part } of SHIPPED_WORKSPACES) {
		const argv = ["pnpm", "--filter", filter, "licenses", "list", "--prod", "--json"];
		const listed = run(argv, root);
		if (!listed.ok) return listed;
		const paths = pathsInLicenceList(listed.value, argv.join(" "));
		if (!paths.ok) return paths;
		for (const path of paths.value) {
			const manifest = readManifest(path);
			if (!manifest.ok) return manifest;
			if (manifest.value.os !== undefined || manifest.value.cpu !== undefined) continue;
			const entry = npmEntry(path, manifest.value, part);
			if (!entry.ok) return entry;
			addEntry(byKey, entry.value);
		}
	}
	const devLists = new Map<string, string[]>();
	for (const tool of BUILD_TOOL_CODE) {
		let paths = devLists.get(tool.filter);
		if (paths === undefined) {
			const argv = ["pnpm", "--filter", tool.filter, "licenses", "list", "--dev", "--json"];
			const listed = run(argv, root);
			if (!listed.ok) return listed;
			const read = pathsInLicenceList(listed.value, argv.join(" "));
			if (!read.ok) return read;
			paths = read.value;
			devLists.set(tool.filter, paths);
		}
		const matches: [string, PackageJson][] = [];
		for (const path of paths) {
			const manifest = readManifest(path);
			if (!manifest.ok) return manifest;
			if (manifest.value.name === tool.name) matches.push([path, manifest.value]);
		}
		const [only, ...rest] = matches;
		if (only === undefined || rest.length > 0) {
			return err(
				appError(
					"notices_build_tool_ambiguous",
					`${tool.filter} has ${matches.length} installed copies of ${tool.name}; the notices need exactly one.`,
				),
			);
		}
		const entry = npmEntry(only[0], only[1], tool.part);
		if (!entry.ok) return entry;
		addEntry(byKey, { ...entry.value, note: `A build tool: ${tool.why}.` });
	}
	return ok([...byKey.values()]);
}

interface CargoPackage {
	id: string;
	name: string;
	version: string;
	source: string | null;
	license: string | null;
	license_file: string | null;
	manifest_path: string;
}

interface CargoMetadata {
	packages: CargoPackage[];
	resolve: {
		root: string;
		nodes: { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }[];
	};
}

/** The crate whose binary ships, from the repository root. */
const APP_CRATE_MANIFEST = "apps/desktop/src-tauri/Cargo.toml";

/** The crates the app's binary is built from for the release target, from Cargo's data. */
function collectCargo(root: string, run: RunCommand): Result<NoticeEntry[]> {
	const argv = [
		"cargo",
		"metadata",
		"--locked",
		"--format-version",
		"1",
		"--filter-platform",
		RELEASE_TARGET,
		"--manifest-path",
		join(root, APP_CRATE_MANIFEST),
	];
	const listed = run(argv, root);
	if (!listed.ok) return listed;
	let metadata: CargoMetadata;
	try {
		metadata = JSON.parse(listed.value) as CargoMetadata;
	} catch (error) {
		return err(appError("notices_cargo_unreadable", "cargo metadata did not print JSON.", error));
	}
	const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
	const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
	const reached = new Set<string>();
	const pending = [metadata.resolve.root];
	while (pending.length > 0) {
		const id = pending.pop() as string;
		if (reached.has(id)) continue;
		reached.add(id);
		for (const dep of nodes.get(id)?.deps ?? []) {
			if (dep.dep_kinds.some((kind) => kind.kind === null)) pending.push(dep.pkg);
		}
	}
	const entries: NoticeEntry[] = [];
	for (const id of reached) {
		const pkg = packages.get(id);
		if (pkg === undefined) {
			return err(
				appError("notices_cargo_unreadable", `cargo metadata names ${id} without its package.`),
			);
		}
		// A crate with no source is a path crate in this repository: ours, under our own licence.
		if (pkg.source === null) continue;
		entries.push({
			ecosystem: "cargo",
			name: pkg.name,
			version: pkg.version,
			licence:
				pkg.license ?? (pkg.license_file === null ? NOT_DECLARED : `See ${pkg.license_file}`),
			shipsIn: ["app binary"],
			files: licenceFiles(
				dirname(pkg.manifest_path),
				pkg.license_file === null ? [] : [pkg.license_file],
			),
		});
	}
	return ok(entries);
}

/** Bun's runtime and the fonts: shipped software no package manager lists. */
function collectOther(root: string): Result<NoticeEntry[]> {
	const bunVersion = readFileSync(join(root, ".bun-version"), "utf8").trim();
	const bunLicence = bunLicencePath(root, bunVersion);
	if (!existsSync(bunLicence)) {
		return err(
			appError(
				"notices_bun_licence_missing",
				`Bun ${bunVersion} has no licence file at ${bunLicence}. Save ${bunLicenceSource(bunVersion).replace("/blob/", "/raw/")} there, and trash the one for the old version.`,
			),
		);
	}
	const fontLicence = join(root, FONTS.file);
	return ok([
		{
			ecosystem: "other",
			name: "Bun",
			version: bunVersion,
			licence: "MIT (Bun's own code; its file lists the libraries it links and their licences)",
			shipsIn: ["sidecar", "cloud"],
			files: [{ name: bunLicenceSource(bunVersion), text: readFileSync(bunLicence, "utf8") }],
		},
		{
			ecosystem: "other",
			name: FONTS.name,
			version: FONTS.version,
			licence: FONTS.licence,
			shipsIn: ["web UI"],
			files: [
				{
					name: FONTS.file.slice(FONTS.file.lastIndexOf("/") + 1),
					text: readFileSync(fontLicence, "utf8"),
				},
			],
		},
	]);
}

/** Every entry of the notices file. */
export function collectAll(root: string, run: RunCommand): Result<NoticeEntry[]> {
	const npm = collectNpm(root, run);
	if (!npm.ok) return npm;
	const cargo = collectCargo(root, run);
	if (!cargo.ok) return cargo;
	const other = collectOther(root);
	if (!other.ok) return other;
	return ok([...npm.value, ...cargo.value, ...other.value]);
}
