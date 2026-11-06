/**
 * @feature APP-05 Icons
 * Owns: the small set of 16px line icons the shell uses. They inherit the text colour.
 * Behaviour: ui-map.md 8 (Conductor uses Lucide and Material file icons).
 * Our design choice: a few hand-drawn line icons instead of an icon library. A file-type icon set for the
 * file tree is a separate decision for the git-panel owner.
 * Must handle: decorative by default (aria-hidden); the button that holds an icon carries the accessible name.
 * The status, git and tool-card families cover the marks those rows need; the file-type set in the file tree
 * remains a separate decision, as noted above.
 * Test first: every icon renders an svg with aria-hidden.
 */
import type { SVGProps } from "react";

function Icon({ d, ...rest }: SVGProps<SVGSVGElement> & { d: string }) {
	return (
		<svg
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			{...rest}
		>
			<path d={d} />
		</svg>
	);
}

type P = SVGProps<SVGSVGElement>;

export const SidebarLeftIcon = (p: P) => <Icon d="M2.5 3.5h11v9h-11zM6 3.5v9" {...p} />;
export const SidebarRightIcon = (p: P) => <Icon d="M2.5 3.5h11v9h-11zM10 3.5v9" {...p} />;
export const ArrowLeftIcon = (p: P) => <Icon d="M13 8H3M7 4L3 8l4 4" {...p} />;
export const ArrowRightIcon = (p: P) => <Icon d="M3 8h10M9 4l4 4-4 4" {...p} />;
export const PlusIcon = (p: P) => <Icon d="M8 3v10M3 8h10" {...p} />;
export const CloseIcon = (p: P) => <Icon d="M4 4l8 8M12 4l-8 8" {...p} />;
export const ChevronDownIcon = (p: P) => <Icon d="M4 6l4 4 4-4" {...p} />;
export const ChevronRightIcon = (p: P) => <Icon d="M6 4l4 4-4 4" {...p} />;
export const TargetIcon = (p: P) => (
	<Icon d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 11A3 3 0 1 0 8 5a3 3 0 0 0 0 6zM8 8.01V8" {...p} />
);
export const PauseIcon = (p: P) => <Icon d="M5.5 3.5v9M10.5 3.5v9" {...p} />;
export const PlayIcon = (p: P) => <Icon d="M5 3.5l7 4.5-7 4.5z" {...p} />;
export const SearchIcon = (p: P) => (
	<Icon d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" {...p} />
);
export const HomeIcon = (p: P) => (
	<Icon d="M2.5 7.5L8 3l5.5 4.5M4 6.5v6.5h3v-3.5h2V13h3V6.5" {...p} />
);
export const FolderPlusIcon = (p: P) => (
	<Icon d="M2 4.5h4l1.5 1.5H14v6.5H2zM8 8v3M6.5 9.5h3" {...p} />
);
export const ChatIcon = (p: P) => <Icon d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" {...p} />;
export const TerminalIcon = (p: P) => (
	<Icon d="M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10h2.5" {...p} />
);
export const FileIcon = (p: P) => <Icon d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" {...p} />;
export const GlobeIcon = (p: P) => (
	<Icon
		d="M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12"
		{...p}
	/>
);
export const PullRequestIcon = (p: P) => (
	<Icon
		d="M6.5 8h5M9.5 6l2 2-2 2M4.5 4.5a1.25 1.25 0 1 0 0-.01zM4.5 11.5a1.25 1.25 0 1 0 0-.01zM4.5 5.75v4.5"
		{...p}
	/>
);
export const CheckIcon = (p: P) => <Icon d="M3 8.5l3 3 7-7" {...p} />;
export const DotIcon = (p: P) => (
	<Icon d="M8 11.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5z" {...p} />
);
export const CircleIcon = (p: P) => (
	<Icon d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z" {...p} />
);
export const ClockIcon = (p: P) => (
	<Icon d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 5v3.5l2 1.5" {...p} />
);
export const EyeIcon = (p: P) => (
	<Icon
		d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"
		{...p}
	/>
);
export const CheckCircleIcon = (p: P) => (
	<Icon d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM5.5 8l1.75 1.75L10.5 6.5" {...p} />
);
export const XCircleIcon = (p: P) => (
	<Icon d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM6 6l4 4M10 6l-4 4" {...p} />
);
export const GitBranchIcon = (p: P) => (
	<Icon
		d="M4.5 4.5a1.25 1.25 0 1 0 0-.01zM4.5 11.5a1.25 1.25 0 1 0 0-.01zM4.5 5.75v4.5M11.5 4.5a1.25 1.25 0 1 0 0-.01zM11.5 5.75c0 3.25-3.25 3.25-5.5 3.75"
		{...p}
	/>
);
export const GitCommitIcon = (p: P) => (
	<Icon d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM1.5 8h4.5M10 8h4.5" {...p} />
);
export const GitMergeIcon = (p: P) => (
	<Icon
		d="M4.5 5.75v4.5M4.5 4.5a1.25 1.25 0 1 0 0-.01zM4.5 11.5a1.25 1.25 0 1 0 0-.01zM11.5 11.5a1.25 1.25 0 1 0 0-.01zM4.5 8c0 2.25 2 3.5 4.5 3.5h1.25"
		{...p}
	/>
);
export const ArrowDownToLineIcon = (p: P) => (
	<Icon d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3.5 13.5h9" {...p} />
);
export const TriangleAlertIcon = (p: P) => <Icon d="M8 2.5L14 13H2zM8 6.5v3M8 11.25v.01" {...p} />;
export const PencilIcon = (p: P) => (
	<Icon d="M10.5 2.5l3 3-7.5 7.5-3.5.5.5-3.5zM8.5 4.5l3 3" {...p} />
);
export const FileTextIcon = (p: P) => (
	<Icon d="M4 2.5h5l3 3v8H4V2.5zM9 2.5v3h3M6 8h4M6 10.5h4" {...p} />
);
export const ListTodoIcon = (p: P) => (
	<Icon d="M6 4.5h7M6 8h7M6 11.5h7M2.5 4.5l1 1 1.5-1.5M2.5 8l1 1L5 7.5M2.5 11.5l1 1L5 11" {...p} />
);
export const WrenchIcon = (p: P) => (
	<Icon
		d="M10.5 2.5a3 3 0 0 0-2.6 4.5L3 11.9l1.1 1.1 4.9-4.9A3 3 0 0 0 13.5 5.5L11.7 7.3 9.5 6.5 8.7 4.3z"
		{...p}
	/>
);
export const statusIcons = {
	backlog: CircleIcon,
	progress: ClockIcon,
	review: EyeIcon,
	done: CheckCircleIcon,
	canceled: XCircleIcon,
} as const;
export const gitIcons = {
	branch: GitBranchIcon,
	commit: GitCommitIcon,
	merge: GitMergeIcon,
	pullRequest: PullRequestIcon,
} as const;
export const toolIcons = {
	terminal: TerminalIcon,
	file: FileIcon,
	read: FileTextIcon,
	edit: PencilIcon,
	search: SearchIcon,
	globe: GlobeIcon,
	todo: ListTodoIcon,
	other: WrenchIcon,
} as const;
