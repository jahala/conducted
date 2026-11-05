/**
 * @feature RUN-01 Run toolbar
 * Owns: tests for the action select, the Run or Stop button, and the Open button.
 * Test first: with a detected localhost URL the Open button is enabled and opens it.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunToolbar } from "./RunToolbar.tsx";

afterEach(cleanup);

const button = { label: "Run Dev server", disabled: false, click: "start" as const };

describe("RUN-01 run toolbar", () => {
	it("opens the first known localhost URL", () => {
		const onOpenUrl = vi.fn();
		render(
			<RunToolbar
				actions={[{ id: "dev", label: "Dev server" }]}
				selectedActionId="dev"
				onSelectAction={() => {}}
				button={button}
				onButtonClick={() => {}}
				urls={[{ label: "Local server", url: "http://localhost:3000" }]}
				onOpenUrl={onOpenUrl}
			/>,
		);

		const open = screen.getByRole("button", { name: "Open" }) as HTMLButtonElement;
		expect(open.disabled).toBe(false);
		fireEvent.click(open);
		expect(onOpenUrl).toHaveBeenCalledWith("http://localhost:3000");
	});

	it("disables Open with the reason before any URL is known", () => {
		render(
			<RunToolbar
				actions={[{ id: "dev", label: "Dev server" }]}
				selectedActionId="dev"
				onSelectAction={() => {}}
				button={{ label: "Starting...", disabled: true, click: null }}
				onButtonClick={() => {}}
				urls={[]}
				onOpenUrl={() => {}}
			/>,
		);

		const open = screen.getByRole("button", { name: "Open" }) as HTMLButtonElement;
		expect(open.disabled).toBe(true);
		expect(open.title).toBe("No preview URL yet");
		expect(screen.getByRole("button", { name: "Starting..." }).hasAttribute("disabled")).toBe(true);
	});

	it("hides the select when there is only one action and shows it for many", () => {
		const { rerender } = render(
			<RunToolbar
				actions={[{ id: "dev", label: "Dev server" }]}
				selectedActionId="dev"
				onSelectAction={() => {}}
				button={button}
				onButtonClick={() => {}}
				urls={[]}
				onOpenUrl={() => {}}
			/>,
		);
		expect(screen.queryByLabelText("Select task")).toBeNull();

		rerender(
			<RunToolbar
				actions={[
					{ id: "dev", label: "Dev server" },
					{ id: "test", label: "Tests" },
				]}
				selectedActionId="dev"
				onSelectAction={() => {}}
				button={button}
				onButtonClick={() => {}}
				urls={[]}
				onOpenUrl={() => {}}
			/>,
		);
		expect(screen.getByLabelText("Select task")).toBeTruthy();
	});

	it("calls onButtonClick with the Run model", () => {
		const onButtonClick = vi.fn();
		render(
			<RunToolbar
				actions={[{ id: "dev", label: "Dev server" }]}
				selectedActionId="dev"
				onSelectAction={() => {}}
				button={button}
				onButtonClick={onButtonClick}
				urls={[]}
				onOpenUrl={() => {}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Run Dev server" }));

		expect(onButtonClick).toHaveBeenCalledTimes(1);
	});
});
