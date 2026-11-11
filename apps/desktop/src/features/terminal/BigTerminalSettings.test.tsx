/**
 * @feature RUN-06 Big terminal mode
 * Owns: tests for the preset commands and the Big terminal settings block.
 * Test first: the Gemini preset gives "gemini -y".
 */
import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import type { SettingValue } from "../../core/registries/settings.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { Toaster } from "../../ui/Toast.tsx";
import { BigTerminalSettings } from "./BigTerminalSettings.tsx";
import {
	bigTerminalCommand,
	bigTerminalPresetCommand,
	customTerminalCommands,
} from "./big-terminal.ts";

const containers: TestContainer[] = [];

afterEach(() => {
	cleanup();
	for (const test of containers.splice(0)) test.close();
});

function renderWith(values: Record<string, SettingValue>) {
	const test = createTestContainer();
	containers.push(test);
	test.container.services.settings.store.setState((current) => ({
		...current,
		loaded: true,
		values: { ...current.values, ...values },
	}));
	const set = vi.spyOn(test.container.services.settings, "set").mockResolvedValue(ok(undefined));
	render(
		<ServicesProvider container={test.container}>
			<BigTerminalSettings />
		</ServicesProvider>,
	);
	return { test, set };
}

describe("RUN-06 big terminal presets", () => {
	it("gives each preset Conductor's command, with the approvals setting's flags", () => {
		expect(bigTerminalPresetCommand("gemini", false)).toBe("gemini -y");
		expect(bigTerminalPresetCommand("copilot", false)).toBe("copilot --allow-all");
		expect(bigTerminalPresetCommand("amp", true)).toBe("amp");
		expect(bigTerminalPresetCommand("claude", false)).toBe("claude --dangerously-skip-permissions");
		expect(bigTerminalPresetCommand("claude", true)).toBe("claude");
		expect(bigTerminalPresetCommand("none", false)).toBe("");
	});

	it("runs the chosen custom command and nothing for a removed one", () => {
		expect(bigTerminalCommand("custom:1", ["first", "second"], false)).toBe("second");
		expect(bigTerminalCommand("custom:4", ["first"], false)).toBeNull();
		expect(bigTerminalCommand("none", [], false)).toBeNull();
		expect(customTerminalCommands("a\n\n b \n")).toEqual(["a", "b"]);
	});

	it("shows Conductor's title, description and each preset's command", () => {
		renderWith({
			experimental_big_terminal_mode: true,
			big_terminal_preset: "gemini",
			tool_approvals_enabled: false,
		});

		expect(screen.getByText("Big terminal settings")).toBeTruthy();
		expect(screen.getByText("Configure the experimental center-pane terminal.")).toBeTruthy();
		expect(screen.getByText("New tab preset")).toBeTruthy();
		for (const label of ["Claude", "Codex", "OpenCode", "Amp", "Copilot", "Gemini", "None"]) {
			expect(screen.getByText(label)).toBeTruthy();
		}
		expect(screen.getByText("gemini -y")).toBeTruthy();
		expect(screen.getByText("copilot --allow-all")).toBeTruthy();
	});

	it("stores the chosen preset", async () => {
		const { set } = renderWith({
			experimental_big_terminal_mode: true,
			big_terminal_preset: "gemini",
			tool_approvals_enabled: false,
		});
		fireEvent.click(screen.getByText("Copilot"));
		await waitFor(() => expect(set).toHaveBeenCalledWith("big_terminal_preset", "copilot"));
	});

	it("offers an empty custom command with Conductor's placeholder", () => {
		renderWith({
			experimental_big_terminal_mode: true,
			big_terminal_preset: "none",
			big_terminal_custom_commands: "",
		});
		fireEvent.click(screen.getByRole("button", { name: "Add custom command" }));
		expect(screen.getByPlaceholderText("my-agent --flag")).toBeTruthy();
	});

	it("shows a custom row by its command alone, as Conductor's row does (renderApp @10680293)", () => {
		renderWith({
			experimental_big_terminal_mode: true,
			big_terminal_preset: "custom:0",
			big_terminal_custom_commands: "my-agent --fast",
		});
		expect(screen.getByText("my-agent --fast")).toBeTruthy();
		expect(screen.queryByText("Custom command")).toBeNull();
	});

	it("shows the error's own message when a preset cannot be saved", async () => {
		const { set } = renderWith({
			experimental_big_terminal_mode: true,
			big_terminal_preset: "gemini",
		});
		set.mockResolvedValue(err(appError("settings_write_failed", "The settings file is read-only.")));
		render(<Toaster />);
		fireEvent.click(screen.getByText("Codex"));
		expect(await screen.findByText("The settings file is read-only.")).toBeTruthy();
	});

	it("shows nothing while big terminal mode is off", () => {
		renderWith({ experimental_big_terminal_mode: false, big_terminal_preset: "gemini" });
		expect(screen.queryByText("Big terminal settings")).toBeNull();
	});
});
