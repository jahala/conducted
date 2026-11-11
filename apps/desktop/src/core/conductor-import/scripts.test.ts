// @vitest-environment node
import { describe, expect, it } from "vitest";
import { conductorNameLines, renameConductorNames, scriptFileCandidates } from "./scripts.ts";

/** A shell variable in braces, written without a template placeholder Biome would flag. */
const braced = (name: string): string => ["$", "{", name, "}"].join("");

describe("APP-17 repository scripts from Conductor", () => {
	it("echo $CONDUCTOR_PORT becomes echo $CONDUCTED_PORT with one rename listed", () => {
		const renamed = renameConductorNames({
			values: { setup_script: `echo $CONDUCTOR_PORT && echo ${braced("CONDUCTOR_PORT")}` },
			actions: [],
		});
		expect(renamed.scripts.values.setup_script).toBe(
			`echo $CONDUCTED_PORT && echo ${braced("CONDUCTED_PORT")}`,
		);
		expect(renamed.renames).toEqual([
			{ from: "CONDUCTOR_PORT", to: "CONDUCTED_PORT", setByConducted: true },
		]);
	});

	it("renames names in run actions and marks a name Conducted does not set", () => {
		const renamed = renameConductorNames({
			values: { run_script_mode: "nonconcurrent" },
			actions: [
				{
					id: "dev",
					command: "serve --root $CONDUCTOR_ROOT_PATH",
					args: ["--user", "$CONDUCTOR_USER_ID", "$CONDUCTOR_PORT_X"],
					cwd: "$CONDUCTOR_WORKSPACE_PATH/app",
				},
			],
		});
		expect(renamed.scripts.actions[0]).toEqual({
			id: "dev",
			command: "serve --root $CONDUCTED_ROOT_PATH",
			args: ["--user", "$CONDUCTED_USER_ID", "$CONDUCTED_PORT_X"],
			cwd: "$CONDUCTED_WORKSPACE_PATH/app",
		});
		expect(renamed.scripts.values.run_script_mode).toBe("nonconcurrent");
		expect(renamed.renames.map((rename) => [rename.to, rename.setByConducted])).toEqual([
			["CONDUCTED_ROOT_PATH", true],
			["CONDUCTED_USER_ID", false],
			["CONDUCTED_PORT_X", false],
			["CONDUCTED_WORKSPACE_PATH", true],
		]);
	});

	it("names the repository files the scripts run, and none outside the repository", () => {
		expect(
			scriptFileCandidates({
				values: {
					setup_script: "./scripts/setup.sh --fast && bash bin/build; make",
					archive_script: "cleanup.sh ../outside.sh /etc/hosts $HOME/x.sh 'tools/run'",
				},
				actions: [{ id: "dev", command: "node", args: ["server/main.js"] }],
			}),
		).toEqual(["scripts/setup.sh", "bin/build", "cleanup.sh", "tools/run", "server/main.js"]);
	});

	it("finds each line that reads a CONDUCTOR_ name", () => {
		expect(
			conductorNameLines(
				'#!/bin/sh\necho $CONDUCTOR_PORT $CONDUCTOR_PORT\ncd "$CONDUCTOR_ROOT_PATH"\n',
			),
		).toEqual([
			{ line: 2, name: "CONDUCTOR_PORT", newName: "CONDUCTED_PORT" },
			{ line: 3, name: "CONDUCTOR_ROOT_PATH", newName: "CONDUCTED_ROOT_PATH" },
		]);
	});
});
