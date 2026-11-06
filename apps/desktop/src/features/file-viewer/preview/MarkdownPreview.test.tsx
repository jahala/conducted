/**
 * @feature REV-08 Markdown preview
 * Tests that raw HTML never becomes an element or a script, the common blocks render, relative
 * links and images resolve to workspace files, and remote images are never loaded.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview.tsx";

afterEach(cleanup);

const renderMarkdown = (text: string, onOpenLink = vi.fn()) =>
	render(
		<MarkdownPreview
			text={text}
			baseDir="docs"
			style="default"
			onOpenLink={onOpenLink}
			onOpenFile={vi.fn()}
			imageUrlFor={() => null}
		/>,
	);

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

	it("opens a relative link as a workspace file, resolved against the file's folder", () => {
		const onOpenFile = vi.fn();
		const onOpenLink = vi.fn();
		render(
			<MarkdownPreview
				text={"[setup](../README.md#install) and [guide](guide/start.md)"}
				baseDir="docs"
				style="default"
				onOpenLink={onOpenLink}
				onOpenFile={onOpenFile}
				imageUrlFor={() => null}
			/>,
		);
		fireEvent.click(screen.getByRole("link", { name: "setup" }));
		fireEvent.click(screen.getByRole("link", { name: "guide" }));
		expect(onOpenFile).toHaveBeenNthCalledWith(1, "README.md");
		expect(onOpenFile).toHaveBeenNthCalledWith(2, "docs/guide/start.md");
		expect(onOpenLink).not.toHaveBeenCalled();
	});

	it("loads a relative image from the workspace and never a //host image", () => {
		const { container } = render(
			<MarkdownPreview
				text={"![chart](img/chart.png) ![tracker](//evil.example/pixel.png)"}
				baseDir="docs"
				style="default"
				onOpenLink={() => {}}
				onOpenFile={() => {}}
				imageUrlFor={(path) => `asset://localhost/${path}`}
			/>,
		);
		const images = container.querySelectorAll("img");
		expect(images).toHaveLength(1);
		expect(images[0]?.getAttribute("src")).toBe("asset://localhost/docs/img/chart.png");
		expect(screen.getByRole("button", { name: "Image: tracker" })).toBeTruthy();
	});

	it("shows a link that climbs out of the workspace as plain text", () => {
		const onOpenFile = vi.fn();
		render(
			<MarkdownPreview
				text="[secret](../../etc/passwd)"
				baseDir="docs"
				style="default"
				onOpenLink={() => {}}
				onOpenFile={onOpenFile}
				imageUrlFor={() => null}
			/>,
		);
		expect(screen.queryByRole("link", { name: "secret" })).toBeNull();
		expect(screen.getByText("secret")).toBeTruthy();
	});
});
