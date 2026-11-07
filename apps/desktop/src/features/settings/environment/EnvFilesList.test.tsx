import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDotenv } from "../../../core/services/dotenv.ts";
import { EnvFilesList, pathInsideRepository } from "./EnvFilesList.tsx";

afterEach(cleanup);

describe("SET-04 EnvFilesList", () => {
	it("refuses a path outside the repository root", () => {
		const onAdd = vi.fn(async () => true);
		render(
			<EnvFilesList
				files={[]}
				candidates={[".env"]}
				repositoryRoot="/repo"
				onAdd={onAdd}
				onRemove={async () => true}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add env file" }));
		fireEvent.change(screen.getByLabelText("Environment file path"), {
			target: { value: "../outside.env" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));

		expect(screen.getByRole("alert").textContent).toContain("inside the repository");
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("adds a dotenv file found in the repository", async () => {
		const onAdd = vi.fn(async () => true);
		render(
			<EnvFilesList
				files={[]}
				candidates={[".env", ".env.local"]}
				repositoryRoot="/repo"
				onAdd={onAdd}
				onRemove={async () => true}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add env file" }));
		fireEvent.change(screen.getByLabelText("Environment file path"), {
			target: { value: ".env.local" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add" }));

		await waitFor(() => expect(onAdd).toHaveBeenCalledWith(".env.local"));
	});

	it("cancels adding an env file without changing anything", () => {
		const onAdd = vi.fn(async () => true);
		render(
			<EnvFilesList
				files={[]}
				candidates={[".env"]}
				repositoryRoot="/repo"
				onAdd={onAdd}
				onRemove={async () => true}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add env file" }));
		fireEvent.click(screen.getByRole("button", { name: "Cancel adding env file" }));

		expect(screen.queryByLabelText("Environment file path")).toBeNull();
		expect(onAdd).not.toHaveBeenCalled();
	});

	it("marks a file that no longer exists and removes without touching it", async () => {
		const onRemove = vi.fn(async () => true);
		render(
			<EnvFilesList
				files={[{ path: ".env", exists: false }]}
				candidates={[]}
				repositoryRoot="/repo"
				onAdd={async () => true}
				onRemove={onRemove}
			/>,
		);

		expect(screen.getByText("File not found")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Remove .env" }));

		await waitFor(() => expect(onRemove).toHaveBeenCalledWith(".env"));
	});

	it("keeps only paths inside the root", () => {
		expect(pathInsideRepository("/repo", ".env")).toBe(".env");
		expect(pathInsideRepository("/repo", "/repo/.env.local")).toBe(".env.local");
		expect(pathInsideRepository("/repo", "/etc/passwd")).toBeNull();
		expect(pathInsideRepository("/repo", "../other/.env")).toBeNull();
	});

	it("reads names and values from a dotenv file", () => {
		expect(parseDotenv('A=1\nexport B="two"\n# skip\nC=\n')).toEqual([
			{ name: "A", value: "1" },
			{ name: "B", value: "two" },
			{ name: "C", value: "" },
		]);
	});
});
