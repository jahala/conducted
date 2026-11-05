import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { SendButton, type SendButtonProps } from "./SendButton.tsx";

afterEach(cleanup);

const props = (over: Partial<SendButtonProps> = {}): SendButtonProps => ({
	state: "send",
	disabled: false,
	busy: false,
	working: false,
	onSend: vi.fn(),
	onStop: vi.fn(),
	...over,
});

describe("COMP-01 SendButton", () => {
	it("reads 'Send message' when the agent is idle", () => {
		render(<SendButton {...props()} />);
		expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
	});

	it("reads 'Queue message' while the agent works and shows the Stop button", () => {
		render(<SendButton {...props({ state: "queue", working: true })} />);
		expect(screen.getByRole("button", { name: "Queue message" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
	});

	it("reads 'Save edit' while a queued message is edited", () => {
		render(<SendButton {...props({ state: "save" })} />);
		expect(screen.getByRole("button", { name: "Save edit" })).toBeTruthy();
	});

	it("is disabled when there is nothing to send", () => {
		render(<SendButton {...props({ disabled: true })} />);
		expect(
			(screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("sends and stops through the callbacks", () => {
		const onSend = vi.fn();
		const onStop = vi.fn();
		render(<SendButton {...props({ working: true, onSend, onStop })} />);
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onStop).toHaveBeenCalledTimes(1);
	});
});
