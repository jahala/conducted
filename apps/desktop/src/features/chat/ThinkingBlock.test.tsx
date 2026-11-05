import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinkingBlock } from "./ThinkingBlock.tsx";

afterEach(cleanup);

describe("CHAT-09 thinking block", () => {
	it("starts collapsed and shows the text after the header is clicked", () => {
		render(<ThinkingBlock text="I will read the file first." summarized={false} />);
		const trigger = screen.getByRole("button", { name: /Thinking/ });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("I will read the file first.")).toBeNull();

		fireEvent.click(trigger);

		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("I will read the file first.")).toBeTruthy();
	});

	it("labels a summary instead of full reasoning", () => {
		render(<ThinkingBlock text="A short summary." summarized />);
		expect(screen.getByText("Summary")).toBeTruthy();
	});

	it("renders nothing when the text is empty", () => {
		const { container } = render(<ThinkingBlock text="" summarized={false} />);
		expect(container.textContent).toBe("");
	});
});
