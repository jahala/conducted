import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../test/dom-polyfills.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { SendButton, type SendButtonProps } from "./SendButton.tsx";

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	test.close();
});

/** `keybindings` is the saved `keybinding_overrides_v1` text. */
const wrapperWith = (keybindings = "") => {
	test.container.services.settings.store.setState({
		loaded: true,
		values: { keybinding_overrides_v1: keybindings },
		dropped: [],
		warnings: [],
	});
	return ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
};

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
		render(<SendButton {...props()} />, { wrapper: wrapperWith() });
		expect(screen.getByRole("button", { name: "Send message" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
	});

	it("reads 'Queue message' while the agent works and shows the Stop button", () => {
		render(<SendButton {...props({ state: "queue", working: true })} />, {
			wrapper: wrapperWith(),
		});
		expect(screen.getByRole("button", { name: "Queue message" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
	});

	it("reads 'Save edit' while a queued message is edited", () => {
		render(<SendButton {...props({ state: "save" })} />, { wrapper: wrapperWith() });
		expect(screen.getByRole("button", { name: "Save edit" })).toBeTruthy();
	});

	it("is disabled when there is nothing to send", () => {
		render(<SendButton {...props({ disabled: true })} />, { wrapper: wrapperWith() });
		expect(
			(screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement).disabled,
		).toBe(true);
	});

	it("shows the send shortcut for the send mode", async () => {
		const { unmount } = render(<SendButton {...props({ sendWith: "enter" })} />, {
			wrapper: wrapperWith(),
		});
		fireEvent.focus(screen.getByRole("button", { name: "Send message" }));
		expect(await screen.findByText("↵")).toBeTruthy();
		unmount();

		render(<SendButton {...props({ sendWith: "mod_enter" })} />, { wrapper: wrapperWith() });
		fireEvent.focus(screen.getByRole("button", { name: "Send message" }));
		expect(await screen.findByText("⌘↵")).toBeTruthy();
	});

	it("shows the cancel shortcut from the command registry", async () => {
		render(<SendButton {...props({ working: true })} />, { wrapper: wrapperWith() });
		fireEvent.focus(screen.getByRole("button", { name: "Cancel" }));
		expect(await screen.findByText("⌘⇧⌫")).toBeTruthy();
	});

	it("shows the rebound cancel shortcut, not the shipped one", async () => {
		const wrapper = wrapperWith(JSON.stringify({ "chat.cancelAgent": ["Cmd+Alt+K"] }));
		render(<SendButton {...props({ working: true })} />, { wrapper });
		fireEvent.focus(screen.getByRole("button", { name: "Cancel" }));
		expect(await screen.findByText("⌥⌘K")).toBeTruthy();
		expect(screen.queryByText("⌘⇧⌫")).toBeNull();
	});

	it("sends and stops through the callbacks", () => {
		const onSend = vi.fn();
		const onStop = vi.fn();
		render(<SendButton {...props({ working: true, onSend, onStop })} />, {
			wrapper: wrapperWith(),
		});
		fireEvent.click(screen.getByRole("button", { name: "Send message" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onStop).toHaveBeenCalledTimes(1);
	});
});
