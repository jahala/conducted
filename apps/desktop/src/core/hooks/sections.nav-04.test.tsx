/**
 * @feature NAV-04 Sidebar section hook
 * Owns: tests that `useSections` reports loading before the store has loaded and the stored
 * sections afterwards.
 * Test first: a loaded sections store comes back as a ready list.
 */
import type { SectionId } from "@conducted/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer } from "../../test/container.ts";
import { ServicesProvider } from "../context.tsx";
import type { Section } from "../model.ts";
import { useSections } from "./sections.ts";

afterEach(cleanup);

const section: Section = {
	id: "s1" as SectionId,
	name: "Review",
	emoji: null,
	position: 0,
	collapsed: false,
	workspaceIds: [],
};

describe("NAV-04 useSections", () => {
	it("is loading before the store has loaded and ready after it", () => {
		const test = createTestContainer();
		try {
			const wrapper = ({ children }: { children: ReactNode }) => (
				<ServicesProvider container={test.container}>{children}</ServicesProvider>
			);
			const { result } = renderHook(() => useSections(), { wrapper });
			expect(result.current).toEqual({ state: "loading" });
			act(() => {
				test.container.services.sections.store.setState({ loaded: true, sections: [section] });
			});
			expect(result.current).toEqual({ state: "ready", data: [section] });
		} finally {
			test.close();
		}
	});
});
