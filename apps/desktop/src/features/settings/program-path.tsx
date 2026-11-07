/**
 * @feature SET-02 Agent program path rows
 * Owns: the Advanced page's program path rows (Conductor's executable path field, renderApp $Gt
 * @10968813): the path under the row's text at full width in mono, the placeholder
 * `/usr/local/bin/<program>`, a folder button inside the field ("Browse for executable", which asks
 * for one file titled "Select <program> executable"), a reset button while a path is set ("Reset to
 * bundled <program>"), and the warning under a custom path; and the check a path passes before it
 * is saved.
 * Behaviour: ui-map.md 6, "Advanced" and "Agents"; the warning is Conductor's (renderApp @10971526).
 * Must handle: an empty value (the bundled program, no warning and no check), a path that does not
 * exist (refused with its reason, and the field shows the stored value again), a cancelled picker
 * (nothing changes), a picker that cannot open (a toast), and a setting that is not a program path
 * (left alone by the check).
 * As Conductor does (renderApp QFa and $Gt), each row looks its program up on the login shell's
 * PATH with `which`. A program found there is the field's placeholder and is offered as "Use system
 * <program>" while no path is set, with the found path as its tooltip; choosing it saves that path,
 * through the same check as a typed one. The app still runs only the program the user chose (D088):
 * the lookup only offers it.
 * Our design choice: a lookup that fails offers no button, as a program not found does; it is an
 * offer, not a value the user relies on.
 * Test first: AdvancedPage.test.tsx, a path that does not exist is refused and not saved.
 */
import { type ReactNode, useEffect, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions, useSetting } from "../../core/hooks.ts";
import {
	getSettingDef,
	pageDescriptionOf,
	type SettingDef,
	type SettingValue,
} from "../../core/registries/settings.ts";
import { Button } from "../../ui/Button.tsx";
import { Input } from "../../ui/Input.tsx";
import { CloseIcon, FolderIcon, TriangleAlertIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { SettingRow, useSettingSaves } from "./SettingRow.tsx";

const isProgramPath = (def: SettingDef): boolean => def.key.endsWith("_executable_path");

/** Refuses a program path that does not exist; any other value passes. */
function programPathCheck(exists: (path: string) => Promise<boolean>) {
	return async (def: SettingDef, value: SettingValue): Promise<string | null> => {
		if (!isProgramPath(def)) return null;
		const text = typeof value === "string" ? value.trim() : "";
		if (text === "") return null;
		return (await exists(text)) ? null : `No program exists at ${text}.`;
	};
}

/** Conductor's warning under a custom program path, with its alert icon. */
function programPathWarning(def: SettingDef, value: SettingValue): ReactNode {
	if (!isProgramPath(def) || typeof value !== "string" || value.trim() === "") return null;
	return (
		<div className="mt-1 flex items-start gap-2 text-xs text-warning">
			<TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
			<p>Changing this may cause issues if the executable is not compatible with Conducted.</p>
		</div>
	);
}

/** The program path settings of the Advanced page, in Conductor's order, with their names. */
export const PROGRAM_PATHS = [
	{ key: "claude_executable_path", label: "Claude Code", binary: "claude" },
	{ key: "codex_executable_path", label: "Codex", binary: "codex" },
	{ key: "opencode_executable_path", label: "OpenCode", binary: "opencode" },
] as const;

/**
 * The program `binary` on the login shell's PATH, as `which` finds it, or null when it is not there.
 * Only the newest answer is kept.
 */
function useSystemProgramPath(binary: string): string | null {
	const { platform } = useServices();
	const [found, setFound] = useState<string | null>(null);
	useEffect(() => {
		let current = true;
		const look = async () => {
			const ran = await platform.shell.run({
				program: "which",
				args: [binary],
				cwd: platform.fs.paths.home,
				timeoutMs: 5_000,
			});
			if (!current) return;
			const path = ran.ok && ran.value.exitCode === 0 ? ran.value.stdout.trim() : "";
			setFound(path === "" ? null : path);
		};
		void look();
		return () => {
			current = false;
		};
	}, [platform, binary]);
	return found;
}

/** One program path row, as Conductor lays it out. */
export function ProgramPathRow({
	settingKey,
	label,
	binary,
	focusSettingKey,
}: {
	settingKey: string;
	label: string;
	binary: string;
	focusSettingKey: string | null;
}) {
	const def = getSettingDef(settingKey);
	const { platform } = useServices();
	const actions = useActions();
	const saves = useSettingSaves();
	const stored = useSetting<string>(settingKey);
	const [text, setText] = useState(stored);
	const [problem, setProblem] = useState<string | null>(null);
	const systemPath = useSystemProgramPath(binary);
	useEffect(() => setText(stored), [stored]);
	if (def === undefined) return null;
	const check = programPathCheck((path) => platform.fs.exists(path));

	const save = async (next: string) => {
		setProblem(null);
		const refused = await check(def, next);
		if (refused !== null) {
			setProblem(refused);
			setText(stored);
			return;
		}
		if (!(await saves.save(settingKey, next))) setText(stored);
	};

	const browse = async () => {
		const picked = await actions.app.pickFile(`Select ${label} executable`);
		if (!picked.ok) {
			toastError("Couldn't open the file picker", picked.error);
			return;
		}
		if (picked.value !== null) await save(picked.value);
	};

	const iconButton =
		"flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50";
	return (
		<SettingRow
			settingKey={settingKey}
			title={def.title}
			description={pageDescriptionOf(def)}
			disabledReason={null}
			highlighted={focusSettingKey === settingKey}
			saveError={problem ?? saves.errorOf(settingKey)}
			stacked
		>
			<div className="flex w-full flex-col">
				<div className="flex w-full items-center gap-2">
					<div className="relative min-w-0 flex-1">
						<Input
							aria-label={def.title}
							value={text}
							placeholder={systemPath ?? `/usr/local/bin/${binary}`}
							className="w-full pr-8 font-mono text-xs"
							onChange={(event) => setText(event.target.value)}
							onBlur={() => {
								if (text !== stored) void save(text.trim());
							}}
						/>
						<button
							type="button"
							title="Browse for executable"
							className={`absolute top-1/2 right-1 -translate-y-1/2 ${iconButton}`}
							onClick={() => void browse()}
						>
							<FolderIcon className="size-3.5" />
						</button>
					</div>
					{stored === "" ? null : (
						<Tooltip content={`Reset to bundled ${label}`}>
							<button
								type="button"
								aria-label={`Reset to bundled ${label}`}
								className={iconButton}
								onClick={() => void save("")}
							>
								<CloseIcon className="size-3.5" />
							</button>
						</Tooltip>
					)}
					{systemPath !== null && stored === "" ? (
						<Tooltip content={systemPath}>
							<Button
								variant="outline"
								size="sm"
								className="shrink-0"
								onClick={() => void save(systemPath)}
							>
								Use system {label}
							</Button>
						</Tooltip>
					) : null}
				</div>
				{programPathWarning(def, stored)}
			</div>
		</SettingRow>
	);
}
