# Shared AI Collaboration Protocol

<!-- AI_PROTOCOL:CANONICAL -->

This is the mandatory coordination contract for Tony, the manager, Codex, and Claude Code. Its purpose is to prevent stale code, silent reversions, overlapping changes, invisible work, and unverified production claims.

## Canonical repository

- Application: Thai Kitchen Buddy POS
- Canonical Git remote: `https://github.com/tonybox1025-NARA/thai-kitchen-buddy.git`
- Integration branch: `origin/main`
- A local directory name is not proof that it is current. Verify the remote URL and latest remote commit.
- The deployed app, Android/SUNMI build, Lovable state, Git branch, and Supabase state are separate. Report each one separately.

## Mandatory preflight

Before proposing or making a change, the agent must:

1. Run `git remote get-url origin` and confirm it matches the canonical remote above.
2. Run `git fetch origin --prune` and inspect `git log -1 origin/main`.
3. Run `git status --short --branch`. Treat every existing change as user-owned unless proven otherwise.
4. Never edit a dirty or stale shared checkout. Create an isolated branch/worktree from the latest `origin/main`.
5. Read `AGENTS.md`, this protocol, `docs/AI_CHANGELOG.md`, and any more specific instruction or business-rule files in the affected path.
6. Inspect relevant code history and existing regression guards before changing behavior.
7. Inspect active remote `codex/*` and `claude/*` branches and their latest commits for overlapping scope. If work overlaps, reconcile it before editing rather than recreating or reverting it.
8. Confirm whether there is an unpublished Lovable draft, unpushed local work, or direct Supabase change relevant to the task. If it cannot be inspected, do not claim the state is synchronized.

## Cross-agent coordination

- Use a descriptive branch under `codex/` or `claude/`, based on the latest `origin/main`.
- Push a small checkpoint with a descriptive commit/branch name before substantial work or as soon as practical, so the other agent can discover the active scope.
- Before pausing or handing off, commit and push all safe work-in-progress. Never leave the only useful state in a chat or an unpushed checkout.
- At the start of every task, review the latest remote history, relevant work branches, and this changelog. Do not rely on conversational memory alone.
- Before integration, fetch again and reassess new commits for overlap. Never force-push shared work or bypass a non-fast-forward rejection.
- Keep one authoritative implementation. Do not reintroduce an older component, query, migration, calculation, or workflow just because it exists in a stale checkout.

## Unshared state rules

- **Uncommitted local changes:** preserve them; do not reset, stash, clean, or overwrite them. Work in a clean isolated checkout.
- **Unpushed commits:** push a named checkpoint before handoff. If pushing is impossible, clearly report that the work is not shared and cannot be protected from parallel edits.
- **Lovable drafts:** sync the intended draft to the canonical Git repository before parallel Codex/Claude work. An unpublished personal draft is invisible to other agents.
- **Supabase:** production writes require explicit authority, pre-write evidence, and post-write verification. Schema/RPC/function changes must be represented by repository migrations or source files when applicable. Record any exceptional direct data repair with date, scope, evidence, and result.
- **Conversation-only decisions:** once Tony confirms an operational rule, record it in repository documentation and, where practical, an executable regression/business-rule guard before considering the task complete.
- Never commit secrets, `.env` contents, customer data, or production credentials to coordination records.

## Change and verification requirements

- Preserve existing behavior unless Tony explicitly requested the change.
- For every operational bug fix, add or extend a regression guard where practical.
- Use Bangkok business time and the repository's existing business-day conventions.
- Separate code status, test status, Git push/merge status, Lovable publish status, Android/SUNMI update status, and live verification status.
- A passing test or build is not proof that production or SUNMI has updated.
- A Git commit or push is not proof that Lovable has published.
- Validate end-to-end behavior for printing, payment, close, financial, and other operational workflows.

## Completion gate

A task is complete only when the agent has:

1. Re-fetched `origin/main` and reconciled overlapping changes.
2. Reviewed the final diff for unintended reversions.
3. Run `npm run guard:ai-protocol` plus relevant tests/build/regression checks.
4. Appended a concise entry to `docs/AI_CHANGELOG.md` for material work.
5. Committed and pushed the work and reported the exact repository, branch, and commit.
6. Reported deployment/publish/device/live-verification status separately and truthfully.
7. Stated any remaining risk or user action in one concise list.

## Tony's working principles

1. Direct conclusion first.
2. Inspect current state and existing changes first.
3. Compare major viable paths together.
4. Recommend one best option first, with the reason.
5. Mention alternatives only for material differences.
6. Separate required work from optional improvements.
7. Reassess globally after failure or contradictory evidence.
8. Complete and verify the full authorized workflow.
9. Minimize Tony's actions and questions.
