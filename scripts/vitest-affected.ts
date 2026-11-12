/**
 * Prints, as one JSON array of absolute paths, the test files Vitest's own module graph says a set
 * of changed files can affect. It asks Vitest the question `vitest related` answers, without
 * running a test: Vitest walks each test file's imports through the package's own Vite
 * configuration, skips modules a test mocks, and answers "every test" when a changed file is part
 * of its configuration or setup. scripts/run-tests.ts calls it for each Vitest runner.
 *
 * It runs under Node, as Vitest does, and loads the Vitest the package itself installed.
 *
 * Usage: node scripts/vitest-affected.ts <package folder> <project or -> <changed file>...
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [folder, project, ...files] = process.argv.slice(2);
if (folder === undefined || project === undefined) {
	console.error("Usage: node scripts/vitest-affected.ts <package folder> <project or -> <file>...");
	process.exit(64);
}
const root = resolve(folder);
const require = createRequire(join(root, "package.json"));
const { createVitest } = await import(pathToFileURL(require.resolve("vitest/node")).href);
const vitest = await createVitest("test", {
	root,
	watch: false,
	related: files.map((file) => resolve(file)),
	project: project === "-" ? undefined : [project],
	reporters: [],
});
try {
	const specifications: { moduleId: string }[] = await vitest.getRelevantTestSpecifications();
	process.stdout.write(
		`${JSON.stringify([...new Set(specifications.map((spec) => spec.moduleId))])}\n`,
	);
} finally {
	await vitest.close();
}
