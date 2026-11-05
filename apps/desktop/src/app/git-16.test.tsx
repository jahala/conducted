import { appError, err, ok } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { createTestContainer } from "../test/container.ts";
import { Toaster, toast } from "../ui/Toast.tsx";
import { XcodeLicenseNotice } from "./xcode-license-notice.ts";

afterEach(() => {
	cleanup();
	toast.dismiss();
});

describe("GIT-16 Xcode licence notice", () => {
	it("explains the blocked licence for 15 seconds and offers the fix", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.scriptShell((command) => {
				if (command.program === "xcodebuild") {
					return ok({
						exitCode: 1,
						stdout: "",
						stderr: "You have not agreed to the Xcode license agreements.",
					});
				}
				if (command.program === "osascript") {
					return ok({ exitCode: 0, stdout: "", stderr: "" });
				}
				return null;
			});

			render(
				<ServicesProvider container={test.container}>
					<XcodeLicenseNotice />
					<Toaster />
				</ServicesProvider>,
			);

			expect(await screen.findByText("Xcode license is not accepted")).toBeTruthy();
			expect(
				screen.getByText("Run `sudo xcodebuild -license accept` in terminal to continue"),
			).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Run for me" }));

			await waitFor(() =>
				expect(
					test.memory.controls.shellCalls.some(
						(command) =>
							command.program === "osascript" &&
							command.args.includes('do script "sudo xcodebuild -license accept"'),
					),
				).toBe(true),
			);
		} finally {
			test.close();
		}
	});

	it("says nothing when the licence is accepted", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.scriptShell((command) =>
				command.program === "xcodebuild" ? ok({ exitCode: 0, stdout: "", stderr: "" }) : null,
			);

			render(
				<ServicesProvider container={test.container}>
					<XcodeLicenseNotice />
					<Toaster />
				</ServicesProvider>,
			);

			await waitFor(() =>
				expect(
					test.memory.controls.shellCalls.some((command) => command.program === "xcodebuild"),
				).toBe(true),
			);
			expect(screen.queryByText("Xcode license is not accepted")).toBeNull();
		} finally {
			test.close();
		}
	});

	it("logs a probe that cannot run instead of hiding it", async () => {
		const test = createTestContainer();
		try {
			test.memory.controls.scriptShell((command) =>
				command.program === "xcodebuild"
					? err(appError("process_spawn", "xcodebuild is not installed"))
					: null,
			);

			render(
				<ServicesProvider container={test.container}>
					<XcodeLicenseNotice />
					<Toaster />
				</ServicesProvider>,
			);

			await waitFor(() =>
				expect(
					test.memory.controls.logs.some(
						(line) => line.message === "Could not check the Xcode license",
					),
				).toBe(true),
			);
			expect(screen.queryByText("Xcode license is not accepted")).toBeNull();
		} finally {
			test.close();
		}
	});
});
