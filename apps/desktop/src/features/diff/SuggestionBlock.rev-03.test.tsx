/**
 * @feature REV-03 Suggestion block
 * Tests the small line diff inside a suggested change.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../../test/dom-polyfills.ts";
import { SuggestionBlock } from "./SuggestionBlock.tsx";

afterEach(cleanup);

describe("REV-03 SuggestionBlock", () => {
	it("renders one removed line and one added line for a changed line", () => {
		const { container } = render(
			<SuggestionBlock original="a" suggestion="b" filePath="src/a.ts" />,
		);

		expect(container.querySelectorAll('[data-kind="removed"]')).toHaveLength(1);
		expect(container.querySelectorAll('[data-kind="added"]')).toHaveLength(1);
		expect(screen.getByText("a")).toBeTruthy();
		expect(screen.getByText("b")).toBeTruthy();
	});

	it("says there is no change when the suggestion matches the original", () => {
		render(<SuggestionBlock original="same" suggestion="same" filePath="src/a.ts" />);

		expect(screen.getByText("No change to src/a.ts.")).toBeTruthy();
	});

	it("renders only removed lines when the suggestion deletes them", () => {
		const { container } = render(
			<SuggestionBlock original={"one\ntwo"} suggestion="" filePath="src/a.ts" />,
		);

		expect(container.querySelectorAll('[data-kind="removed"]')).toHaveLength(2);
		expect(container.querySelectorAll('[data-kind="added"]')).toHaveLength(0);
	});
});
