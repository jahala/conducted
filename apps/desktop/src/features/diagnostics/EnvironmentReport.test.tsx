import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticsCapture } from "../../core/model.ts";
import { EnvironmentReport } from "./EnvironmentReport.tsx";

afterEach(cleanup);

const capture = (changes: Partial<DiagnosticsCapture> = {}): DiagnosticsCapture => ({
	app: { version: "0.1.0", channel: "dev" },
	os: { name: "macOS", version: "15.4.1", arch: "arm64" },
	shell: "/bin/zsh",
	path: "/Users/me/bin:/usr/bin:/bin",
	env: { LANG: "en_AU.UTF-8", API_TOKEN: "4a5b6c7d" },
	agents: [{ name: "claude", installed: true, version: "2.1.0", path: "/bin/claude" }],
	sidecar: { running: true, logPath: "/logs/sidecar.log" },
	capturedAt: 1_700_000_000_000,
	...changes,
});

describe("APP-03 environment report", () => {
	it("renders only the values the redacted capture holds", () => {
		render(<EnvironmentReport capture={capture()} view="redacted" />);

		expect(screen.getByText("API_TOKEN")).toBeTruthy();
		expect(screen.getByText("4a5b6c7d")).toBeTruthy();
		expect(screen.getByText("en_AU.UTF-8")).toBeTruthy();
		expect(screen.queryByText("super-secret")).toBeNull();
	});

	it("filters the variable list and says when nothing matches", () => {
		render(
			<EnvironmentReport
				capture={capture({ env: { LANG: "en_AU.UTF-8", PWD: "/Users/me" } })}
				view="redacted"
			/>,
		);

		fireEvent.change(screen.getByLabelText("Filter environment variables"), {
			target: { value: "lang" },
		});
		expect(screen.getByText("LANG")).toBeTruthy();
		expect(screen.queryByText("PWD")).toBeNull();

		fireEvent.change(screen.getByLabelText("Filter environment variables"), {
			target: { value: "nothing" },
		});
		expect(screen.getByText("No variables match your filter.")).toBeTruthy();
	});

	it("lists each PATH entry and collapses a long one", () => {
		const path = Array.from({ length: 12 }, (_, index) => `/entry-${index}`).join(":");
		render(<EnvironmentReport capture={capture({ path })} view="redacted" />);

		expect(screen.getByText("12 entries")).toBeTruthy();
		expect(screen.getByText("/entry-0")).toBeTruthy();
		expect(screen.getByText("/entry-11")).toBeTruthy();
	});

	it("lists a folder PATH names twice as two entries without a duplicate key", () => {
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			render(
				<EnvironmentReport
					capture={capture({ path: "/usr/local/bin:/usr/bin:/usr/local/bin" })}
					view="redacted"
				/>,
			);

			expect(screen.getByText("3 entries")).toBeTruthy();
			expect(screen.getAllByText("/usr/local/bin")).toHaveLength(2);
			const duplicateKey = errors.mock.calls.filter((call) => String(call[0]).includes("same key"));
			expect(duplicateKey).toEqual([]);
		} finally {
			errors.mockRestore();
		}
	});

	it("shows missing agents and a stopped sidecar", () => {
		render(
			<EnvironmentReport
				capture={capture({
					agents: [{ name: "codex", installed: false, version: null, path: null }],
					sidecar: { running: false, logPath: null },
				})}
				view="full"
			/>,
		);

		expect(screen.getByText("Not installed")).toBeTruthy();
		expect(screen.getByText("Not running")).toBeTruthy();
		expect(screen.getByText("Full values")).toBeTruthy();
	});
});
