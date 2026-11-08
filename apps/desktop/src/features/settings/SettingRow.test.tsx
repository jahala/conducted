import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Input } from "../../ui/Input.tsx";
import { SettingRow } from "./SettingRow.tsx";

afterEach(cleanup);

describe("SET-02 SettingRow", () => {
	it("disables the control and shows the reason when a setting is locked", () => {
		render(
			<SettingRow
				settingKey="demo"
				title="Demo setting"
				description="A described setting."
				disabledReason="Locked by the project settings file."
				highlighted={false}
				saveError={null}
			>
				<Input aria-label="Demo control" />
			</SettingRow>,
		);

		const control = screen.getByLabelText("Demo control") as HTMLInputElement;
		expect(control.disabled).toBe(true);
		expect(screen.getByText("Locked by the project settings file.")).toBeTruthy();
		// Conductor's rows carry no "User" or "Repository" marker (D098).
		expect(screen.queryByText("Repository")).toBeNull();
		expect(screen.queryByText("User")).toBeNull();
	});

	it("puts a stacked control 12 px under the text, as Conductor's rows do", () => {
		render(
			<SettingRow
				settingKey="demo"
				title="Demo setting"
				description="A described setting."
				disabledReason={null}
				highlighted={false}
				saveError={null}
				stacked
			>
				<Input aria-label="Demo control" />
			</SettingRow>,
		);

		const layout = document.querySelector("[data-stacked='true']");
		const gaps = layout?.className.split(" ").filter((name) => name.startsWith("gap-"));
		// cn joins classes without merging them, so a second gap class would win by CSS order.
		expect(gaps).toEqual(["gap-3"]);
	});

	it("shows a save error and a reset action", () => {
		render(
			<SettingRow
				settingKey="demo"
				title="Demo setting"
				description={null}
				disabledReason={null}
				highlighted
				saveError="The settings file is read-only."
				onReset={() => undefined}
			>
				<Input aria-label="Demo control" />
			</SettingRow>,
		);

		expect(screen.getByRole("alert").textContent).toContain("The settings file is read-only.");
		expect(screen.getByRole("button", { name: "Setting actions" })).toBeTruthy();
		expect(
			document.querySelector('[data-setting-key="demo"]')?.getAttribute("data-highlighted"),
		).toBe("true");
	});
});

describe("SET-02 SettingRow actions menu", () => {
	it("puts Reset behind Conductor's 'Setting actions' menu", async () => {
		const { fireEvent } = await import("@testing-library/react");
		const onReset = vi.fn();
		render(
			<SettingRow
				settingKey="demo"
				title="Demo setting"
				description={null}
				disabledReason={null}
				highlighted={false}
				saveError={null}
				onReset={onReset}
			>
				<Input aria-label="Demo control" />
			</SettingRow>,
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "Setting actions" }), { key: "Enter" });
		const item = await screen.findByRole("menuitem", { name: "Reset" });
		fireEvent.click(item);
		expect(onReset).toHaveBeenCalledTimes(1);
	});
});
