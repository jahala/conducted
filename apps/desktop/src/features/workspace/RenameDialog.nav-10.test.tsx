/**
 * @feature NAV-10 Rename dialog
 * Owns: tests for the one small rename dialog.
 * Test first: Submitting 'Fix login' calls onSubmit('Fix login'); an empty field disables the submit
 * button.
 */
import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameDialog } from "./RenameDialog.tsx";

afterEach(cleanup);

describe("NAV-10 RenameDialog", () => {
	it("submits the typed name", async () => {
		const onSubmit = vi.fn(async () => ok(undefined));
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
				onSubmit={vi.fn(async () => ok(undefined))}
			/>,
		);
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "   " },
		});
		expect((screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("keeps the dialog open and shows the Result's failure", async () => {
		const onOpenChange = vi.fn();
		render(
			<RenameDialog
				open
				onOpenChange={onOpenChange}
				title="Rename workspace"
				initialName="Old name"
				onSubmit={async () => err(appError("db.conflict", "The name is taken."))}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Rename" }));
		expect(await screen.findByText("The name is taken.")).toBeTruthy();
		expect(onOpenChange).not.toHaveBeenCalledWith(false);
	});

	it("submits on Enter and closes on Escape", async () => {
		const onSubmit = vi.fn(async () => ok(undefined));
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
		fireEvent.keyDown(field, { key: "Enter" });
		await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Old name"));
		fireEvent.keyDown(field, { key: "Escape" });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("selects the current name on open so typing replaces it", () => {
		render(
			<RenameDialog
				open
				onOpenChange={vi.fn()}
				title="Rename workspace"
				initialName="Old name"
				onSubmit={vi.fn(async () => ok(undefined))}
			/>,
		);
		const field = screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement;
		fireEvent.focus(field);
		expect(field.selectionStart).toBe(0);
		expect(field.selectionEnd).toBe("Old name".length);
	});

	it("submits once when Cmd+Enter is pressed in the field", async () => {
		const onSubmit = vi.fn(async () => ok(undefined));
		render(
			<RenameDialog
				open
				onOpenChange={vi.fn()}
				title="Rename workspace"
				initialName="Old name"
				onSubmit={onSubmit}
			/>,
		);
		fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), {
			key: "Enter",
			metaKey: true,
		});
		await waitFor(() => expect(onSubmit).toHaveBeenCalled());
		expect(onSubmit).toHaveBeenCalledTimes(1);
	});

	it("keeps what the user typed when the starting name changes while open", () => {
		const props = {
			onOpenChange: vi.fn(),
			title: "Rename workspace",
			onSubmit: vi.fn(async () => ok(undefined)),
		};
		const view = render(<RenameDialog open initialName="Old name" {...props} />);
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Half typed" },
		});
		view.rerender(<RenameDialog open initialName="Renamed elsewhere" {...props} />);
		expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe(
			"Half typed",
		);
	});

	it("starts from the current name each time it opens", () => {
		const props = {
			onOpenChange: vi.fn(),
			title: "Rename workspace",
			onSubmit: vi.fn(async () => ok(undefined)),
		};
		const view = render(<RenameDialog open initialName="Old name" {...props} />);
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Half typed" },
		});
		view.rerender(<RenameDialog open={false} initialName="Newer name" {...props} />);
		view.rerender(<RenameDialog open initialName="Newer name" {...props} />);
		expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe(
			"Newer name",
		);
	});
});
