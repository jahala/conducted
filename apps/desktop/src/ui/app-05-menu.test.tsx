import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuRadioGroup,
	ContextMenuRadioItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
} from "./ContextMenu.tsx";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
	menuContentClass,
	menuLabelClass,
	menuSeparatorClass,
	menuSubTriggerClass,
} from "./Menu.tsx";

afterEach(cleanup);

describe("APP-05 Menu scroll and digit keys", () => {
	it("does not close when its own content scrolls", async () => {
		const onOpenChange = vi.fn();
		render(
			<Menu onOpenChange={onOpenChange}>
				<MenuTrigger asChild>
					<button type="button">Actions</button>
				</MenuTrigger>
				<MenuContent>
					<MenuItem>Pin</MenuItem>
				</MenuContent>
			</Menu>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Actions" }), { key: "Enter" });
		const menu = await screen.findByRole("menu");
		onOpenChange.mockClear();
		fireEvent.scroll(menu);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(screen.queryByRole("menu")).not.toBeNull();
	});

	it("does not pick a parent item from a digit pressed in a submenu", async () => {
		const onFirst = vi.fn();
		const onNested = vi.fn();
		render(
			<Menu>
				<MenuTrigger asChild>
					<button type="button">Actions</button>
				</MenuTrigger>
				<MenuContent>
					<MenuItem onSelect={onFirst}>First</MenuItem>
					<MenuSub>
						<MenuSubTrigger>More</MenuSubTrigger>
						<MenuSubContent>
							<MenuItem onSelect={onNested}>Nested</MenuItem>
						</MenuSubContent>
					</MenuSub>
				</MenuContent>
			</Menu>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Actions" }), { key: "Enter" });
		const trigger = await screen.findByRole("menuitem", { name: "More" });
		fireEvent.keyDown(trigger, { key: "ArrowRight" });
		const nested = await screen.findByRole("menuitem", { name: "Nested" });
		fireEvent.keyDown(nested, { key: "1" });
		expect(onFirst).not.toHaveBeenCalled();
		expect(onNested).toHaveBeenCalledTimes(1);
	});
});

describe("APP-05 ContextMenu shared behaviour", () => {
	it("closes when the page scrolls", async () => {
		render(
			<ContextMenu items={<ContextMenuItem>View</ContextMenuItem>}>
				<div>Workspace row</div>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Workspace row"));
		expect(await screen.findByRole("menu")).toBeTruthy();
		fireEvent.scroll(document);
		await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
	});

	it("does not close when its own content scrolls", async () => {
		const onOpenChange = vi.fn();
		render(
			<ContextMenu onOpenChange={onOpenChange} items={<ContextMenuItem>View</ContextMenuItem>}>
				<div>Workspace row</div>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Workspace row"));
		const menu = await screen.findByRole("menu");
		onOpenChange.mockClear();
		fireEvent.scroll(menu);
		expect(onOpenChange).not.toHaveBeenCalled();
		expect(screen.queryByRole("menu")).not.toBeNull();
	});

	it("activates the item matching a digit", async () => {
		const onFirst = vi.fn();
		const onSecond = vi.fn();
		render(
			<ContextMenu
				items={
					<>
						<ContextMenuItem onSelect={onFirst}>First</ContextMenuItem>
						<ContextMenuItem onSelect={onSecond}>Second</ContextMenuItem>
					</>
				}
			>
				<div>Workspace row</div>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Workspace row"));
		const first = await screen.findByRole("menuitem", { name: "First" });
		fireEvent.keyDown(first, { key: "2" });
		expect(onSecond).toHaveBeenCalledTimes(1);
		expect(onFirst).not.toHaveBeenCalled();
	});

	it("opens from the context-menu key", async () => {
		render(
			<ContextMenu items={<ContextMenuItem>View</ContextMenuItem>}>
				<div>Workspace row</div>
			</ContextMenu>,
		);
		const row = screen.getByText("Workspace row");
		row.focus();
		fireEvent.keyDown(row, { key: "ContextMenu" });
		expect(await screen.findByRole("menuitem", { name: "View" })).toBeTruthy();
	});
});

describe("APP-05 ContextMenu item parts", () => {
	it("renders submenus, checkbox items and radio items", async () => {
		render(
			<ContextMenu
				items={
					<>
						<ContextMenuCheckboxItem checked>Wrap lines</ContextMenuCheckboxItem>
						<ContextMenuRadioGroup value="name">
							<ContextMenuRadioItem value="name">Name</ContextMenuRadioItem>
							<ContextMenuRadioItem value="date">Date</ContextMenuRadioItem>
						</ContextMenuRadioGroup>
						<ContextMenuSub>
							<ContextMenuSubTrigger>More</ContextMenuSubTrigger>
							<ContextMenuSubContent>
								<ContextMenuItem>Nested</ContextMenuItem>
							</ContextMenuSubContent>
						</ContextMenuSub>
					</>
				}
			>
				<div>Workspace row</div>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Workspace row"));
		const checkbox = await screen.findByRole("menuitemcheckbox", { name: "Wrap lines" });
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
		const radio = screen.getByRole("menuitemradio", { name: "Name" });
		expect(radio.getAttribute("aria-checked")).toBe("true");
		fireEvent.keyDown(screen.getByRole("menuitem", { name: "More" }), { key: "ArrowRight" });
		expect(await screen.findByRole("menuitem", { name: "Nested" })).toBeTruthy();
	});

	it("draws the same indicator and shortcut parts as the dropdown item", async () => {
		const icon = <span data-testid="item-icon" />;
		render(
			<ContextMenu
				items={
					<>
						<ContextMenuItem icon={icon} shortcut="⌘V">
							Paste
						</ContextMenuItem>
						<ContextMenuCheckboxItem checked>Wrap lines</ContextMenuCheckboxItem>
						<ContextMenuRadioGroup value="name">
							<ContextMenuRadioItem value="name">Name</ContextMenuRadioItem>
						</ContextMenuRadioGroup>
					</>
				}
			>
				<div>Workspace row</div>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Workspace row"));
		const paste = await screen.findByRole("menuitem", { name: /Paste/ });
		expect(paste.textContent).toContain("⌘V");
		expect(paste.querySelector("[data-testid='item-icon']")).not.toBeNull();
		const checkbox = screen.getByRole("menuitemcheckbox", { name: "Wrap lines" });
		expect(checkbox.querySelector("svg")).not.toBeNull();
		const radio = screen.getByRole("menuitemradio", { name: "Name" });
		expect(radio.querySelector("svg")).not.toBeNull();
	});

	it("shares the content, label, separator and sub-trigger classes", async () => {
		render(
			<ContextMenu
				items={
					<>
						<ContextMenuLabel>Section</ContextMenuLabel>
						<ContextMenuSeparator />
						<ContextMenuSub>
							<ContextMenuSubTrigger>More</ContextMenuSubTrigger>
							<ContextMenuSubContent>
								<ContextMenuItem>Nested</ContextMenuItem>
							</ContextMenuSubContent>
						</ContextMenuSub>
					</>
				}
			>
				<div>Workspace row</div>
			</ContextMenu>,
		);
		fireEvent.contextMenu(screen.getByText("Workspace row"));
		const menu = await screen.findByRole("menu");
		expect(menu.className).toContain(menuContentClass);
		expect(screen.getByText("Section").className).toContain(menuLabelClass);
		const separator = document.querySelector('[role="separator"]');
		expect(separator?.getAttribute("class")).toContain(menuSeparatorClass);
		const subTrigger = screen.getByRole("menuitem", { name: "More" });
		expect(subTrigger.className).toContain(menuSubTriggerClass);
	});
});

describe("APP-05 Menu item classes are shared with the dropdown", () => {
	it("uses the same label, separator and sub-trigger classes", async () => {
		render(
			<Menu>
				<MenuTrigger asChild>
					<button type="button">Actions</button>
				</MenuTrigger>
				<MenuContent>
					<MenuLabel>Section</MenuLabel>
					<MenuSeparator />
					<MenuSub>
						<MenuSubTrigger>More</MenuSubTrigger>
						<MenuSubContent>
							<MenuItem>Nested</MenuItem>
						</MenuSubContent>
					</MenuSub>
				</MenuContent>
			</Menu>,
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Actions" }), { key: "Enter" });
		expect((await screen.findByText("Section")).className).toContain(menuLabelClass);
		const separator = document.querySelector('[role="separator"]');
		expect(separator?.getAttribute("class")).toContain(menuSeparatorClass);
		expect(screen.getByRole("menuitem", { name: "More" }).className).toContain(menuSubTriggerClass);
	});
});
