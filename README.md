# herdr-tuicr

**Review beside Files and Changes, powered by actual [tuicr](https://tuicr.dev).**
A self-contained [Herdr app](https://herdr.dev) mod for reviewing local and remote
Git repositories without leaving your workspace.

![Illustrated Review panel](preview.svg)

The preview is an illustration, not a screenshot of a user's repository.

**Status: beta (`0.1.0-beta.1`).** Automated regression and isolated
native role checks pass. The packaged install still needs an interactive
local/remote smoke test before a stable release.

## Features

- Commit selector, working-tree changes, and revision ranges.
- Searchable local and remote-tracking branch picker with an editable base.
- Runs tuicr **on the machine that owns the repository**, via herdr-core.
- Hides Review when tuicr or a Git repository cannot be found there.
- Workspace-isolated terminals, selected targets, and unsubmitted range drafts.
- Reuses live reviews when switching panels; restores the slot after tuicr exits.
- Focuses the terminal when opening Review; the divider has no arbitrary maximum.
- Leaves actual comments, reviewed-file tracking, and exports to tuicr.

## Requirements

- Herdr app **0.1.15**, with `hc` available. Native role checks use Herdr app
  0.1.15; the development environment has hc 0.1.21 and tuicr 0.28.0.
  Other Herdr versions are unvalidated and may require adapting the bundled tab bar.
- Git and tuicr installed on each machine where you want reviews.
- A POSIX shell (`sh`) on those machines. Native Windows targets are not supported.
- A main-style layout with blocks `tabs`, `panel`, and `panel-body`.
- Python 3.10+ for the optional installer; Node 22+ for development tests.

No npm dependencies or build step are needed to run the mod.

## Install

**Trusted-code disclosure:** this mod runs `git` and `tuicr` locally or over Herdr's
machine connections, reads repository metadata, and modifies its personal layout
to embed a terminal. It never installs tuicr, checks out branches, fetches, pushes,
or submits a review on your behalf. Operations you request inside tuicr itself
have tuicr's normal permissions.

Read the source and [RECIPE.md](RECIPE.md) first. The installer defaults to a **dry
run**, refuses name collisions, and never overwrites shipped layouts or mods:

Open Herdr app, then clone this repository and run the installer:

```sh
git clone https://github.com/ubaid-18/herdr-tuicr.git
cd herdr-tuicr
git checkout v0.1.0-beta.1
python3 scripts/install.py
python3 scripts/install.py --apply
```

This copies `mods/tuicr-review`, checks it, clones the shipped `main` layout as
`main-tuicr`, switches to it, then atomically updates that named clone's file.
Herdr retains the clone's saved sizes, visibility, and appearance while reloading
the structural edit. Switching to another layout during installation cannot
redirect that edit. Your original layout,
shortcuts, settings, and TUI configuration stay unchanged. The first availability
check may take a moment. Missing programs are not installed automatically.

Choose another compatible layout or a different clone name:

```sh
python3 scripts/install.py --layout main --as review-workspace
python3 scripts/install.py --layout main --as review-workspace --apply
```

`--home PATH` selects another running Herdr app home (or set `HERDR_APP_HOME`).
Otherwise the installer respects `XDG_CONFIG_HOME`, defaulting to
`~/.config/herdr-app`. The source
layout must use the shipped `tabs` mod and must not already contain a Review
integration. Integrating with a customized tab bar is a manual merge; the script
refuses rather than silently replacing your custom code.

### Manual integration

Copy the mod folder without overwriting an existing name, then check it:

```sh
herdr-app check ~/.config/herdr-app/mods/tuicr-review
```

In a **personal layout**, replace the tab-bar block's `content` with:

```json
{ "mod": "tuicr-review", "props": { "role": "tabs" } }
```

Append the node in [`examples/review-node.json`](examples/review-node.json) to
`panel-body.children`. Keep the Files and Changes children. Remove any `max`
width from `panel` if you want a wide review area. Do not change `shared.json`,
layout click-state files, or any shipped mod.

The same folder provides all roles: tabs/controller, panel header, empty-state
content, and branch popup. There are no imports from personal mods or layouts.

## Use

Open a repository in a workspace and click **Review**:

| Control | Action |
|---|---|
| Commits | Open/reuse tuicr's commit selector |
| Working tree | Open/reuse `tuicr -w` |
| Range | Review a Git revision/range, e.g. `HEAD~1..HEAD` |
| Branch… | Search branches; review `base..full-branch-ref` |
| Focus | Give the embedded terminal the keyboard |

Branch base defaults to `HEAD`. Pick `main` as the base if that is the comparison
you want. Remote entries are **cached remote-tracking refs**; this mod never
fetches. `master..HEAD~1` is empty if `master` is HEAD: use `HEAD~2..HEAD~1` for the
previous commit.

Inside tuicr, press `?` for its help. Comments and drafts stay on the machine
running tuicr. Clipboard export is tuicr's own behavior; this mod adds no clipboard
bridge. Quit from tuicr to stop a review. Closing/hiding the side panel does not
stop it, and changing review modes can leave several review terminals running.

Optional mod commands (only while its tab-bar copy is shown):

```sh
herdr-app do tuicr-review.review
herdr-app do tuicr-review.branches
```

## Limitations

- Changing a branch here reviews its diff; it does not switch tuicr's whole
  checkout context or create a worktree.
- State is scoped by workspace, machine, repository, mode, and range. Separate
  tabs in the same workspace/repository intentionally share the selected review.
- A live terminal reused for a target is a running tuicr session, not a new
  snapshot automatically refreshed after every commit.
- tuicr can exit immediately for empty/invalid ranges. Its terminal may disappear;
  the panel restores the launcher, but startup stderr is not yet surfaced there.
- Availability and branch refs refresh every minute. Login-shell PATH lookup is
  required; shell aliases/functions that do not resolve to an absolute executable
  are not supported.
- During first discovery of a workspace/repository, the panel shows a loading
  state rather than another workspace's terminal. A known source stays usable
  during its periodic refresh. Launches in different workspaces are independent.
- This mod shares its UI/request channels between copies. Use one tabs/controller
  copy per active layout. Multiple simultaneous desktop windows are not validated.
- Per-terminal font sizing is not supported by Herdr app 0.1.15.
- The bundled tab bar is a snapshot and does not auto-merge future Herdr changes.

## Develop

```sh
npm test
npm run check
```

The tests use dependency-injected Herdr/GPUI stubs and temporary files; they do not
start terminals or edit your Herdr configuration. Native checks load each role
once; they are not a substitute for trying the mod in the app.

Regression coverage includes delayed discovery, concurrent launches, queued layout
updates (single-click open/reopen), terminal exit recovery, workspace drafts, and
installation while the active layout changes. GitHub Actions runs the unit tests.

Before calling a release stable, try the **packaged mod** in a disposable personal
layout: install with saved sizes/theme, open and reopen local and remote reviews
with one click, switch workspaces during discovery/launch, review a valid branch
range, quit/reopen tuicr, and switch back before removing the test installation.

Files:

- `main.js`: role dispatcher.
- `tabs.js`: adapted native tab bar and Files/Changes/Review integration.
- `controller.js`: remote discovery, workspace state, terminal lifecycle.
- `controls.js`: review controls and searchable branch popup.
- `review.svg`: monochrome Review button icon.

## Uninstall

Switch back to your original layout first. Remove only the mod directory and
personal layout clone you installed; running review terminals and tuicr's saved
comments are not deleted automatically.

Release notes are in [CHANGELOG.md](CHANGELOG.md). The included SVG preview is
an illustration; a gallery screenshot can be added after the interactive checks.

Apache-2.0; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
