# Security Policy

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's private advisory flow:

<https://github.com/jahala/conducted/security/advisories/new>

We'll acknowledge within 72 hours and coordinate disclosure with you.

## What matters most here

Conducted runs coding agents on your machine with your permissions, and passes them your shell environment. Reports about any of these are especially welcome:

- a way for an agent or a repository to run commands outside its workspace without approval,
- secrets (API keys, tokens) reaching an agent, a log or a file they should not,
- the web view gaining access to commands it should not have (`src-tauri/capabilities/`).

## Supported versions

Only the latest release receives security updates.
