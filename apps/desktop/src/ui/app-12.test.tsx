import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../test/dom-polyfills.ts";
import { Checkbox } from "./Checkbox.tsx";
import { Input, Label, Textarea } from "./Input.tsx";
import { Select } from "./Select.tsx";
import { Slider } from "./Slider.tsx";
import { Switch } from "./Switch.tsx";

if (typeof Element.prototype.scrollIntoView !== "function") {
	Element.prototype.scrollIntoView = () => {};
}

afterEach(cleanup);

describe("APP-12 Slider", () => {
	it("steps the value with the arrow keys", () => {
		const onValueChange = vi.fn();
		render(
			<Slider
				value={100}
				min={50}
				max={200}
				step={10}
				onValueChange={onValueChange}
				formatValue={(value) => `${value}%`}
				aria-label="App zoom"
			/>,
		);
		const thumb = screen.getByRole("slider", { name: "App zoom" });
		thumb.focus();
		fireEvent.keyDown(thumb, { key: "ArrowRight" });
		expect(onValueChange).toHaveBeenCalledWith(110);
	});

	it("steps by ten steps with PageUp", () => {
		const onValueChange = vi.fn();
		render(
			<Slider
				value={100}
				min={50}
				max={300}
				step={10}
				onValueChange={onValueChange}
				formatValue={(value) => `${value}%`}
				aria-label="App zoom"
			/>,
		);
		const thumb = screen.getByRole("slider", { name: "App zoom" });
		thumb.focus();
		fireEvent.keyDown(thumb, { key: "PageUp" });
		expect(onValueChange).toHaveBeenCalledWith(200);
	});

	it("reads out the value with its unit", () => {
		render(
			<Slider
				value={110}
				min={50}
				max={200}
				step={10}
				onValueChange={() => {}}
				formatValue={(value) => `${value}%`}
				aria-label="App zoom"
			/>,
		);
		expect(screen.getByRole("slider", { name: "App zoom" }).getAttribute("aria-valuetext")).toBe(
			"110%",
		);
	});

	it("does not step while disabled", () => {
		const onValueChange = vi.fn();
		render(
			<Slider
				value={100}
				min={50}
				max={200}
				step={10}
				onValueChange={onValueChange}
				formatValue={(value) => `${value}%`}
				aria-label="App zoom"
				disabled
			/>,
		);
		fireEvent.keyDown(screen.getByRole("slider", { name: "App zoom" }), { key: "ArrowRight" });
		expect(onValueChange).not.toHaveBeenCalled();
	});
});

describe("APP-12 Switch", () => {
	it("toggles with Space from the keyboard", () => {
		const onCheckedChange = vi.fn();
		render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Notifications" />);
		const control = screen.getByRole("switch", { name: "Notifications" });
		control.focus();
		fireEvent.keyDown(control, { key: " " });
		expect(onCheckedChange).toHaveBeenCalledWith(true);
	});

	it("toggles with Enter from the keyboard", () => {
		const onCheckedChange = vi.fn();
		render(<Switch checked onCheckedChange={onCheckedChange} aria-label="Notifications" />);
		fireEvent.keyDown(screen.getByRole("switch", { name: "Notifications" }), { key: "Enter" });
		expect(onCheckedChange).toHaveBeenCalledWith(false);
	});

	it("is named by a label", () => {
		render(
			<>
				<Label htmlFor="notifications">Notifications</Label>
				<Switch id="notifications" checked={false} onCheckedChange={() => {}} />
			</>,
		);
		expect(screen.getByRole("switch", { name: "Notifications" })).toBeTruthy();
	});

	it("does not toggle while disabled", () => {
		const onCheckedChange = vi.fn();
		render(
			<Switch
				checked={false}
				onCheckedChange={onCheckedChange}
				aria-label="Notifications"
				disabled
			/>,
		);
		fireEvent.keyDown(screen.getByRole("switch", { name: "Notifications" }), { key: " " });
		expect(onCheckedChange).not.toHaveBeenCalled();
	});
});

describe("APP-12 Checkbox", () => {
	it("toggles when its label is clicked", () => {
		const onCheckedChange = vi.fn();
		render(
			<>
				<Checkbox id="wrap-lines" checked={false} onCheckedChange={onCheckedChange} />
				<Label htmlFor="wrap-lines">Wrap lines</Label>
			</>,
		);
		fireEvent.click(screen.getByText("Wrap lines"));
		expect(onCheckedChange).toHaveBeenCalledWith(true);
	});

	it("reports the indeterminate state and turns it on when clicked", () => {
		const onCheckedChange = vi.fn();
		render(
			<Checkbox
				checked="indeterminate"
				onCheckedChange={onCheckedChange}
				aria-label="Select all"
			/>,
		);
		const checkbox = screen.getByRole("checkbox", { name: "Select all" });
		expect(checkbox.getAttribute("aria-checked")).toBe("mixed");
		fireEvent.click(checkbox);
		expect(onCheckedChange).toHaveBeenCalledWith(true);
	});

	it("keeps the small size at 14 pixels", () => {
		render(<Checkbox checked={false} onCheckedChange={() => {}} aria-label="Small" size="sm" />);
		expect(screen.getByRole("checkbox", { name: "Small" }).className).toContain("size-3.5");
	});
});

