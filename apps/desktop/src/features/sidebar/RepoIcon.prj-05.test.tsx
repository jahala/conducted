/**
 * @feature PRJ-05 Repository icon
 * Owns: tests for the sidebar avatar and its Change repository icon dialog over the real container:
 * the context menu, the picker's sources, choosing an emoji, removing one, uploading an image, and
 * the letter shown when a favicon or owner avatar does not load.
 * Test first: right-clicking the avatar offers Change repository icon, and choosing an emoji saves it.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo } from "../../core/model.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";
import { RepoIconAvatar } from "./RepoIcon.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function renderAvatar(changes: Partial<Parameters<typeof seedRepo>[1]> = {}) {
	test = createTestContainer();
	const repo = await seedRepo(test.container, changes);
	render(
		<ServicesProvider container={test.container}>
			<RepoIconAvatar repo={repo} />
		</ServicesProvider>,
	);
	return { repo, container: test.container };
}

async function openPicker(repo: Repo): Promise<void> {
	fireEvent.contextMenu(screen.getByRole("img", { name: `${repo.name} icon` }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "Change repository icon" }));
	await screen.findByRole("dialog", { name: "Change repository icon" });
}

describe("PRJ-05 repository icon avatar", () => {
	it("shows the repository's letter when its owner avatar or favicon fails to load", async () => {
		const { repo } = await renderAvatar({
			name: "conducted",
			remoteUrl: "https://gitlab.example.com/me/conducted.git",
		});
		const avatar = screen.getByRole("img", { name: `${repo.name} icon` });
		const image = avatar.querySelector("img");
		expect(image?.getAttribute("src")).toBe("https://gitlab.example.com/favicon.ico");

		fireEvent.error(image as HTMLImageElement);

		expect(avatar.querySelector("img")).toBeNull();
		expect(avatar.textContent).toBe("C");
	});

	it("opens the picker from the repo icon's right-click menu", async () => {
		const { repo } = await renderAvatar({ icon: "emoji:🚀" });
		await openPicker(repo);

		expect(screen.getByRole("tab", { name: "Icons" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Emoji" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Favicon" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Upload" })).toBeTruthy();
		expect(screen.getByLabelText("Search emoji")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Remove emoji" })).toBeTruthy();
	});

	it("searches emoji and saves the chosen one", async () => {
		const { repo, container } = await renderAvatar();
		await openPicker(repo);

		fireEvent.change(screen.getByLabelText("Search emoji"), { target: { value: "rocket" } });
		fireEvent.click(screen.getByRole("button", { name: "Use 🚀" }));

		await waitFor(() =>
			expect(container.services.repo.store.getState().reposById[repo.id]?.icon).toBe("emoji:🚀"),
		);
		expect(screen.queryByRole("dialog", { name: "Change repository icon" })).toBeNull();
	});

	it("removes the saved emoji", async () => {
		const { repo, container } = await renderAvatar({ icon: "emoji:🚀" });
		await openPicker(repo);

		fireEvent.click(screen.getByRole("button", { name: "Remove emoji" }));

		await waitFor(() =>
			expect(container.services.repo.store.getState().reposById[repo.id]?.icon).toBeNull(),
		);
	});

	it("chooses a built-in icon from the Icons tab", async () => {
		const { repo, container } = await renderAvatar();
		await openPicker(repo);

		fireEvent.click(screen.getByRole("tab", { name: "Icons" }));
		fireEvent.click(screen.getByRole("button", { name: "Use icon diamond" }));

		await waitFor(() =>
			expect(container.services.repo.store.getState().reposById[repo.id]?.icon).toBe("emoji:◆"),
		);
	});

	it("describes itself in Conductor's words, for screen readers only", async () => {
		const { repo } = await renderAvatar({ icon: "emoji:🚀" });
		await openPicker(repo);

		const description = screen.getByText(
			"Pick an icon, emoji, favicon, or uploaded image for this repository",
		);
		expect(description.closest("[style]")?.getAttribute("style")).toContain("clip");
	});

	it("says No favicon detected for a repository with no remote, with its letter", async () => {
		const { repo } = await renderAvatar({ name: "notes", icon: "emoji:🚀", remoteUrl: null });
		await openPicker(repo);

		fireEvent.click(screen.getByRole("tab", { name: "Favicon" }));

		expect(screen.getByText("No favicon detected")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /favicon/i })).toBeNull();
	});

	it("offers the GitHub avatar for a GitHub repository while another icon is saved", async () => {
		const { repo, container } = await renderAvatar({
			icon: "emoji:🚀",
			remoteUrl: "git@github.com:octocat/alpha.git",
		});
		await openPicker(repo);
		fireEvent.click(screen.getByRole("tab", { name: "Favicon" }));

		fireEvent.click(screen.getByRole("button", { name: "Use GitHub avatar" }));

		await waitFor(() =>
			expect(container.services.repo.store.getState().reposById[repo.id]?.icon).toBeNull(),
		);
	});

	it("says Using GitHub avatar when no icon is saved", async () => {
		const { repo } = await renderAvatar({ remoteUrl: "git@github.com:octocat/alpha.git" });
		await openPicker(repo);
		fireEvent.click(screen.getByRole("tab", { name: "Favicon" }));

		expect(screen.getByRole("button", { name: "Using GitHub avatar" })).toBeTruthy();
	});

	it("clears back to the fallback from the Favicon tab", async () => {
		const { repo, container } = await renderAvatar({
			icon: "emoji:🚀",
			remoteUrl: "https://gitlab.example.com/me/conducted.git",
		});
		await openPicker(repo);

		fireEvent.click(screen.getByRole("tab", { name: "Favicon" }));
		fireEvent.click(screen.getByRole("button", { name: "Use favicon" }));

		await waitFor(() =>
			expect(container.services.repo.store.getState().reposById[repo.id]?.icon).toBeNull(),
		);
	});

	it("uploads an image chosen from the file picker", async () => {
		const { repo, container } = await renderAvatar();
		const source = "/tmp/picked-icon.png";
		test?.memory.controls.files.set(source, "png bytes");
		test?.memory.controls.queueDialogAnswers({ files: [source] });
		// jsdom has no canvas; the drawing runs in Chromium in scripts/catalogue/icon-resize.browser.ts.
		test?.memory.controls.scriptIconImage(() => ok(new TextEncoder().encode("icon png")));
		await openPicker(repo);

		fireEvent.click(screen.getByRole("tab", { name: "Upload" }));
		expect(
			screen.getByText(
				"Upload a PNG, JPEG, GIF, WebP, or SVG image. Conducted resizes it to icon size.",
			),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Upload image" }));

		await waitFor(() =>
			expect(
				container.services.repo.store.getState().reposById[repo.id]?.icon?.startsWith("file:"),
			).toBe(true),
		);
	});

	it("shows the upload failure inside the picker", async () => {
		const { repo } = await renderAvatar();
		test?.memory.controls.files.set("/tmp/icon.bmp", "bmp bytes");
		test?.memory.controls.queueDialogAnswers({ files: ["/tmp/icon.bmp"] });
		await openPicker(repo);

		fireEvent.click(screen.getByRole("tab", { name: "Upload" }));
		fireEvent.click(screen.getByRole("button", { name: "Upload image" }));

		expect(await screen.findByText("Choose a PNG, JPEG, GIF, WebP, or SVG image")).toBeTruthy();
	});

	it("shows a GitHub owner's avatar when no icon is saved", async () => {
		const { repo } = await renderAvatar({ remoteUrl: "https://github.com/jahala/conducted" });

		const avatar = screen.getByRole("img", { name: `${repo.name} icon` });
		expect(avatar.querySelector("img")?.getAttribute("src")).toBe(
			"https://github.com/jahala.png?size=64",
		);
	});
});
