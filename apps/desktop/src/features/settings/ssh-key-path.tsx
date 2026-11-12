/**
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Owns: Conductor's "SSH private key path" row on the Advanced page: the path field, the browse
 * button, the reset to the auto-generated key, and the check a chosen key passes before it is
 * saved.
 * Behaviour: the bundle's setting definition (`Ii` in renderApp-DeUrsznk.js, read 2026-11-07):
 * title "SSH private key path", description "Use your own SSH key for cloud workspace access.
 * Leave empty to auto-generate a key.", placeholder `~/.ssh/id_ed25519`, a folder button titled
 * "Browse for SSH key" whose picker is "Select SSH private key", and a trash button titled
 * "Reset to auto-generated key" while a path is set. `JFa` and `wrn`/`cEe`/`ib` in
 * main-BE1h_1MP.js expand `~`, read only `<path>.pub`, and answer "Custom SSH public key not found
 * at <path>.pub" when it is missing. `ssh_key_path` is a user-scope Advanced setting.
 * Must handle: an empty value (the auto-generated key, no reset button), a `~` path, a missing
 * private file or `.pub` half (Conductor's message, nothing saved), a key outside the app's file
 * folders such as `~/.ssh` (read through the shell, as Conductor reads it, issue #601), a check that
 * cannot run (its reason, never "not found"), a cancelled picker, and a failed save (the field goes
 * back to the stored value).
 * Our design choice: the check is core/ssh-key.ts `readCustomPublicKey`, which also needs the
 * private file; Conductor reads only the companion, but a key whose private half is gone cannot
 * open anything.
 * Test first: AdvancedPage.test.tsx, a missing `/keys/missing.pub` is refused with Conductor's
 * wording and settings.set is not called.
 */
import { useEffect, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions, useSetting } from "../../core/hooks.ts";
import { getSettingDef, pageDescriptionOf } from "../../core/registries/settings.ts";
import { expandSshKeyPath, readCustomPublicKey, SSH_KEY_PATH_SETTING } from "../../core/ssh-key.ts";
import type { Shell } from "../../platform/platform.ts";
import { Input } from "../../ui/Input.tsx";
import { FolderIcon, TrashIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";
import { SettingRow, useSettingSaves } from "./SettingRow.tsx";

/**
 * Conductor's problem for a custom key that cannot be used, or null for an empty or usable path.
 * The read is the one the cloud SSH service makes, so a key accepted here is a key it can use.
 */
async function sshKeyPathProblem(
	value: string,
	home: string,
	shell: Pick<Shell, "run">,
): Promise<string | null> {
	const text = value.trim();
	if (text === "") return null;
	const read = await readCustomPublicKey(shell, expandSshKeyPath(text, home), home);
	return read.ok ? null : read.error.message;
}

/** The icon-button style Conductor uses inside and beside the field. */
const iconButton =
	"flex size-6 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50";

/** One SSH key row, as Conductor lays it out on the Advanced page. */
export function SshKeyPathRow({ focusSettingKey }: { focusSettingKey: string | null }) {
	const def = getSettingDef(SSH_KEY_PATH_SETTING);
	const { platform } = useServices();
	const actions = useActions();
	const saves = useSettingSaves();
	const stored = useSetting<string>(SSH_KEY_PATH_SETTING);
	const [text, setText] = useState(stored);
	const [problem, setProblem] = useState<string | null>(null);
	useEffect(() => setText(stored), [stored]);
	if (def === undefined) return null;

	const check = (value: string) => sshKeyPathProblem(value, platform.fs.paths.home, platform.shell);

	const save = async (next: string) => {
		setProblem(null);
		const refused = await check(next);
		if (refused !== null) {
			setProblem(refused);
			setText(stored);
			return;
		}
		if (!(await saves.save(SSH_KEY_PATH_SETTING, next))) setText(stored);
	};

	const browse = async () => {
		const picked = await actions.app.pickFile("Select SSH private key");
		if (!picked.ok) {
			toastError("Couldn't open the file picker", picked.error);
			return;
		}
		if (picked.value !== null) await save(picked.value);
	};

	return (
		<SettingRow
			settingKey={SSH_KEY_PATH_SETTING}
			title={def.title}
			description={pageDescriptionOf(def)}
			disabledReason={null}
			highlighted={focusSettingKey === SSH_KEY_PATH_SETTING}
			saveError={problem}
			stacked
		>
			<div className="flex w-full items-center gap-1">
				<div className="relative min-w-0 flex-1">
					<Input
						aria-label={def.title}
						value={text}
						placeholder="~/.ssh/id_ed25519"
						className="w-full pr-8 font-mono text-xs"
						onChange={(event) => setText(event.target.value)}
						onBlur={() => {
							if (text !== stored) void save(text.trim());
						}}
					/>
					<button
						type="button"
						title="Browse for SSH key"
						className={`absolute top-1/2 right-1 -translate-y-1/2 ${iconButton}`}
						onClick={() => void browse()}
					>
						<FolderIcon className="size-3.5" />
					</button>
				</div>
				{stored === "" ? null : (
					<Tooltip content="Reset to auto-generated key">
						<button
							type="button"
							aria-label="Reset to auto-generated key"
							className={iconButton}
							onClick={() => void save("")}
						>
							<TrashIcon className="size-3.5" />
						</button>
					</Tooltip>
				)}
			</div>
		</SettingRow>
	);
}
