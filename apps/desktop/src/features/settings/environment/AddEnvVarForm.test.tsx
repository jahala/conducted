import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddEnvVarForm, type EnvDraft } from "./AddEnvVarForm.tsx";

afterEach(cleanup);

function renderPanel(
	onAdd: (entries: readonly EnvDraft[]) => Promise<boolean>,
	existingNames: readonly string[] = [],
) {
	const onOpenChange = vi.fn();
	render(
		<AddEnvVarForm open onOpenChange={onOpenChange} existingNames={existingNames} onAdd={onAdd} />,
	);
	return { onOpenChange };
}

/** Pastes `text` into the Name field as the clipboard would. */
const pasteIntoName = (text: string) =>
	fireEvent.paste(screen.getByLabelText("Name"), {
		clipboardData: { getData: () => text },
	});

describe("SET-04 AddEnvVarForm", () => {
	it("splits a pasted NAME=value line into the two fields", () => {
		renderPanel(async () => true);

		pasteIntoName("TOKEN=abc");

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("TOKEN");
		expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("abc");
	});

	it("adds an empty value and closes the panel", async () => {
		const onAdd = vi.fn(async () => true);
		const { onOpenChange } = renderPanel(onAdd);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "EMPTY" } });
		fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

		await waitFor(() => expect(onAdd).toHaveBeenCalledWith([{ name: "EMPTY", value: "" }]));
		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
	});

	it("refuses an invalid name in Conductor's words", () => {
		const onAdd = vi.fn(async () => true);
		renderPanel(onAdd);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "2BAD" } });
		fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

		expect(screen.getByRole("alert").textContent).toBe(
			"Invalid variable name 2BAD. Names must start with a letter or underscore and contain only letters, numbers, and underscores.",
		);
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("refuses a name the app sets itself", () => {
		const onAdd = vi.fn(async () => true);
		renderPanel(onAdd);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CONDUCTED_PORT" } });
		fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

		expect(screen.getByRole("alert").textContent).toContain("The app sets CONDUCTED_PORT itself");
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("keeps the text when the save fails", async () => {
		const onAdd = vi.fn(async () => false);
		const { onOpenChange } = renderPanel(onAdd);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "TOKEN" } });
		fireEvent.change(screen.getByLabelText("Value"), { target: { value: "abc" } });
		fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

		await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
		expect(onOpenChange).not.toHaveBeenCalled();
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("TOKEN");
		expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("abc");
	});

	// Conductor's paste of a block (renderApp ODa): the panel lists what it found and saves them all.
	it("lists a pasted block of lines and adds every variable with Cmd+Enter", async () => {
		const onAdd = vi.fn(async () => true);
		renderPanel(onAdd);

		pasteIntoName("FIRST=one\nSECOND=two\n");

		expect(screen.getByRole("dialog", { name: "Add environment variables" })).toBeTruthy();
		expect(screen.getByText("Detected 2 variables from your pasted text.")).toBeTruthy();
		expect(screen.getByRole("list", { name: "Variables" }).textContent).toContain("SECOND");
		fireEvent.keyDown(screen.getByRole("button", { name: "Clear" }), {
			key: "Enter",
			metaKey: true,
		});

		await waitFor(() =>
			expect(onAdd).toHaveBeenCalledWith([
				{ name: "FIRST", value: "one" },
				{ name: "SECOND", value: "two" },
			]),
		);
	});

	it("names the pasted variables that are already set and saves none", () => {
		const onAdd = vi.fn(async () => true);
		renderPanel(onAdd, ["FIRST", "SECOND"]);

		pasteIntoName("FIRST=one\nSECOND=two\nTHIRD=three");
		fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

		expect(screen.getByRole("alert").textContent).toBe(
			"These variables already exist: FIRST, SECOND. Remove them from your pasted text and try again.",
		);
		expect(onAdd).not.toHaveBeenCalled();
	});
});
