/**
 * Opens TypeScript projects through the compiler's own API (the `typescript` package, version 7).
 * The structure guards use it to ask the type checker who uses a symbol and what a call passes,
 * so no guard has to guess with a regex. The server process starts once per run and is always
 * closed, even when the work throws. Only the async API is used: the sync one needs Node
 * internals that Bun does not have.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { API, type Project } from "typescript/unstable/async";

/** A project opened from one tsconfig, with the root folder its paths are shown against. */
export interface OpenProject {
	/** The tsconfig path from the repo root, for example `apps/desktop/tsconfig.json`. */
	config: string;
	project: Project;
	/** Absolute paths of the files the tsconfig includes. */
	files: string[];
}

/** Lower-cases a path, because the checker hands back lower-cased paths on a Mac. */
export const normal = (path: string): string => path.toLowerCase();

/** The path of `absolute` from `root`, with forward slashes. */
export const fromRoot = (root: string, absolute: string): string =>
	relative(root, absolute).split("\\").join("/");

/**
 * Opens each tsconfig under `root` and hands the projects to `work`. The caller checks that the
 * files exist first, so a missing config is reported as a problem and never skipped silently.
 */
export async function withProjects<T>(
	root: string,
	configs: readonly string[],
	work: (projects: OpenProject[]) => Promise<T>,
): Promise<T> {
	const api = new API({ cwd: root });
	try {
		const opened: OpenProject[] = [];
		for (const config of configs) {
			const path = join(root, config);
			if (!existsSync(path)) throw new Error(`${config} does not exist`);
			const snapshot = await api.updateSnapshot({ openProject: path });
			const project = snapshot
				.getProjects()
				.find((candidate) => normal(candidate.configFileName).endsWith(normal(config)));
			if (project === undefined) throw new Error(`The compiler did not open ${config}`);
			opened.push({ config, project, files: [...project.rootFiles] });
		}
		return await work(opened);
	} finally {
		await api.close();
	}
}
