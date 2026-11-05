/**
 * @feature RUN-07 Terminal output for the GetTerminalOutput tool
 * Owns: tests for the sidecar's getTerminalOutput request reaching the terminal output port.
 * Test first: the request's source and line count reach the port, and its result goes back.
 */
import { appError, err, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createSidecarRequestHandlers, type SidecarHandlerPorts } from "./handlers.ts";

const sessionId = "s1" as SessionId;

const ports = (outputForSession: SidecarHandlerPorts["terminalOutput"]["outputForSession"]) =>
	({
		terminalOutput: { outputForSession },
	}) as unknown as SidecarHandlerPorts;

describe("RUN-07 getTerminalOutput handler", () => {
	it("passes the session, source and line count to the terminals service", async () => {
		const outputForSession = vi.fn(async () => ({
			ok: true as const,
			value: { output: "dev server ready", source: "Action", running: true },
		}));
		const handlers = createSidecarRequestHandlers(ports(outputForSession));

		const result = await handlers.getTerminalOutput({
			sessionId,
			source: "run_script",
			maxLines: 250,
		});

		expect(outputForSession).toHaveBeenCalledWith(sessionId, "run_script", 250);
		expect(result).toEqual({ output: "dev server ready", source: "Action", running: true });
	});

	it("reports a real failed read as an RPC error, not as terminal output", async () => {
		const handlers = createSidecarRequestHandlers(
			ports(async () => err(appError("terminal_output_failed", "Couldn't read the terminal."))),
		);

		await expect(
			handlers.getTerminalOutput({
				sessionId,
				source: "auto",
				maxLines: 1000,
			}),
		).rejects.toThrow("Couldn't read the terminal.");
	});
});
