import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, type FunctionComponent, type SVGProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test/dom-polyfills.ts";
import { Dialog, DialogContent, type DialogSize } from "./Dialog.tsx";
import * as icons from "./icons.tsx";
import { Spinner } from "./Spinner.tsx";

afterEach(cleanup);

describe("APP-05 Spinner kinds draw different shapes", () => {
	it("renders working as one plain track and one turning arc", () => {
		const { container } = render(<Spinner label="Loading workspaces" kind="working" />);
		const svg = container.querySelector("svg");
		expect(svg?.getAttribute("class")).toContain("animate-spin");
		expect(svg?.querySelectorAll("path")).toHaveLength(1);
		expect(svg?.querySelector("circle")?.getAttribute("stroke-dasharray")).toBeNull();
	});

	it("renders waiting as a dashed track that turns slowly", () => {
		const { container } = render(<Spinner label="Waiting for you" kind="waiting" />);
		const svg = container.querySelector("svg");
		expect(svg?.getAttribute("class")).toContain("animate-spin");
		expect(svg?.getAttribute("class")).toContain("[animation-duration:2s]");
		expect(svg?.querySelector("circle")?.getAttribute("stroke-dasharray")).toBe("2 3");
		expect(svg?.querySelectorAll("path")).toHaveLength(1);
	});

	it("renders setting-up as two arcs", () => {
		const { container } = render(<Spinner label="Setting up" kind="setting-up" />);
		const svg = container.querySelector("svg");
		expect(svg?.getAttribute("class")).toContain("[animation-duration:1.4s]");
		expect(svg?.querySelectorAll("path")).toHaveLength(2);
	});

	it("renders typing as three pulsing dots and no ring", () => {
		const { container } = render(<Spinner label="Agent is typing" kind="typing" />);
		expect(container.querySelector("svg")).toBeNull();
		const dots = container.querySelectorAll("span.animate-pulse");
		expect(dots).toHaveLength(3);
		// styles.css cuts every animation to one 0.01ms run under prefers-reduced-motion,
		// so this pulse stops and the dots sit still.
		expect([...dots].every((dot) => dot.classList.contains("rounded-full"))).toBe(true);
	});
});

const namedIcons = Object.entries(icons).filter(
	([name, value]) => /Icon$/.test(name) && typeof value === "function",
) as [string, FunctionComponent<SVGProps<SVGSVGElement>>][];

const gitIcons = Object.entries(icons.gitIcons) as [
	string,
	FunctionComponent<SVGProps<SVGSVGElement>>,
][];

function pathOf(Icon: FunctionComponent<SVGProps<SVGSVGElement>>): string {
	const { container } = render(createElement(Icon));
	return container.querySelector("path")?.getAttribute("d") ?? "";
}

describe("APP-05 icons", () => {
	it("draws every icon with its own path", () => {
		const seen = new Map<string, string>();
		for (const [name, Icon] of namedIcons) {
			const d = pathOf(Icon);
			expect(d, `${name} has no path`).not.toBe("");
			expect(seen.get(d), `${name} reuses the path of ${seen.get(d)}`).toBeUndefined();
			seen.set(d, name);
		}
	});

	it("opens every git icon with a different shape", () => {
		const seen = new Map<string, string>();
		for (const [name, Icon] of gitIcons) {
			const opening = pathOf(Icon).slice(0, 10);
			expect(seen.get(opening), `${name} opens like ${seen.get(opening)}`).toBeUndefined();
			seen.set(opening, name);
		}
	});
});

const dialogSizes: [DialogSize, string][] = [
	["sm", "max-w-sm"],
	["md", "max-w-md"],
	["lg", "max-w-lg"],
	["xl", "max-w-xl"],
	["2xl", "max-w-2xl"],
	["3xl", "max-w-3xl"],
	["4xl", "max-w-4xl"],
];

describe("APP-05 Dialog dimensions", () => {
	it.each(dialogSizes)("keeps the ui-dimensions 4 width for the %s dialog", async (size, width) => {
		render(
			<Dialog open>
				<DialogContent title="Sized" size={size}>
					<p>Body</p>
				</DialogContent>
			</Dialog>,
		);
		const dialog = await screen.findByRole("dialog", { name: "Sized" });
		expect(dialog.className).toContain(width);
		expect(dialog.className).toContain("rounded-md");
		expect(dialog.className).toContain("p-6");
		expect(dialog.className).toContain("gap-4");
	});
});

describe("APP-05 Dialog Cmd+Enter", () => {
	it("confirms while focus is in a textarea", async () => {
		const onConfirm = vi.fn();
		render(
			<Dialog open>
				<DialogContent title="Rename chat" onConfirm={onConfirm}>
					<textarea aria-label="Chat name" defaultValue="Old name" />
				</DialogContent>
			</Dialog>,
		);
		const field = await screen.findByRole("textbox", { name: "Chat name" });
		field.focus();
		fireEvent.keyDown(field, { key: "Enter", metaKey: true });
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("leaves plain Enter in a textarea alone", async () => {
		const onConfirm = vi.fn();
		render(
			<Dialog open>
				<DialogContent title="Rename chat" onConfirm={onConfirm}>
					<textarea aria-label="Chat name" defaultValue="Old name" />
				</DialogContent>
			</Dialog>,
		);
		const field = await screen.findByRole("textbox", { name: "Chat name" });
		fireEvent.keyDown(field, { key: "Enter" });
		expect(onConfirm).not.toHaveBeenCalled();
	});
});
