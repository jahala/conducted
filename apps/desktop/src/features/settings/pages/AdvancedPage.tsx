/**
 * @feature SET-02 Advanced settings page
 * Owns: the Advanced page of Settings: where files live, agent program paths, and terminal
 * history size.
 * Behaviour: ui-map.md 6, "Advanced" table; services-map.md 4.2.3. The "set upstream on plain
 * push" row stays on the Git page (one home per setting). Rows come from the settings registry
 * (SET-01).
 * Our design choice: a program path is checked against the file system before it is saved. An
 * invalid path is refused with a reason, so a saved path is always a path that exists.
 * Must handle: a path that does not exist, an empty value meaning the bundled program, and a root
 * folder change that asks for confirmation first.
 * Test first: saving a non-existent program path shows the error and does not call settings.set.
 */
import { useState } from "react";
import { useServices } from "../../../core/context.tsx";
import { useActions, useSetting } from "../../../core/hooks.ts";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { toast, toastError } from "../../../ui/Toast.tsx";
import { RegistrySettingRows, SettingRow, useSettingSaves } from "../SettingRow.tsx";
import { SettingsPageFrame } from "../SettingsPageFrame.tsx";

const ROOT_PATH_KEY = "conducted_root_path";

export function AdvancedPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const { platform } = useServices();
	const actions = useActions();
	const saves = useSettingSaves();
	const rootPath = useSetting<string>(ROOT_PATH_KEY);
	const [pendingRoot, setPendingRoot] = useState<string | null>(null);
	const rootDef = getSettingDef(ROOT_PATH_KEY);

	const chooseRoot = async () => {
		const picked = await actions.app.pickFolder("Choose the root folder");
		if (!picked.ok) {
			toastError("Couldn't open the folder picker", picked.error);
			return;
		}
		if (picked.value !== null) setPendingRoot(picked.value);
	};

	const saveRoot = async () => {
		const next = pendingRoot;
		setPendingRoot(null);
		if (next === null) return;
		const saved = await saves.save(ROOT_PATH_KEY, next);
		if (saved) toast("Conductor root path changed successfully");
	};

	return (
		<SettingsPageFrame
			title="Advanced"
			description="Where the app keeps its data, which programs it runs, and how much terminal history it keeps."
			state="ready"
			errorMessage={null}
			onRetry={() => undefined}
			focusSettingKey={focusSettingKey}
		>
			<SettingRow
				settingKey={ROOT_PATH_KEY}
				title={rootDef?.title ?? "Root folder"}
				description={
					rootDef?.description ??
					"Where the app keeps cloned repositories and workspaces. Use an empty folder you do not edit by hand."
				}
				scope="user"
				disabledReason={null}
				highlighted={focusSettingKey === ROOT_PATH_KEY}
				saveError={saves.errorOf(ROOT_PATH_KEY)}
			>
				<div className="flex items-center gap-2">
					<Input
						aria-label="Root folder"
						value={rootPath}
						readOnly
						className="w-64 font-mono text-xs"
					/>
					<Button variant="secondary" onClick={() => void chooseRoot()}>
						Choose folder
					</Button>
				</div>
			</SettingRow>

			<RegistrySettingRows
				page="advanced"
				focusSettingKey={focusSettingKey}
				exclude={[ROOT_PATH_KEY]}
				beforeSave={async (def, value) => {
					if (!def.key.endsWith("_executable_path")) return null;
					const text = typeof value === "string" ? value.trim() : "";
					if (text === "") return null;
					const exists = await platform.fs.exists(text);
					return exists ? null : `No program exists at ${text}.`;
				}}
			/>

			<AlertDialog
				open={pendingRoot !== null}
				onOpenChange={(open) => {
					if (!open) setPendingRoot(null);
				}}
			>
				<AlertDialogContent
					title="Change root path?"
					description="New repositories and workspaces will use the new folder. Existing ones stay where they are."
					confirmLabel="Change root path"
					onConfirm={() => void saveRoot()}
				/>
			</AlertDialog>
		</SettingsPageFrame>
	);
}
