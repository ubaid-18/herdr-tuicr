import { exec, hc, spaces, panes, focused, terminals, layout, run, shared, setShared, openOverlay, notify, appHome } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const result = find(child, id);
    if (result) return result;
  }
  return null;
}

function publish(value) {
  if (JSON.stringify(shared("tuicr-review.ui")) !== JSON.stringify(value)) setShared("tuicr-review.ui", value);
}

export class Review {
  constructor(cx) {
    this.sources = {};
    this.probes = {};
    this.starting = new Set();
    this.stopping = new Map();
    this.retired = new Set();
    this.stopErrors = new Map();
    this.copying = new Set();
    this.copyChoices = new Map();
    this.runs = JSON.parse(localStorage.getItem("tuicr-review.runs") ?? "{}");
    this.targets = JSON.parse(localStorage.getItem("tuicr-review.targets") ?? "{}");
    this.lastRequest = shared("tuicr-review.request")?.token;
    cx.timer.every(60000, cx => {
      // Keep a known source usable while refreshing it. A new source still
      // starts unavailable, so it can never inherit another source's review.
      for (const probe of Object.values(this.probes)) probe.stale = true;
      cx.notify();
    });
  }

  source() {
    const space = spaces().find(s => s.active);
    const tab = space?.tabs.find(t => t.active);
    if (!space || !tab) return null;
    const focus = focused();
    const candidates = panes().filter(p => p.tab === tab.id);
    const pane = candidates.find(p => p.pane === focus?.pane);
    // A composition terminal belongs to the review, not the repository source.
    const cwd = pane?.cwd || this.sources[tab.id] || candidates.find(p => p.cwd)?.cwd || space.folder;
    if (pane?.cwd) this.sources[tab.id] = pane.cwd;
    if (!cwd) return null;
    return { on: space.machine ?? null, cwd, tab: tab.id, workspace: space.id };
  }

