import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button.tsx";
import { Sheet, SheetContent } from "./Sheet.tsx";

afterEach(cleanup);

function renderSheet(onSave: () => void, onOpenChange: (open: boolean) => void) {
	render(
		<Sheet open onOpenChange={onOpenChange}>
			<SheetContent
				title="Add environment variable"
				description="Paste a block of KEY=VALUE lines into the name field to add several at once."
				footer={
					<Button data-primary-action onClick={onSave}>
						Save
					</Button>
				}
			>
				<input aria-label="Name" />
			</SheetContent>
		</Sheet>,
	);
}

describe("APP-05 Sheet", () => {
	it("presses the primary button on Cmd+Enter in a field, and asks to close on Escape", () => {
		const onSave = vi.fn();
		const onOpenChange = vi.fn();
		renderSheet(onSave, onOpenChange);

		const dialog = screen.getByRole("dialog", { name: "Add environment variable" });
		expect(dialog.className).toContain("w-[520px]");
		fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", metaKey: true });
		expect(onSave).toHaveBeenCalledTimes(1);

		fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("names its close cross for screen readers", () => {
		const onOpenChange = vi.fn();
		renderSheet(vi.fn(), onOpenChange);

		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
