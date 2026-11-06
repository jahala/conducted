import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Callout } from "./Callout.tsx";

afterEach(cleanup);

describe("APP-10 Callout", () => {
	it("shows its title and text while it is not dismissed", () => {
		render(
			<Callout id="send-hint" dismissed={false} onDismiss={() => {}} title="Send">
				<p>Press Enter to send.</p>
			</Callout>,
		);

		expect(screen.getByText("Send")).toBeTruthy();
		expect(screen.getByText("Press Enter to send.")).toBeTruthy();
	});

	it("calls onDismiss with its id when Dismiss is clicked", () => {
		const onDismiss = vi.fn();
		render(
			<Callout id="send-hint" dismissed={false} onDismiss={onDismiss}>
				Press Enter to send.
			</Callout>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

		expect(onDismiss).toHaveBeenCalledWith("send-hint");
	});

	it("renders nothing once dismissed", () => {
		const { container } = render(
			<Callout id="send-hint" dismissed onDismiss={() => {}}>
				Press Enter to send.
			</Callout>,
		);

		expect(container.childElementCount).toBe(0);
	});

	it("dismisses when Escape is pressed inside it", () => {
		const onDismiss = vi.fn();
		render(
			<Callout id="send-hint" dismissed={false} onDismiss={onDismiss}>
				Press Enter to send.
			</Callout>,
		);

		fireEvent.keyDown(screen.getByRole("button", { name: "Dismiss" }), { key: "Escape" });

		expect(onDismiss).toHaveBeenCalledWith("send-hint");
	});

	it("keeps a control inside the hint reachable by keyboard", () => {
		render(
			<Callout id="send-hint" dismissed={false} onDismiss={() => {}}>
				<a href="#help">Open help</a>
			</Callout>,
		);

		expect(screen.getByRole("link", { name: "Open help" }).getAttribute("href")).toBe("#help");
	});
});
