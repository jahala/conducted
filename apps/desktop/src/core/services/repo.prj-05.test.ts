/**
 * @feature PRJ-05 Repository icon
 * Owns: tests for saving and clearing a repository icon through the real container: emoji, upload,
 * bad type, too large, an image the web view cannot draw, a failed database write that keeps the
 * old icon, the old upload trashed when it is replaced or cleared or its project is removed, a new
 * file name for each upload, and only the picked file and the icons folder exposed to the web view.
 * The drawing itself runs in a real browser (scripts/catalogue/icon-resize.browser.ts); here the
 * memory Platform's drawing is scripted, because jsdom has no canvas.
 * Test first: an uploaded image is drawn at icon size and saved in app storage as a PNG.
 */
import { appError, err, ok } from "@conducted/shared";
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

/** Draws each image as "icon of <its bytes>" and records the type it was read as. */
function scriptDrawing(container: TestContainer): string[] {
	const types: string[] = [];
	container.memory.controls.scriptIconImage((bytes, mimeType) => {
		types.push(mimeType);
		return ok(new TextEncoder().encode(`icon of ${new TextDecoder().decode(bytes)}`));
	});
	return types;
}

/** The text of a file the app wrote as bytes, or undefined when nothing is there. */
const written = (container: TestContainer, path: string): string | undefined => {
	const bytes = container.memory.controls.blobs.get(path);
	return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
};

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

	// Conductor draws an upload on a 128 pixel square and keeps the PNG (renderApp `UWa` @11289680).
	it("draws an uploaded image at icon size and saves it in app storage as a PNG", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const source = "/tmp/picked-icon.jpeg";
		test.memory.controls.files.set(source, "jpeg bytes");
		const types = scriptDrawing(test);

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
		expect(types).toEqual(["image/jpeg"]);
		expect(written(test, destination)).toBe("icon of jpeg bytes");
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

	it("reports an image the web view cannot draw, and keeps no file", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		const source = "/tmp/broken-icon.png";
		test.memory.controls.files.set(source, "png bytes");
		test.memory.controls.scriptIconImage(() =>
			err(appError("icon_image_failed", "The web view could not decode the image.")),
		);

		const result = await test.container.actions.projects.setIcon(repo.id, {
			kind: "file",
			path: source,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.message).toBe("Failed to set the icon. Try a different image.");
		}
		expect(test.container.services.repo.store.getState().reposById[repo.id]?.icon).toBeNull();
		const folder = repoIconsDir(test.memory.platform.fs.paths);
		expect(
			[...test.memory.controls.blobs.keys()].filter((path) => path.startsWith(folder)),
		).toEqual([]);
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
		scriptDrawing(test);

		expect(await upload(test, repo.id, "/tmp/first.png")).toEqual(ok(undefined));
		const first = uploaded(test, repo.id);
		expect(await upload(test, repo.id, "/tmp/second.png")).toEqual(ok(undefined));
		const second = uploaded(test, repo.id);

		expect(second).not.toBe(first);
		expect(written(test, second)).toBe("icon of bytes of /tmp/second.png");
	});

	// The file system has no delete, only the Trash, so a file that is gone was trashed.
	it("trashes the previous upload when the icon is replaced or cleared", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		scriptDrawing(test);

		await upload(test, repo.id, "/tmp/first.png");
		const png = uploaded(test, repo.id);
		await upload(test, repo.id, "/tmp/second.jpg");
		const jpg = uploaded(test, repo.id);
		expect(test.memory.controls.blobs.has(png)).toBe(false);

		expect(await test.container.actions.projects.setIcon(repo.id, null)).toEqual(ok(undefined));
		expect(test.memory.controls.blobs.has(jpg)).toBe(false);
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
		scriptDrawing(test);
		await upload(test, repo.id, "/tmp/first.png");
		const kept = uploaded(test, repo.id);

		failWrites = true;
		const result = await upload(test, repo.id, "/tmp/second.png");

		expect(result.ok).toBe(false);
		expect(uploaded(test, repo.id)).toBe(kept);
		expect(written(test, kept)).toBe("icon of bytes of /tmp/first.png");
	});

	it("exposes only the picked file and the icons folder to the web view", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		scriptDrawing(test);

		await upload(test, repo.id, "/Users/me/Pictures/logo.png");

		const roots = test.memory.controls.registeredRoots;
		expect(roots).not.toContain("/Users/me/Pictures");
		expect(roots).toContain(repoIconsDir(test.memory.platform.fs.paths));
	});

	it("trashes a removed project's uploaded icon", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container);
		scriptDrawing(test);
		await upload(test, repo.id, "/tmp/first.png");
		const icon = uploaded(test, repo.id);

		expect(await test.container.services.repo.remove(repo.id)).toEqual(ok(undefined));

		expect(test.memory.controls.blobs.has(icon)).toBe(false);
	});
});
