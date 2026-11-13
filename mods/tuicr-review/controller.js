import { exec, hc, spaces, panes, focused, terminals, layout, run, shared, setShared } from "herdr";

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
          if (request.action === "focus") {
            const address = this.address();
            if (address) this.focus(address, cx);
          }
        });
      }
    }
    const address = this.address();
    publish({
      available: !!current, loading: probe.loading,
      repo: current?.repo, workspace: source.workspace, root: current?.root, on: current?.on,
      busy: !!current && this.starting.has(current.repo),
      terminal: address, error: current ? this.errors?.[current.repo] : null,
      branches: current?.branches ?? [],
    });
    // Detach stale terminals even when hidden: discovery can take several
    // seconds, and the user may open the panel before it finishes.
    // The tab bar owns panel visibility and its per-workspace selection.
    if (!current || this.visible()) this.display(address);
    else {
      const attached = find(layout(), "review-terminal")?.content?.terminal;
      if (attached && attached !== address) this.display(null);
    }
  }

  isCurrent(current) {
    const source = this.source();
    return !!current && this.current?.repo === current.repo
      && source?.workspace === current.workspace
      && source?.on === current.on && source?.cwd === current.cwd;
  }

  address() {
    if (!this.current) return null;
    const target = this.targets[this.current.repo] ?? JSON.stringify([this.current.workspace, this.current.on, this.current.root, "commits", ""]);
    // Rediscover labeled reviews after a mod reload or an app restart.
    const live = terminals().filter(t => t.state === "live");
    const cached = this.runs[target];
    const address = live.some(t => t.address === cached) ? cached : live.find(t =>
      t.state === "live" && t.labels?.["tuicr-review.panel"] === "tuicr" && t.labels?.["tuicr-review.target"] === target)?.address;
    return address ?? null;
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
    if (!this.isCurrent(this.current)) return;
    const address = this.address();
    if (address) {
      if (this.errors) delete this.errors[this.current.repo];
      this.display(address, { reveal: true });
      this.focus(address, cx);
      cx.notify();
    } else if (this.starting.has(this.current.repo)) {
      this.display(null, { reveal: true });
    } else this.start("commits", "", cx);
  }

  start(mode, range, cx) {
    const current = this.current;
    if (!this.isCurrent(current) || this.starting.has(current.repo)) return;
    range = (range ?? "").trim();
    if (!["commits", "worktree", "range"].includes(mode)) return;
    if (mode === "range" && (!range || range.startsWith("-") || /[\x00-\x1f]/.test(range))) {
      this.errors ??= {};
      this.errors[current.repo] = "Enter a revision or range, e.g. main..HEAD (not an option).";
      cx.notify();
      return;
    }
    const target = JSON.stringify([current.workspace, current.on, current.root, mode, mode === "range" ? range : ""]);
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
        if (this.isCurrent(current) && this.targets[current.repo] === target) {
          if (this.visible()) this.display(created.address);
          // The opening layout update may still be queued. The focus callback
          // checks the applied layout after sync() has attached the live terminal.
          this.focus(created.address, cx);
        }
      } catch (e) {
        this.errors[current.repo] = String(e.message ?? e);
      } finally {
        this.starting.delete(current.repo);
        cx.notify();
      }
    });
    cx.notify();
  }
}
