import type { RepoId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvVarView } from "../../../core/model.ts";
import "../../../test/dom-polyfills.ts";
import { EnvVarTable } from "./EnvVarTable.tsx";

afterEach(cleanup);

const view = (changes: Partial<EnvVarView> = {}): EnvVarView => ({
	name: "TOKEN",
	scope: "global",
	hasValue: true,
	overridesGlobal: false,
	overriddenInRepos: 0,
	...changes,
});

const props = (vars: EnvVarView[]) => ({
	vars,
	onReveal: vi.fn(async () => "secret"),
	onEdit: vi.fn(async () => true),
	onRemove: vi.fn(async () => true),
});

describe("SET-04 EnvVarTable", () => {
	it("asks for the value once and hides it after blur", async () => {
		const handlers = props([view()]);
		render(<EnvVarTable {...handlers} />);

		fireEvent.click(screen.getByRole("button", { name: "Reveal" }));

		const value = await screen.findByLabelText("Value of TOKEN");
		expect((value as HTMLInputElement).value).toBe("secret");
		expect(handlers.onReveal).toHaveBeenCalledTimes(1);
		expect(handlers.onReveal).toHaveBeenCalledWith("TOKEN");

		fireEvent.blur(value);

		await waitFor(() => expect(screen.queryByLabelText("Value of TOKEN")).toBeNull());
	});

	it("shows the designed empty state", () => {
		render(<EnvVarTable {...props([])} />);

		expect(screen.getByText("No variables set")).toBeTruthy();
		expect(
			screen.getByText("Add a variable to make it available in this environment."),
		).toBeTruthy();
	});

	it("marks a repository value that replaces a global one", () => {
		render(
			<EnvVarTable
				{...props([view({ scope: { repoId: "r1" as RepoId }, overridesGlobal: true })])}
			/>,
		);

		expect(screen.getByText("Locally overwritten")).toBeTruthy();
	});

	it("says when a global variable is replaced in repositories", () => {
		render(<EnvVarTable {...props([view({ overriddenInRepos: 2 })])} />);

		expect(screen.getByText("Overridden in 2 repositories")).toBeTruthy();
	});

	it("asks before removing and removes only after confirmation", async () => {
		const handlers = props([view()]);
		render(<EnvVarTable {...handlers} />);

		fireEvent.click(screen.getByRole("button", { name: "Remove" }));
		expect(handlers.onRemove).not.toHaveBeenCalled();

		fireEvent.click(await screen.findByRole("button", { name: "Remove variable" }));

		await waitFor(() => expect(handlers.onRemove).toHaveBeenCalledWith("TOKEN"));
	});
});
