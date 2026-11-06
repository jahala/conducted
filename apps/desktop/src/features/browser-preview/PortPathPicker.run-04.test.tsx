/**
 * @feature RUN-04 Port and path picker
 * Owns: tests for choosing the port and path the preview shows.
 * Test first: choosing port 5173 with path "docs" calls onChange with its URL.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortPathPicker } from "./PortPathPicker.tsx";

afterEach(cleanup);

describe("RUN-04 port and path picker", () => {
	it("choosing port 5173 with path docs calls onChange with its URL", async () => {
		const onChange = vi.fn();
		render(
			<PortPathPicker
				workspacePort={3000}
				detectedPorts={[3000, 5173]}
				current={{ port: 3000, path: "docs" }}
				onChange={onChange}
			/>,
		);

		fireEvent.keyDown(screen.getByRole("combobox", { name: "Port" }), { key: "Enter" });
		const option = await screen.findByRole("option", { name: "5173" });
		fireEvent.keyDown(option, { key: "Enter" });

		expect(onChange).toHaveBeenCalledWith("http://localhost:5173/docs");
	});

	it("adds a leading slash to a path without one", () => {
		const onChange = vi.fn();
		render(
			<PortPathPicker
				workspacePort={5173}
				detectedPorts={[5173]}
				current={{ port: 5173, path: "" }}
				onChange={onChange}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Path"), { target: { value: "docs" } });
		fireEvent.click(screen.getByRole("button", { name: "Go" }));

		expect(onChange).toHaveBeenCalledWith("http://localhost:5173/docs");
	});

	it("rejects a port outside the valid range", () => {
		render(
			<PortPathPicker
				workspacePort={70_000}
				detectedPorts={[0, 70_000]}
				current={{ port: 70_000, path: "/" }}
				onChange={() => {}}
			/>,
		);

		expect(screen.getByText("No valid port to preview.")).toBeTruthy();
		expect(screen.queryByRole("combobox", { name: "Port" })).toBeNull();
	});
});
