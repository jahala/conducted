/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests the file-sync state the scripts panel shows for a cloud workspace, with the words
 * Conductor uses ("Sync files is off", "Sync folder unavailable", "Sync files failed") and the
 * local-terminal reason as its title.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptsPanelTabs } from "./ScriptsPanelTabs.tsx";

const base = {
	active: { kind: "setup" as const },
	terminals: [],
	setupStatus: "idle" as const,
	runActive: false,
	showPorts: false,
	terminalLimit: 5,
	collapsed: false,
	onSelect: vi.fn(),
	onNewTerminal: vi.fn(),
	onCloseTerminal: vi.fn(),
	onToggleCollapsed: vi.fn(),
};

afterEach(() => {
	cleanup();
});

describe("CLOUD-11 the scripts panel file-sync state", () => {
	it("shows Sync files is off", () => {
		render(<ScriptsPanelTabs {...base} fileSync={{ state: "off", label: "Sync files is off" }} />);
		expect(screen.getByText("Sync files is off")).toBeTruthy();
	});

	it("shows Sync folder unavailable and names the local terminal on hover", () => {
		render(
			<ScriptsPanelTabs
				{...base}
				fileSync={{
					state: "unavailable",
					label: "Sync folder unavailable",
					localTerminalLabel: "Local terminal unavailable",
				}}
			/>,
		);
		expect(screen.getByText("Sync folder unavailable").title).toBe("Local terminal unavailable");
	});

	it("shows Sync files failed with its message", () => {
		render(
			<ScriptsPanelTabs
				{...base}
				fileSync={{ state: "failed", label: "Sync files failed", message: "sandbox asleep" }}
			/>,
		);
		expect(screen.getByText("Sync files failed").title).toBe("sandbox asleep");
	});

	it("shows no sync state on a Mac workspace", () => {
		render(<ScriptsPanelTabs {...base} fileSync={{ state: "local" }} />);
		expect(screen.queryByText("Sync files is off")).toBeNull();
	});
});
