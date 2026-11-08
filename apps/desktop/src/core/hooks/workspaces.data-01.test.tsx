/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: tests for the workspace hooks when the workspace table cannot be read: the store keeps the
 * error and the list reports it instead of an empty ready list.
 * Behaviour: services-map.md 1.3.
 * Must handle: a database failure while loading workspaces, then a successful retry.
 * Test first: a failed workspace load makes useWorkspaces report its error, not an empty list.
 */
import { appError, type WorkspaceId } from "@conducted/shared";
import { cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { failingOnSelect } from "../../test/failing-database.ts";
import { ServicesProvider } from "../context.tsx";
import { BACKLOG_WORKSPACES_SQL } from "../db/backlog-workspaces.ts";
import { WORKSPACES_SQL } from "../db/workspaces.ts";
import { useWorkspace, useWorkspaces } from "./workspaces.ts";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

function wrapperFor(container: TestContainer) {
	return ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container.container}>{children}</ServicesProvider>
	);
}

const loadFailure = appError("db.failed", "Listing workspaces failed");

describe("DATA-01 workspace load failure", () => {
	it("reports the error from useWorkspaces instead of an empty ready list", () => {
		test = createTestContainer();
		test.container.services.workspace.store.setState({ loaded: true, loadError: loadFailure });
		const { result } = renderHook(() => useWorkspaces(), { wrapper: wrapperFor(test) });
		expect(result.current).toEqual({ state: "error", error: loadFailure });
	});

	it("reports the load error from useWorkspace too", () => {
		test = createTestContainer();
		test.container.services.workspace.store.setState({ loaded: true, loadError: loadFailure });
		const { result } = renderHook(() => useWorkspace("w1" as WorkspaceId), {
			wrapper: wrapperFor(test),
		});
		expect(result.current).toEqual({ state: "error", error: loadFailure });
	});

	it("keeps the error a failed start returns, and a successful start clears it", async () => {
		test = createTestContainer({
			wrapDatabase: (database) =>
				failingOnSelect(database, WORKSPACES_SQL.listAll, new Error("disk read failed")),
		});
		const failed = await test.container.services.workspace.start();
		expect(failed.ok).toBe(false);
		const loadError = test.container.services.workspace.store.getState().loadError;
		expect(loadError?.code).toBe(loadFailure.code);
		expect(loadError?.message).toBe(loadFailure.message);
		test.close();
		test = undefined;

		const retried = createTestContainer();
		test = retried;
		expect((await retried.container.services.workspace.start()).ok).toBe(true);
		expect(retried.container.services.workspace.store.getState().loadError).toBeNull();
	});

	it("keeps an error from the backlog read too, so no step's failure reads as an empty list", async () => {
		test = createTestContainer({
			wrapDatabase: (database) =>
				failingOnSelect(database, BACKLOG_WORKSPACES_SQL.list, new Error("disk read failed")),
		});
		const failed = await test.container.services.workspace.start();
		expect(failed.ok).toBe(false);
		expect(test.container.services.workspace.store.getState().loadError?.message).toBe(
			"Listing backlog workspaces failed",
		);
	});
});
