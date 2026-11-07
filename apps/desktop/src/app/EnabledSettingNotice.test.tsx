/**
 * @feature NAV-17 Enabled-setting notice
 * Owns: tests for the notice shown after a deep link turned on an experimental setting.
 * Behaviour: coverage/inventory-controls.md (the toast "Enabled setting: <name>" with "Go to setting");
 * native-and-sidecar-map.md A8 (`settings-enable?key=`).
 * Test first: clicking "Go to setting" calls onGoToSetting once.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnabledSettingNotice } from "./EnabledSettingNotice.tsx";

afterEach(cleanup);

describe("NAV-17 EnabledSettingNotice", () => {
	it("names the setting and calls onGoToSetting once when its button is clicked", () => {
		const onGoToSetting = vi.fn();
		render(
			<EnabledSettingNotice
				settingKey="experimental_big_terminal_mode"
				settingTitle="Big terminal mode"
				onGoToSetting={onGoToSetting}
				onDismiss={() => {}}
			/>,
		);

		expect(screen.getByText("Enabled setting: Big terminal mode")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Go to setting" }));
		expect(onGoToSetting).toHaveBeenCalledTimes(1);
	});

	it("calls onDismiss from its dismiss button", () => {
		const onDismiss = vi.fn();
		render(
			<EnabledSettingNotice
				settingKey="experimental_big_terminal_mode"
				settingTitle="Big terminal mode"
				onGoToSetting={() => {}}
				onDismiss={onDismiss}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Dismiss enabled setting notice" }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("keeps a long title in a tooltip while the visible text is cut", () => {
		const title = "A very long setting title that cannot fit on one line in the notice";
		render(
			<EnabledSettingNotice
				settingKey="experimental_big_terminal_mode"
				settingTitle={title}
				onGoToSetting={() => {}}
				onDismiss={() => {}}
			/>,
		);

		const label = screen.getByText(`Enabled setting: ${title}`);
		expect(label.getAttribute("title")).toBe(`Enabled setting: ${title}`);
	});
});
