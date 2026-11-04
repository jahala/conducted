import { appError, NotImplemented, notImplemented } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../core/api.ts";
import { ErrorBoundary } from "./ErrorBoundary.tsx";
import { LoadableView } from "./LoadableView.tsx";
import { NotBuiltYet } from "./not-built-yet.tsx";

afterEach(cleanup);

function Boom({ message }: { message: string }): never {
	throw new Error(message);
}

const flaky = { shouldThrow: true };

function Flaky() {
	if (flaky.shouldThrow) throw new Error("render failed");
	return <p>recovered</p>;
}

function Missing({ id }: { id: string }): never {
	return notImplemented(id);
}

describe("NotBuiltYet", () => {
	it("shows the feature id of a placeholder", () => {
		render(
			<NotBuiltYet area="Chat">
				<Missing id="CHAT-06" />
			</NotBuiltYet>,
		);
		expect(screen.getByText("Chat")).toBeTruthy();
		expect(screen.getByText("Not built yet: CHAT-06")).toBeTruthy();
	});

	it("shows a generic message for any other error and logs it", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		render(
			<NotBuiltYet area="Chat">
				<Boom message="x" />
			</NotBuiltYet>,
		);
		expect(screen.getByText("This part failed to load.")).toBeTruthy();
		expect(log).toHaveBeenCalled();
		log.mockRestore();
	});

	it("renders its children when nothing throws", () => {
		render(
			<NotBuiltYet area="Chat">
				<p>fine</p>
			</NotBuiltYet>,
		);
		expect(screen.getByText("fine")).toBeTruthy();
	});

	it("tries again when resetKey changes", () => {
		const { rerender } = render(
			<NotBuiltYet area="Workspace" resetKey="a">
				<Missing id="WS-01" />
			</NotBuiltYet>,
		);
		expect(screen.getByText("Not built yet: WS-01")).toBeTruthy();
		rerender(
			<NotBuiltYet area="Workspace" resetKey="b">
				<p>loaded</p>
			</NotBuiltYet>,
		);
		expect(screen.getByText("loaded")).toBeTruthy();
	});

	it("offers to close an overlay that is not built", () => {
		const onDismiss = vi.fn();
		render(
			<NotBuiltYet area="Passport" variant="overlay" onDismiss={onDismiss}>
				<Missing id="NAV-13" />
			</NotBuiltYet>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("shows one line for the inline variant", () => {
		render(
			<NotBuiltYet area="Updates" variant="inline">
				<Missing id="APP-06" />
			</NotBuiltYet>,
		);
		expect(screen.getByRole("status").textContent).toBe("Updates: Not built yet: APP-06");
	});
});

describe("ErrorBoundary", () => {
	it("shows the fallback with the error and clears it on reset", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		flaky.shouldThrow = true;
		render(
			<ErrorBoundary
				fallback={(error, reset) => (
					<button type="button" onClick={reset}>
						{error.message}
					</button>
				)}
			>
				<Flaky />
			</ErrorBoundary>,
		);
		flaky.shouldThrow = false;
		fireEvent.click(screen.getByRole("button", { name: "render failed" }));
		expect(screen.getByText("recovered")).toBeTruthy();
		log.mockRestore();
	});

	it("clears the error when resetKey changes", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const { rerender } = render(
			<ErrorBoundary fallback={() => <p>broken</p>} resetKey="a">
				<Boom message="x" />
			</ErrorBoundary>,
		);
		expect(screen.getByText("broken")).toBeTruthy();
		rerender(
			<ErrorBoundary fallback={() => <p>broken</p>} resetKey="b">
				<p>next tab</p>
			</ErrorBoundary>,
		);
		expect(screen.getByText("next tab")).toBeTruthy();
		log.mockRestore();
	});

	it("leaves NotImplemented errors to the NotBuiltYet boundary above", () => {
		render(
			<NotBuiltYet area="Tab">
				<ErrorBoundary fallback={() => <p>generic card</p>}>
					<Missing id="REV-08" />
				</ErrorBoundary>
			</NotBuiltYet>,
		);
		expect(screen.getByText("Not built yet: REV-08")).toBeTruthy();
		expect(screen.queryByText("generic card")).toBeNull();
		expect(new NotImplemented("X").featureId).toBe("X");
	});
});

describe("LoadableView", () => {
	const view = (value: Loadable<string[]>, onRetry?: () => void) =>
		render(
			<LoadableView
				value={value}
				loadingLabel="Loading workspaces"
				errorTitle="Couldn't load workspaces"
				onRetry={onRetry}
			>
				{(rows) => <p>{rows.length} rows</p>}
			</LoadableView>,
		);

	it("announces loading", () => {
		view({ state: "loading" });
		expect(screen.getByRole("status", { name: "Loading workspaces" })).toBeTruthy();
	});

	it("wraps a custom loading element as a status region", () => {
		render(
			<LoadableView
				value={{ state: "loading" }}
				loadingLabel="Loading workspaces"
				loading={<p>skeleton</p>}
				errorTitle="x"
			>
				{() => null}
			</LoadableView>,
		);
		expect(screen.getByRole("status", { name: "Loading workspaces" }).textContent).toBe("skeleton");
	});

	it("shows the error message with a retry that works", () => {
		const onRetry = vi.fn();
		view({ state: "error", error: appError("db", "Database is locked") }, onRetry);
		expect(screen.getByText("Couldn't load workspaces")).toBeTruthy();
		expect(screen.getByText("Database is locked")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("offers no retry when none is given", () => {
		view({ state: "error", error: appError("db", "Nope") });
		expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
	});

	it("renders children with the data", () => {
		view({ state: "ready", data: ["a", "b"] });
		expect(screen.getByText("2 rows")).toBeTruthy();
	});
});
