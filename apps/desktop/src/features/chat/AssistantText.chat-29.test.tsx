/**
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Tests an image in an assistant reply: its Save image and Copy image menu, and the viewer a
 * click opens.
 * Test first: choosing Save image on a reply image shows "Image saved".
 */
import { ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
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
});
