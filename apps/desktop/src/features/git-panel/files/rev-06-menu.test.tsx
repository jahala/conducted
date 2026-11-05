import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileRowMenu, type FileRowMenuProps } from "./FileRowMenu.tsx";

afterEach(cleanup);

const menu = (over: Partial<FileRowMenuProps> = {}): FileRowMenuProps => ({
	path: "src/app.ts",
	isDirectory: false,
	changed: false,
	hasActiveChat: true,
	children: <div>src/app.ts</div>,
	onView: vi.fn(),
	onAttachInChat: vi.fn(),
	onCopyPath: vi.fn(),
	onDiscard: vi.fn(),
	...over,
});

async function open(props: FileRowMenuProps, trigger = "src/app.ts"): Promise<void> {
	render(<FileRowMenu {...props} />);
	fireEvent.contextMenu(screen.getByText(trigger));
	await screen.findByRole("menu");
}

describe("REV-06 file row menu", () => {
	it("has no Discard changes item for an unchanged file", async () => {
		await open(menu({ changed: false }));
		expect(screen.getByRole("menuitem", { name: "View" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "Copy relative path" })).toBeTruthy();
		expect(screen.queryByRole("menuitem", { name: "Discard changes" })).toBeNull();
	});

	it("asks to confirm before discarding a changed file", async () => {
		const onDiscard = vi.fn();
		await open(menu({ changed: true, onDiscard }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Discard changes" }));
		expect(await screen.findByText("Discard file changes?")).toBeTruthy();
		expect(onDiscard).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(onDiscard).toHaveBeenCalledTimes(1);
	});

	it("disables Attach in chat with a reason when no chat is open", async () => {
		await open(menu({ hasActiveChat: false }));
		const attach = screen.getByRole("menuitem", { name: "Attach in chat" });
		expect(attach.getAttribute("title")).toBe("Open a chat first.");
		expect(attach.getAttribute("data-disabled")).not.toBeNull();
	});

	it("leaves View and Discard out of a folder's menu", async () => {
		await open(
			menu({ isDirectory: true, changed: true, path: "src", children: <div>src</div> }),
			"src",
		);
		expect(screen.queryByRole("menuitem", { name: "View" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Discard changes" })).toBeNull();
		expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeTruthy();
	});

	it("offers only the copy items on an archived workspace", async () => {
		await open(menu({ archived: true, changed: true }));
		expect(screen.queryByRole("menuitem", { name: "View" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Attach in chat" })).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Discard changes" })).toBeNull();
		expect(screen.getByRole("menuitem", { name: "Copy path" })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: "Copy relative path" })).toBeTruthy();
	});
});
