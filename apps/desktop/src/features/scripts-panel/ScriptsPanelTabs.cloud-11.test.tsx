/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests the file-sync state the scripts panel shows for a cloud workspace, with the words
 * Conductor uses ("Sync files is off", "Sync folder unavailable", "Sync files failed") and the
 * local-terminal reason as its title.
 */
import type { TerminalId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
		render(
			<ScriptsPanelTabs
				{...base}
				fileSync={{
					state: "off",
					label: "Sync files is off",
					description: "Runs against a synced copy on your Mac.",
					mirrorPath: "/m",
					enabled: false,
				}}
			/>,
		);
		expect(screen.getByText("Sync files is off. Local files may be outdated.")).toBeTruthy();
	});

	it("shows Sync folder unavailable and names the local terminal on hover", () => {
		render(
			<ScriptsPanelTabs
				{...base}
				fileSync={{
					state: "unavailable",
					label: "Sync folder unavailable",
					description:
						"The local sync folder was removed. Sync files will recreate it when it resumes.",
					mirrorPath: "/m",
					localTerminalLabel: "Local terminal unavailable",
					localTerminalDescription: "Restart sync to recreate the local folder.",
					enabled: true,
				}}
			/>,
		);
		const pill = screen.getByText("Sync folder unavailable").closest("[data-file-sync-state]");
		expect(pill?.getAttribute("aria-label")).toBe("Local terminal unavailable");
		expect((pill as HTMLElement).title).toBe("Restart sync to recreate the local folder.");
		expect(screen.getByText("Sync folder unavailable").title).toBe(
			"The local sync folder was removed. Sync files will recreate it when it resumes.",
		);
	});

	it("shows Sync files failed with its message", () => {
		render(
			<ScriptsPanelTabs
				{...base}
				fileSync={{
					state: "failed",
					label: "Sync files failed",
					message: "sandbox asleep",
					description: "The local terminal cannot start until Sync files recovers.",
					mirrorPath: "/m",
					enabled: true,
				}}
			/>,
		);
		expect(
			screen
				.getByText("Sync files failed")
				.closest("[data-file-sync-state]")
				?.getAttribute("title"),
		).toBe("sandbox asleep");
	});

	it("shows no sync state on a Mac workspace", () => {
		render(<ScriptsPanelTabs {...base} fileSync={{ state: "local" }} />);
		expect(screen.queryByText("Sync files is off")).toBeNull();
	});

	it("offers a Cloud and a Local terminal in a cloud workspace", async () => {
		const onNewTerminal = vi.fn();
		render(
			<ScriptsPanelTabs
				{...base}
				cloudWorkspace
				onNewTerminal={onNewTerminal}
				fileSync={{
					state: "synced",
					label: "In sync",
					mirrorPath: "/m",
					lastSyncedAt: 1,
					files: 1,
					truncated: false,
					enabled: true,
				}}
			/>,
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "New terminal" }), { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Local terminal" }));

		expect(onNewTerminal).toHaveBeenCalledWith("local");
	});

	it("shows each terminal's own host beside its name", () => {
		render(
			<ScriptsPanelTabs
				{...base}
				cloudWorkspace
				terminals={[
					{ id: "t1" as TerminalId, title: "Terminal 1", ended: false, hostKind: "cloud" },
					{ id: "t2" as TerminalId, title: "Terminal 2", ended: false, hostKind: "local" },
				]}
				fileSync={{ state: "local" }}
			/>,
		);

		expect(
			screen.getByText("Terminal 1").parentElement?.querySelector('[data-host="cloud"]'),
		).toBeTruthy();
		expect(
			screen.getByText("Terminal 2").parentElement?.querySelector('[data-host="local"]'),
		).toBeTruthy();
	});
});
