# Changelog

## Unreleased

- Save and exit hidden, superseded, duplicate, and orphaned review processes
  instead of retaining a process for every previously opened target.
- Reopen the workspace's remembered target; serialize replacement with shutdown,
  clean up late launches, and forward app/layout close hooks.
- Preserve unfinished editors/dialogs and failed saves with a notification linking
  back to the review. Remove finished core screens after a successful close.
- Replace Focus with Copy comments: export saved review comments as Markdown to
  the local clipboard, including from remote repositories.
- Add a saved-review chooser when a repository has multiple sessions, with
  stale-workspace protection and copy-result notifications.
- Copy comments requires tuicr 0.28+; save edits in tuicr with `:w` before copying.
- Add clipboard regression coverage and a fifth native UI-role check.

## 0.1.0-beta.1

Initial standalone tuicr Review mod for Herdr app.

- Local and remote commit, working-tree, range, and branch reviews.
- Workspace-scoped terminals, selected targets, and range drafts.
- Single-click panel opening and reopening with deferred terminal focus.
- Immediate detachment of another workspace's terminal during discovery.
- Independent launches across workspaces and preserved panel selection while loading.
- Named-clone installation that preserves saved layout appearance and cannot
  redirect edits to another active layout.
- Regression tests and isolated native checks for all four UI roles.

Validated with Herdr app 0.1.15 native role checks. Interactive testing of the
packaged installation on local and remote repositories is still pending.
