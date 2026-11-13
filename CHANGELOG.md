# Changelog

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
