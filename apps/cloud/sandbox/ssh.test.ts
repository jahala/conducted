/**
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * Tests the sandbox image's sshd: it listens on loopback only, accepts public keys only, and
 * lets root in with a key, which is the door the Worker's SSH tunnel reaches (D119).
 * Test first: the generated sshd config binds 127.0.0.1 and turns every password path off.
 */
import { describe, expect, it } from "vitest";
import { SSH_PORT, SSHD_CONFIG, SSHD_CONFIG_PATH, sshdArguments } from "./ssh.ts";

describe("CLOUD-12 the sandbox sshd", () => {
	it("listens on loopback only", () => {
		expect(SSHD_CONFIG).toContain("Port 22");
		expect(SSHD_CONFIG).toContain("ListenAddress 127.0.0.1");
		expect(SSHD_CONFIG).not.toContain("ListenAddress 0.0.0.0");
		expect(SSHD_CONFIG).not.toContain("ListenAddress ::");
	});

	it("accepts public keys only, for root", () => {
		expect(SSHD_CONFIG).toContain("PubkeyAuthentication yes");
		expect(SSHD_CONFIG).toContain("PasswordAuthentication no");
		expect(SSHD_CONFIG).toContain("KbdInteractiveAuthentication no");
		expect(SSHD_CONFIG).toContain("PermitEmptyPasswords no");
		expect(SSHD_CONFIG).toContain("PermitRootLogin prohibit-password");
		expect(SSHD_CONFIG).toContain("AllowUsers root");
		expect(SSHD_CONFIG).toContain("AuthorizedKeysFile /root/.ssh/authorized_keys");
	});

	it("starts sshd in the foreground with this config", () => {
		expect(sshdArguments()).toEqual(["/usr/sbin/sshd", "-D", "-e", "-f", SSHD_CONFIG_PATH]);
	});
});
