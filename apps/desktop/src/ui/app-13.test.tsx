import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test/dom-polyfills.ts";
import { Alert, AlertDescription, AlertTitle } from "./Alert.tsx";
import { AlertDialog, AlertDialogContent } from "./AlertDialog.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./Card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./Collapsible.tsx";
import { CopyButton } from "./CopyButton.tsx";
import { HighlightedText } from "./HighlightedText.tsx";
import { Separator } from "./Separator.tsx";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "./Table.tsx";
import { Toggle, ToggleGroup, ToggleGroupItem } from "./Toggle.tsx";
import { TruncatedText, truncateMiddle } from "./TruncatedText.tsx";

afterEach(cleanup);

describe("APP-13 Toggle", () => {
	it("reports the pressed state and toggles it on click", () => {
		const onPressedChange = vi.fn();
		render(
			<Toggle aria-label="Bold" onPressedChange={onPressedChange}>
				Bold
			</Toggle>,
		);
		const toggle = screen.getByRole("button", { name: "Bold" });
		expect(toggle.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(toggle);
		expect(onPressedChange).toHaveBeenCalledWith(true);
	});

	it("shows the pressed state in its style", () => {
		render(
			<Toggle aria-label="Bold" pressed>
				Bold
			</Toggle>,
		);
		const toggle = screen.getByRole("button", { name: "Bold" });
		expect(toggle.getAttribute("data-state")).toBe("on");
		expect(toggle.className).toContain("bg-active");
	});

	it("keeps the small size at 24 pixels", () => {
		render(
			<Toggle aria-label="Bold" size="sm">
				B
			</Toggle>,
		);
		expect(screen.getByRole("button", { name: "Bold" }).className).toContain("h-6");
	});
});

describe("APP-13 ToggleGroup", () => {
	it("chooses one segment and reports its value", () => {
		const onValueChange = vi.fn();
		render(
			<ToggleGroup type="single" defaultValue="unified" onValueChange={onValueChange}>
				<ToggleGroupItem value="unified">Unified</ToggleGroupItem>
				<ToggleGroupItem value="split">Split</ToggleGroupItem>
			</ToggleGroup>,
		);
		expect(screen.getByRole("radiogroup")).toBeTruthy();
		expect(screen.getByRole("radio", { name: "Unified" }).getAttribute("aria-checked")).toBe(
			"true",
		);
		fireEvent.click(screen.getByRole("radio", { name: "Split" }));
		expect(onValueChange).toHaveBeenCalledWith("split");
	});

	it("presses several segments at once when it allows multiple", () => {
		const onValueChange = vi.fn();
		render(
			<ToggleGroup type="multiple" defaultValue={["name"]} onValueChange={onValueChange}>
				<ToggleGroupItem value="name">Name</ToggleGroupItem>
				<ToggleGroupItem value="cpu">CPU</ToggleGroupItem>
			</ToggleGroup>,
		);
		fireEvent.click(screen.getByRole("button", { name: "CPU" }));
		expect(onValueChange).toHaveBeenCalledWith(["name", "cpu"]);
	});
});

describe("APP-13 CopyButton", () => {
	it("copies its text and shows Copied for a short time", async () => {
		const onCopy = vi.fn(async () => {});
		render(<CopyButton text="git status" onCopy={onCopy} copiedMs={200} />);

		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		expect(onCopy).toHaveBeenCalledWith("git status");
		expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
		await waitFor(() => expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy());
	});

	it("does not claim it copied when the copy failed", async () => {
		const onCopy = vi.fn(async () => {
			throw new Error("denied");
		});
		render(<CopyButton text="secret" onCopy={onCopy} />);

		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		await waitFor(() => expect(onCopy).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
	});
});

describe("APP-13 AlertDialog", () => {
	it("shows its title and description", async () => {
		render(
			<AlertDialog open>
				<AlertDialogContent
					title="Remove repository?"
					description="Its workspaces and chats will be deleted."
				/>
			</AlertDialog>,
		);
		expect(await screen.findByRole("alertdialog", { name: "Remove repository?" })).toBeTruthy();
		expect(screen.getByText("Its workspaces and chats will be deleted.")).toBeTruthy();
	});

	it("runs its action and closes from cancel", async () => {
		const onConfirm = vi.fn();
		const onOpenChange = vi.fn();
		render(
			<AlertDialog open onOpenChange={onOpenChange}>
				<AlertDialogContent
					title="Discard changes?"
					confirmLabel="Discard"
					cancelLabel="Keep"
					onConfirm={onConfirm}
				/>
			</AlertDialog>,
		);
		fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
		expect(onConfirm).toHaveBeenCalledTimes(1);
		expect(onOpenChange).toHaveBeenCalledWith(false);

		fireEvent.click(screen.getByRole("button", { name: "Keep" }));
		expect(onOpenChange).toHaveBeenCalledTimes(2);
	});

	it("marks the action destructive when asked", async () => {
		render(
			<AlertDialog open>
				<AlertDialogContent title="Delete workspace?" confirmLabel="Delete" tone="destructive" />
			</AlertDialog>,
		);
		const action = await screen.findByRole("button", { name: "Delete" });
		expect(action.getAttribute("data-variant")).toBe("destructive");
	});

	it("closes on Escape", async () => {
		const onOpenChange = vi.fn();
		render(
			<AlertDialog open onOpenChange={onOpenChange}>
				<AlertDialogContent title="Delete workspace?" />
			</AlertDialog>,
		);
		const dialog = await screen.findByRole("alertdialog", { name: "Delete workspace?" });
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});

describe("APP-13 Card", () => {
	it("groups a title, description, content and footer", () => {
		render(
			<Card>
				<CardHeader>
					<CardTitle>Workspace</CardTitle>
					<CardDescription>Details</CardDescription>
				</CardHeader>
				<CardContent>Body</CardContent>
				<CardFooter>Foot</CardFooter>
			</Card>,
		);
		const title = screen.getByRole("heading", { name: "Workspace" });
		expect(screen.getByText("Details")).toBeTruthy();
		expect(screen.getByText("Body")).toBeTruthy();
		expect(screen.getByText("Foot")).toBeTruthy();
		const card = title.closest("[data-slot='card']");
		expect(card?.className).toContain("bg-raised");
		expect(card?.className).toContain("border-border");
	});
});

describe("APP-13 Separator", () => {
	it("is horizontal by default and vertical when asked", () => {
		const { rerender } = render(<Separator />);
		const horizontal = screen.getByRole("separator");
		expect(horizontal.getAttribute("data-orientation")).toBe("horizontal");
		expect(horizontal.className).toContain("h-px");

		rerender(<Separator orientation="vertical" />);
		const vertical = screen.getByRole("separator");
		expect(vertical.getAttribute("data-orientation")).toBe("vertical");
		expect(vertical.className).toContain("w-px");
	});

	it("can be decorative", () => {
		render(<Separator decorative />);
		expect(screen.queryByRole("separator")).toBeNull();
	});
});

describe("APP-13 Collapsible", () => {
	it("opens and closes its content", () => {
		render(
			<Collapsible>
				<CollapsibleTrigger>More</CollapsibleTrigger>
				<CollapsibleContent>Details</CollapsibleContent>
			</Collapsible>,
		);
		const trigger = screen.getByRole("button", { name: "More" });
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("Details")).toBeNull();

		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("true");
		expect(screen.getByText("Details")).toBeTruthy();

		fireEvent.click(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByText("Details")).toBeNull();
	});

	it("can start open", () => {
		render(
			<Collapsible defaultOpen>
				<CollapsibleTrigger>More</CollapsibleTrigger>
				<CollapsibleContent>Details</CollapsibleContent>
			</Collapsible>,
		);
		expect(screen.getByText("Details")).toBeTruthy();
	});
});

describe("APP-13 Table", () => {
	it("renders a caption, column headers and cells", () => {
		render(
			<Table>
				<TableCaption>Resources</TableCaption>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>CPU</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell>Editor</TableCell>
						<TableCell>12%</TableCell>
					</TableRow>
				</TableBody>
			</Table>,
		);
		expect(screen.getByRole("table")).toBeTruthy();
		expect(screen.getByText("Resources").tagName).toBe("CAPTION");
		expect(screen.getByRole("columnheader", { name: "Name" })).toBeTruthy();
		expect(screen.getByRole("cell", { name: "Editor" })).toBeTruthy();
		expect(screen.getByRole("cell", { name: "12%" })).toBeTruthy();
	});

	it("scrolls horizontally instead of squeezing its columns", () => {
		const { container } = render(
			<Table>
				<TableBody>
					<TableRow>
						<TableCell>Wide</TableCell>
					</TableRow>
				</TableBody>
			</Table>,
		);
		expect(container.firstElementChild?.className).toContain("overflow-x-auto");
	});
});

describe("APP-13 Alert", () => {
	it("shows a title, a description and an icon", () => {
		render(
			<Alert icon={<span data-testid="alert-icon" />}>
				<AlertTitle>Heads up</AlertTitle>
				<AlertDescription>Something happened.</AlertDescription>
			</Alert>,
		);
		expect(screen.getByRole("alert")).toBeTruthy();
		expect(screen.getByText("Heads up")).toBeTruthy();
		expect(screen.getByText("Something happened.")).toBeTruthy();
		expect(screen.getByTestId("alert-icon")).toBeTruthy();
	});

	it("marks the destructive tone", () => {
		render(
			<Alert tone="destructive">
				<AlertTitle>Failed</AlertTitle>
			</Alert>,
		);
		const alert = screen.getByRole("alert");
		expect(alert.getAttribute("data-tone")).toBe("destructive");
		expect(alert.className).toContain("border-danger");
	});
});

describe("APP-13 TruncatedText", () => {
	it("keeps the start and the end of a long text in the middle", () => {
		const text = "packages/sidecar/src/session/manager/very-long-file-name.ts";
		const shown = truncateMiddle(text, 24);
		expect(shown.startsWith(text.slice(0, 12))).toBe(true);
		expect(shown.endsWith(text.slice(-11))).toBe(true);
		expect(shown).toContain("…");
		expect(shown).toHaveLength(24);
	});

	it("leaves short text alone", () => {
		expect(truncateMiddle("short", 60)).toBe("short");
	});

	it("keeps the full text in a tooltip and copies it", () => {
		const onCopy = vi.fn();
		const text = "~/projects/a-very-long-repository-name/src/deeply/nested/folder/file.ts";
		render(<TruncatedText text={text} maxLength={20} onCopy={onCopy} />);

		const shown = screen.getByText(truncateMiddle(text, 20));
		expect(shown.getAttribute("title")).toBe(text);

		fireEvent.click(screen.getByRole("button", { name: "Copy" }));
		expect(onCopy).toHaveBeenCalledWith(text);
	});
});

describe("APP-13 HighlightedText", () => {
	it("marks every case-insensitive match", () => {
		const { container } = render(
			<HighlightedText text="Search settings and search results" query="search" />,
		);
		const marks = container.querySelectorAll("mark");
		expect(marks).toHaveLength(2);
		expect(marks[0]?.textContent).toBe("Search");
		expect(marks[1]?.textContent).toBe("search");
		expect(container.textContent).toBe("Search settings and search results");
	});

	it("treats a query with regular-expression symbols as plain text", () => {
		const { container } = render(<HighlightedText text="Use a.b or a+b" query="a." />);
		const marks = container.querySelectorAll("mark");
		expect(marks).toHaveLength(1);
		expect(marks[0]?.textContent).toBe("a.");
	});

	it("renders the text unchanged when there is no query", () => {
		const { container } = render(<HighlightedText text="Plain" query="" />);
		expect(screen.getByText("Plain")).toBeTruthy();
		expect(container.querySelector("mark")).toBeNull();
	});

	it("leaves the text alone when nothing matches", () => {
		const { container } = render(<HighlightedText text="Plain" query="zzz" />);
		expect(screen.getByText("Plain")).toBeTruthy();
		expect(container.querySelector("mark")).toBeNull();
	});
});
