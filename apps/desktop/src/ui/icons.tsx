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
export const ArrowLeftRightIcon = (p: P) => (
	<Icon d="M5.5 2.5l-3 3 3 3M2.5 5.5h11M10.5 7.5l3 3-3 3M13.5 10.5h-11" {...p} />
);
/** An arrow pointing up and right: a control that opens a page outside the app. */
export const ArrowUpRightIcon = (p: P) => <Icon d="M5 11l6-6M6 5h5v5" {...p} />;
export const ArchiveIcon = (p: P) => <Icon d="M2.5 3h11v3h-11zM3.5 6v7h9V6M6.5 8.5h3" {...p} />;
export const ArrowUpDownIcon = (p: P) => (
	<Icon d="M5 13V3M2.5 5.5L5 3l2.5 2.5M11 3v10M8.5 10.5L11 13l2.5-2.5" {...p} />
);
export const RefreshIcon = (p: P) => (
	<Icon
		d="M13 3.5v3h-3M3 12.5v-3h3M12.4 6.5A4.75 4.75 0 0 0 3.6 6M3.6 9.5a4.75 4.75 0 0 0 8.8.5"
		{...p}
	/>
);
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
export const HelpCircleIcon = (p: P) => (
	<Icon
		d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM6.4 6.4a1.65 1.65 0 0 1 3.2.55c0 1.1-1.6 1.4-1.6 2.3M8 10.9h.01"
		{...p}
	/>
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
export const BrainIcon = (p: P) => (
	<Icon
		d="M6.5 2.5a2 2 0 0 0-2 2 2 2 0 0 0-1.5 3.25A2 2 0 0 0 4.5 11a2 2 0 0 0 2 2.5V2.5zM9.5 2.5a2 2 0 0 1 2 2 2 2 0 0 1 1.5 3.25A2 2 0 0 1 11.5 11a2 2 0 0 1-2 2.5V2.5z"
		{...p}
	/>
);
export const FilePenIcon = (p: P) => (
	<Icon d="M8 13.5H4V2.5h5l3 3v1.5M9 2.5v3h3M12.5 8.5l1.5 1.5-3.5 3.5H9V12z" {...p} />
);
export const FileSearchIcon = (p: P) => (
	<Icon
		d="M7 13.5H4V2.5h5l3 3v2.5M9 2.5v3h3M10.5 12.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5zM11.75 11.75l1.75 1.75"
		{...p}
	/>
);
export const FileCodeIcon = (p: P) => (
	<Icon d="M4 2.5h5l3 3v8H4zM9 2.5v3h3M7 8l-1.5 1.5L7 11M9 8l1.5 1.5L9 11" {...p} />
);
export const FileDiffIcon = (p: P) => (
	<Icon d="M4 2.5h5l3 3v8H4zM9 2.5v3h3M8 6.5v3M6.5 8h3M6.5 11h3" {...p} />
);
export const ImageIcon = (p: P) => (
	<Icon d="M2.5 2.5h11v11h-11zM6 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM13.5 10l-3-3-7 6.5" {...p} />
);
export const BotIcon = (p: P) => (
	<Icon d="M3.5 5.5h9v7.5h-9zM8 5.5V3M6.5 3h3M1.5 9h2M12.5 9h2M6 8.5v1M10 8.5v1" {...p} />
);
export const ClipboardListIcon = (p: P) => (
	<Icon
		d="M5.5 3H3.5v10.5h9V3h-2M6 2h4v2H6zM7.5 7.5h3M7.5 10.5h3M5.5 7.5h.01M5.5 10.5h.01"
		{...p}
	/>
);
export const PromptIcon = (p: P) => <Icon d="M3 4.5l4 3.5-4 3.5M8.5 12h4.5" {...p} />;
export const BlocksIcon = (p: P) => (
	<Icon d="M2.5 6.5h4v7h-4zM6.5 9.5h7v4h-7zM9.5 2.5h4v4h-4z" {...p} />
);
export const FolderIcon = (p: P) => <Icon d="M2 4.5h4l1.5 1.5H14v6.5H2z" {...p} />;
export const GearIcon = (p: P) => (
	<Icon
		d="M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.9 2.5h2.2l.4 1.6 1.2.7 1.6-.5 1.1 1.9-1.2 1.1v1.4l1.2 1.1-1.1 1.9-1.6-.5-1.2.7-.4 1.6H6.9l-.4-1.6-1.2-.7-1.6.5-1.1-1.9 1.2-1.1V7.3L2.6 6.2l1.1-1.9 1.6.5 1.2-.7z"
		{...p}
	/>
);
export const GitCompareIcon = (p: P) => (
	<Icon
		d="M4.5 5.75a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zM11.5 12.75a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zM4.5 5.75V11a1.5 1.5 0 0 0 1.5 1.5h2M11.5 10.25V5a1.5 1.5 0 0 0-1.5-1.5H8"
		{...p}
	/>
);
export const SlidersIcon = (p: P) => (
	<Icon
		d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M10 6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM6 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"
		{...p}
	/>
);
export const UserCircleIcon = (p: P) => (
	<Icon
		d="M8 13.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM8 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4.5 12.25c.75-1.5 2-2.25 3.5-2.25s2.75.75 3.5 2.25"
		{...p}
	/>
);
export const PaletteIcon = (p: P) => (
	<Icon
		d="M8 13.5a5.5 5.5 0 1 1 5.5-5.5c0 1.5-1.25 2-2.25 2H10a1.25 1.25 0 0 0-.9 2.1A1.1 1.1 0 0 1 8 13.5zM5 7.5h.01M7 5h.01M10 5.5h.01"
		{...p}
	/>
);
export const KeyboardIcon = (p: P) => (
	<Icon d="M2 4.5h12v7H2zM4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6" {...p} />
);
export const CpuIcon = (p: P) => (
	<Icon
		d="M4.5 4.5h7v7h-7zM6.5 6.5h3v3h-3zM6 2v2.5M10 2v2.5M6 11.5V14M10 11.5V14M2 6h2.5M2 10h2.5M11.5 6H14M11.5 10H14"
		{...p}
	/>
);
export const KeyIcon = (p: P) => (
	<Icon d="M5.5 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7.6 7.9L13 2.5M11 4.5l1.5 1.5" {...p} />
);
export const PlugIcon = (p: P) => (
	<Icon d="M6 2.5v3M10 2.5v3M4.5 5.5h7V8a3.5 3.5 0 0 1-7 0zM8 11.5v2" {...p} />
);
export const FlaskIcon = (p: P) => (
	<Icon d="M6.5 2.5h3M7 2.5v4L3.5 12.5a.7.7 0 0 0 .6 1h7.8a.7.7 0 0 0 .6-1L9 6.5v-4" {...p} />
);
export const ChevronsUpDownIcon = (p: P) => <Icon d="M5 6l3-3 3 3M5 10l3 3 3-3" {...p} />;
export const PinIcon = (p: P) => <Icon d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5" {...p} />;
export const SlashIcon = (p: P) => <Icon d="M11 2.5L5 13.5" {...p} />;
export const SendIcon = (p: P) => <Icon d="M14 2L7 9M14 2l-4.5 12-2.5-5-5-2.5z" {...p} />;
export const SquareCheckIcon = (p: P) => <Icon d="M2.5 2.5h11v11h-11zM5.5 8l2 2 3.5-4" {...p} />;
export const MessageSquareIcon = (p: P) => <Icon d="M2.5 2.5h11v8.5H6L2.5 13.5z" {...p} />;
export const RadioIcon = (p: P) => (
	<Icon
		d="M8 9.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zM5.5 5.5a3.5 3.5 0 0 0 0 5M10.5 5.5a3.5 3.5 0 0 1 0 5M3.5 3.5a6.5 6.5 0 0 0 0 9M12.5 3.5a6.5 6.5 0 0 1 0 9"
		{...p}
	/>
);
export const LaptopIcon = (p: P) => <Icon d="M3.5 4h9v6.5h-9zM1.5 12.5h13" {...p} />;
export const BicepsIcon = (p: P) => (
	<Icon
		d="M3 13.5c2.5 0 7 .5 9.5-1.5s.5-6-2-5.5c-1 .2-1.5 1-2 2M3 13.5V7.5l2.5-5 2 1-1 3.5"
		{...p}
	/>
);
export const CopyIcon = (p: P) => <Icon d="M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3" {...p} />;
export const MoreHorizontalIcon = (p: P) => (
	<Icon d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.25" {...p} />
);
export const MoreVerticalIcon = (p: P) => (
	<Icon d="M8 3.5v.01M8 8v.01M8 12.5v.01" strokeWidth="2.25" {...p} />
);
export const ColumnsIcon = (p: P) => <Icon d="M2.5 3h11v10h-11zM8 3v10" {...p} />;
export const ArrowUpIcon = (p: P) => <Icon d="M8 13V3M4 7l4-4 4 4" {...p} />;
export const UndoIcon = (p: P) => (
	<Icon d="M5.5 9.5L2.5 6.5l3-3M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7" {...p} />
);
export const SplitIcon = (p: P) => (
	<Icon d="M8 13.5V9L3.5 4.5M3.5 8V4.5H7M8 9l4.5-4.5M12.5 8V4.5H9" {...p} />
);
export const MessageSquarePlusIcon = (p: P) => (
	<Icon d="M2.5 2.5h11v8.5H6L2.5 13.5zM8 4.5v4M6 6.5h4" {...p} />
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
