# Security Policy

## Supported versions

Epet currently deploys continuously rather than publishing numbered stable releases. Security fixes are applied to the current production deployment and the latest code on the default branch.

| Version | Supported |
| --- | --- |
| Current production deployment and latest `main` | Yes |
| Older commits, forks, and local snapshots | No |

Users of an older revision should first reproduce the issue against the latest supported version when it is safe to do so.

## Reporting a vulnerability

If it is enabled for the repository, please report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/andreww0421/epet/security/advisories/new). Do not disclose a vulnerability in a public issue, discussion, pull request, or commit message.

If private reporting is unavailable, open a public issue containing only the title **Security contact request** and ask the maintainers to establish a private channel. Do not include exploit details, credentials, student information, tenant data, or other sensitive material in that issue.

A useful private report includes:

- the affected component and supported version;
- the security impact and likely attack conditions;
- minimal, safe reproduction steps or a proof of concept using synthetic data;
- any known mitigations or suggested remediation; and
- a way to contact the reporter for coordinated follow-up.

We aim to acknowledge a complete report within five business days. We will validate the report, communicate material status changes, and coordinate a disclosure timeline based on severity and remediation risk. This is a response target, not a guarantee of resolution within five days.

## Secret handling

- Never commit credentials, tokens, private keys, production configuration, or real student data to source control, fixtures, logs, workflow files, build artifacts, or screenshots. Redact sensitive values before sharing diagnostic material.
- Store automation credentials only in GitHub repository or environment secrets, scope them to the smallest practical permissions and environment, and rotate them regularly.
- Store Worker-only credentials in the Cloudflare Workers secret store rather than source files or plaintext Wrangler configuration.
- Pull request security checks must not receive production secrets. Values exposed to frontend builds, including `VITE_*` variables, must be treated as public.
- If a secret is exposed, revoke or rotate it first, then remove it from the repository and artifacts, and review relevant provider and audit logs. Removing it from Git history alone does not make it safe again.
- Use synthetic, non-identifying data for tests and reports. Student personally identifiable information must not be copied into security tooling or disclosure material.

Repository administrators should enable GitHub secret scanning, push protection, and validity checks where the repository plan supports them. Push protection should only be bypassed for reviewed false positives or approved test values, with a documented reason. Administrators should also enable private vulnerability reporting and Dependabot alerts.

## Dependency policy

- Commit `package-lock.json` and use `npm ci` for reproducible verification and deployment.
- Dependabot checks npm packages and GitHub Actions weekly. Every update remains subject to review and the full project verification suite; dependency pull requests are not auto-merged by policy.
- Pull requests are blocked when dependency review introduces a dependency with a known high or critical advisory.
- CI runs `npm audit --audit-level=high` against the complete committed dependency graph, including development and build tooling. High and critical advisories block the security job; moderate advisories are triaged, and low advisories are monitored.
- Prefer the smallest non-breaking update that removes an advisory. Do not run `npm audit fix --force` without reviewing API, build, runtime, and data-compatibility impact.
- All third-party actions must use least-privilege permissions and be pinned to a full commit SHA. Dependabot should keep those pins current. Review the upstream repository and resolved commit before updating a pin; a SHA alone does not establish trust.

## Review and release controls

Repository administrators must require **PR required checks**, **CodeQL**, **Dependency review**, and **npm audit**, bound to the GitHub Actions App, for `main`. The functional gate requires successful TypeScript/unit/API/local D1/build/Worker verification and every discovered E2E/accessibility/capacity browser job. Failed, cancelled or skipped dependencies fail the gate. Workflow files alone do not enforce merge protection: administrators must apply and read back the rules, then run the positive and negative acceptance tests in [the release protection runbook](docs/release-protection.md).

Require at least one independent approving review, dismiss stale approvals, require approval after the last push and resolve review threads. Do not allow ordinary collaborators, bots, deploy keys or administrators a standing bypass. Changes to workflows, release scripts, rulesets and this policy need explicit security review. Assign qualified independent CODEOWNERS before requiring code-owner review; do not name an account that cannot review its own changes.

Production application deployment and manual D1 expansion must both use a protected Environment with independent approval, self-review prevention, no admin bypass and a branch policy limited to `main`. Keep database mutation in its separate manual workflow. Production secrets belong only in protected deployment environments; PR jobs must have no production environment, secrets or remote data access. Staging retains its separate Worker, database and credentials. Review Cloudflare native Builds and other publishers as well as GitHub Actions: GitHub Environment approval cannot protect deployments performed outside that Environment.

Emergency changes use an expedited reviewed PR with passing checks and an incident record. Do not turn a red check green, remove a required check, or grant an all-role bypass to ship a release. Any exceptional access requires separate explicit authorization, a narrow actor, a deadline, before/after policy evidence and an independent post-incident review. This change does not grant or configure emergency access.

## Responsible disclosure

We welcome good-faith research that avoids privacy violations, service disruption, persistence, social engineering, and access beyond what is necessary to demonstrate the issue. Use accounts and synthetic data you are authorized to control. Stop testing and report immediately if you encounter student data, another tenant's data, or active credentials.

Please allow a reasonable remediation period before publishing technical details, and coordinate disclosure timing through the private report. Do not exfiltrate, retain, or publicly share sensitive data. This policy does not create a bug bounty or promise payment, but constructive reports will be credited when the reporter requests attribution and disclosure is safe.
