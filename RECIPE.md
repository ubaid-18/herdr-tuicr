# tuicr Review

A native Review button alongside Files and Changes opens the actual tuicr TUI
inside the right-hand panel, including its **built-in syntax highlighting** for
code and diffs. It follows the source workspace's repository and machine,
remembers separate range drafts per workspace, and disappears where tuicr is
unavailable.

[![tuicr Review panel (cropped)](preview.png)](preview-full.png)

## Before installing (for agents)

Read the installed Herdr `AGENTS.md`, this recipe, and the mod files. Inspect the
available layouts and the mods they reference. **Ask where Review should go
before changing files**, unless the user already specified both the installation
option and target layout:

> Would you like to add the Review button to one of your existing layouts, or
> create a new layout with it?

- **Existing layout:** list the available layouts, identify personal versus
  Herdr-shipped layouts, and ask which one to update.
- **New layout:** ask which layout to use as the base and what to name the new
  personal copy. Offer `main` as a base if the user has no preference.
- **A shipped layout was selected:** explain that Herdr regenerates shipped
  files and ask for a personal-copy name, then use the new-layout path.

Review is integrated per layout. Use the user's chosen layout and the
[integration steps below](#integrate-into-the-chosen-layout).

### Required dependency

**Tell the user that tuicr is a required, separately installed dependency before
integrating this mod.** Explain:

> This mod embeds tuicr; it does not bundle or install it. You need tuicr 0.28 or
> newer on each machine that hosts repositories you want to review. For remote
> repositories, tuicr must be installed on the remote machine, not just your desktop.

Check `sh -lc 'command -v tuicr'` on each intended repository machine, along with
Git availability, and verify the discovered binary's `--version` is 0.28 or newer.
If tuicr is missing or too old, name the affected machine and point the
user to [tuicr's installation instructions](https://tuicr.dev). Explain that
Review stays hidden there until Git, tuicr, and a Git repository are available.
In the installation summary, report which machines were checked and any missing
or unverified dependencies.

## What you see

- A 14px Review icon/button alongside Files and Changes. The bundled tab bar
  matches Herdr's standard one; merge Review into an existing custom tab bar.
- A resizable right panel, initially widened to at least 640 logical pixels on
  first Review open. There is no explicit maximum panel width.
- A 126px header: Review title and machine/repo, Commits / Working tree / Branch…
  / Copy comments controls, a range field, Range button, a `:w saves comments`
  hint, and optional error text.
- Below it, a real native terminal, not a rendered copy of tuicr's output.
- A 520×450 branch popup with editable base (HEAD), search, up to eight visible
  rows, local/remote labels, and keyboard instructions. The selected row stays
  visible by sliding the rendered slice.
- A 600×420 saved-review popup when Copy comments finds several sessions:
  search, newest-first session names, comment counts, open-session indicators,
  and up to eight visible rows. Enter copies the selected session; Esc cancels.
- Theme colors throughout, 11px header text, 26px header buttons, rounded corners.
  tuicr draws and themes its own terminal contents.

## How it behaves

- Discovery uses the focused model pane's live cwd and active space's machine.
  While the embedded terminal is focused, keep the source pane's last cwd.
- Probe `command -v tuicr` through `sh -lc`, `git rev-parse --show-toplevel`, and
  local/cached-remote refs through `git for-each-ref`; never fetch or check out.
- Hide Review unless an absolute tuicr executable and Git repo are found.
  Refresh discovery/ref metadata every 60 seconds and on source-folder changes.
  Detach the previous source's terminal immediately while a new source loads or
  has no repository. Keep a known source usable during periodic refresh.
- Commits opens tuicr's selector, Working tree adds `-w`, Range adds `-r` with one
  argument. Branch selection generates `base..refs/heads/name` (or a remote ref).
- Remember selected targets by workspace/machine/repo/mode/range.
  Restore each workspace/repo's range text, including drafts not submitted yet.
- Ignore stale branch popups and queued requests when their workspace no longer
  matches. Validate that a range/base is not an option/control-character input.
- Keep only the visible source's selected review running. Closing the panel,
  selecting Files/Changes, switching source/workspace, or replacing a target
  saves and exits the old process. Reopening restarts the remembered target.
  Recreate the terminal block when Herdr removes it after process exit.
- Retire the previous target before launching its replacement. Rapid reopening
  waits for an in-flight exit; a late launch for a departed source is retired.
  Reconcile after layout commands settle, including at startup, so labeled
  leftovers from old versions, deleted workspaces, and duplicate runs are reclaimed.
- Cleanup targets only this integration's labeled terminals and checks that
  tuicr is in the foreground and in NORMAL/SELECT mode. Use `:wq`, declining
  clipboard export. An editor/dialog or failed save leaves the terminal alive
  and posts a notification that opens it. Do not force-kill or submit a review.
- Forward the exported View's `close()` hook to the controller for best-effort
  app/layout shutdown. Normal process exit also drops its core screen/history;
  saved tuicr sessions remain on the repository host.
- Open/select/widen/attach Review in one layout update, so a stale snapshot cannot
  undo the click. Launches are locked per workspace/repository, not globally.
  Pending discovery preserves a workspace's Review-panel selection.
- Focus only after a bounded, delayed check confirms the correct visible block
  and live terminal. Stop waiting after source changes, superseded clicks, or a
  hidden panel. Avoid "no such pane" by not focusing ahead of layout application.
- Handle review requests after rendering, not inside it. Clear prior errors before
  reusing a good terminal, not only before starting a new one.
- Copy comments reads saved reviews for the source repository on its own machine.
  Copy directly when exactly one session exists; otherwise let the user choose,
  including sessions with zero comments. Never guess by newest/open session.
  Save edits in tuicr with `:w` first; unsaved TUI edits are not in the CLI output.
- Export that session's comments as Markdown with repository/session context,
  file/line locations, comment types, and multiline text. Write through Herdr's
  local clipboard API, including for remote repositories. The button also works
  after tuicr exits. Toasts report success, no saved comments, and errors.
- Copy requests are deduplicated per workspace/repository. A workspace, source,
  or selected-target change cancels late results and stale session selections.
  An empty or failed read leaves the clipboard intact.
- tuicr owns review progress/comments and any forge actions. Agent states
  working/blocked/done/idle retain the shipped tab-bar appearances; this mod does
  not infer an agent status from tuicr or animate a new spinner.

## Built from

The bundled implementation is one `mods/tuicr-review` folder, with no shipped
layout or keymap:

- `main.js` default-exports a View and dispatches by props.
- `props.role: "tabs"` uses `tabs.js` and its `Review` controller.
- Default role renders `controls.js`; `empty: true` selects the launcher body,
  `picker: true` selects the branch popup, and `copyPicker: true` selects the
  saved-review popup.
- Imports `gpui-kit`, `gpui-base`, and Herdr APIs, plus relative modules inside
  the same mod folder. Shipped icon paths remain Herdr-owned assets.
- Tab-bar implementation derived from Herdr app 0.1.15, Apache-2.0.
- `tuicr-review.ui` / `.request` shared channels; mod-local storage for runs,
  selected targets, and range drafts.
- `exec` for Git and PATH lookup on the source machine. `hc run --bg --json
  --no-parent --no-notify --cwd …` for reviews, optionally `--on machine`,
  with `tuicr-review.panel` and `.target` labels.
- `quit.sh` uses POSIX shell utilities and `hc connect`'s framed terminal API
  to send save-and-quit without changing the terminal size. This avoids older
  `hc keys` versions that cannot encode `:`. The helper runs on the desktop and
  routes remote terminal addresses through the existing core connection.
- Uses `layout.select/show/hide/resize/set` and `pane.focus {terminal}`.
  Update the personal layout's `review-terminal` block, not a model pane.
- Copy uses the discovered tuicr executable with `review list --repo <root>`
  and `review comments --session <path> --repo <root>` via `exec` on the source
  machine, then `cx.write_to_clipboard` on the desktop. `openOverlay` presents
  session choices and `notify` reports the result.

### Integrate into the chosen layout

#### 1. Select the target file

- **Existing personal layout:** edit `layouts/<chosen-name>.json` in the running
  app's home. Record the original tab-bar reference and the code/layout changes
  for removal later. This path updates the selected layout in place.
- **New layout:** choose an unused name and use
  `herdr-app do layout.clone '{"name":"<base>","as":"<new-name>"}'`, substituting
  the user's choices. Herdr copies the base's saved sizes and appearance and
  switches to the clone. Integrate into `layouts/<new-name>.json`.

Use the selected app home throughout. Re-read the named file before saving and
preserve unrelated fields. Let Herdr's file watcher reload the structural edit;
an installation-time `layout.set` targets the active layout and clears saved
click/look state. Leave `layouts/.state/` to Herdr.

The optional `scripts/install.py` automates only the **new-layout** path for a
main-style layout with the shipped tab bar. For an existing layout or a custom
tab bar, perform the integration below directly.

#### 2. Install or reuse the mod

Copy `mods/tuicr-review` into the app's `mods/` directory. If that name exists,
inspect it: reuse a matching installation, or give the incoming copy a unique
name. For a renamed copy, consistently update its layout `mod` references,
empty-state and overlay mod names, icon paths, and `tuicr-review.*` namespaces
across its controller and controls.

Before editing a tab-bar mod used by other layouts, clone it under an unused
personal name and point the selected layout to that copy. Shipped mods always
require a personal copy for code changes.

#### 3. Wire the button and controller

- **Standard tab bar:** set its block's content to
  `{ "mod": "tuicr-review", "props": { "role": "tabs" } }` (using the installed
  name). The bundled implementation provides the button and controller.
- **Custom tab bar:** preserve its rendering, controls, and existing handlers.
  Copy `controller.js` into that personal mod under an unused filename and
  import `Review` with a relative import. Initialize one `new Review(cx)` in the
  view's `init`, then call its `sync(cx)` during `render`.
  Forward the custom View's `close()` to `review.close()`. Keep `quit.sh` in the
  installed controls mod; the controller's helper path must use that mod's name.
  Use `tabs.js` as the reference for the Review button: show it when
  `review.current` is available, call `review.open(cx)` to open it, and hide
  `panel` when clicking the already-selected Review button. Merge `syncPanel`'s
  workspace selection and loading behavior into the existing panel handling.
  If exposing the Review/Branches commands, merge their handlers into the
  tab bar's command loop.

Keep exactly one Review controller in the active layout. The custom-tab path
uses the installed mod for controls, empty state, and both popups; its copied
controller must use the same mod names and shared/request namespaces.

#### 4. Add the Review panel

In a main-style layout, append [`examples/review-node.json`](examples/review-node.json)
to `panel-body.children`, alongside its existing children. This adds the `review`
column, 126px `review-controls`, and weighted `review-terminal` block. Inspect
and reuse an existing Review integration instead of adding duplicate nodes.
Remove the panel's maximum-width constraint so the divider can widen Review.

For a different layout, adapt its existing side panel or add a resizable panel
and stack alongside its main content. The bundled code expects `panel`,
`panel-body`, `review`, `review-controls`, and `review-terminal` IDs. If those IDs
are already used for other purposes, choose unique IDs and update all matching
controller, tab-bar, and layout references in a layout-specific mod copy.
Preserve the chosen layout's arrangement and existing controls while fitting
the Review panel into it.

#### 5. Check and hand over

Run `herdr-app check` for each added or changed mod, including the roles listed
under **Done when**. Switch to the chosen layout and verify Review opening,
controls, and workspace switching there. Include checks for the user's existing
tab-bar controls after a custom merge.

Tell the user which layout now contains Review, whether it was updated or
created, which mod copies/references changed, the dependency-check results, and
any interactive checks still pending.

## Watch out

- Trusted code runs programs and reads repositories outside its mod folder.
  Remote operations use the existing machine connection. No automatic installs.
- Never overwrite a shipped mod/layout or edit Herdr's `.state` files.
- Existing Review integrations and custom tab bars need a manual merge; the
  supplied installer refuses collisions instead of guessing.
- `cx.notify()` is illegal during render. Delayed callbacks need their own `cx`.
- The native check cannot prove later async states or deferred popup rows work.
- Cleanup waits for a settled layout and never closes an unfinished editor or
  dialog. Finish it and close Review again, or use `:wq` yourself.
- App-quit cleanup is best-effort under Herdr's short close deadline; startup
  reconciliation handles surviving labeled reviews when the app returns.
- Native Windows targets, multiwindow coordination, per-terminal font size, and
  full startup-error presentation are not implemented.
- tuicr session data itself is keyed by tuicr, not this mod. Workspace isolation
  here means terminals/selected targets/range drafts, not a new tuicr data store.

## Done when

- `herdr-app check` passes for controls, tab bar, both pickers, and empty state.
- In an installed personal layout, Review appears for local and remote repos
  with tuicr, and is absent when the program is missing.
- Real tuicr opens in the side panel for selector, worktree and valid ranges.
- A chosen branch produces a range without changing the checkout.
- Two workspaces using the same repo keep distinct terminals and range drafts.
- Quit and reopen a review: its deleted terminal slot is reconstructed.
- Switch ranges repeatedly: only the latest process stays live. Close Review or
  change workspace: the old process exits and its saved comments remain. Reopen:
  the remembered target starts again. Old labeled orphans are reclaimed too.
- Save a comment locally and remotely, then Copy comments; both put Markdown
  on the desktop clipboard. Multiple sessions require a selection. Empty reviews,
  CLI failures, and workspace/target switches do not replace the clipboard.
- No render-phase notification errors; reopening a good review clears stale errors.
- One click opens/reopens Review even while layout commands are queued.
- A layout switch during installation cannot redirect the structural edit.
- Saved sizes and appearance are preserved when updating a layout or cloning it.
- Existing Files/Changes, keyboard shortcuts, source terminals, and the old TUI
  remain unchanged. The installer does not publish the repository.
- The user chose an existing-layout update or a new layout, and Review works in
  that selected layout. Custom tab-bar controls still work after integration.
- The installation summary identifies the target layout, changed mod references,
  required tuicr installations, and completed versus pending checks.

## Removing Review

For an existing-layout installation, remove the added Review button/controller
and panel nodes, and restore the previous tab-bar reference where a copy was
made. Preserve later user edits when undoing an in-place custom-tab merge.
Keep the existing layout.

For a dedicated new layout, switch to another layout before deleting the clone.
Remove installed or cloned mod folders only after checking that no layout or
other mod still references them. Close Review first and resolve any cleanup
notification. Saved tuicr sessions remain independent of the mod.
