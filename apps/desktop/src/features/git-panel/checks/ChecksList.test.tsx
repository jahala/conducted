import type { WorkspaceId } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import type { CheckRun, CheckState } from "../../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { ChecksList } from "./ChecksList.tsx";

const check = (name: string, state: CheckState): CheckRun => ({
	name,
	state,
	url: null,
	startedAt: null,
	completedAt: null,
	required: true,
});

let test: TestContainer;

function renderList(checks: CheckRun[], onRerunFailed = vi.fn()) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<ServicesProvider container={test.container}>
			<QueryClientProvider client={client}>
				<ChecksList
					workspaceId={"w1" as WorkspaceId}
					checks={checks}
					treatOptionalAsBlocking
					rerunBusy={false}
					fixBusy={false}
					onRerunFailed={onRerunFailed}
					onFixErrors={vi.fn()}
					onOpenCheckUrl={vi.fn()}
				/>
			</QueryClientProvider>
		</ServicesProvider>,
	);
	return onRerunFailed;
}

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	test.close();
});

describe("PR-04 checks list", () => {
	it("renders failed, then running, then successful checks", () => {
		renderList([
			check("success", "success"),
			check("failure", "failure"),
			check("running", "running"),
		]);
		const rows = screen.getAllByTestId("check-row").map((row) => row.textContent ?? "");
		expect(rows[0]).toContain("failure");
		expect(rows[1]).toContain("running");
		expect(rows[2]).toContain("success");
	});

	it("offers Re-run failed checks and Fix errors when a check failed", () => {
		const rerun = renderList([check("failure", "failure")]);
		fireEvent.click(screen.getByRole("button", { name: "Re-run" }));
		expect(rerun).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("button", { name: "Fix errors" })).toBeTruthy();
	});

	it("names the section Checks with no counts beside it, as Conductor does", () => {
		renderList([check("failure", "failure"), check("success", "success")]);
		expect(screen.getByRole("heading", { name: "Checks" })).toBeTruthy();
		expect(screen.queryByText(/failed ·/)).toBeNull();
	});

	it("names each check's link Open externally, as Conductor does", () => {
		renderList([{ ...check("failure", "failure"), url: "https://example.test/run/1" }]);
		expect(screen.getByRole("button", { name: "Open externally" })).toBeTruthy();
	});

	it("says when GitHub reports no checks", () => {
		renderList([]);
		expect(screen.getByText("GitHub reports no checks for this pull request.")).toBeTruthy();
	});
});
