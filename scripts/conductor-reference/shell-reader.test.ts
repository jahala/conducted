import { describe, expect, test } from "bun:test";
import { type Output, runShellString, type ShellHost, tokenize } from "./shell-reader.ts";

interface Ran {
	program: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

/** A world with two answers, one folder and one executable, that records what it was asked. */
function world(answers: Record<string, Output>): { host: ShellHost; ran: Ran[]; made: string[] } {
	const ran: Ran[] = [];
	const made: string[] = [];
	const host: ShellHost = {
		run: async (command) => {
			ran.push(command);
			return answers[[command.program, ...command.args].join(" ")] ?? null;
		},
		stat: async (path) =>
			path === "/repo"
				? { isDirectory: true }
				: path === "/bin/tool"
					? { isDirectory: false }
					: null,
		mkdirp: async (path) => {
			made.push(path);
			return true;
		},
	};
	return { host, ran, made };
}

const session = () => ({ cwd: "/home", env: { HOME: "/home", PATH: "/bin" } });
const ok = (stdout: string): Output => ({ code: 0, stdout, stderr: "" });

describe("tokenize", () => {
	test("reads quotes, escapes and variables the way zsh does", () => {
		expect(tokenize(`cd "$HOME/a b" && echo 'it''s' \\$x`, { HOME: "/h" })).toEqual([
			{ kind: "word", text: "cd", bare: true },
			{ kind: "word", text: "/h/a b" },
			{ kind: "op", op: "&&" },
			{ kind: "word", text: "echo", bare: true },
			{ kind: "word", text: "its" },
			{ kind: "word", text: "$x", bare: true },
		]);
	});

	test("refuses what it cannot read exactly", () => {
		for (const source of ["ls | wc", "echo $(date)", "ls *.ts", "echo $UNSET", "echo `x`", "a &"]) {
			expect(tokenize(source, {})).toBeNull();
		}
	});
});

describe("runShellString", () => {
	test("runs a program in the folder `cd` names, with the exports in its environment", async () => {
		const { host, ran } = world({ "git branch --show-current": ok("main\n") });
		const out = await runShellString(
			"export PATH='/opt/bin' && cd '/repo' && git branch --show-current",
			session(),
			host,
		);
		expect(out).toEqual(ok("main\n"));
		expect(ran).toEqual([
			{
				program: "git",
				args: ["branch", "--show-current"],
				cwd: "/repo",
				env: { HOME: "/home", PATH: "/opt/bin" },
			},
		]);
	});

	test("`git -C` runs git in that folder", async () => {
		const { host, ran } = world({ "git status": ok("") });
		await runShellString("git -C /repo status", session(), host);
		expect(ran[0]?.cwd).toBe("/repo");
		expect(ran[0]?.args).toEqual(["status"]);
	});

	test("keeps the shell's exit status rules and redirections", async () => {
		const { host } = world({
			"tool --fail": { code: 2, stdout: "", stderr: "boom\n" },
			"tool --both": { code: 0, stdout: "out\n", stderr: "err\n" },
		});
		expect(await runShellString("tool --fail 2>/dev/null || echo '{}'", session(), host)).toEqual(
			ok("{}\n"),
		);
		expect(await runShellString("tool --fail || true", session(), host)).toEqual({
			code: 0,
			stdout: "",
			stderr: "boom\n",
		});
		expect(await runShellString("tool --fail && echo never", session(), host)).toEqual({
			code: 2,
			stdout: "",
			stderr: "boom\n",
		});
		expect(await runShellString("tool --both 2>&1", session(), host)).toEqual(ok("out\nerr\n"));
	});

	test("answers its built-ins without the world", async () => {
		const { host, ran, made } = world({});
		expect(await runShellString("unset PATH && env", session(), host)).toEqual(ok("HOME=/home\n"));
		expect(await runShellString("which tool", session(), host)).toEqual(ok("/bin/tool\n"));
		expect((await runShellString("command -v gt", session(), host))?.code).toBe(1);
		const probe = `A=1 zsh -lc 'printf "%s\\n" "--"; env; printf "%s\\n" "--"; exit'`;
		expect(await runShellString(probe, session(), host)).toEqual(
			ok("--\nHOME=/home\nPATH=/bin\nA=1\n--\n"),
		);
		expect(
			await runShellString("test -d /repo && test -x /bin/tool && echo yes", session(), host),
		).toEqual(ok("yes\n"));
		expect((await runShellString("[ -f /missing ]", session(), host))?.code).toBe(1);
		expect(await runShellString("mkdir -p /new/dir", session(), host)).toEqual(ok(""));
		expect(made).toEqual(["/new/dir"]);
		expect(ran).toEqual([]);
	});

	test("reads if blocks, groups and subshells", async () => {
		const { host, ran } = world({ "git status": ok("clean\n") });
		const script =
			"cd /repo || exit 1\nif [ -f missing ] || [ -L missing ]; then gt state; elif [ ! -d /nowhere ]; then git status; fi";
		expect(await runShellString(script, session(), host)).toEqual(ok("clean\n"));
		expect(ran[0]?.cwd).toBe("/repo");
		// A subshell's `cd` stays inside it; a `{ }` group's does not.
		await runShellString("(cd /repo) && git status", session(), host);
		expect(ran.at(-1)?.cwd).toBe("/home");
		await runShellString("{ cd /repo; } && git status", session(), host);
		expect(ran.at(-1)?.cwd).toBe("/repo");
		expect(
			await runShellString(
				"if git status; then echo yes; else echo no; fi 2>/dev/null",
				session(),
				host,
			),
		).toEqual(ok("clean\nyes\n"));
		expect(await runShellString("if true; then echo", session(), host)).toBeNull();
	});

	test("has no answer when any command it would run has none", async () => {
		const { host } = world({ "git status": ok("") });
		expect(await runShellString("git status && gt state", session(), host)).toBeNull();
		// A command the status rules skip is never asked.
		expect(await runShellString("git status || gt state", session(), host)).toEqual(ok(""));
	});
});
