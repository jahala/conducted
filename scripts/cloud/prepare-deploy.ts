/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: the deploy inputs the app ships as Tauri resources: a pre-bundled Worker, the sandbox
 * Dockerfile, the sandbox image's build output, and `deploy.json`, the small fact file Rust reads
 * to write the deploy config.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 ("Deploying") and D109: the app carries what it
 * deploys, so the user needs neither a checkout nor a build. The sandbox image is built by the
 * user's Docker from the shipped Dockerfile and build output.
 * Must handle: a missing or invalid `apps/cloud/wrangler.jsonc`; a bundling run that fails (stop
 * and leave the previous output untouched, so a release never ships a half folder); a config with
 * no container, no Durable Object binding or no R2 binding.
 * Our design choice: the Worker is bundled once, at release time, with `wrangler deploy --dry-run`
 * against a copy of the config that has no containers, so the dry run does not try to build the
 * image. At deploy time the user's wrangler uploads that bundle with `no_bundle: true`.
 * Test first: the bundling config drops the containers block, and a config without a bucket is
 * refused.
 */
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where the Tauri bundle takes the deploy inputs from, relative to the repository root. */
export const DEPLOY_RESOURCES = "apps/desktop/src-tauri/resources/cloud";
/** The Worker source folder. */
export const CLOUD_SOURCE = "apps/cloud";
/** The file the app reads to write the deploy config. */
export const DEPLOY_FACT_FILE = "deploy.json";
/** The pre-bundled Worker the app uploads. Rust's `DEPLOY_WORKER_FILE` is the same name. */
export const DEPLOY_WORKER_FILE = "worker.js";

/** The facts a deploy needs, read from the Worker's own `wrangler.jsonc`. */
export interface DeployFacts {
	name: string;
	compatibilityDate: string;
	compatibilityFlags: string[];
	instance: string;
	className: string;
	imageKey: string;
	objectBinding: string;
	backupBinding: string;
}

/** Removes JSONC comments and trailing commas, keeping every string (a URL) intact. */
export function stripJsonc(text: string): string {
	let out = "";
	let index = 0;
	let inString = false;
	let escaped = false;
	while (index < text.length) {
		const character = text[index] ?? "";
		if (inString) {
			out += character;
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === '"') inString = false;
			index += 1;
			continue;
		}
		if (character === '"') {
			inString = true;
			out += character;
			index += 1;
			continue;
		}
		if (character === "/" && text[index + 1] === "/") {
			while (index < text.length && text[index] !== "\n") index += 1;
			continue;
		}
		if (character === "/" && text[index + 1] === "*") {
			index += 2;
			while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
				index += 1;
			}
			index += 2;
			continue;
		}
		if (character === ",") {
			let next = index + 1;
			while (next < text.length && /\s/.test(text[next] ?? "")) next += 1;
			if (text[next] === "]" || text[next] === "}") {
				index += 1;
				continue;
			}
		}
		out += character;
		index += 1;
	}
	return out;
}

/** The deploy facts a Worker config states, or the reason it cannot be used. */
export function readDeployFacts(text: string): DeployFacts {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripJsonc(text));
	} catch {
		throw new Error("apps/cloud/wrangler.jsonc is not valid JSON.");
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("apps/cloud/wrangler.jsonc is not an object.");
	}
	const config = parsed as {
		name?: unknown;
		compatibility_date?: unknown;
		compatibility_flags?: unknown;
		vars?: { INSTANCE_TYPE?: unknown };
		containers?: { class_name?: unknown; images?: Record<string, unknown> }[];
		durable_objects?: { bindings?: { name?: unknown }[] };
		r2_buckets?: { binding?: unknown }[];
	};
	const container = config.containers?.[0];
	const imageKey = container?.images === undefined ? "" : (Object.keys(container.images)[0] ?? "");
	const facts: DeployFacts = {
		name: typeof config.name === "string" ? config.name : "",
		compatibilityDate:
			typeof config.compatibility_date === "string" ? config.compatibility_date : "",
		compatibilityFlags: Array.isArray(config.compatibility_flags)
			? config.compatibility_flags.filter((flag): flag is string => typeof flag === "string")
			: [],
		instance: typeof config.vars?.INSTANCE_TYPE === "string" ? config.vars.INSTANCE_TYPE : "",
		className: typeof container?.class_name === "string" ? container.class_name : "",
		imageKey,
		objectBinding:
			typeof config.durable_objects?.bindings?.[0]?.name === "string"
				? (config.durable_objects?.bindings?.[0]?.name as string)
				: "",
		backupBinding:
			typeof config.r2_buckets?.[0]?.binding === "string"
				? (config.r2_buckets?.[0]?.binding as string)
				: "",
	};
	const missing = [
		facts.name === "" ? "name" : null,
		facts.compatibilityDate === "" ? "compatibility_date" : null,
		facts.instance === "" ? "vars.INSTANCE_TYPE" : null,
		facts.className === "" ? "containers[0].class_name" : null,
		facts.imageKey === "" ? "containers[0].images" : null,
		facts.objectBinding === "" ? "durable_objects.bindings[0].name" : null,
		facts.backupBinding === "" ? "r2_buckets[0].binding" : null,
	].filter((field): field is string => field !== null);
	if (missing.length > 0) {
		throw new Error(`apps/cloud/wrangler.jsonc is missing ${missing.join(", ")}.`);
	}
	return facts;
}

