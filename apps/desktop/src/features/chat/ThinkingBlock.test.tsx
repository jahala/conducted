import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThinkingBlock } from "./ThinkingBlock.tsx";

afterEach(cleanup);

describe("CHAT-09 thinking block", () => {
	it("starts collapsed, with the reasoning's start on the row, and opens on click", () => {
		const { container } = render(
			<ThinkingBlock text="I will read the file first." summarized={false} />,
		);
		const trigger = screen.getByRole("button", { name: /Thinking/ });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		// Conductor's collapsed row shows the reasoning in a chip after the word "Thinking".
		expect(trigger.textContent).toContain("I will read the file first.");
		expect(container.querySelector('[data-region="thinking"]')).toBeNull();

		fireEvent.click(trigger);

		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(container.querySelector('[data-region="thinking"]')?.textContent).toBe(
			"I will read the file first.",
		);
	});

	it("labels a summary instead of full reasoning", () => {
		render(<ThinkingBlock text="A short summary." summarized />);
		expect(screen.getByText("Thinking (summary)")).toBeTruthy();
	});

	it("renders nothing when the text is empty", () => {
		const { container } = render(<ThinkingBlock text="" summarized={false} />);
		expect(container.textContent).toBe("");
	});
});
