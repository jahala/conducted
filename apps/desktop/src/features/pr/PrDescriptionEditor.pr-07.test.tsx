/**
 * @feature PR-07 PR description editor
 * Owns: tests of the PR tab's description: the "No description" placeholder, Save, Discard,
 * Escape, Cmd+Enter saving once, a failed save, an edit kept while the description changes on
 * GitHub, and a read-only pull request.
 * Behaviour: ui-map.md 3.2, 3.6 and 7.2.
 * Test first: with an empty description the placeholder shows and clicking it enters edit mode.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { PrDescriptionEditor } from "./PrDescriptionEditor.tsx";

let opened: TestContainer | null = null;

afterEach(() => {
	cleanup();
	opened?.close();
	opened = null;
});

/** The rendered description uses the chat's Markdown renderer, which reads the app's services. */
function withServices() {
	opened = createTestContainer();
	const container = opened.container;
	return {
		wrapper: ({ children }: { children: ReactNode }) => (
			<ServicesProvider container={container}>{children}</ServicesProvider>
		),
	};
}

describe("PR-07 PrDescriptionEditor", () => {
	it("shows the No description placeholder and enters edit mode when clicked", () => {
		render(<PrDescriptionEditor body="" editable onSave={vi.fn().mockResolvedValue(true)} />);

		const placeholder = screen.getByRole("button", { name: "Edit PR description" });
		expect(placeholder.textContent).toBe("No description");

		fireEvent.click(placeholder);
		expect(screen.getByRole("textbox", { name: "PR description" })).toBeTruthy();
	});

	it("shows a read-only No description for a closed pull request", () => {
		render(<PrDescriptionEditor body="" editable={false} onSave={vi.fn()} />);

		expect(screen.getByText("No description")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Edit PR description" })).toBeNull();
	});

	const field = () => screen.getByRole("textbox", { name: "PR description" });

	it("saves the edited description and shows it", async () => {
		const onSave = vi.fn().mockResolvedValue(true);
		render(<PrDescriptionEditor body="First text" editable onSave={onSave} />, withServices());

		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.change(field(), { target: { value: "Second text" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
		// Let every effect of leaving edit mode run: the saved text must stay, not fall back to the
		// old description before the next poll brings the new one.
		await act(async () => {});
		expect(onSave).toHaveBeenCalledWith("Second text");
		expect(screen.getByText("Second text")).toBeTruthy();
		expect(screen.queryByText("First text")).toBeNull();
	});

	it("puts the description back on Discard and on Escape, saving nothing", () => {
		const onSave = vi.fn();
		render(<PrDescriptionEditor body="First text" editable onSave={onSave} />, withServices());

		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.change(field(), { target: { value: "Thrown away" } });
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(screen.getByText("First text")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		expect((field() as HTMLTextAreaElement).value).toBe("First text");
		fireEvent.change(field(), { target: { value: "Thrown away too" } });
		fireEvent.keyDown(field(), { key: "Escape" });
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.getByText("First text")).toBeTruthy();
		expect(onSave).not.toHaveBeenCalled();
	});

	it("saves once when Cmd+Enter is pressed twice while the save runs", async () => {
		let finish: (saved: boolean) => void = () => {};
		const onSave = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					finish = resolve;
				}),
		);
		render(<PrDescriptionEditor body="First text" editable onSave={onSave} />, withServices());

		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.change(field(), { target: { value: "Second text" } });
		fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
		fireEvent.keyDown(field(), { key: "Enter", metaKey: true });
		finish(true);

		await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
		expect(onSave).toHaveBeenCalledTimes(1);
	});

	it("keeps the edit open with an error when the save fails", async () => {
		const onSave = vi.fn().mockResolvedValue(false);
		render(<PrDescriptionEditor body="First text" editable onSave={onSave} />, withServices());

		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.change(field(), { target: { value: "Second text" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		expect(await screen.findByText("Couldn't save the description.")).toBeTruthy();
		expect((field() as HTMLTextAreaElement).value).toBe("Second text");
	});

	it("keeps the user's edit when the description changes on GitHub meanwhile", () => {
		const { rerender } = render(
			<PrDescriptionEditor body="First text" editable onSave={vi.fn()} />,
			withServices(),
		);
		fireEvent.click(screen.getByRole("button", { name: "Edit" }));
		fireEvent.change(field(), { target: { value: "My edit" } });

		rerender(<PrDescriptionEditor body="Changed on GitHub" editable onSave={vi.fn()} />);

		expect((field() as HTMLTextAreaElement).value).toBe("My edit");
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(screen.getByText("Changed on GitHub")).toBeTruthy();
	});
});
