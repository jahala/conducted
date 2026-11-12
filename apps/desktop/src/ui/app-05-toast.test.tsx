import { appError, err, type WorkspaceId } from "@conducted/shared";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("APP-05 how long a toast shows", () => {
	// Conductor's toaster closes a toast after 5 seconds unless the toast sets its own time
	// (renderApp @614279, M4i = 5e3; its Toaster gets only a theme, @11706792).
	it("keeps a toast for 5 seconds, as Conductor's toaster does", () => {
		vi.useFakeTimers();
		try {
			render(<Toaster />);
			act(() => {
				toast.error("Failed to save setting");
			});
			act(() => {
				vi.advanceTimersByTime(4_900);
			});
			expect(screen.getByText("Failed to save setting")).toBeTruthy();
			// Past 5 seconds it closes, and sonner unmounts it after its exit animation.
			act(() => {
				vi.advanceTimersByTime(1_000);
			});
			expect(screen.queryByText("Failed to save setting")).toBeNull();
		} finally {
			vi.useRealTimers();
		}
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

describe("APP-05 toast descriptions", () => {
	// Conductor's toast keeps a description's line breaks (renderApp CSS, white-space: pre-line).
	it("keeps the line breaks of a description, as Conductor's toast does", async () => {
		render(<Toaster />);
		act(() => {
			toast.error("Can't save setting because your settings file is invalid", {
				description: "line one\nline two",
			});
		});
		const description = await screen.findByText(/line one/);
		expect(description.className.split(" ")).toContain("whitespace-pre-line");
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

	it("does not show a workspace toast while another workspace is open", async () => {
		render(<Toaster workspaceId={"w2" as WorkspaceId} />);
		let shown: string | null = "unset";
		act(() => {
			shown = workspaceToast("w1" as WorkspaceId, "For w1 only");
		});
		expect(shown).toBeNull();
		expect(screen.queryByText("For w1 only")).toBeNull();
		expect(workspaceToastIds()).toEqual([]);
	});

	it("dismisses a workspace toast when the user moves to another workspace", async () => {
		render(<Toaster />);
		setCurrentWorkspace("w1" as WorkspaceId);
		act(() => {
			workspaceToast("w1" as WorkspaceId, "Leaving w1", { duration: 60_000 });
		});
		expect(await screen.findByText("Leaving w1")).toBeTruthy();
		expect(workspaceToastIds()).toHaveLength(1);
		act(() => {
			setCurrentWorkspace("w2" as WorkspaceId);
		});
		await waitFor(() => expect(screen.queryByText("Leaving w1")).toBeNull());
		expect(workspaceToastIds()).toEqual([]);
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
