import { appError, err, type WorkspaceId } from "@conducted/shared";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "../test/dom-polyfills.ts";
import { AppProviders, createQueryClient } from "../app/providers.tsx";
import { Button } from "./Button.tsx";
import {
	setCurrentWorkspace,
	Toaster,
	toast,
	toastError,
	workspaceToast,
	workspaceToastIds,
} from "./Toast.tsx";

afterEach(() => {
	cleanup();
	toast.dismiss();
	setCurrentWorkspace(null);
});

function toastClasses(text: string): string {
	const title = screen.getByText(text);
	return title.closest("[data-sonner-toast]")?.className ?? "";
}

describe("APP-05 toast host", () => {
	it("mounts exactly one toast host at the app root", async () => {
		render(
			<AppProviders client={createQueryClient(() => {})}>
				<div>App</div>
			</AppProviders>,
		);
		act(() => {
			toast.success("Mounted once");
		});
		expect(await screen.findByText("Mounted once")).toBeTruthy();
		expect(document.querySelectorAll("[data-sonner-toaster]")).toHaveLength(1);
	});
});

describe("APP-05 toast variants", () => {
	it("marks success, error and warning toasts with their tone class", async () => {
		render(<Toaster />);
		act(() => {
			toast.success("Saved");
			toast.error("Failed");
			toast.warning("Careful");
		});
		expect(await screen.findByText("Saved")).toBeTruthy();
		expect(toastClasses("Saved")).toContain("text-success");
		expect(toastClasses("Failed")).toContain("text-danger");
		expect(toastClasses("Careful")).toContain("text-warning");
	});
});

describe("APP-05 toast errors", () => {
	it("turns a failed Result into a toast with the failure's message", async () => {
		render(<Toaster />);
		const result = err(appError("save_failed", "Disk is full"));
		act(() => {
			if (!result.ok) toastError("Couldn't save the file", result.error);
		});
		expect(await screen.findByText("Couldn't save the file")).toBeTruthy();
		expect(screen.getByText("Disk is full")).toBeTruthy();
	});
});

describe("APP-05 workspace toasts", () => {
	it("shows a workspace toast before a workspace is open", async () => {
		setCurrentWorkspace(null);
		render(<Toaster />);
		act(() => {
			workspaceToast("w1" as WorkspaceId, "Before routing");
		});
		expect(await screen.findByText("Before routing")).toBeTruthy();
	});

	it("shows a workspace toast when the route has no workspace", async () => {
		render(<Toaster workspaceId={null} />);
		act(() => {
			workspaceToast("w1" as WorkspaceId, "No route workspace");
		});
		expect(await screen.findByText("No route workspace")).toBeTruthy();
	});

	it("releases the workspace claim when the toast auto-closes", async () => {
		render(<Toaster />);
		act(() => {
			workspaceToast("w1" as WorkspaceId, "Auto-closing", { duration: 30 });
		});
		expect(await screen.findByText("Auto-closing")).toBeTruthy();
		await waitFor(() => expect(workspaceToastIds()).toEqual([]), { timeout: 2000 });
	});
});

describe("APP-05 loading buttons", () => {
	it("keeps its own accessible name and reports busy instead of announcing the spinner", () => {
		render(<Button loading>Save draft</Button>);
		const button = screen.getByRole("button", { name: "Save draft" });
		expect(button.getAttribute("aria-busy")).toBe("true");
		expect(screen.queryByRole("status")).toBeNull();
	});
});
