import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { GeneralPage } from "./pages/GeneralPage.tsx";
import { ResetCalloutDismissals } from "./ResetCalloutDismissals.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("APP-10 Reset callout dismissals", () => {
	it("resets two dismissed hints once and then says there are none", async () => {
		const onReset = vi.fn().mockResolvedValue(true);
		render(
			<ResetCalloutDismissals dismissedIds={["send-hint", "terminal-hint"]} onReset={onReset} />,
		);

		expect(screen.getByText("2 dismissed hints")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Reset callout dismissals" }));

		expect(await screen.findByText("No dismissed hints")).toBeTruthy();
		expect(onReset).toHaveBeenCalledTimes(1);
		expect(
			(screen.getByRole("button", { name: "Reset callout dismissals" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("disables the button when nothing is dismissed", () => {
		render(<ResetCalloutDismissals dismissedIds={[]} onReset={vi.fn()} />);

		expect(screen.getByText("No dismissed hints")).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Reset callout dismissals" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("ignores a second click while the reset is running", async () => {
		let finish: (value: boolean) => void = () => {};
		const pending = new Promise<boolean>((resolve) => {
			finish = resolve;
		});
		const onReset = vi.fn().mockReturnValue(pending);
		render(<ResetCalloutDismissals dismissedIds={["send-hint"]} onReset={onReset} />);
		const button = screen.getByRole("button", { name: "Reset callout dismissals" });

		fireEvent.click(button);
		fireEvent.click(button);

		expect(onReset).toHaveBeenCalledTimes(1);
		finish(true);
		await waitFor(() => expect(screen.getByText("No dismissed hints")).toBeTruthy());
	});

	it("keeps the list and shows an error when the reset fails", async () => {
		const onReset = vi.fn().mockResolvedValue(false);
		render(
			<ResetCalloutDismissals dismissedIds={["send-hint", "terminal-hint"]} onReset={onReset} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Reset callout dismissals" }));

		expect(await screen.findByRole("alert")).toBeTruthy();
		expect(screen.getByText("2 dismissed hints")).toBeTruthy();
	});
});

describe("APP-10 callout dismissals on the General page", () => {
	it("remembers a dismissed hint and brings it back with Reset callout dismissals", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<GeneralPage />
			</ServicesProvider>,
		);

		expect(await screen.findByText(/Hints explain a control once/)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

		await waitFor(() =>
			expect(test?.container.services.settings.get("dismissed_callouts")).toEqual([
				"callout-dismissals-hint",
			]),
		);
		await waitFor(() => expect(screen.queryByText(/Hints explain a control once/)).toBeNull());
		expect(await screen.findByText("1 dismissed hint")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Reset callout dismissals" }));

		await waitFor(() =>
			expect(test?.container.services.settings.get("dismissed_callouts")).toEqual([]),
		);
		expect(await screen.findByText(/Hints explain a control once/)).toBeTruthy();
		expect(screen.getByText("No dismissed hints")).toBeTruthy();
	});
});
