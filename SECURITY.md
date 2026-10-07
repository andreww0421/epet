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
- New third-party actions in security workflows must use least-privilege permissions and be pinned to a full commit SHA. Dependabot should keep those pins current.

Repository administrators should require the **CodeQL**, **Dependency review**, and **npm audit** checks in branch protection or repository rules after the workflow has run successfully at least once.

## Responsible disclosure

We welcome good-faith research that avoids privacy violations, service disruption, persistence, social engineering, and access beyond what is necessary to demonstrate the issue. Use accounts and synthetic data you are authorized to control. Stop testing and report immediately if you encounter student data, another tenant's data, or active credentials.

Please allow a reasonable remediation period before publishing technical details, and coordinate disclosure timing through the private report. Do not exfiltrate, retain, or publicly share sensitive data. This policy does not create a bug bounty or promise payment, but constructive reports will be credited when the reporter requests attribution and disclosure is safe.
