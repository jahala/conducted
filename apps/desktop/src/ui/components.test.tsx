import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Badge } from "./Badge.tsx";
import { Button, type ButtonVariant } from "./Button.tsx";
import { cn } from "./cn.ts";
import { Dialog, DialogContent } from "./Dialog.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { IconButton } from "./IconButton.tsx";
import { Kbd } from "./Kbd.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./Menu.tsx";
import { PanelHeader, SectionHeader } from "./PanelHeader.tsx";
import { Spinner } from "./Spinner.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs.tsx";
import { Tooltip } from "./Tooltip.tsx";

afterEach(cleanup);

describe("cn", () => {
	it("joins parts and drops falsy ones", () => {
		expect(cn("a", false, null, undefined, "b")).toBe("a b");
		expect(cn()).toBe("");
	});
});

describe("Button", () => {
	const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];

	it.each(variants)("renders the %s variant", (variant) => {
		render(<Button variant={variant}>Go</Button>);
		const button = screen.getByRole("button", { name: "Go" });
		expect(button.getAttribute("data-variant")).toBe(variant);
	});

	it("gives the primary variant the primary fill and no other variant", () => {
		render(
			<>
				<Button variant="primary">A</Button>
				<Button variant="secondary">B</Button>
			</>,
		);
		expect(screen.getByRole("button", { name: "A" }).className).toContain("bg-primary-fill");
		expect(screen.getByRole("button", { name: "B" }).className).not.toContain("bg-primary-fill");
	});

	it("does not submit a form unless asked", () => {
		render(<Button>Plain</Button>);
		expect(screen.getByRole("button", { name: "Plain" }).getAttribute("type")).toBe("button");
	});

	it("is disabled while loading and shows a spinner", () => {
		const onClick = vi.fn();
		render(
			<Button loading onClick={onClick}>
				Save
			</Button>,
		);
		const button = screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(screen.getByRole("status", { name: "Working" })).toBeTruthy();
		fireEvent.click(button);
		expect(onClick).not.toHaveBeenCalled();
	});
});

describe("IconButton", () => {
	it("exposes its label as the accessible name", () => {
		render(<IconButton label="Go back" icon={<span />} />);
		expect(screen.getByRole("button", { name: "Go back" })).toBeTruthy();
	});

	it("reports the pressed state", () => {
		render(<IconButton label="Toggle" icon={<span />} pressed />);
		expect(screen.getByRole("button", { name: "Toggle" }).getAttribute("aria-pressed")).toBe(
			"true",
		);
	});
});

describe("Spinner", () => {
	it("is a status region with its label", () => {
		render(<Spinner label="Loading workspaces" />);
		expect(screen.getByRole("status", { name: "Loading workspaces" })).toBeTruthy();
	});
});

describe("Kbd", () => {
	it("renders its text in a kbd element", () => {
		render(<Kbd>⌘K</Kbd>);
		expect(screen.getByText("⌘K").tagName).toBe("KBD");
	});
});

describe("EmptyState", () => {
	it("renders title, body and action", () => {
		render(
			<EmptyState
				title="Nothing here"
				body="Add something."
				action={<button type="button">Add</button>}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Nothing here" })).toBeTruthy();
		expect(screen.getByText("Add something.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();
	});

	it("leaves out the body when there is none", () => {
		const { container } = render(<EmptyState title="Only a title" />);
		expect(container.querySelector("p")).toBeNull();
	});
});

describe("PanelHeader", () => {
	it("renders the title and actions and can be a drag region", () => {
		const { container } = render(
			<PanelHeader title="Changes" actions={<button type="button">Review</button>} dragRegion />,
		);
		expect(screen.getByRole("heading", { name: "Changes" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Review" })).toBeTruthy();
		expect(container.querySelector("[data-tauri-drag-region]")).not.toBeNull();
	});

	it("is not a drag region by default", () => {
		const { container } = render(<PanelHeader title="Plain" />);
		expect(container.querySelector("[data-tauri-drag-region]")).toBeNull();
	});
});

describe("SectionHeader", () => {
	it("shows the count next to the label", () => {
		render(<SectionHeader label="Pinned" count={3} />);
		expect(screen.getByText("Pinned").textContent).toContain("3");
	});
});

describe("Badge", () => {
	it("renders its text with a tone", () => {
		render(<Badge tone="danger">Failed</Badge>);
		expect(screen.getByText("Failed").className).toContain("text-danger");
	});
});

describe("Tabs", () => {
	it("shows the content of the selected tab only", () => {
		render(
			<Tabs defaultValue="one">
				<TabsList>
					<TabsTrigger value="one">One</TabsTrigger>
					<TabsTrigger value="two">Two</TabsTrigger>
				</TabsList>
				<TabsContent value="one">First panel</TabsContent>
				<TabsContent value="two">Second panel</TabsContent>
			</Tabs>,
		);
		expect(screen.getByText("First panel")).toBeTruthy();
		expect(screen.queryByText("Second panel")).toBeNull();
		fireEvent.mouseDown(screen.getByRole("tab", { name: "Two" }), { button: 0 });
		expect(screen.getByText("Second panel")).toBeTruthy();
		expect(screen.queryByText("First panel")).toBeNull();
	});
});

describe("Tooltip", () => {
	it("shows its text when the trigger gets keyboard focus", async () => {
		render(
			<Tooltip content="Hide sidebar">
				<button type="button">Toggle</button>
			</Tooltip>,
		);
		fireEvent.focus(screen.getByRole("button", { name: "Toggle" }));
		expect((await screen.findAllByText("Hide sidebar")).length).toBeGreaterThan(0);
	});
});

describe("Menu", () => {
	it("opens from the keyboard, lists items and calls onSelect", async () => {
		const onSelect = vi.fn();
		render(
			<Menu>
				<MenuTrigger asChild>
					<button type="button">Actions</button>
				</MenuTrigger>
				<MenuContent>
					<MenuItem onSelect={onSelect} shortcut="⌘P">
						Pin
					</MenuItem>
					<MenuItem destructive>Archive</MenuItem>
				</MenuContent>
			</Menu>,
		);
		const trigger = screen.getByRole("button", { name: "Actions" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		const pin = await screen.findByRole("menuitem", { name: /Pin/ });
		expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
		fireEvent.click(pin);
		expect(onSelect).toHaveBeenCalledTimes(1);
	});
});

describe("Dialog", () => {
	it("shows title and description and asks to close on Escape", async () => {
		const onOpenChange = vi.fn();
		render(
			<Dialog open onOpenChange={onOpenChange}>
				<DialogContent title="Reset chat?" description="Later messages will be deleted.">
					<p>Body</p>
				</DialogContent>
			</Dialog>,
		);
		expect(await screen.findByRole("dialog", { name: "Reset chat?" })).toBeTruthy();
		expect(screen.getByText("Later messages will be deleted.")).toBeTruthy();
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("keeps a hidden title available to screen readers", async () => {
		render(
			<Dialog open>
				<DialogContent title="Quick open" hideTitle>
					<p>Body</p>
				</DialogContent>
			</Dialog>,
		);
		expect(await screen.findByRole("dialog", { name: "Quick open" })).toBeTruthy();
	});
});
