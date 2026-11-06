import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticsCapture } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";
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
		render(
			<EnvironmentReport
				capture={capture()}
				view="redacted"
				failedSections={[]}
				onRetrySection={() => {}}
			/>,
		);

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
				failedSections={[]}
				onRetrySection={() => {}}
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

	it("names a failed section and offers Retry for it", () => {
		const retry = vi.fn();
		render(
			<EnvironmentReport
				capture={capture()}
				view="redacted"
				failedSections={["shell"]}
				onRetrySection={retry}
			/>,
		);

		expect(screen.getByRole("alert").textContent).toContain("Could not capture the login shell.");
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(retry).toHaveBeenCalledWith("shell");
	});

	it("lists each PATH entry and collapses a long one", () => {
		const path = Array.from({ length: 12 }, (_, index) => `/entry-${index}`).join(":");
		render(
			<EnvironmentReport
				capture={capture({ path })}
				view="redacted"
				failedSections={[]}
				onRetrySection={() => {}}
			/>,
		);

		expect(screen.getByText("12 entries")).toBeTruthy();
		expect(screen.getByText("/entry-0")).toBeTruthy();
		expect(screen.getByText("/entry-11")).toBeTruthy();
	});

	it("shows missing agents and a stopped sidecar", () => {
		render(
			<EnvironmentReport
				capture={capture({
					agents: [{ name: "codex", installed: false, version: null, path: null }],
					sidecar: { running: false, logPath: null },
				})}
				view="full"
				failedSections={[]}
				onRetrySection={() => {}}
			/>,
		);

		expect(screen.getByText("Not installed")).toBeTruthy();
		expect(screen.getByText("Not running")).toBeTruthy();
		expect(screen.getByText("Full values")).toBeTruthy();
	});
});
