import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type EnvTableRow, EnvVarTable } from "./EnvVarTable.tsx";

afterEach(cleanup);

const row = (changes: Partial<EnvTableRow> = {}): EnvTableRow => ({
	name: "TOKEN",
	hasValue: true,
	editable: true,
	canRename: true,
	...changes,
});

const props = (rows: EnvTableRow[]) => ({
	scopeLabel: "shared",
	rows,
	onReveal: vi.fn(async () => "secret"),
	onCopy: vi.fn(),
	onSave: vi.fn(async () => true),
	onDelete: vi.fn(async () => true),
});

describe("SET-04 EnvVarTable", () => {
	it("asks for the value once and shows it until Hide", async () => {
		const handlers = props([row()]);
		render(<EnvVarTable {...handlers} />);
		expect(screen.getByText("••••••••")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Reveal TOKEN" }));

		expect(await screen.findByText("secret")).toBeTruthy();
		expect(handlers.onReveal).toHaveBeenCalledTimes(1);
		expect(handlers.onReveal).toHaveBeenCalledWith("TOKEN");

		fireEvent.click(screen.getByRole("button", { name: "Hide TOKEN" }));

		await waitFor(() => expect(screen.queryByText("secret")).toBeNull());
		expect(screen.getByText("••••••••")).toBeTruthy();
	});

	// Conductor's empty state is a row inside the bordered table (renderApp Cnr).
	it("shows the designed empty state inside the bordered table", () => {
		render(<EnvVarTable {...props([])} />);

		const table = screen.getByRole("table");
		expect(table.parentElement?.className).toContain("rounded-md border");
		expect(within(table).getByText("No variables set")).toBeTruthy();
		expect(
			within(table).getByText("Add a variable to make it available in this environment."),
		).toBeTruthy();
	});

	it("dims an inherited row that this scope replaces", () => {
		render(<EnvVarTable {...props([row({ editable: false, dimmed: true })])} />);

		expect(screen.getByRole("row", { name: /TOKEN/ }).className).toContain("opacity-50");
		expect(screen.getByText("Locally overwritten")).toBeTruthy();
		// A row of another scope can be looked at, not changed or deleted here.
		expect(screen.getByRole("button", { name: "View TOKEN" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Delete TOKEN" })).toBeNull();
	});

	it("copies a value from its row", async () => {
		const handlers = props([row()]);
		render(<EnvVarTable {...handlers} />);

		fireEvent.click(screen.getByText("••••••••"));

		await waitFor(() => expect(handlers.onCopy).toHaveBeenCalledWith("TOKEN", "secret"));
	});

	it("asks before removing and removes only after confirmation", async () => {
		const handlers = props([row()]);
		render(<EnvVarTable {...handlers} />);

		fireEvent.click(screen.getByRole("button", { name: "Delete TOKEN" }));
		expect(handlers.onDelete).not.toHaveBeenCalled();

		fireEvent.click(await screen.findByRole("button", { name: "Remove variable" }));

		await waitFor(() => expect(handlers.onDelete).toHaveBeenCalledWith("TOKEN"));
	});

	it("reads the stored value into the side panel before it saves, so a hidden value is never saved as empty", async () => {
		const handlers = props([row()]);
		let answer: (value: string) => void = () => undefined;
		handlers.onReveal.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					answer = resolve;
				}),
		);
		render(<EnvVarTable {...handlers} />);

		fireEvent.click(screen.getByRole("button", { name: "Edit TOKEN" }));
		const panel = await screen.findByRole("dialog", { name: "Edit shared variable" });
		const save = within(panel).getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		fireEvent.click(save);
		expect(handlers.onSave).not.toHaveBeenCalled();

		answer("secret");
		await waitFor(() => expect(save.disabled).toBe(false));
		expect((within(panel).getByLabelText("Value") as HTMLTextAreaElement).value).toBe("secret");
		fireEvent.change(within(panel).getByLabelText("Value"), { target: { value: "rotated" } });
		fireEvent.click(save);

		await waitFor(() =>
			expect(handlers.onSave).toHaveBeenCalledWith({
				name: "TOKEN",
				value: "rotated",
				previousName: "TOKEN",
			}),
		);
	});

	it("renames a variable in the side panel, and refuses a name already set", async () => {
		const handlers = props([row(), row({ name: "OTHER" })]);
		render(<EnvVarTable {...handlers} />);

		fireEvent.click(screen.getByRole("button", { name: "Edit TOKEN" }));
		const panel = await screen.findByRole("dialog", { name: "Edit shared variable" });
		await waitFor(() =>
			expect((within(panel).getByLabelText("Value") as HTMLTextAreaElement).value).toBe("secret"),
		);
		const name = within(panel).getByLabelText("Name");
		fireEvent.change(name, { target: { value: "OTHER" } });
		fireEvent.click(within(panel).getByRole("button", { name: /^Save/ }));
		expect(within(panel).getByRole("alert").textContent).toBe("That variable already exists.");

		fireEvent.change(name, { target: { value: "API_TOKEN" } });
		fireEvent.click(within(panel).getByRole("button", { name: /^Save/ }));

		await waitFor(() =>
			expect(handlers.onSave).toHaveBeenCalledWith({
				name: "API_TOKEN",
				value: "secret",
				previousName: "TOKEN",
			}),
		);
	});
});