/** The config that bundles the Worker without building the container image. */
export function bundlingConfig(facts: DeployFacts, main: string): Record<string, unknown> {
	return {
		name: facts.name,
		main,
		compatibility_date: facts.compatibilityDate,
		compatibility_flags: facts.compatibilityFlags,
		vars: { INSTANCE_TYPE: facts.instance },
		durable_objects: { bindings: [{ class_name: facts.className, name: facts.objectBinding }] },
		exports: { [facts.className]: { type: "durable-object", storage: "sqlite" } },
		r2_buckets: [{ binding: facts.backupBinding, bucket_name: facts.name }],
	};
}

/** Runs one command and refuses a nonzero exit, with its own words. */
function run(argv: readonly string[], cwd: string, what: string): void {
	const result = Bun.spawnSync([...argv], { cwd, stdout: "inherit", stderr: "pipe" });
	if (result.exitCode !== 0) {
		const stderr = result.stderr === undefined ? "" : result.stderr.toString();
		throw new Error(`${what} failed:\n${stderr}`);
	}
}

/**
 * Builds the deploy inputs into `outputRoot`. The work goes to a sibling folder first and is moved
 * into place only when every step succeeded, so a failed run leaves the previous inputs intact.
 */
export function prepareDeploy(
	repoRoot: string,
	outputRoot = join(repoRoot, DEPLOY_RESOURCES),
): void {
	const source = join(repoRoot, CLOUD_SOURCE);
	const facts = readDeployFacts(readFileSync(join(source, "wrangler.jsonc"), "utf8"));
	const staging = mkdtempSync(join(tmpdir(), "conducted-cloud-deploy-"));
	try {
		// The image inputs the Dockerfile copies: the Linux sidecar, the entry and our scripts.
		run(["bun", "apps/cloud/sandbox/build.ts"], repoRoot, "Building the sandbox image inputs");
		const work = join(staging, "work");
		const out = join(staging, "out");
		mkdirSync(work, { recursive: true });
		const bundleDir = join(work, "bundle");
		const configPath = join(work, "bundle-config.jsonc");
		writeFileSync(
			configPath,
			`${JSON.stringify(bundlingConfig(facts, join(source, "src/index.ts")), null, 2)}\n`,
		);
		run(
			[
				"pnpm",
				"exec",
				"wrangler",
				"deploy",
				"--dry-run",
				"--config",
				configPath,
				"--outdir",
				bundleDir,
			],
			source,
			"Bundling the Worker",
		);
		const bundle = join(bundleDir, "index.js");
		if (!existsSync(bundle)) throw new Error(`wrangler wrote no ${bundle}.`);

		mkdirSync(join(out, "sandbox"), { recursive: true });
		cpSync(bundle, join(out, DEPLOY_WORKER_FILE));
		writeFileSync(join(out, DEPLOY_FACT_FILE), `${JSON.stringify(facts, null, 2)}\n`);
		cpSync(join(source, "sandbox/Dockerfile"), join(out, "sandbox/Dockerfile"));
		cpSync(join(source, "sandbox/build"), join(out, "sandbox/build"), { recursive: true });

		rmSync(outputRoot, { recursive: true, force: true });
		cpSync(out, outputRoot, { recursive: true });
		// The staging folder is one this run made in the system temp folder, so it may be removed.
		rmSync(staging, { recursive: true, force: true });
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

if (import.meta.main) {
	const repoRoot = join(import.meta.dir, "../..");
	try {
		prepareDeploy(repoRoot);
		console.log(`The deploy inputs are in ${join(repoRoot, DEPLOY_RESOURCES)}`);
	} catch (error) {
		console.error((error as Error).message);
		process.exit(1);
	}
}
