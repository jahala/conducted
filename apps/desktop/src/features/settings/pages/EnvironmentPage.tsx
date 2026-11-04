/**
 * @feature SET-04 Environment settings page
 * Owns: the Environment page of Settings: environment variables given to setup scripts, actions
 * and terminals of new workspaces, and the files that hold more variables.
 * Behaviour: ui-map.md 6, "Environment" table and "Environment page" (Variables table: Name,
 * Value, "Locally overwritten", "Not set"; empty state "No variables set"; env files list; a
 * banner for importing local variables); services-map.md 4.2.8 (env_vars table; values are secrets).
 * Data: useEnvVars(scope), useActions().settings.setEnvVar and removeEnvVar.
 * Children: environment/EnvVarTable, environment/AddEnvVarForm, environment/EnvFilesList.
 * Our design choice: values live in the Keychain; the database holds names only (SET-04). The page
 * has a scope switch: all repositories, or one repository whose values override the global ones.
 * Must handle: no variables (designed empty state), a name that is invalid or reserved (names of
 * variables the app sets itself are refused), a value hidden until revealed, a Keychain error (row
 * shows it, nothing is lost), an overridden variable (shows which scope wins), and values never
 * written to logs.
 * Test first: adding a variable calls setEnvVar with the scope and shows the row with a hidden
 * value.
 */
import { notImplemented } from "@conducted/shared";

export function EnvironmentPage(): never {
	return notImplemented("SET-04");
}
