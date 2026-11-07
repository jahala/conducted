/**
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Owns: the sandbox image's sshd configuration and the command line the container entry starts it
 * with.
 * Behaviour: D119. The Worker's authenticated SSH tunnel reaches the sandbox's loopback port 22;
 * nothing outside the container can reach it, and the only credential is the Mac's public key,
 * installed by the Worker at start.
 * Must handle: a password or keyboard-interactive login (refused), a root login with no key
 * (refused), a listener on any interface other than loopback (not configured), and a host key the
 * image did not generate (`ssh-keygen -A` in the Dockerfile creates it).
 * Our design choice: the config is written by the entry at start, so the tested text in this file
 * is the one sshd reads. The image installs openssh-server and generates host keys; the key-only
 * rule is the config's, not a runtime flag.
 * Test first: the config binds 127.0.0.1 and turns every password path off.
 */

/** The port sshd listens on inside the sandbox. The Worker's tunnel is its only route in. */
export const SSH_PORT = 22;

/** The config file the entry writes before it starts sshd. */
export const SSHD_CONFIG_PATH = "/etc/ssh/sshd_config.conducted";

/** The one sshd configuration the sandbox runs: loopback only, public keys only, root. */
export const SSHD_CONFIG = [
	"# Written by the Conducted sandbox entry. Do not edit.",
	`Port ${SSH_PORT}`,
	"ListenAddress 127.0.0.1",
	"AddressFamily inet",
	"HostKey /etc/ssh/ssh_host_ed25519_key",
	"PermitRootLogin prohibit-password",
	"PubkeyAuthentication yes",
	"PasswordAuthentication no",
	"KbdInteractiveAuthentication no",
	"ChallengeResponseAuthentication no",
	"PermitEmptyPasswords no",
	"UsePAM no",
	"AllowUsers root",
	"AllowTcpForwarding no",
	"AllowAgentForwarding no",
	"PermitTunnel no",
	"X11Forwarding no",
	"AuthorizedKeysFile /root/.ssh/authorized_keys",
	"StrictModes no",
	"PidFile /run/sshd.pid",
	"PrintMotd no",
	"LogLevel ERROR",
	"",
].join("\n");

/** The argv the entry spawns: sshd in the foreground, logging to stderr, with this config. */
export function sshdArguments(configPath: string = SSHD_CONFIG_PATH): string[] {
	return ["/usr/sbin/sshd", "-D", "-e", "-f", configPath];
}
