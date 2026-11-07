/**
 * @feature RUN-01 Scripts panel tab strip
 * Owns: tests for the tab buttons, the terminal limit reason, middle-click closing and collapse.
 * Test first: at the terminal limit the new-terminal button is disabled and says why.
 */
import type { TerminalId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptsPanelTabs } from "./ScriptsPanelTabs.tsx";

afterEach(cleanup);

const props = {
	active: { kind: "setup" as const },
	terminals: [
		{ id: "t1" as TerminalId, title: "Terminal 1", ended: false },
		{ id: "t2" as TerminalId, title: "Terminal 2", ended: false },
	],
	setupStatus: "idle" as const,
	runActive: false,
	showPorts: false,
	terminalLimit: 2,
	collapsed: false,
	onSelect: () => {},
	onNewTerminal: () => {},
	onCloseTerminal: () => {},
	onToggleCollapsed: () => {},
};

describe("RUN-01 scripts panel tab strip", () => {
	it("disables New terminal at the limit and says the reason", () => {
		render(<ScriptsPanelTabs {...props} />);

		const button = screen.getByRole("button", { name: "New terminal" }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.title).toBe("Maximum 2 terminals allowed");
	});

	it("selects a fixed tab and a terminal tab", () => {
		const onSelect = vi.fn();
		render(<ScriptsPanelTabs {...props} onSelect={onSelect} />);

		fireEvent.click(screen.getByRole("tab", { name: "Run" }));
		fireEvent.click(screen.getByRole("tab", { name: "Terminal 2" }));

		expect(onSelect).toHaveBeenNthCalledWith(1, { kind: "run" });
		expect(onSelect).toHaveBeenNthCalledWith(2, { kind: "terminal", terminalId: "t2" });
	});

	it("closes a terminal with a middle click", () => {
		const onCloseTerminal = vi.fn();
		render(<ScriptsPanelTabs {...props} onCloseTerminal={onCloseTerminal} />);

		fireEvent(
			screen.getByRole("tab", { name: "Terminal 1" }),
			new MouseEvent("auxclick", { bubbles: true, button: 1 }),
		);

		expect(onCloseTerminal).toHaveBeenCalledWith("t1");
	});

	it("shows the Ports tab only when a port was detected", () => {
		const { rerender } = render(<ScriptsPanelTabs {...props} />);
		expect(screen.queryByRole("tab", { name: "Ports" })).toBeNull();

		rerender(<ScriptsPanelTabs {...props} showPorts />);
		expect(screen.getByRole("tab", { name: "Ports" })).toBeTruthy();
	});

	it("shows each terminal's host icon in a cloud workspace", () => {
		const { container, rerender } = render(
			<ScriptsPanelTabs
				{...props}
				terminals={[{ id: "t1" as TerminalId, title: "Terminal 1", ended: false }]}
			/>,
		);
		expect(container.querySelector('[data-host="cloud"]')).toBeNull();

		rerender(
			<ScriptsPanelTabs
				{...props}
				terminals={[
					{ id: "t1" as TerminalId, title: "Terminal 1", ended: false, hostKind: "cloud" },
					{ id: "t2" as TerminalId, title: "Terminal 2", ended: false, hostKind: "local" },
				]}
			/>,
		);
		expect(container.querySelectorAll('[data-host="cloud"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-host="local"]')).toHaveLength(1);
	});

	it("toggles the panel from the collapse control", () => {
		const onToggleCollapsed = vi.fn();
		const { rerender } = render(
			<ScriptsPanelTabs {...props} onToggleCollapsed={onToggleCollapsed} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Collapse panel" }));
		expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

		rerender(<ScriptsPanelTabs {...props} collapsed onToggleCollapsed={onToggleCollapsed} />);
		expect(screen.getByRole("button", { name: "Expand panel" })).toBeTruthy();
	});
});
