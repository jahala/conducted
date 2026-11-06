/**
 * @feature NAV-09 Keybinding editor
 * Owns: tests for the control that records a key combination for one command.
 * Behaviour: ui-map.md 5.4 (rebinding, reserved keys).
 * Test first: Pressing Cmd+Shift+K while recording calls onChange('Cmd+Shift+K'); Escape cancels.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { KeybindingEditor } from "./KeybindingEditor.tsx";

afterEach(cleanup);

describe("NAV-09 KeybindingEditor", () => {
	it("records Cmd+Shift+K while recording", () => {
		const onChange = vi.fn();
		render(
			<KeybindingEditor commandId="view.toggleLeftSidebar" current="Cmd+B" onChange={onChange} />,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Change shortcut for Show or hide the left sidebar" }),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Recording shortcut" }), {
			key: "k",
			metaKey: true,
			shiftKey: true,
		});

		expect(onChange).toHaveBeenCalledWith("Cmd+Shift+K");
	});

	it("cancels on Escape without changing anything", () => {
		const onChange = vi.fn();
		render(
			<KeybindingEditor commandId="view.toggleLeftSidebar" current="Cmd+B" onChange={onChange} />,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Change shortcut for Show or hide the left sidebar" }),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Recording shortcut" }), {
			key: "Escape",
		});

		expect(onChange).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "Recording shortcut" })).toBeNull();
	});

	it("refuses Cmd+Q and Cmd+, because the app reserves them", () => {
		const onChange = vi.fn();
		render(
			<KeybindingEditor commandId="view.toggleLeftSidebar" current="Cmd+B" onChange={onChange} />,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Change shortcut for Show or hide the left sidebar" }),
		);
		const recorder = screen.getByRole("button", { name: "Recording shortcut" });

		fireEvent.keyDown(recorder, { key: "q", metaKey: true });
		expect(screen.getByRole("alert").textContent).toContain("reserved for Quit the app");
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.keyDown(recorder, { key: ",", metaKey: true });
		expect(screen.getByRole("alert").textContent).toContain("reserved for Open settings");
		expect(onChange).not.toHaveBeenCalled();
	});

	it("waits for a key after a modifier alone", () => {
		const onChange = vi.fn();
		render(
			<KeybindingEditor commandId="view.toggleLeftSidebar" current="Cmd+B" onChange={onChange} />,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Change shortcut for Show or hide the left sidebar" }),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Recording shortcut" }), {
			key: "Shift",
			shiftKey: true,
		});

		expect(onChange).not.toHaveBeenCalled();
	});

	it("shows a fixed command without an edit control, in symbols and in words", () => {
		const onChange = vi.fn();
		render(<KeybindingEditor commandId="app.quit" current="Cmd+Q" onChange={onChange} />);

		expect(screen.queryByRole("button", { name: "Change shortcut for Quit the app" })).toBeNull();
		expect(screen.getByText("⌘Q")).toBeTruthy();
		expect(screen.getByText("Command Q")).toBeTruthy();
	});
});
