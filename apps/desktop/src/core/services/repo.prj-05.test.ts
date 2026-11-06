/**
 * @feature PRJ-05 Repository icon
 * Owns: tests for saving and clearing a repository icon through the real container: emoji, upload,
 * bad type, too large, and a failed copy.
 * Test first: an uploaded PNG is copied into app storage and saved as a file icon.
 */
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";
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
		const destination = `${repoIconsDir(test.memory.platform.fs.paths)}/${repo.id}.png`;
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
});
