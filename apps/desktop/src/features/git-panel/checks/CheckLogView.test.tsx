import { appError } from "@conducted/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../test/dom-polyfills.ts";
import { ansiToSpans, CheckLogView } from "./CheckLogView.tsx";

afterEach(cleanup);

describe("PR-04 check log ANSI", () => {
	it("renders red text from the escape in a span with the red class", () => {
		render(
			<CheckLogView
				log={{ state: "ready", data: "before \u001b[31mred\u001b[0m after" }}
				onRetry={vi.fn()}
			/>,
		);
		const red = screen.getByText("red");
		expect(red.className).toContain("text-term-red");
		expect(screen.getByText("before ").className).not.toContain("text-term-red");
	});

	it("drops the escapes from the visible text", () => {
		const spans = ansiToSpans("\u001b[1;32mok\u001b[0m");
		expect(spans.map((span) => span.text)).toEqual(["ok"]);
		expect(spans[0]?.className).toContain("font-semibold");
		expect(spans[0]?.className).toContain("text-term-green");
	});
});

describe("PR-04 check log states", () => {
	it("shows a loading spinner", () => {
		render(<CheckLogView log={{ state: "loading" }} onRetry={vi.fn()} />);
		expect(screen.getByRole("status", { name: "Loading logs" })).toBeTruthy();
	});

	it("says the logs expired", () => {
		render(
			<CheckLogView
				log={{
					state: "error",
					error: appError("github_check_log_expired", "The log is gone."),
				}}
				onRetry={vi.fn()}
			/>,
		);
		expect(screen.getByText("No logs were recorded, or they have expired.")).toBeTruthy();
	});

	it("says when a check has no log", () => {
		render(
			<CheckLogView
				log={{ state: "error", error: appError("github_check_no_job", "No logs available.") }}
				onRetry={vi.fn()}
			/>,
		);
		expect(screen.getByText("No logs available.")).toBeTruthy();
	});

	it("says a log is empty", () => {
		render(<CheckLogView log={{ state: "ready", data: "   " }} onRetry={vi.fn()} />);
		expect(screen.getByText("No logs available.")).toBeTruthy();
	});

	it("offers to copy the log", () => {
		const onCopy = vi.fn();
		render(
			<CheckLogView log={{ state: "ready", data: "hello" }} onRetry={vi.fn()} onCopy={onCopy} />,
		);
		expect(screen.getByRole("button", { name: /Copy log/ })).toBeTruthy();
	});
});
