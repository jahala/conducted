/**
 * @feature PRJ-03 Quick start a new project from a template
 * Owns: the templates Quick start offers and the folder name it makes from a project name.
 * Behaviour: ui-map.md 3.9 (Create project: Project name, Parent folder, Template).
 * Must handle: a name with no letters or numbers is refused rather than made into an empty folder;
 * a long name is cut at 100 characters, as GitHub repository names are.
 * Test first: "My App!" makes the folder name "my-app".
 */

export type ProjectTemplate = "empty" | "nextjs" | "gstack";

/** The skill collection the gstack template installs. */
export const GSTACK_TEMPLATE_URL = "https://github.com/garrytan/gstack.git";

export interface ProjectTemplateChoice {
	value: ProjectTemplate;
	label: string;
	description: string;
}

/** The three templates the Create project dialog offers, in the order it shows them. */
export const PROJECT_TEMPLATES: readonly ProjectTemplateChoice[] = [
	{ value: "empty", label: "Empty", description: "Blank Git repo" },
	{ value: "nextjs", label: "Next.js", description: "TypeScript, Tailwind, App Router" },
	{ value: "gstack", label: "gstack", description: "Agent workflow template" },
];

export function isProjectTemplate(value: string): value is ProjectTemplate {
	return PROJECT_TEMPLATES.some((template) => template.value === value);
}

/**
 * The folder and repository name a project name makes: lower case, anything that is not a letter
 * or a number becomes a hyphen, repeated and edge hyphens are removed, and the result stops at 100
 * characters. An empty result means the name has nothing GitHub can use.
 */
export function projectFolderName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 100);
}
