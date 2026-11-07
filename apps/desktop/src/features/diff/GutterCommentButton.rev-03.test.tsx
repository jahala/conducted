/**
 * @feature REV-03 Gutter comment button
 * Tests the button that starts a comment on the hovered diff line.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GutterCommentButton } from "./GutterCommentButton.tsx";

afterEach(cleanup);

describe("REV-03 GutterCommentButton", () => {
	it("calls onAdd with the hovered side and line", () => {
		const onAdd = vi.fn();
		render(
			<GutterCommentButton
				getHoveredLine={() => ({ lineNumber: 5, side: "additions" })}
				onAdd={onAdd}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add a comment for the AI" }));

		expect(onAdd).toHaveBeenCalledWith({ lineNumber: 5, side: "additions" });
	});

	it("renders nothing when no line is hovered", () => {
		const { container } = render(
			<GutterCommentButton getHoveredLine={() => undefined} onAdd={vi.fn()} />,
		);

		expect(container.firstChild).toBeNull();
	});
});
