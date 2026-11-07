import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AddEnvVarForm } from "./AddEnvVarForm.tsx";

afterEach(cleanup);

describe("SET-04 AddEnvVarForm", () => {
	it("splits a pasted NAME=value line into the two fields", () => {
		render(<AddEnvVarForm existingNames={[]} reservedNames={[]} onAdd={async () => true} />);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "TOKEN=abc" } });

		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("TOKEN");
		expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("abc");
	});

	it("adds an empty value and clears the form", async () => {
		const onAdd = vi.fn(async () => true);
		render(<AddEnvVarForm existingNames={[]} reservedNames={[]} onAdd={onAdd} />);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "EMPTY" } });
		fireEvent.click(screen.getByRole("button", { name: "Add variable" }));

		await waitFor(() => expect(onAdd).toHaveBeenCalledWith("EMPTY", ""));
		await waitFor(() => expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(""));
	});

	it("refuses an invalid name", () => {
		const onAdd = vi.fn(async () => true);
		render(<AddEnvVarForm existingNames={[]} reservedNames={[]} onAdd={onAdd} />);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "2BAD" } });
		fireEvent.click(screen.getByRole("button", { name: "Add variable" }));

		expect(screen.getByRole("alert").textContent).toContain("letters, digits and underscores");
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("refuses a name the app sets itself", () => {
		const onAdd = vi.fn(async () => true);
		render(<AddEnvVarForm existingNames={[]} reservedNames={["CONDUCTED_PORT"]} onAdd={onAdd} />);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CONDUCTED_PORT" } });
		fireEvent.click(screen.getByRole("button", { name: "Add variable" }));

		expect(screen.getByRole("alert").textContent).toContain("The app sets CONDUCTED_PORT itself");
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("keeps the text when the save fails", async () => {
		const onAdd = vi.fn(async () => false);
		render(<AddEnvVarForm existingNames={[]} reservedNames={[]} onAdd={onAdd} />);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "TOKEN" } });
		fireEvent.change(screen.getByLabelText("Value"), { target: { value: "abc" } });
		fireEvent.click(screen.getByRole("button", { name: "Add variable" }));

		expect(await screen.findByRole("alert")).toBeTruthy();
		expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("TOKEN");
		expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe("abc");
	});
});
