import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { SettingsPageFrame } from "./SettingsPageFrame.tsx";

afterEach(cleanup);

describe("SET-02 SettingsPageFrame", () => {
	it("shows the error message and a Retry button that calls onRetry", () => {
		const onRetry = vi.fn();
		render(
			<SettingsPageFrame
				title="General"
				description={null}
				state="error"
				errorMessage="The settings file is invalid."
				onRetry={onRetry}
				focusSettingKey={null}
			>
				<p>Hidden content</p>
			</SettingsPageFrame>,
		);

		expect(screen.getByText("The settings file is invalid.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(screen.queryByText("Hidden content")).toBeNull();
	});

	it("shows skeleton rows while loading and the page once ready", () => {
		const { rerender } = render(
			<SettingsPageFrame
				title="General"
				description={null}
				state="loading"
				errorMessage={null}
				onRetry={() => undefined}
				focusSettingKey={null}
			>
				<p>Page content</p>
			</SettingsPageFrame>,
		);
		expect(screen.getByRole("status", { name: "Loading General" })).toBeTruthy();

		rerender(
			<SettingsPageFrame
				title="General"
				description="Everyday behaviour."
				state="ready"
				errorMessage={null}
				onRetry={() => undefined}
				focusSettingKey={null}
			>
				<p>Page content</p>
			</SettingsPageFrame>,
		);
		expect(screen.getByText("Page content")).toBeTruthy();
	});
});
