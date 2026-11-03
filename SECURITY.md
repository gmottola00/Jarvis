# Security Policy

Jarvis is an agent with read access to a Kubernetes cluster, logs, metrics,
ArgoCD and GitHub. Security reports are taken seriously.

## Design guarantees

These are architectural, and a test enforces the first one:

- **No write path to the cluster.** There is no `apply`, `patch`, `delete` or
  `scale` tool. Jarvis changes infrastructure only by opening pull requests;
  ArgoCD is the only thing that applies them.
- **Human approval.** Actions that open PRs are suspended until a person approves.
- **No built-in authentication.** The console is meant to sit behind a private
  network (e.g. Tailscale). **Do not expose it to the public internet** without
  putting an authenticating proxy in front of it.

## Supported versions

Only the latest commit on `main` receives fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub:
**Security → [Report a vulnerability](../../security/advisories/new)**.

Useful details: affected component, steps to reproduce, impact, and a suggested
fix if you have one.

This is a personal project maintained on a best-effort basis. Expect an
acknowledgement within about a week; fixes are coordinated with you before any
public disclosure.

## Scope

In scope: ways to make the agent perform actions outside its approved tools,
bypass approvals, leak credentials or cluster data, or SSRF/injection through
the API or console.

Out of scope: issues that need an already-compromised host, or deployments
deliberately exposed without authentication.