describe("APP-12 Input, Textarea and Label", () => {
	it("names its input from a label and shows the accent edge on focus", () => {
		render(
			<>
				<Label htmlFor="chat-title">Chat title</Label>
				<Input id="chat-title" />
			</>,
		);
		const input = screen.getByLabelText("Chat title");
		expect(input.className).toContain("border-border-strong");
		fireEvent.focus(input);
		expect(input.className).toContain("border-accent");
		fireEvent.blur(input);
		expect(input.className).not.toContain("border-accent");
	});

	it("lets the caller choose the field width", () => {
		render(
			<>
				<Input aria-label="Width" className="w-40" />
				<Textarea aria-label="Notes width" className="w-40" />
			</>,
		);
		for (const field of [screen.getByLabelText("Width"), screen.getByLabelText("Notes width")]) {
			expect(field.className).toContain("w-40");
			expect(field.className).not.toContain("w-full");
		}
	});

	it("is styled read-only when the caller makes it read-only", () => {
		render(<Input aria-label="Fixed" readOnly defaultValue="fixed" />);
		const input = screen.getByLabelText("Fixed");
		expect(input.hasAttribute("readonly")).toBe(true);
		expect(input.className).toContain("read-only:bg-muted");
	});

	it("links an error message to its field", () => {
		render(<Input id="email" aria-label="Email" error="Enter an email address" />);
		const input = screen.getByLabelText("Email");
		expect(input.getAttribute("aria-invalid")).toBe("true");
		const describedBy = input.getAttribute("aria-describedby");
		expect(describedBy).not.toBeNull();
		expect(document.getElementById(describedBy ?? "")?.textContent).toBe("Enter an email address");
	});

	it("gives the textarea the same edge and focus behaviour and a minimum height", () => {
		render(
			<>
				<Label htmlFor="notes">Notes</Label>
				<Textarea id="notes" />
			</>,
		);
		const textarea = screen.getByLabelText("Notes");
		expect(textarea.className).toContain("min-h-15");
		fireEvent.focus(textarea);
		expect(textarea.className).toContain("border-accent");
	});
});

describe("APP-12 Select", () => {
	const options = [
		{ value: "light", label: "Light" },
		{ value: "dark", label: "Dark" },
	];

	it("chooses an option from the keyboard", async () => {
		const onValueChange = vi.fn();
		render(
			<Select value="light" options={options} onValueChange={onValueChange} aria-label="Theme" />,
		);
		const trigger = screen.getByRole("combobox", { name: "Theme" });
		fireEvent.keyDown(trigger, { key: "Enter" });
		const dark = await screen.findByRole("option", { name: "Dark" });
		fireEvent.keyDown(dark, { key: "Enter" });
		expect(onValueChange).toHaveBeenCalledWith("dark");
	});

	it("shows a value that is not in the options as it is", () => {
		render(
			<Select value="custom-theme" options={options} onValueChange={() => {}} aria-label="Theme" />,
		);
		expect(screen.getByRole("combobox", { name: "Theme" }).textContent).toContain("custom-theme");
	});

	it("scrolls a long list inside the popup", async () => {
		const many = Array.from({ length: 40 }, (_, index) => ({
			value: `option-${index}`,
			label: `Option ${index}`,
		}));
		render(
			<Select value="option-0" options={many} onValueChange={() => {}} aria-label="Long list" />,
		);
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Long list" }), { key: "Enter" });
		await screen.findByRole("option", { name: "Option 39" });
		const viewport = document.querySelector("[data-radix-select-viewport]");
		expect(viewport).not.toBeNull();
		expect(viewport?.className).toContain("overflow-y-auto");
	});

	it("does not choose a disabled option", async () => {
		const onValueChange = vi.fn();
		render(
			<Select
				value="light"
				options={[...options, { value: "system", label: "System", disabled: true }]}
				onValueChange={onValueChange}
				aria-label="Theme"
			/>,
		);
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Theme" }), { key: "Enter" });
		const system = await screen.findByRole("option", { name: "System" });
		fireEvent.keyDown(system, { key: "Enter" });
		expect(onValueChange).not.toHaveBeenCalled();
	});
});
