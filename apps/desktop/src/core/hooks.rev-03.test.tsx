/**
 * @feature REV-03 useDiffComments
 * Tests the review comment hook over the real container.
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { useDiffComments } from "./hooks.ts";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("REV-03 useDiffComments", () => {
	it("loads the workspace's comments on demand", async () => {
		test = createTestContainer();
		const container = test.container;
		const workspace = await seedWorkspace(container);
		const added = await container.services.review.add(workspace.id, "src/a.ts", 3, null, "Load me");
		if (!added.ok) throw new Error(added.error.message);
		container.services.review.store.setState({ byWorkspace: {}, errors: {} });

		const wrapper = ({ children }: { children: ReactNode }) => (
			<ServicesProvider container={container}>{children}</ServicesProvider>
		);
		const { result } = renderHook(() => useDiffComments(workspace.id), { wrapper });

		expect(result.current.state).toBe("loading");
		await waitFor(() => expect(result.current.state).toBe("ready"));
		expect(result.current).toMatchObject({
			state: "ready",
			data: [{ body: "Load me" }],
		});
	});
});
