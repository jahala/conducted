/**
 * @feature NAV-10 Rename dialog
 * Owns: tests for the one small rename dialog.
 * Test first: Submitting 'Fix login' calls onSubmit('Fix login'); an empty field disables the submit
 * button.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { RenameDialog } from "./RenameDialog.tsx";

afterEach(cleanup);

describe("NAV-10 RenameDialog", () => {
	it("submits the typed name", async () => {
		const onSubmit = vi.fn(async () => {});
		const onOpenChange = vi.fn();
		render(
			<RenameDialog
				open
				onOpenChange={onOpenChange}
				title="Rename workspace"
				initialName="Old name"
				onSubmit={onSubmit}
			/>,
		);
		const field = screen.getByRole("textbox", { name: "Name" });
		fireEvent.change(field, { target: { value: "Fix login" } });
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Fix login"));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("disables Rename while the name is empty", () => {
		render(
			<RenameDialog
				open
				onOpenChange={vi.fn()}
				title="Rename workspace"
				initialName="Old name"
				onSubmit={vi.fn(async () => {})}
			/>,
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "   " },
		});
		expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("keeps the dialog open and shows the failure", async () => {
		const onOpenChange = vi.fn();
		render(
			<RenameDialog
				open
				onOpenChange={onOpenChange}
				title="Rename workspace"
				initialName="Old name"
				onSubmit={async () => {
					throw new Error("The name is taken.");
				}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		expect(await screen.findByText("The name is taken.")).toBeTruthy();
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});
});
