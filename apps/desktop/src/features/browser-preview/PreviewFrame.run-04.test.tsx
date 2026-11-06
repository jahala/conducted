/**
 * @feature RUN-04 Preview frame
 * Owns: tests for the frame's load state reports.
 * Test first: a load failure event produces the failed state with the URL.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PreviewFrame, type PreviewLoadState } from "./PreviewFrame.tsx";

afterEach(cleanup);

describe("RUN-04 preview frame", () => {
	it("a load failure event produces the failed state with the URL", () => {
		const states: PreviewLoadState[] = [];
		const url = "http://localhost:5173/docs";
		render(<PreviewFrame url={url} onLoadState={(state) => states.push(state)} />);

		fireEvent.error(screen.getByTitle("Preview"));

		expect(states.at(-1)).toEqual({ kind: "failed", reason: "blocked", url });
	});

	it("a load finish reports the ready state", () => {
		const states: PreviewLoadState[] = [];
		const url = "http://localhost:5173";
		render(<PreviewFrame url={url} onLoadState={(state) => states.push(state)} />);

		fireEvent.load(screen.getByTitle("Preview"));

		expect(states.at(-1)).toEqual({ kind: "ready", title: null });
	});
});
