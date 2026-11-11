/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the organisation switcher at the top of the sidebar: its trigger (the active entry's icon
 * and name) and its menu (this Mac and, on a paired Mac, the Worker marked "Cloud organization",
 * the data-privacy line, and Settings). Choosing an entry saves it in `active_organization`, which
 * decides where new workspaces run and which workspaces the lists show.
 * Behaviour: Conductor 0.92.1's switcher (renderApp `CRt` and `U9a` @10381031, its row in `R8a`
 * above Home): an "Account menu" button with the active organisation's icon, name and a chevron;
 * a 260px menu that lists the organisations when there is more than one, each with its icon and
 * name, the cloud mark ("Cloud organization" as a tooltip and as screen-reader text) and a check
 * on the active one; "Organizations are unavailable when enterprise data privacy is enabled."
 * while data privacy is on; then Settings. Choosing another organisation remembers the workspace
 * open in the one being left and reopens the last workspace of the one chosen.
 * Must handle: an unpaired Mac (one entry, so no list); a pairing not read yet (the trigger shows
 * this Mac); a failed save (a toast, and the choice stays as it was); choosing the active entry
 * (nothing happens).
 * Our design choice: Conductor's account email, single sign-on marks, "Create organization",
 * "Upgrade to Pro", "Log out", the copy-info context menus, its new-organisation callouts and its
 * Ctrl+1 to Ctrl+9 switch shortcuts belong to its accounts and teams, which this app leaves out
 * (D004, D025, D127). This Mac's entry is "My Mac", Conductor's name for a personal organisation
 * whose account has no name; the Worker's entry is its host name. The remembered workspace lives
 * while the sidebar is mounted.
 * Test first: choosing the cloud entry saves it and the sidebar lists that Worker's workspaces.
 */
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useRef } from "react";
import { useActions, useOrganizations, useSetting } from "../../core/hooks.ts";
import {
	CLOUD_ORGANIZATION_TEXT,
	LOCAL_ORGANIZATION,
	ORGANIZATIONS_UNAVAILABLE_WITH_DATA_PRIVACY,
	type Organization,
	type OrganizationId,
} from "../../core/organization.ts";
import {
	BuildingIcon,
	CheckIcon,
	ChevronDownIcon,
	CloudIcon,
	GearIcon,
	UserRoundIcon,
} from "../../ui/icons.tsx";
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuSeparator,
	MenuTrigger,
} from "../../ui/Menu.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

/** Conductor's switcher row: the nav rows' padding, gap and radius (renderApp `P9a`). */
const triggerClass =
	"flex h-8 w-full min-w-0 items-center gap-2 rounded-md p-1.5 text-left text-sm transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-expanded:bg-hover";

/** The workspace route a path names, for reopening it when its organisation is chosen again. */
type WorkspaceRoute = { repositoryId: string; workspaceId: string };
const WORKSPACE_PATH = /^\/repository\/([^/]+)\/workspace\/([^/]+)/;

function workspaceRouteOf(pathname: string): WorkspaceRoute | null {
	const match = WORKSPACE_PATH.exec(pathname);
	if (match === null) return null;
	const [, repositoryId = "", workspaceId = ""] = match;
	return { repositoryId, workspaceId };
}

/** An entry's mark: this Mac's round avatar, or an organisation's building. */
function OrganizationIcon({ organization }: { organization: Organization }) {
	if (organization.isCloud) return <BuildingIcon className="size-3.5 text-fg-muted" />;
	return (
		<span className="flex size-4 items-center justify-center rounded-full bg-muted text-fg-muted">
			<UserRoundIcon className="size-2.5" />
		</span>
	);
}

/** The cloud mark beside a cloud entry, with Conductor's tooltip and screen-reader text. */
function CloudMark() {
	return (
		<>
			<Tooltip content={CLOUD_ORGANIZATION_TEXT} side="right">
				<span className="inline-flex shrink-0 text-fg-muted">
					<CloudIcon className="size-3.5" />
				</span>
			</Tooltip>
			<span className="sr-only">{CLOUD_ORGANIZATION_TEXT}</span>
		</>
	);
}

export function OrganizationSwitcher() {
	const actions = useActions();
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const loaded = useOrganizations();
	const dataPrivacy = useSetting<boolean>("enterprise_data_privacy");
	const lastRoutes = useRef<Partial<Record<OrganizationId, WorkspaceRoute>>>({});
	const organizations = loaded.state === "ready" ? loaded.data.organizations : [LOCAL_ORGANIZATION];
	const active = loaded.state === "ready" ? loaded.data.active : LOCAL_ORGANIZATION;

	const choose = (organization: Organization) => {
		if (organization.id === active.id) return;
		const current = workspaceRouteOf(pathname);
		if (current !== null) lastRoutes.current[active.id] = current;
		void actions.settings.set("active_organization", organization.id).then((saved) => {
			if (!saved.ok) {
				toastError("Couldn't save the setting", saved.error);
				return;
			}
			const remembered = lastRoutes.current[organization.id];
			if (remembered === undefined) return;
			void navigate({
				to: "/repository/$repositoryId/workspace/$workspaceId",
				params: remembered,
				replace: true,
			});
		});
	};

	return (
		<Menu>
			<MenuTrigger aria-label="Account menu" className={triggerClass}>
				<span className="flex size-4 shrink-0 items-center justify-center">
					<OrganizationIcon organization={active} />
				</span>
				<span className="min-w-0 truncate font-medium text-sidebar-fg">{active.label}</span>
				<ChevronDownIcon className="size-3.5 shrink-0 text-sidebar-fg-muted" />
			</MenuTrigger>
			<MenuContent align="start" className="w-[260px]">
				{organizations.length > 1 ? (
					<>
						{organizations.map((organization) => (
							<MenuItem
								key={organization.id}
								icon={<OrganizationIcon organization={organization} />}
								onSelect={() => choose(organization)}
							>
								<span className="flex min-w-0 items-center gap-2">
									<span className="truncate">{organization.label}</span>
									{organization.isCloud ? <CloudMark /> : null}
									{organization.id === active.id ? (
										<CheckIcon className="ml-auto size-3.5 shrink-0" />
									) : null}
								</span>
							</MenuItem>
						))}
						<MenuSeparator />
					</>
				) : null}
				{dataPrivacy ? (
					<>
						<MenuLabel className="flex items-start gap-2 font-normal text-fg-muted">
							<BuildingIcon className="mt-0.5 size-3.5 shrink-0" />
							<span className="whitespace-normal text-xs">
								{ORGANIZATIONS_UNAVAILABLE_WITH_DATA_PRIVACY}
							</span>
						</MenuLabel>
						<MenuSeparator />
					</>
				) : null}
				<MenuItem icon={<GearIcon />} onSelect={() => void navigate({ to: "/settings" })}>
					Settings
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}
