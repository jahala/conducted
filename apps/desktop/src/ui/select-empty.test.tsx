/**
 * @feature APP-05 Select with an empty-string option
 * Tests that an option whose value is "" (Automatic, No section) shows on the trigger and can be chosen.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Select } from "./Select.tsx";

afterEach(cleanup);

const options = [
	{ value: "", label: "Automatic" },
	{ value: "cli", label: "GitHub CLI" },
];

describe("APP-05 Select", () => {
	it("shows the label of an empty-string value on the trigger", () => {
		render(<Select aria-label="Method" value="" options={options} onValueChange={() => {}} />);
		expect(screen.getByRole("combobox", { name: "Method" }).textContent).toContain("Automatic");
	});

	it("shows its placeholder when no option is chosen", () => {
		render(
			<Select
				aria-label="Owner"
				value=""
				options={[{ value: "sam", label: "sam" }]}
				placeholder="Select an owner"
				onValueChange={() => {}}
			/>,
		);
		expect(screen.getByRole("combobox", { name: "Owner" }).textContent).toContain(
			"Select an owner",
		);
	});

	it("hands back the empty string when that option is chosen", async () => {
		const onValueChange = vi.fn();
		render(
			<Select aria-label="Method" value="cli" options={options} onValueChange={onValueChange} />,
		);
		fireEvent.keyDown(screen.getByRole("combobox", { name: "Method" }), { key: "Enter" });
		fireEvent.keyDown(await screen.findByRole("option", { name: "Automatic" }), { key: "Enter" });
		expect(onValueChange).toHaveBeenCalledWith("");
	});
});
