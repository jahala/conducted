/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Owns: the request bodies the routes accept, and the checks each one gets before it reaches the
 * sandbox.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (the host seam's git, shell and file calls and
 * the sidecar relay reach the Worker) and services-map.md 1.2 (a shell command is a program and
 * its arguments, never a shell string).
 * Must handle: an absolute path inside the sandbox, a program and argument without NUL bytes, a
 * file body that carries text or base64 bytes (CLOUD-11), and a timeout that catches a hang rather
 * than slowness. Relative file paths are refused because a
 * sandbox has no session working directory.
 * Our design choice: `exec` runs an argv, the same shape the Platform's Shell takes, so the desktop
 * can hand its own commands over unchanged. Git is a separate route because it is the call the
 * host seam makes most and its body names the arguments only.
 * Test first: a relative file path and an empty program are refused before the container is
 * touched.
 */
import { z } from "zod";

const noNul = (value: string): boolean => !value.includes("\u0000");

const absolutePath = z
	.string()
	.min(1)
	.refine((path) => path.startsWith("/") && noNul(path), {
		message: "A sandbox path must be absolute and hold no NUL byte.",
	});

const argument = z.string().refine(noNul, { message: "An argument holds no NUL byte." });

/** Longest a single command may run. A timeout catches a hang, not a slow build. */
export const MAX_TIMEOUT_MS = 10 * 60 * 1000;

export const zGitBody = z
	.object({
		args: z.array(argument),
		cwd: absolutePath,
	})
	.strict();
export type GitBody = z.infer<typeof zGitBody>;

export const zExecBody = z
	.object({
		program: z.string().min(1).refine(noNul, { message: "A program holds no NUL byte." }),
		args: z.array(argument),
		cwd: absolutePath,
		env: z.record(z.string(), z.string()).optional(),
		stdin: z.string().optional(),
		timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
	})
	.strict();
export type ExecBody = z.infer<typeof zExecBody>;

export const zPreviewBody = z.object({ port: z.number().int().min(1).max(65_535) }).strict();
export type PreviewBody = z.infer<typeof zPreviewBody>;

/**
 * One SSH public key, one line. The Worker installs it as root's authorized key in the sandbox;
 * a private key, a second key on another line and free text are all refused before the sandbox is
 * touched.
 */
export const SSH_PUBLIC_KEY =
	/^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,2}(?: [^\r\n]*)?$/;

export const zSshKeyBody = z
	.object({
		publicKey: z
			.string()
			.min(1)
			.max(4_096)
			.refine((key) => SSH_PUBLIC_KEY.test(key), {
				message: "The SSH key must be one public key on one line.",
			}),
	})
	.strict();
export type SshKeyBody = z.infer<typeof zSshKeyBody>;

export const zFileBody = z.discriminatedUnion("operation", [
	z.object({ operation: z.literal("read"), path: absolutePath }).strict(),
	z.object({ operation: z.literal("readBytes"), path: absolutePath }).strict(),
	z.object({ operation: z.literal("write"), path: absolutePath, text: z.string() }).strict(),
	z.object({ operation: z.literal("writeBytes"), path: absolutePath, base64: z.string() }).strict(),
	z.object({ operation: z.literal("exists"), path: absolutePath }).strict(),
	z.object({ operation: z.literal("stat"), path: absolutePath }).strict(),
	z.object({ operation: z.literal("readDir"), path: absolutePath }).strict(),
	z.object({ operation: z.literal("list"), path: absolutePath }).strict(),
	z.object({ operation: z.literal("mkdirp"), path: absolutePath }).strict(),
	z.object({ operation: z.literal("trash"), path: absolutePath }).strict(),
]);
export type FileBody = z.infer<typeof zFileBody>;

/** The shape every route answers with when a body is not what it accepts. */
export const INVALID_BODY = "Invalid request body";

/** A workspace's name in a route: what a Durable Object name may be. */
export const WORKSPACE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
