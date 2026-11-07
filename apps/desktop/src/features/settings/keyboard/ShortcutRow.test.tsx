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
	it("shows no key caps and a Set action for an unbound command, as Conductor does", () => {
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
				fixed={false}
			/>,
		);

		expect(screen.queryByText("Not set")).toBeNull();
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
				fixed={false}
			/>,
		);

		expect(screen.getByText("⌘K")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reset shortcut for Test command" })).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain("Command palette");
	});

	it("shows a fixed shortcut with a lock and no way to change it", () => {
		render(
			<ShortcutRow
				command={{ ...command, title: "Quit", shortcut: "⌘Q", defaultShortcut: "⌘Q" }}
				changedFromDefault={false}
				conflictWith={null}
				recording={false}
				onStartRecording={() => undefined}
				onClear={() => undefined}
				onReset={() => undefined}
				fixed
			/>,
		);

		expect(screen.getByText("⌘Q")).toBeTruthy();
		expect(screen.getByText("Fixed shortcut")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /shortcut for Quit/ })).toBeNull();
	});
});
