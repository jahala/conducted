import type { WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type FunctionComponent, type SVGProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test/dom-polyfills.ts";
import { Button, type ButtonVariant, buttonVariantClass } from "./Button.tsx";
import { ContextMenu, ContextMenuItem } from "./ContextMenu.tsx";
import { Dialog, DialogContent } from "./Dialog.tsx";
import * as icons from "./icons.tsx";
import {
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "./Menu.tsx";
import { Popover } from "./Popover.tsx";
import { Spinner, type SpinnerKind } from "./Spinner.tsx";
import { Toaster, toast, workspaceToast } from "./Toast.tsx";

afterEach(() => {
	cleanup();
	toast.dismiss();
});

describe("APP-05 Button variants", () => {
	const variants: ButtonVariant[] = [
		"default",
		"destructive",
		"outline",
		"outlineDestructive",
		"secondary",
		"ghost",
		"link",
	];

	it("gives every variant its own class", () => {
		const classes = new Set(variants.map((variant) => buttonVariantClass[variant]));
		expect(classes.size).toBe(variants.length);
	});

	it.each(variants)("renders the %s variant", (variant) => {
		render(<Button variant={variant}>{variant}</Button>);
		const button = screen.getByRole("button", { name: variant });
		expect(button.getAttribute("data-variant")).toBe(variant);
		expect(button.className).toContain(buttonVariantClass[variant]);
	});
});

describe("APP-05 Menu checkbox and radio items", () => {
	it("reports a checkbox item change", async () => {
		const onCheckedChange = vi.fn();
		render(
			<Menu>
				<MenuTrigger asChild>
					<button type="button">Options</button>
				</MenuTrigger>
				<MenuContent>
					<MenuCheckboxItem checked={false} onCheckedChange={onCheckedChange}>
						Wrap lines
					</MenuCheckboxItem>
				</MenuContent>
			</Menu>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Options" }), { key: "Enter" });
		const item = await screen.findByRole("menuitemcheckbox", { name: "Wrap lines" });
		fireEvent.click(item);
		expect(onCheckedChange).toHaveBeenCalledWith(true);
	});

	it("reports a radio item change", async () => {
		const onValueChange = vi.fn();
		render(
			<Menu>
				<MenuTrigger asChild>
					<button type="button">Sort</button>
				</MenuTrigger>
				<MenuContent>
					<MenuRadioGroup value="name" onValueChange={onValueChange}>
						<MenuRadioItem value="name">Name</MenuRadioItem>
						<MenuRadioItem value="date">Date</MenuRadioItem>
					</MenuRadioGroup>
				</MenuContent>
			</Menu>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Sort" }), { key: "Enter" });
		const item = await screen.findByRole("menuitemradio", { name: "Date" });
		fireEvent.click(item);
		expect(onValueChange).toHaveBeenCalledWith("date");
	});
});

describe("APP-05 Menu keyboard and scroll", () => {
	it("activates the item matching a digit", async () => {
		const onFirst = vi.fn();
		const onSecond = vi.fn();
		render(
			<Menu>
				<MenuTrigger asChild>
					<button type="button">Actions</button>
				</MenuTrigger>
				<MenuContent>
					<MenuItem onSelect={onFirst}>First</MenuItem>
					<MenuItem onSelect={onSecond}>Second</MenuItem>
				</MenuContent>
			</Menu>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Actions" }), { key: "Enter" });
		const first = await screen.findByRole("menuitem", { name: "First" });
		fireEvent.keyDown(first, { key: "2" });
		expect(onSecond).toHaveBeenCalledTimes(1);
		expect(onFirst).not.toHaveBeenCalled();
	});

	it("opens a submenu with the keyboard", async () => {
		render(
			<Menu>
				<MenuTrigger asChild>
					<button type="button">Open in</button>
				</MenuTrigger>
				<MenuContent>
					<MenuSub>
						<MenuSubTrigger>Editors</MenuSubTrigger>
						<MenuSubContent>
							<MenuItem>Code</MenuItem>
						</MenuSubContent>
					</MenuSub>
				</MenuContent>
			</Menu>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Open in" }), { key: "Enter" });
		const trigger = await screen.findByRole("menuitem", { name: "Editors" });
		fireEvent.keyDown(trigger, { key: "ArrowRight" });
		expect(await screen.findByRole("menuitem", { name: "Code" })).toBeTruthy();
	});

	it("closes when the page scrolls", async () => {
		render(
			<Menu>
				<MenuTrigger asChild>
					<button type="button">Actions</button>
				</MenuTrigger>
				<MenuContent>
					<MenuItem>Pin</MenuItem>
				</MenuContent>
			</Menu>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Actions" }), { key: "Enter" });
		expect(await screen.findByRole("menu")).toBeTruthy();
		fireEvent.scroll(document);
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	});
});

describe("APP-05 Popover and hover card", () => {
	it("shows its content on click and returns focus on Escape", async () => {
		render(
			<Popover trigger={<button type="button">Model</button>}>
				<p>Model list</p>
			</Popover>,
		);
		const trigger = screen.getByRole("button", { name: "Model" });
		fireEvent.click(trigger);
		const content = await screen.findByText("Model list");
		expect(content).toBeTruthy();
		fireEvent.keyDown(content, { key: "Escape" });
		await waitFor(() => expect(screen.queryByText("Model list")).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(trigger));
	});

	it("opens the hover card on keyboard focus", async () => {
		render(
			<Popover hover trigger={<button type="button">Context</button>}>
				<p>Context usage</p>
			</Popover>,
		);
		fireEvent.focus(screen.getByRole("button", { name: "Context" }));
		expect(await screen.findByText("Context usage")).toBeTruthy();
	});
});

describe("APP-05 ContextMenu", () => {
	it("opens from a right click and selects an item", async () => {
		const onSelect = vi.fn();
		render(
			<ContextMenu
				items={
					<>
						<ContextMenuItem onSelect={onSelect}>View</ContextMenuItem>
						<ContextMenuItem destructive>Delete</ContextMenuItem>
					</>
				}
			>
				<div>Workspace row</div>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Workspace row"));
		const view = await screen.findByRole("menuitem", { name: "View" });
		expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
		fireEvent.click(view);
		expect(onSelect).toHaveBeenCalledTimes(1);
	});
});

describe("APP-05 Dialog shortcut", () => {
	it("confirms on Cmd+Enter", async () => {
		const onConfirm = vi.fn();
		render(
			<Dialog open>
				<DialogContent title="Rename chat" onConfirm={onConfirm}>
					<p>Body</p>
				</DialogContent>
			</Dialog>,
		);
		const dialog = await screen.findByRole("dialog", { name: "Rename chat" });
		fireEvent.keyDown(dialog, { key: "Enter", metaKey: true });
		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it("does not confirm on a plain Enter", async () => {
		const onConfirm = vi.fn();
		render(
			<Dialog open>
				<DialogContent title="Rename chat" onConfirm={onConfirm}>
					<p>Body</p>
				</DialogContent>
			</Dialog>,
		);
		const dialog = await screen.findByRole("dialog", { name: "Rename chat" });
		fireEvent.keyDown(dialog, { key: "Enter" });
		expect(onConfirm).not.toHaveBeenCalled();
	});
});

describe("APP-05 Toast", () => {
	it("shows an error toast", async () => {
		render(<Toaster />);
		act(() => {
			toast.error("Couldn't save the file");
		});
		expect(await screen.findByText("Couldn't save the file")).toBeTruthy();
	});

	it("shows success and warning variants", async () => {
		render(<Toaster />);
		act(() => {
			toast.success("Saved");
			toast.warning("Port is reserved");
		});
		expect(await screen.findByText("Saved")).toBeTruthy();
		expect(screen.getByText("Port is reserved")).toBeTruthy();
	});

	it("hides a workspace toast while another workspace is open", async () => {
		const workspace = "w1" as WorkspaceId;
		const other = "w2" as WorkspaceId;
		const { rerender } = render(<Toaster workspaceId={workspace} />);
		act(() => {
			workspaceToast(other, "Wrong workspace");
		});
		expect(screen.queryByText("Wrong workspace")).toBeNull();
		act(() => {
			workspaceToast(workspace, "Right workspace");
		});
		expect(await screen.findByText("Right workspace")).toBeTruthy();
		rerender(<Toaster workspaceId={other} />);
		await waitFor(() => expect(screen.queryByText("Right workspace")).toBeNull());
	});
});

describe("APP-05 Spinner kinds", () => {
	const kinds: SpinnerKind[] = ["working", "typing", "waiting", "setting-up"];

	it.each(kinds)("renders the %s kind as a status", (kind) => {
		render(<Spinner label={`Loading ${kind}`} kind={kind} />);
		const status = screen.getByRole("status", { name: `Loading ${kind}` });
		expect(status.getAttribute("data-kind")).toBe(kind);
	});
});

describe("APP-05 icons", () => {
	const namedIcons = Object.entries(icons).filter(
		([name, value]) => /Icon$/.test(name) && typeof value === "function",
	) as [string, FunctionComponent<SVGProps<SVGSVGElement>>][];

	it("has the status, git and tool families", () => {
		expect(Object.keys(icons.statusIcons)).toContain("review");
		expect(Object.keys(icons.gitIcons)).toContain("pullRequest");
		expect(Object.keys(icons.toolIcons)).toContain("terminal");
	});

	it.each(namedIcons)("%s renders a hidden svg", (_name, Icon) => {
		const { container } = render(createElement(Icon));
		const svg = container.querySelector("svg");
		expect(svg).not.toBeNull();
		expect(svg?.getAttribute("aria-hidden")).toBe("true");
	});
});
