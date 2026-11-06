/**
 * @feature SET-05 MCP status dialog
 * Owns: the tests for one MCP server's status and log dialog.
 * Behaviour: ui-map.md 3.10 (logs), 5.2 ("MCP status" dialog title).
 * Test first: the dialog shows the log lines in order and a copy action puts them on the clipboard.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServerView } from "../../../core/model.ts";
import "../../../test/dom-polyfills.ts";
import { McpStatusDialog } from "./McpStatusDialog.tsx";

const server = (changes: Partial<McpServerView> = {}): McpServerView => ({
	name: "github",
	source: "user",
	transport: "stdio",
	status: "failed",
	toolCount: 2,
	error: "permission denied",
	logTail: ["starting github", "permission denied"],
	...changes,
});

afterEach(cleanup);

describe("SET-05 MCP status dialog", () => {
	it("SET-05 shows the log lines in order and copies them", async () => {
		const copy = vi.fn();
		render(<McpStatusDialog open server={server()} onOpenChange={() => {}} onCopyLog={copy} />);

		expect(screen.getByRole("heading", { name: "MCP status" })).toBeTruthy();
		const log = within(screen.getByRole("list", { name: "MCP server log" }));
		expect(log.getAllByRole("listitem").map((line) => line.textContent)).toEqual([
			"starting github",
			"permission denied",
		]);

		fireEvent.click(screen.getByRole("button", { name: "Copy log" }));
		await waitFor(() => expect(copy).toHaveBeenCalledWith("starting github\npermission denied"));
	});

	it("SET-05 says when no log lines were captured", () => {
		render(
			<McpStatusDialog
				open
				server={server({ logTail: [] })}
				onOpenChange={() => {}}
				onCopyLog={() => {}}
			/>,
		);

		expect(screen.getByText("No log lines were captured.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Copy log" })).toHaveProperty("disabled", true);
	});

	it("SET-05 says when no server is configured", () => {
		render(<McpStatusDialog open server={null} onOpenChange={() => {}} onCopyLog={() => {}} />);

		expect(screen.getByText("No MCP servers configured.")).toBeTruthy();
	});
});
