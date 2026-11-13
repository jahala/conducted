/**
 * @feature CHAT-24 Mermaid diagrams in replies
 * Owns: the test for a Mermaid library that fails to load (a missing chunk), kept apart because the
 * module stand-in is per file.
 * Behaviour: ui-map.md 3.3 (Assistant text: Mermaid).
 * Test first: a failed load shows the source with the plain message and logs the load failure,
 * apart from a parse failure.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer } from "../../test/container.ts";
import { MermaidDiagram } from "./MermaidDiagram.tsx";

// seam: CHAT-24 the Mermaid chunk is loaded on first use; this stands in for a chunk that is missing.
vi.mock("mermaid", () => {
	throw new Error("Failed to fetch dynamically imported module");
});

let test: ReturnType<typeof createTestContainer>;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	test.close();
});

describe("CHAT-24 mermaid library that fails to load", () => {
	it("says Failed to render diagram and logs a load failure, not a parse failure", async () => {
		render(
			<ServicesProvider container={test.container}>
				<MermaidDiagram source={"graph TD\nA --> B"} streaming={false} />
			</ServicesProvider>,
		);

		expect(await screen.findByText("Failed to render diagram")).toBeTruthy();
		const warnings = test.memory.controls.logs.filter((line) => line.level === "warn");
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.message).toMatch(/^The Mermaid library could not be loaded: /);
	});
});
