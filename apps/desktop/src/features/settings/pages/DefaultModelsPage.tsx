/**
 * @feature SET-02 Default models settings page
 * Owns: the Default models page of Settings: which model new chats start with, fast mode, plan
 * mode and the effort and personality defaults. Review defaults are rows from the registry too.
 * Behaviour: ui-map.md 6, "Default models" table; services-map.md 4.2.3 (models and providers).
 * Data: useModels("claude") for the models this app starts chats with, useAgentInstalls() to say
 * when the program is missing, useSetting and useSettingSaves for the stored values.
 * Must handle: models loading (the picker is disabled), no installed Claude program (the page
 * says so), and a chosen model that does not support fast mode (the fast mode switch is disabled
 * with the reason).
 * Test first: picking a model without fast mode support disables the fast mode toggle.
 */
import { useAgentInstalls, useModels, useSetting } from "../../../core/hooks.ts";
import { getSettingDef } from "../../../core/registries/settings.ts";
import { Select } from "../../../ui/Select.tsx";
import { Skeleton } from "../../../ui/Skeleton.tsx";
import { Switch } from "../../../ui/Switch.tsx";
import { RegistrySettingRows, SettingRow, useSettingSaves } from "../SettingRow.tsx";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

const MODEL_KEY = "default_model";
const FAST_MODE_KEY = "default_fast_mode";

export function DefaultModelsPage({ focusSettingKey = null }: { focusSettingKey?: string | null }) {
	const load = useSettingsLoad();
	const models = useModels("claude");
	const installs = useAgentInstalls();
	const saves = useSettingSaves();
	const storedModel = useSetting<string>(MODEL_KEY);
	const fastMode = useSetting<boolean>(FAST_MODE_KEY);
	const modelDef = getSettingDef(MODEL_KEY);
	const fastDef = getSettingDef(FAST_MODE_KEY);

	const list = models.state === "ready" ? models.data : [];
	const selected =
		list.find((model) => model.id === storedModel) ?? list.find((model) => model.isDefault);
	const supportsFastMode = selected?.supportsFastMode ?? true;
	const claudeInstalled =
		installs.state === "ready" &&
		installs.data.some((install) => install.agent === "claude" && install.installed);

	return (
		<SettingsPageFrame
			title="Default models"
			description="The model and options a new chat starts with."
			{...load}
			focusSettingKey={focusSettingKey}
		>
			{installs.state === "ready" && !claudeInstalled ? (
				<p className="pb-2 text-sm text-fg-muted">
					No Claude Code program was found. Install it on the Agents page, then come back.
				</p>
			) : null}

			<SettingRow
				settingKey={MODEL_KEY}
				title={modelDef?.title ?? "Default model"}
				description={modelDef?.description ?? null}
				scope="user"
				disabledReason={models.state === "error" ? models.error.message : null}
				highlighted={focusSettingKey === MODEL_KEY}
				saveError={saves.errorOf(MODEL_KEY)}
			>
				{models.state === "loading" ? (
					<Skeleton className="h-8 w-48" />
				) : (
					<Select
						aria-label="Default model"
						value={storedModel}
						options={[
							{ value: "", label: "First available model" },
							...list.map((model) => ({ value: model.id, label: model.label })),
						]}
						onValueChange={(modelId) => void saves.save(MODEL_KEY, modelId)}
					/>
				)}
			</SettingRow>

			<SettingRow
				settingKey={FAST_MODE_KEY}
				title={fastDef?.title ?? "Fast mode in new chats"}
				description={fastDef?.description ?? null}
				scope="user"
				disabledReason={supportsFastMode ? null : "The chosen model does not support fast mode."}
				highlighted={focusSettingKey === FAST_MODE_KEY}
				saveError={saves.errorOf(FAST_MODE_KEY)}
			>
				<Switch
					aria-label={fastDef?.title ?? "Fast mode in new chats"}
					checked={fastMode}
					onCheckedChange={(checked) => void saves.save(FAST_MODE_KEY, checked)}
				/>
			</SettingRow>

			<RegistrySettingRows
				page="models"
				focusSettingKey={focusSettingKey}
				exclude={[MODEL_KEY, FAST_MODE_KEY]}
			/>
		</SettingsPageFrame>
	);
}
