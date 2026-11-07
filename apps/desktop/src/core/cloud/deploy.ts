/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Owns: reading the Worker's resource names from its own `wrangler.jsonc`, and the deploy and
 * uninstall calls the Connections page makes.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1, "Deploying" (a setup flow in the app that runs
 * `wrangler` with the user's login; the container image is built in the user's account from our
 * Dockerfile). The brief's D018 model: the Worker, its container application and its R2 bucket all
 * belong to the user's account, and the uninstall removes all three together because a deleted
 * Worker leaves its container billing.
 * Must handle: a folder with no `wrangler.jsonc`; a config with comments and trailing commas (it
 * is JSONC); a config missing the Worker name, the container name or the bucket name, each named in
 * the error; a deploy already in flight is the user's next click, not a second concurrent deploy,
 * because the page disables its button.
 * Our design choice: the names are read from the config the deploy uses, so there is one home for
 * them and a renamed resource needs no second change. The pairing token is made in Rust and set as
 * a Worker secret there, so it never reaches the web view (D106).
 * Test first: a comment that holds a URL is not cut from the config, and a config with no bucket
 * name is refused.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type {
	Cloud,
	CloudDeployInput,
	CloudDeployResult,
	FileSystem,
} from "../../platform/platform.ts";

/** The three names a deploy needs, all read from the Worker's config. */
export interface DeployManifest {
	workerName: string;
	bucketName: string;
	containerApp: string;
}

/**
 * Removes JSONC's comments and trailing commas while keeping every string intact, so a URL inside
 * `$schema` survives. The config is ours and has no block comments, but handling them costs nothing.
 */
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

/** The resource names a Worker's config states, or the reason it cannot be used. */
export function parseDeployManifest(text: string): Result<DeployManifest> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stripJsonc(text));
	} catch {
		return err(appError("cloud_config_invalid", "The Worker's wrangler.jsonc is not valid JSON."));
	}
	if (typeof parsed !== "object" || parsed === null) {
		return err(appError("cloud_config_invalid", "The Worker's wrangler.jsonc is not an object."));
	}
	const config = parsed as {
		name?: unknown;
		containers?: unknown;
		r2_buckets?: unknown;
	};
	const first = (value: unknown): Record<string, unknown> | null =>
		Array.isArray(value) && typeof value[0] === "object" && value[0] !== null
			? (value[0] as Record<string, unknown>)
			: null;
	const workerName = typeof config.name === "string" ? config.name : "";
	const containerApp =
		typeof first(config.containers)?.name === "string"
			? (first(config.containers)?.name as string)
			: "";
	const bucketName =
		typeof first(config.r2_buckets)?.bucket_name === "string"
			? (first(config.r2_buckets)?.bucket_name as string)
			: "";
	const missing = [
		workerName === "" ? "name" : null,
		containerApp === "" ? "containers[0].name" : null,
		bucketName === "" ? "r2_buckets[0].bucket_name" : null,
	].filter((field): field is string => field !== null);
	if (missing.length > 0) {
		return err(
			appError(
				"cloud_config_invalid",
				`The Worker's wrangler.jsonc is missing ${missing.join(", ")}.`,
			),
		);
	}
	return ok({ workerName, bucketName, containerApp });
}

export interface CloudDeployService {
	/** Deploys the Worker from `sourceDir` to the user's account and pairs this Mac. */
	deploy(sourceDir: string): Promise<Result<CloudDeployResult>>;
	/** Deletes what the Worker's deploy made and unpairs this Mac. */
	uninstall(sourceDir: string): Promise<Result<void>>;
}

export interface CloudDeployDeps {
	cloud: Pick<Cloud, "deploy" | "uninstall">;
	fs: Pick<FileSystem, "readText">;
}

/** Reads the Worker's config, then hands its names to the shell's deploy. */
async function manifestFrom(
	fs: Pick<FileSystem, "readText">,
	sourceDir: string,
): Promise<Result<DeployManifest>> {
	const folder = sourceDir.trim().replace(/\/+$/, "");
	if (folder === "") {
		return err(appError("cloud_source_invalid", "Choose the folder that holds the Worker."));
	}
	const text = await fs.readText(`${folder}/wrangler.jsonc`);
	if (!text.ok) {
		return err(
			appError("cloud_source_invalid", `That folder has no wrangler.jsonc: ${text.error.message}`),
		);
	}
	const manifest = parseDeployManifest(text.value);
	if (!manifest.ok) return manifest;
	return ok(manifest.value);
}

export function createCloudDeploy(deps: CloudDeployDeps): CloudDeployService {
	return {
		deploy: async (sourceDir) => {
			const manifest = await manifestFrom(deps.fs, sourceDir);
			if (!manifest.ok) return manifest;
			const input: CloudDeployInput = {
				sourceDir: sourceDir.trim().replace(/\/+$/, ""),
				workerName: manifest.value.workerName,
				bucketName: manifest.value.bucketName,
				containerApp: manifest.value.containerApp,
			};
			return deps.cloud.deploy(input);
		},
		uninstall: async (sourceDir) => {
			const manifest = await manifestFrom(deps.fs, sourceDir);
			if (!manifest.ok) return manifest;
			return deps.cloud.uninstall({
				sourceDir: sourceDir.trim().replace(/\/+$/, ""),
				workerName: manifest.value.workerName,
				bucketName: manifest.value.bucketName,
				containerApp: manifest.value.containerApp,
			});
		},
	};
}
