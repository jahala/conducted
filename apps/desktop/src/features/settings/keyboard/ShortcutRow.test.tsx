import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutRow } from "./ShortcutRow.tsx";

afterEach(cleanup);

const command = {
	id: "test.command",
	title: "Test command",
	category: "General",
	shortcut: null,
	defaultShortcut: null,
	enabled: true,
};

describe("SET-02 ShortcutRow", () => {
	it("shows Not set and a Set action for an unbound command", () => {
		const onStartRecording = vi.fn();
		render(
			<ShortcutRow
				command={command}
				changedFromDefault={false}
				conflictWith={null}
				recording={false}
				onStartRecording={onStartRecording}
				onClear={() => undefined}
				onReset={() => undefined}
			/>,
		);

		expect(screen.getByText("Not set")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Set shortcut for Test command" }));
		expect(onStartRecording).toHaveBeenCalledTimes(1);
	});

	it("shows the current shortcut, a changed marker and a conflict", () => {
		render(
			<ShortcutRow
				command={{ ...command, shortcut: "⌘K", defaultShortcut: "⌘P" }}
				changedFromDefault
				conflictWith="Command palette"
				recording={false}
				onStartRecording={() => undefined}
				onClear={() => undefined}
				onReset={() => undefined}
			/>,
		);

		expect(screen.getByText("⌘K")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reset shortcut for Test command" })).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("Command palette");
	});
});
