import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./../../test/dom-polyfills.ts";
import { ScrollToBottomButton } from "./ScrollToBottomButton.tsx";

afterEach(cleanup);

describe("CHAT-06 scroll to bottom button", () => {
	it("is hidden when the list is at the bottom", () => {
		render(<ScrollToBottomButton visible={false} hasNew={false} onClick={vi.fn()} />);
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("shows the control and calls onClick", () => {
		const onClick = vi.fn();
		render(<ScrollToBottomButton visible hasNew={false} onClick={onClick} />);
		fireEvent.click(screen.getByRole("button", { name: "Scroll to bottom" }));
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it("marks new content that arrived while the user was away", () => {
		render(<ScrollToBottomButton visible hasNew onClick={vi.fn()} />);
		expect(screen.getByText("New")).toBeTruthy();
	});
});
