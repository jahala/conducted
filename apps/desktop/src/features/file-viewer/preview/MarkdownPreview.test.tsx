/**
 * @feature REV-08 Markdown preview
 * Tests that raw HTML never becomes an element or a script, and the common blocks render.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview.tsx";

afterEach(cleanup);

const renderMarkdown = (text: string, onOpenLink = vi.fn()) =>
	render(<MarkdownPreview text={text} baseDir="docs" style="default" onOpenLink={onOpenLink} />);

describe("REV-08 MarkdownPreview", () => {
	it("shows a script tag as text and never runs it", () => {
		const { container } = renderMarkdown(
			"# Title\n\n<script>window.__markdownRan = true;</script>",
		);
		expect(container.querySelector("script")).toBeNull();
		expect((window as unknown as { __markdownRan?: boolean }).__markdownRan).toBeUndefined();
		expect(container.textContent).toContain("Title");
		expect(container.textContent).toContain("<script>");
	});

	it("renders headings, fenced code, lists and tables", () => {
		const text = [
			"# Heading",
			"",
			"```ts",
			"const a = 1;",
			"```",
			"",
			"- one",
			"- two",
			"",
			"| a | b |",
			"| --- | --- |",
			"| 1 | 2 |",
		].join("\n");
		renderMarkdown(text);
		expect(screen.getByRole("heading", { name: "Heading" })).toBeTruthy();
		expect(screen.getByText("const a = 1;")).toBeTruthy();
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(screen.getByRole("table")).toBeTruthy();
	});

	it("sends a link click to the handler instead of navigating", () => {
		const onOpenLink = vi.fn();
		renderMarkdown("[docs](https://example.com/docs)", onOpenLink);
		fireEvent.click(screen.getByRole("link", { name: "docs" }));
		expect(onOpenLink).toHaveBeenCalledWith("https://example.com/docs");
	});
});
