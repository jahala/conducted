/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Tests an image in an assistant reply: its Save image and Copy image menu, and the viewer a
 * click opens. A target relative to the workspace is copied and viewed from the workspace.
 * Test first: choosing Save image on a reply image shows "Image saved".
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { AssistantText } from "./AssistantText.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	test?.close();
	test = undefined;
});

async function renderReply(text: string): Promise<TestContainer> {
	const opened = createTestContainer();
	test = opened;
	await opened.container.services.settings.start();
	render(
		<ServicesProvider container={opened.container}>
			<AssistantText text={text} />
			<Toaster />
		</ServicesProvider>,
	);
	return opened;
}

describe("CHAT-29 assistant image", () => {
	it("saves a reply image from its menu and says Image saved", async () => {
		const opened = await renderReply("![A chart](/tmp/chart.png)");
		vi.spyOn(opened.container.platform.dialogs, "pickSavePath").mockResolvedValue(
			"/tmp/chart-copy.png",
		);
		vi.spyOn(opened.container.platform.shell, "run").mockResolvedValue(
			ok({ exitCode: 0, stdout: "", stderr: "" }),
		);

		fireEvent.contextMenu(await screen.findByRole("img", { name: "A chart" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Save image" }));

		expect(await screen.findByText("Image saved")).toBeTruthy();
	});

	it("opens a reply image in the attachment viewer", async () => {
		await renderReply("![A chart](/tmp/chart.png)");

		fireEvent.click(await screen.findByRole("button", { name: "Open A chart" }));

		expect(await screen.findByRole("heading", { name: "A chart" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Copy image" })).toBeTruthy();
	});

	it("copies and views a relative reply image from the chat's workspace", async () => {
		const opened = createTestContainer();
		test = opened;
		await opened.container.services.settings.start();
		const workspace = await seedWorkspace(opened.container, { path: "/code/workspaces/reply" });
		const run = vi
			.spyOn(opened.container.platform.shell, "run")
			.mockResolvedValue(ok({ exitCode: 0, stdout: "iVBORw0KGgo=", stderr: "" }));
		render(
			<ServicesProvider container={opened.container}>
				<AssistantText text="![Shot](./shots/../shots/shot.png)" workspaceId={workspace.id} />
				<Toaster />
			</ServicesProvider>,
		);

		fireEvent.contextMenu(await screen.findByRole("img", { name: "Shot" }));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Copy image" }));
		expect(await screen.findByText("Copied image to clipboard")).toBeTruthy();
		expect(run.mock.calls[0]?.[0].args.at(-1)).toBe("/code/workspaces/reply/shots/shot.png");

		fireEvent.click(screen.getByRole("button", { name: "Open Shot" }));
		const viewer = await screen.findByRole("dialog");
		expect(viewer.querySelector("img")?.getAttribute("src")).toBe(
			opened.container.platform.fs.assetUrl("/code/workspaces/reply/shots/shot.png"),
		);
	});
});
