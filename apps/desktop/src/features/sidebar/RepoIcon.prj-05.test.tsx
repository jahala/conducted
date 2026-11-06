/**
 * @feature PRJ-05 Repository icon
 * Owns: tests for the sidebar avatar and its Change repository icon dialog over the real container:
 * the context menu, the picker's sources, choosing an emoji, removing one, and uploading an image.
 * Test first: right-clicking the avatar offers Change repository icon, and choosing an emoji saves it.
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo } from "../../core/model.ts";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
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

	it("clears back to the fallback from the Favicon tab", async () => {
		const { repo, container } = await renderAvatar({ icon: "emoji:🚀" });
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
		test?.memory.controls.scriptShell((command) => {
			if (command.program !== "cp") return null;
			const from = command.args[1];
			const to = command.args[2];
			if (from === undefined || to === undefined) return null;
			const text = test?.memory.controls.files.get(from);
			if (text === undefined) return null;
			test?.memory.controls.files.set(to, text);
			return ok({ exitCode: 0, stdout: "", stderr: "" });
		});
		await openPicker(repo);

		fireEvent.click(screen.getByRole("tab", { name: "Upload" }));
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
