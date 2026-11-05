import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { type ActionDraft, AddActionDialog } from "./AddActionDialog.tsx";

afterEach(cleanup);

const emptyDraft: ActionDraft = {
	id: null,
	name: "",
	command: "",
	cwd: "",
	icon: null,
	isDefault: false,
};

function renderDialog(
	changes: {
		initial?: ActionDraft;
		existingIds?: string[];
		onSave?: (draft: ActionDraft) => Promise<boolean>;
	} = {},
) {
	const onSave = vi.fn((_draft: ActionDraft) => Promise.resolve(true));
	const onOpenChange = vi.fn();
	render(
		<AddActionDialog
			open
			initial={changes.initial ?? emptyDraft}
			existingIds={changes.existingIds ?? []}
			onOpenChange={onOpenChange}
			onSave={changes.onSave ?? onSave}
		/>,
	);
	return { onSave, onOpenChange };
}

describe("SET-07 AddActionDialog", () => {
	it("shows the clash for two names that normalise to the same id and disables Save", () => {
		renderDialog({ existingIds: ["dev-server"] });

		fireEvent.change(screen.getByLabelText("Action name"), {
			target: { value: "Dev server" },
		});

		expect(screen.getByText('An action called "Dev server" already exists.')).toBeTruthy();
		const save = screen.getByRole("button", { name: "Save action" }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
	});

	it("saves the normalised id and the trimmed text", async () => {
		const { onSave } = renderDialog();
		fireEvent.change(screen.getByLabelText("Action name"), { target: { value: "Test suite" } });
		fireEvent.change(screen.getByLabelText("Command"), { target: { value: "  pnpm test  " } });
		fireEvent.change(screen.getByLabelText("Working folder"), {
			target: { value: " packages/app " },
		});

		fireEvent.click(screen.getByRole("button", { name: "Save action" }));

		await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
		expect(onSave.mock.calls[0]?.[0]).toEqual({
			id: "Test-suite",
			name: "Test suite",
			command: "pnpm test",
			cwd: "packages/app",
			icon: null,
			isDefault: false,
		});
	});

	it("stays open and shows the failure when the save fails", async () => {
		const { onOpenChange } = renderDialog({
			onSave: vi.fn((_draft: ActionDraft) => Promise.resolve(false)),
		});
		fireEvent.change(screen.getByLabelText("Action name"), { target: { value: "Tests" } });
		fireEvent.change(screen.getByLabelText("Command"), { target: { value: "pnpm test" } });

		fireEvent.click(screen.getByRole("button", { name: "Save action" }));

		expect(await screen.findByText("The action could not be saved.")).toBeTruthy();
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it("keeps Save disabled until the name and command are filled", () => {
		renderDialog();
		const save = screen.getByRole("button", { name: "Save action" }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);

		fireEvent.change(screen.getByLabelText("Action name"), { target: { value: "Docs" } });
		expect(save.disabled).toBe(true);

		fireEvent.change(screen.getByLabelText("Command"), { target: { value: "pnpm docs" } });
		expect(save.disabled).toBe(false);
	});
});
