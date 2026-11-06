/**
 * @feature PRJ-05 Repository icon
 * Owns: tests for saving and clearing a repository icon through the real container: emoji, upload,
 * bad type, too large, a failed copy, a failed database write that keeps the old icon, the old
 * upload trashed when it is replaced or cleared or its project is removed, a new file name for each
 * upload, and only the picked file and the icons folder exposed to the web view.
 * Test first: an uploaded PNG is copied into app storage and saved as a file icon.
 */
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";
import { failingOnExecute } from "../../test/failing-database.ts";
import { REPOS_SQL } from "../db/repos.ts";
import { repoIconsDir } from "./repo.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

const MAX_ICON_BYTES = 10 * 1024 * 1024;

function scriptCopy(container: TestContainer): void {
	container.memory.controls.scriptShell((command) => {
		if (command.program !== "cp") return null;
		const source = command.args[1];
		const target = command.args[2];
		if (source === undefined || target === undefined) return null;
		const text = container.memory.controls.files.get(source);
		if (text === undefined) return null;
		container.memory.controls.files.set(target, text);
		return ok({ exitCode: 0, stdout: "", stderr: "" });
	});
}

describe("PRJ-05 repo service setIcon", () => {
	it("saves an emoji and clears it again", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);

		const saved = await test.container.actions.projects.setIcon(repo.id, {
			kind: "emoji",
			emoji: "🚀",
		});
		expect(saved).toEqual(ok(undefined));
		expect(test.container.services.repo.store.getState().reposById[repo.id]?.icon).toBe("emoji:🚀");

		const cleared = await test.container.actions.projects.setIcon(repo.id, null);
		expect(cleared).toEqual(ok(undefined));
		expect(test.container.services.repo.store.getState().reposById[repo.id]?.icon).toBeNull();
	});

	it("copies an uploaded PNG into app storage", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const source = "/tmp/picked-icon.png";
		test.memory.controls.files.set(source, "png bytes");
		scriptCopy(test);

		const result = await test.container.actions.projects.setIcon(repo.id, {
			kind: "file",
			path: source,
		});

		expect(result).toEqual(ok(undefined));
		const icon = test.container.services.repo.store.getState().reposById[repo.id]?.icon ?? "";
		const destination = icon.slice("file:".length);
		expect(
			destination.startsWith(`${repoIconsDir(test.memory.platform.fs.paths)}/${repo.id}-`),
		).toBe(true);
		expect(destination.endsWith(".png")).toBe(true);
		expect(test.memory.controls.files.get(destination)).toBe("png bytes");
		expect(test.container.services.repo.store.getState().reposById[repo.id]?.icon).toBe(
			`file:${destination}`,
		);
	});

	it("refuses an image that is not PNG, JPEG, GIF, WebP or SVG", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);

		const result = await test.container.actions.projects.setIcon(repo.id, {
			kind: "file",
			path: "/tmp/icon.bmp",
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toBe("Choose a PNG, JPEG, GIF, WebP, or SVG image");
		}
	});

	it("refuses an image over 10 MB", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const source = "/tmp/huge-icon.png";
		test.memory.controls.files.set(source, "x".repeat(MAX_ICON_BYTES + 1));

		const result = await test.container.actions.projects.setIcon(repo.id, {
			kind: "file",
			path: source,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toBe("Image is too large. Choose one under 10MB.");
		}
	});

	it("reports an icon that cannot be copied", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const source = "/tmp/broken-icon.png";
		test.memory.controls.files.set(source, "png bytes");

		const result = await test.container.actions.projects.setIcon(repo.id, {
			kind: "file",
			path: source,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toBe("Failed to set the icon. Try a different image.");
		}
		expect(test.container.services.repo.store.getState().reposById[repo.id]?.icon).toBeNull();
	});

	const uploaded = (container: TestContainer, repoId: string): string => {
		const icon = container.container.services.repo.store.getState().reposById[repoId]?.icon ?? "";
		expect(icon.startsWith("file:")).toBe(true);
		return icon.slice("file:".length);
	};

	async function upload(container: TestContainer, repoId: string, source: string) {
		container.memory.controls.files.set(source, `bytes of ${source}`);
		return container.container.actions.projects.setIcon(repoId as never, {
			kind: "file",
			path: source,
		});
	}

	it("gives each upload its own file, so a new image is not shown from the cache", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		scriptCopy(test);

		expect(await upload(test, repo.id, "/tmp/first.png")).toEqual(ok(undefined));
		const first = uploaded(test, repo.id);
		expect(await upload(test, repo.id, "/tmp/second.png")).toEqual(ok(undefined));
		const second = uploaded(test, repo.id);

		expect(second).not.toBe(first);
		expect(test.memory.controls.files.get(second)).toBe("bytes of /tmp/second.png");
	});

	// The file system has no delete, only the Trash, so a file that is gone was trashed.
	it("trashes the previous upload when the icon is replaced or cleared", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		scriptCopy(test);

		await upload(test, repo.id, "/tmp/first.png");
		const png = uploaded(test, repo.id);
		await upload(test, repo.id, "/tmp/second.jpg");
		const jpg = uploaded(test, repo.id);
		expect(test.memory.controls.files.has(png)).toBe(false);

		expect(await test.container.actions.projects.setIcon(repo.id, null)).toEqual(ok(undefined));
		expect(test.memory.controls.files.has(jpg)).toBe(false);
	});

	it("keeps the old icon and its file when the database write fails", async () => {
		let failWrites = false;
		test = createTestContainer({
			wrapDatabase: (database) => {
				const failing = failingOnExecute(database, REPOS_SQL.setIcon, new Error("disk full"));
				return {
					execute: (sql, params) =>
						failWrites ? failing.execute(sql, params) : database.execute(sql, params),
					select: (sql, params) => database.select(sql, params),
					transaction: (work) => database.transaction(work),
				};
			},
		});
		const repo = await seedRepo(test.container);
		scriptCopy(test);
		await upload(test, repo.id, "/tmp/first.png");
		const kept = uploaded(test, repo.id);

		failWrites = true;
		const result = await upload(test, repo.id, "/tmp/second.png");

		expect(result.ok).toBe(false);
		expect(uploaded(test, repo.id)).toBe(kept);
		expect(test.memory.controls.files.get(kept)).toBe("bytes of /tmp/first.png");
	});

	it("exposes only the picked file and the icons folder to the web view", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		scriptCopy(test);

		await upload(test, repo.id, "/Users/me/Pictures/logo.png");

		const roots = test.memory.controls.registeredRoots;
		expect(roots).not.toContain("/Users/me/Pictures");
		expect(roots).toContain(repoIconsDir(test.memory.platform.fs.paths));
	});

	it("trashes a removed project's uploaded icon", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		scriptCopy(test);
		await upload(test, repo.id, "/tmp/first.png");
		const icon = uploaded(test, repo.id);

		expect(await test.container.services.repo.remove(repo.id)).toEqual(ok(undefined));

		expect(test.memory.controls.files.has(icon)).toBe(false);
	});
});