  sync(cx) {
    if (this.closed) return;
    this.scheduleCleanup(cx);
    const source = this.source();
    if (!source) {
      this.current = null;
      this.loading = false;
      publish({ available: false, loading: false, workspace: spaces().find(s => s.active)?.id });
      this.display(null);
      return;
    }
    const key = JSON.stringify([source.on, source.cwd]);
    if (!this.probes[key] || this.probes[key].stale && !this.probes[key].loading) {
      const probe = this.probes[key] ??= {};
      Object.assign(probe, { loading: true, stale: false });
      cx.spawn(async cx => {
        try {
          const [binary, repo, refs] = await Promise.all([
            exec("sh", ["-lc", "command -v tuicr"], { on: source.on, timeout: 10000 }),
            exec("git", ["rev-parse", "--show-toplevel"], { on: source.on, cwd: source.cwd, timeout: 10000 }),
            exec("git", ["for-each-ref", "--format=%(refname)%09%(symref)", "refs/heads", "refs/remotes"],
              { on: source.on, cwd: source.cwd, timeout: 10000 }),
          ]);
          const path = binary.stdout.trim();
          Object.assign(probe, {
            loading: false,
            available: binary.code === 0 && path.startsWith("/") && repo.code === 0,
            binary: path, root: repo.stdout.replace(/\n$/, ""), on: source.on,
            branches: refs.code === 0 ? refs.stdout.split("\n").filter(Boolean).flatMap(line => {
              const [ref, symbolic] = line.split("\t");
              return symbolic ? [] : [{ ref, name: ref.replace(/^refs\/(heads|remotes)\//, ""),
                remote: ref.startsWith("refs/remotes/") }];
            }) : [],
          });
        } catch {
          Object.assign(probe, { loading: false, available: false });
        }
        cx.notify();
      });
    }
    const probe = this.probes[key];
    this.loading = probe.loading;
    this.current = probe.available ? {
      ...probe, workspace: source.workspace, cwd: source.cwd,
      repo: JSON.stringify([source.workspace, probe.on, probe.root]),
    } : null;
    const current = this.current;
    const request = shared("tuicr-review.request");
    if (request?.token !== this.lastRequest) {
      this.lastRequest = request?.token;
      if (request && request.repo === this.current?.repo) {
        // sync() runs inside Tabs.render(). Handle requests in a fresh timer
        // callback: start() may notify and must never run in the render phase.
        cx.timer.after(0, cx => {
          if (shared("tuicr-review.request")?.token !== request.token
              || !this.isCurrent(current)) return;
          if (request.action === "start") this.start(request.mode, request.range, cx);
          if (request.target === this.target()) {
            if (request.action === "copy") this.copyComments(cx);
            if (request.action === "copy-session") this.copyComments(cx, request);
          }
        });
      }
    }
    const address = this.address();
    publish({
      available: !!current, loading: probe.loading,
      repo: current?.repo, workspace: source.workspace, root: current?.root, on: current?.on,
      busy: !!current && this.starting.has(current.repo),
      copying: !!current && this.copying.has(current.repo), target: this.target(),
      terminal: address, error: current ? this.errors?.[current.repo] : null,
      branches: current?.branches ?? [],
    });
    // Detach hidden/stale terminals before quitting. Otherwise Herdr's exit
    // handler can remove their block and overwrite a rapid reopening's layout.
    // The tab bar owns panel visibility and its per-workspace selection.
    this.display(this.visible() ? address : null);
  }

  isCurrent(current) {
    const source = this.source();
    return !this.closed && !!current && this.current?.repo === current.repo
      && source?.workspace === current.workspace
      && source?.on === current.on && source?.cwd === current.cwd;
  }

  target() {
    if (!this.current) return null;
    return this.targets[this.current.repo] ?? JSON.stringify([this.current.workspace, this.current.on, this.current.root, "commits", ""]);
  }

  address() {
    const target = this.target();
    if (!target) return null;
    // Rediscover labeled reviews after a mod reload or an app restart.
    const live = this.owned().filter(t => !this.stopping.has(t.address)
      && t.labels["tuicr-review.target"] === target);
    const cached = this.runs[target];
    const address = live.some(t => t.address === cached) ? cached : live[0]?.address;
    return address ?? null;
  }

  owned() {
    return terminals().filter(t => t.state === "live" && !this.retired.has(t.address)
      && t.labels?.["tuicr-review.panel"] === "tuicr"
      && typeof t.labels?.["tuicr-review.target"] === "string");
  }

  async core(args) {
    const result = await hc([...args, "--json"]);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Core command failed");
    return JSON.parse(result.stdout);
  }

  retire(address) {
    if (this.stopping.has(address)) return this.stopping.get(address);
    const task = (async () => {
      const info = await this.core(["get", address]);
      if (info.state === "live") {
        // Only address a terminal this integration owns, with tuicr itself in
        // the foreground. An external editor must be left for the user to close.
        if (info.labels?.["tuicr-review.panel"] !== "tuicr"
            || typeof info.labels?.["tuicr-review.target"] !== "string") {
          throw new Error("Terminal ownership changed");
        }
        if (info.foreground?.name !== "tuicr") throw new Error("An editor or another program is still open");
        const screen = await this.core(["read", address]);
        const footer = screen.text?.trimEnd().split("\n").at(-1) ?? "";
        if (!/^\s*(NORMAL|SELECT)\b/.test(footer)) {
          throw new Error("Finish the open comment, command, or dialog first");
        }
        // :wq saves before exiting. Answer No to its optional clipboard-export
        // prompt. Never force-kill: a failed save must leave the review intact.
        const attach = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "terminal.attach",
          params: { terminal: address, cols: info.cols, rows: info.rows, history: 0 } });
        const quit = await exec("sh", [`${appHome()}/mods/tuicr-review/quit.sh`, address, attach], { timeout: 10000 });
        if (quit.code !== 0) throw new Error(quit.stderr || "Could not request save and quit");
        const after = await this.core(["get", address]);
        if (after.state === "live") throw new Error("Save and quit did not finish; use :w then :q");
      }
      // Saved reviews belong to tuicr; the finished core screen is disposable.
      await hc(["rm", address, "--json"]);
      this.retired.add(address);
      this.stopErrors.delete(address);
      for (const [target, cached] of Object.entries(this.runs)) {
        if (cached === address) delete this.runs[target];
      }
      localStorage.setItem("tuicr-review.runs", JSON.stringify(this.runs));
    })().finally(() => this.stopping.delete(address));
    this.stopping.set(address, task);
    return task;
  }

  stopFailed(address, error) {
    const message = String(error.message ?? error);
    if (this.stopErrors.get(address)?.message !== message) {
      notify({ title: "tuicr Review", level: "warning",
        body: `Review ${address} is still running: ${message}. Click to open it.`,
        action: { name: "terminal.peek", args: { terminal: address } } });
    }
    this.stopErrors.set(address, { message, retry: Date.now() + 60000 });
  }

  scheduleCleanup(cx) {
    if (this.cleanupQueued || this.closed) return;
    this.cleanupQueued = true;
    // Layout commands and workspace panel restoration land after render.
    // Inspect the applied layout, not the snapshot that queued those commands.
    cx.timer.after(100, cx => {
      this.cleanupQueued = false;
      if (this.closed) return;
      const keep = this.isCurrent(this.current) && this.visible() ? this.address() : null;
      const source = this.source();
      const discovering = !this.current && this.loading && this.visible();
      if (keep) this.stopErrors.delete(keep);
      const live = new Set(terminals().filter(t => t.state === "live").map(t => t.address));
      for (const address of this.retired) if (!live.has(address)) this.retired.delete(address);
      for (const address of this.stopErrors.keys()) if (!live.has(address)) this.stopErrors.delete(address);
      let changed = false;
      for (const [target, address] of Object.entries(this.runs)) {
        if (!live.has(address)) { delete this.runs[target]; changed = true; }
      }
      if (changed) localStorage.setItem("tuicr-review.runs", JSON.stringify(this.runs));
      for (const terminal of this.owned()) {
        const address = terminal.address;
        // A cold/reloaded remote probe can take seconds. Preserve a candidate
        // for this source, but still retire reviews from repositories we left.
        if (discovering) {
          let identity;
          try { identity = JSON.parse(terminal.labels["tuicr-review.target"]); } catch {}
          const root = identity?.[2];
          if (Array.isArray(identity) && identity.length === 5
              && identity[0] === source?.workspace && identity[1] === source?.on
              && typeof root === "string" && root.startsWith("/")
              && (source.cwd === root || source.cwd.startsWith(`${root.replace(/\/+$/, "")}/`))) continue;
        }
        if (address === keep || this.stopping.has(address)
            || (this.stopErrors.get(address)?.retry ?? 0) > Date.now()) continue;
        cx.spawn(async cx => {
          try { await this.retire(address); }
          catch (e) { this.stopFailed(address, e); }
          finally { cx.notify(); }
        });
      }
    });
  }

  async close() {
    this.closed = true;
    this.focusGeneration = (this.focusGeneration ?? 0) + 1;
    // Herdr gives close() a short best-effort window; the next controller also
    // reaps labeled leftovers after a crash, reload, or interrupted remote quit.
    // Start fresh work here: the host cancels the copy's earlier async tasks.
    this.stopping.clear();
    await Promise.allSettled(this.owned().map(t => this.retire(t.address)));
  }

  copyComments(cx, selection = null) {
    const current = this.current, target = this.target();
    if (!this.isCurrent(current) || this.copying.has(current.repo)) return;
    let session;
    if (selection) {
      const choice = this.copyChoices.get(current.repo);
      if (!choice || choice.token !== selection.choice || choice.target !== target) return;
      session = choice.sessions.find(s => s.path === selection.path);
      if (!session) return;
    }
    this.copyChoices.delete(current.repo);
    this.copying.add(current.repo);
    cx.spawn(async cx => {
      const active = () => this.isCurrent(current) && this.target() === target;
      const message = (body, level = "info") => notify({ title: "tuicr Review", body, level });
      const read = async args => {
        const result = await exec(current.binary, ["review", ...args],
          { on: current.on, cwd: current.root, timeout: 10000 });
        if (result.code !== 0) throw new Error(result.stderr?.trim() || "tuicr review failed; Copy comments requires tuicr 0.28+.");
        const value = JSON.parse(result.stdout);
        if (!Array.isArray(value)) throw new Error("tuicr returned an invalid review response.");
        return value;
      };
      try {
        if (!session) {
          const sessions = await read(["list", "--repo", current.root]);
          if (!active()) return;
          if (sessions.some(s => !s || typeof s.path !== "string" || !s.path
              || typeof s.slug !== "string" || !s.slug)) throw new Error("tuicr returned an invalid saved-review list.");
          if (!sessions.length) {
            message("No saved reviews found. Save your comments in tuicr with :w, then try again.");
            return;
          }
          if (sessions.length > 1) {
            sessions.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
            const token = `${Date.now()}-${Math.random()}`;
            this.copyChoices.set(current.repo, { token, target, sessions });
            openOverlay({ mod: "tuicr-review", kind: "popup", width: 600, height: 420,
              props: { copyPicker: true, repo: current.repo, target, choice: token, sessions } });
            return;
          }
          session = sessions[0];
        }
        const comments = await read(["comments", "--session", session.path, "--repo", current.root]);
        if (!active()) return;
        if (comments.some(c => !c || typeof c.location !== "string" || typeof c.content !== "string")) {
          throw new Error("tuicr returned invalid comments.");
        }
        if (!comments.length) {
          message(`No saved comments in ${session.slug}. Save in tuicr with :w, then try again.`);
          return;
        }
        const markdown = [
          `# Review comments: ${session.slug}`,
          `Repository: ${current.root} (${current.on ?? "local"})`,
          ...comments.map(c => {
            const type = c.comment_type && c.comment_type !== "none" ? ` [${c.comment_type}]` : "";
            return `### ${c.location}${type}\n\n${c.content}`;
          }),
        ].join("\n\n");
        cx.write_to_clipboard(markdown);
        message(`Copied ${comments.length} comment${comments.length === 1 ? "" : "s"} from ${session.slug}.`, "success");
      } catch (e) {
        if (active()) message(`Couldn't copy comments: ${e.message ?? e}`, "error");
      } finally {
        this.copying.delete(current.repo);
        cx.notify();
      }
    });
    cx.notify();
  }

  visible() {
    const root = layout();
    return !find(root, "panel")?.hidden && find(root, "panel-body")?.active === "review";
  }

  display(address, { reveal = false } = {}) {
    const before = layout();
    if (!before) return;
    const root = JSON.parse(JSON.stringify(before));
    const review = find(root, "review");
    if (!review) return;
    if (reveal) {
      const panel = find(root, "panel"), body = find(root, "panel-body");
      if (!panel || !body) return;
      // One composition update: a subsequent layout.set must not undo a
      // layout.show/select/resize queued against the previous snapshot.
      panel.hidden = false;
      body.active = "review";
      if ((panel.size?.px ?? 368) < 640) panel.size = { px: 640 };
    }
    const content = address ? { terminal: address } : { mod: "tuicr-review", props: { empty: true } };
    let block = find(root, "review-terminal");
    // Herdr removes a composition terminal block when its program exits.
    // Rebuild our slot rather than treating its absence as a missing panel.
    if (!block) {
      review.children ??= [];
      review.children.push({ id: "review-terminal", type: "block", content });
    } else block.content = content;
    if (JSON.stringify(before) === JSON.stringify(root)) return;
    run("layout.set", { layout: root });
  }

  focus(address, cx) {
    // layout.show/select/set are applied asynchronously. Never focus a terminal
    // until the *applied* composition contains it, or Herdr falls back to looking
    // for a model pane (these review terminals deliberately don't have one).
    const generation = this.focusGeneration = (this.focusGeneration ?? 0) + 1;
    const source = this.source();
    const current = this.current;
    let attempts = 0;
    const afterLayout = cx => {
      if (generation !== this.focusGeneration) return;
      const now = this.source();
      if (now?.tab !== source?.tab || !this.isCurrent(current)) return;
      const live = terminals().some(t => t.address === address && t.state === "live");
      const attached = find(layout(), "review-terminal")?.content?.terminal === address;
      if (live && attached && this.visible()) {
        run("pane.focus", { terminal: address });
      } else if (++attempts < 10 && this.visible()) {
        cx.timer.after(50, afterLayout);
      }
    };
    cx.timer.after(50, afterLayout);
  }

  open(cx) {
    if (this.closed || !this.isCurrent(this.current)) return;
    const address = this.address();
    if (address) {
      if (this.errors) delete this.errors[this.current.repo];
      this.display(address, { reveal: true });
      this.focus(address, cx);
      cx.notify();
    } else if (this.starting.has(this.current.repo)) {
      this.display(null, { reveal: true });
    } else {
      let selected;
      try { selected = JSON.parse(this.target()); } catch {}
      this.start(selected?.[3] ?? "commits", selected?.[4] ?? "", cx);
    }
  }

  start(mode, range, cx) {
    const current = this.current;
    if (this.closed || !this.isCurrent(current) || this.starting.has(current.repo)) return;
    range = (range ?? "").trim();
    if (!["commits", "worktree", "range"].includes(mode)) return;
    if (mode === "range" && (!range || range.startsWith("-") || /[\x00-\x1f]/.test(range))) {
      this.errors ??= {};
      this.errors[current.repo] = "Enter a revision or range, e.g. main..HEAD (not an option).";
      cx.notify();
      return;
    }
    const target = JSON.stringify([current.workspace, current.on, current.root, mode, mode === "range" ? range : ""]);
    const previous = this.targets[current.repo];
    this.errors ??= {};
    delete this.errors[current.repo];
    this.targets[current.repo] = target;
    localStorage.setItem("tuicr-review.targets", JSON.stringify(this.targets));
    const address = this.address();
    this.display(address, { reveal: true });
    if (address) {
      this.focus(address, cx);
      cx.notify();
      return;
    }
    this.starting.add(current.repo);
    cx.spawn(async cx => {
      try {
        // Replacing a target must retire its old process before starting another.
        // Also wait for an in-flight close when the user immediately reopens it.
        for (const terminal of this.owned()) {
          let identity;
          try { identity = JSON.parse(terminal.labels["tuicr-review.target"]); } catch { continue; }
          if (!Array.isArray(identity) || JSON.stringify(identity.slice(0, 3)) !== current.repo) continue;
          if (terminal.labels["tuicr-review.target"] === target && !this.stopping.has(terminal.address)) continue;
          try { await this.retire(terminal.address); }
          catch (e) { this.stopFailed(terminal.address, e); throw e; }
        }
        if (this.closed || !this.isCurrent(current) || this.target() !== target) return;
        const existing = this.address();
        if (existing) {
          this.display(existing, { reveal: true });
          this.focus(existing, cx);
          return;
        }
        const args = ["run", "--bg", "--json", "--no-parent", "--no-notify",
          "--cwd", current.root, "--label", "tuicr-review.panel=tuicr", "--label", `tuicr-review.target=${target}`];
        if (current.on) args.push("--on", current.on);
        args.push("--", current.binary, "--no-update-check");
        if (mode === "worktree") args.push("-w");
        if (mode === "range") args.push("-r", range);
        const result = await hc(args);
        if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Cannot start tuicr");
        const created = JSON.parse(result.stdout);
        if (!created.address) throw new Error("Core did not return a terminal address");
        this.runs[target] = created.address;
        localStorage.setItem("tuicr-review.runs", JSON.stringify(this.runs));
        if (this.closed) {
          await this.retire(created.address);
          return;
        }
        if (!this.closed && this.isCurrent(current) && this.targets[current.repo] === target) {
          if (this.visible()) this.display(created.address);
          // The opening layout update may still be queued. The focus callback
          // checks the applied layout after sync() has attached the live terminal.
          this.focus(created.address, cx);
        }
      } catch (e) {
        this.errors[current.repo] = String(e.message ?? e);
        if (this.targets[current.repo] === target) {
          if (previous) this.targets[current.repo] = previous;
          else delete this.targets[current.repo];
          localStorage.setItem("tuicr-review.targets", JSON.stringify(this.targets));
          if (this.isCurrent(current) && this.visible()) this.display(this.address());
        }
      } finally {
        this.starting.delete(current.repo);
        this.scheduleCleanup(cx);
        cx.notify();
      }
    });
    cx.notify();
  }
}
