import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const folder = new URL("../mods/tuicr-review/", import.meta.url);
function load(name, className, dependencies) {
  const source = fs.readFileSync(new URL(name, folder), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace(`export class ${className}`, `class ${className}`);
  return new Function(...Object.keys(dependencies), `${source}\nreturn ${className};`)(
    ...Object.values(dependencies));
}

function harness() {
  const h = {
    workspace: "workspace-a", machine: "dev", cwd: "/repo", tab: "tab-a",
    focusedPane: "source", installed: true, git: true,
    shared: {}, storage: new Map(), live: [], launched: [], commands: [],
    timers: [], intervals: [], tasks: [], notifications: 0,
    queued: [], deferCommands: false, launchGates: new Map(),
    sessions: [], comments: new Map(), reviewCalls: [], reviewResponses: new Map(),
    reviewGates: new Map(), reviewStarts: new Map(), overlays: [], toasts: [],
    clipboard: "existing clipboard", clipboardWrites: [],
    stopped: [], coreCalls: [], stopGates: new Map(), stopStarts: new Map(),
    stopFailures: new Set(), screens: new Map(), foregrounds: new Map(),
    tree: { id: "root", children: [{ id: "panel", hidden: false, children: [
      { id: "panel-body", active: "review", children: [{ id: "review", children: [
        { id: "review-controls", content: { mod: "tuicr-review" } },
        { id: "review-terminal", content: { mod: "tuicr-review", props: { empty: true } } },
      ] }] },
    ] }] },
  };
  const localStorage = {
    getItem: k => h.storage.get(k) ?? null,
    setItem: (k, v) => h.storage.set(k, v),
  };
  const timer = {
    every(_ms, fn) { h.intervals.push(fn); },
    after(ms, fn) { h.timers.push({ ms, fn }); },
  };
  h.cx = {
    timer,
    notify() { h.notifications++; },
    spawn(fn) { h.tasks.push(fn(h.cx)); },
    write_to_clipboard(text) { h.clipboard = text; h.clipboardWrites.push(text); },
  };
  h.renderCx = { ...h.cx, notify() { throw new Error("notify during render"); } };
  const Review = load("controller.js", "Review", {
    exec: async (command, args, options) => {
      if (command === "sh" && args[0].endsWith("/quit.sh")) {
        const address = args[1], terminal = h.live.find(t => t.address === address);
        h.stopped.push(address);
        h.stopStarts.get(address)?.();
        await h.stopGates.get(address);
        if (!h.stopFailures.has(address)) terminal.state = "exited";
        return { code: 0, stdout: "{}" };
      }
      if (command === "/bin/tuicr") {
        h.reviewCalls.push({ command, args, options });
        h.reviewStarts.get(args[1])?.();
        await h.reviewGates.get(args[1]);
        const response = h.reviewResponses.get(args[1]);
        if (response instanceof Error) throw response;
        if (response) return response;
        const value = args[1] === "list" ? h.sessions : h.comments.get(args[args.indexOf("--session") + 1]) ?? [];
        return { code: 0, stdout: JSON.stringify(value) };
      }
      if (command === "sh") return { code: h.installed ? 0 : 1, stdout: h.installed ? "/bin/tuicr\n" : "" };
      if (args[0] === "for-each-ref") return { code: 0, stdout:
        "refs/heads/main\t\nrefs/heads/feature\t\nrefs/remotes/origin/feature\t\nrefs/remotes/origin/HEAD\trefs/remotes/origin/main\n" };
      return { code: h.git ? 0 : 1, stdout: h.git ? "/repo\n" : "" };
    },
    hc: async args => {
      h.coreCalls.push(args);
      const [command, address] = args;
      if (command !== "run") {
        const terminal = h.live.find(t => t.address === address);
        if (!terminal) return { code: 1, stderr: "No such terminal" };
        if (command === "get") return { code: 0, stdout: JSON.stringify({
          ...terminal, foreground: { name: h.foregrounds.get(address) ?? "tuicr" },
        }) };
        if (command === "read") return { code: 0, stdout: JSON.stringify({
          text: h.screens.get(address) ?? "tuicr\n NORMAL    j/k scroll · :w save",
        }) };
        return { code: 0, stdout: JSON.stringify({ state: terminal.state }) };
      }
      h.launched.push(args);
      const on = args.includes("--on") ? args[args.indexOf("--on") + 1] : null;
      const created = `${on ? `${on}/` : ""}t${h.launched.length}`;
      const label = args.find(arg => arg.startsWith("tuicr-review.target="));
      const target = label.slice("tuicr-review.target=".length);
      await h.launchGates.get(JSON.parse(target)[0]);
      h.live.push({ address: created, state: "live", labels: {
        "tuicr-review.panel": "tuicr", "tuicr-review.target": target,
      } });
      return { code: 0, stdout: JSON.stringify({ address: created }) };
    },
    spaces: () => [{ id: h.workspace, active: true, machine: h.machine,
      folder: h.cwd, tabs: [{ id: h.tab, active: true }] }],
    panes: () => [{ pane: "source", tab: h.tab, cwd: h.cwd }],
    focused: () => ({ pane: h.focusedPane }),
    terminals: () => h.live,
    layout: () => h.tree,
    run: (name, args) => {
      h.commands.push([name, args]);
      h.queued.push([name, args]);
      if (!h.deferCommands) h.flush();
    },
    shared: k => h.shared[k],
    setShared: (k, v) => { h.shared[k] = v; },
    openOverlay: spec => { h.overlays.push(spec); return "copy-popup"; },
    notify: message => h.toasts.push(message),
    localStorage,
    appHome: () => "/app",
  });
  h.flush = () => {
    for (const [name, args] of h.queued.splice(0)) {
      if (name === "layout.set") h.tree = args.layout;
      if (name === "layout.hide") h.tree.children[0].hidden = true;
      if (name === "layout.show") h.tree.children[0].hidden = false;
      if (name === "layout.select") h.tree.children[0].children[0].active = args.child;
      if (name === "layout.resize") h.tree.children[0].size = { px: args.px };
    }
  };
  h.review = new Review(h.cx);
  h.settle = async () => { while (h.tasks.length) await Promise.all(h.tasks.splice(0)); };
  h.discover = async () => {
    h.review.sync(h.renderCx);
    await h.settle();
    h.review.sync(h.renderCx);
  };
  h.tick = () => {
    const timers = h.timers.splice(0);
    for (const { fn } of timers) fn(h.cx);
  };
  return h;
}

function tabsHarness(h) {
  const clicks = new Map();
  const element = () => {
    let id;
    const builder = new Proxy({}, { get: (_target, key) => (...args) => {
      if (key === "id") id = args[0];
      if (key === "on_click") clicks.set(id, args[0]);
      if (key === "when" && args[0]) args[1](builder);
      return builder;
    } });
    return builder;
  };
  const Tabs = load("tabs.js", "ReviewTabs", {
    div: element, svg: element, image: element, h_flex: element,
    spaces: () => [{ id: h.workspace, active: true, tabs: [] }],
    panes: () => [], theme: () => ({}), window: () => ({}),
    shared: key => h.shared[key], layout: () => h.tree,
    run: (name, args) => {
      h.commands.push([name, args]);
      h.queued.push([name, args]);
      if (!h.deferCommands) h.flush();
    },
    localStorage: { setItem: (k, v) => h.storage.set(k, v) },
  });
  const tabs = new Tabs();
  tabs.review = h.review;
  tabs.panels = {};
  tabs.scroll = { scroll_to_item() {} };
  return { tabs, clicks };
}

const content = h => h.tree.children[0].children[0].children[0].children[1].content;

test("remote discovery parses branches and omits symbolic remote HEAD", async () => {
  const h = harness();
  await h.discover();
  assert.equal(h.review.current.on, "dev");
  assert.deepEqual(h.review.current.branches.map(b => b.name),
    ["main", "feature", "origin/feature"]);
  assert.equal(h.review.current.branches[2].remote, true);
});

test("local/remote launch, safe arguments, existing terminal reuse", async () => {
  const h = harness();
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  assert.equal(h.review.address(), "dev/t1");
  assert(h.launched[0].includes("--on"));
  assert(h.launched[0].includes("--no-parent"));
  h.review.open(h.cx);
  assert.equal(h.launched.length, 1);
  h.review.start("worktree", "", h.cx);
  await h.settle();
  assert(h.launched[1].includes("-w"));
  h.review.start("range", "--bad", h.cx);
  await h.settle();
  assert.equal(h.launched.length, 2);
  h.review.start("range", "main..refs/heads/feature", h.cx);
  await h.settle();
  assert.deepEqual(h.launched[2].slice(-2), ["-r", "main..refs/heads/feature"]);
  h.machine = null;
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  assert(!h.launched[3].includes("--on"));
});

test("same repository in different workspaces has isolated review terminals", async () => {
  const h = harness();
  await h.discover();
  h.review.start("range", "HEAD~1..HEAD", h.cx);
  await h.settle();
  h.workspace = "workspace-b";
  await h.discover();
  assert.equal(h.review.address(), null);
  h.review.start("range", "HEAD~1..HEAD", h.cx);
  await h.settle();
  assert.equal(h.review.address(), "dev/t2");
  h.workspace = "workspace-a";
  await h.discover();
  assert.equal(h.review.address(), "dev/t1");
});

test("requests notify only outside render; stale requests do not run", async () => {
  const h = harness();
  await h.discover();
  const repo = h.review.current.repo;
  h.review.open(h.cx);
  await h.settle();
  h.timers = [];
  h.review.errors = { [repo]: "stale error" };
  h.shared["tuicr-review.request"] = { token: "first", repo, action: "start", mode: "commits" };
  h.review.sync(h.renderCx);
  assert.equal(h.review.errors[repo], "stale error");
  h.tick();
  assert.equal(h.review.errors[repo], undefined);
  h.shared["tuicr-review.request"] = { token: "second", repo, action: "start", mode: "worktree" };
  h.review.sync(h.renderCx);
  h.shared["tuicr-review.request"] = { token: "third", repo, action: "focus" };
  h.tick();
  await h.settle();
  assert.equal(h.launched.length, 1);
});

test("terminal slot reconstructed after exit; no duplicate blocks", async () => {
  const h = harness();
  await h.discover();
  const column = h.tree.children[0].children[0].children[0];
  column.children.pop();
  h.review.display(null);
  let children = h.tree.children[0].children[0].children[0].children;
  assert.equal(children[1].content.mod, "tuicr-review");
  h.review.display("dev/t9");
  h.review.display("dev/t9");
  children = h.tree.children[0].children[0].children[0].children;
  assert.equal(children.length, 2);
  assert.equal(children[1].content.terminal, "dev/t9");
});

test("focus waits for a live visible attached terminal; tab changes cancel it", async () => {
  const h = harness();
  await h.discover();
  h.live.push({ address: "dev/t9", state: "live" });
  h.review.focus("dev/t9", h.cx);
  h.tick();
  assert(!h.commands.some(([name]) => name === "pane.focus"));
  h.review.display("dev/t9");
  h.tick();
  assert.equal(h.commands.filter(([name]) => name === "pane.focus").length, 1);
  h.review.focus("dev/t9", h.cx);
  h.tab = "elsewhere";
  h.tick();
  assert.equal(h.commands.filter(([name]) => name === "pane.focus").length, 1);
});

test("missing tuicr hides Review without starting anything", async () => {
  const h = harness();
  const { tabs } = tabsHarness(h);
  h.installed = false;
  await h.discover();
  tabs.render(h.renderCx);
  assert.equal(h.shared["tuicr-review.ui"].available, false);
  assert.equal(h.tree.children[0].hidden, true);
  assert.equal(h.launched.length, 0);
});

test("switching to a cold or absent source immediately detaches the previous review", async () => {
  const h = harness();
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  assert.equal(content(h).terminal, "dev/t1");
  h.workspace = "workspace-b";
  h.tab = "tab-b";
  h.cwd = "/another-repo";
  h.review.sync(h.renderCx);
  assert.equal(h.shared["tuicr-review.ui"].loading, true);
  assert.equal(content(h).terminal, undefined);
  assert.equal(h.live[0].state, "live");
  await h.settle();

  // The no-source early-return path must detach too, including a hidden slot.
  h.review.display("dev/t1");
  h.tree.children[0].hidden = true;
  h.workspace = "empty-workspace";
  h.tab = "empty-tab";
  h.cwd = "";
  h.review.sync(h.renderCx);
  assert.equal(content(h).terminal, undefined);
  assert.equal(h.shared["tuicr-review.ui"].workspace, "empty-workspace");
  assert.equal(h.shared["tuicr-review.ui"].available, false);
});

test("cold workspace discovery retains Review selection; explicit panel changes win", async () => {
  const h = harness();
  const { tabs } = tabsHarness(h);
  tabs.space = "workspace-a";
  tabs.panels = { "workspace-a": "review", "workspace-b": "review" };
  h.workspace = "workspace-b";
  tabs.render(h.renderCx);
  assert.equal(h.review.loading, true);
  assert.equal(tabs.panels["workspace-b"], "review");
  assert.equal(h.tree.children[0].hidden, false);
  await h.settle();
  tabs.render(h.renderCx);
  assert.equal(tabs.panels["workspace-b"], "review");
  assert.equal(h.tree.children[0].children[0].active, "review");

  h.cwd = "/third-source";
  tabs.render(h.renderCx);
  h.tree.children[0].children[0].active = "files";
  tabs.render(h.renderCx);
  await h.settle();
  tabs.render(h.renderCx);
  assert.equal(tabs.panels["workspace-b"], "files");
  assert.equal(h.tree.children[0].children[0].active, "files");
});

test("periodic refresh keeps the current review usable until availability is known", async () => {
  const h = harness();
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  h.intervals[0](h.cx);
  h.review.sync(h.renderCx);
  assert.equal(h.review.loading, true);
  assert.equal(h.shared["tuicr-review.ui"].available, true);
  assert.equal(content(h).terminal, "dev/t1");
  await h.settle();
  h.review.sync(h.renderCx);
  assert.equal(h.review.loading, false);
  assert.equal(h.review.address(), "dev/t1");
});

test("concurrent workspaces launch independently and late completion cannot steal the panel", async () => {
  const h = harness();
  await h.discover();
  let finishA;
  h.launchGates.set("workspace-a", new Promise(resolve => { finishA = resolve; }));
  h.review.start("commits", "", h.cx);
  h.review.sync(h.renderCx);
  assert.equal(h.shared["tuicr-review.ui"].busy, true);
  const first = h.tasks.shift();

  h.workspace = "workspace-b";
  h.review.sync(h.renderCx);
  assert.equal(h.shared["tuicr-review.ui"].busy, false);
  h.review.start("worktree", "", h.cx);
  assert.equal(h.launched.length, 2);
  await h.settle();
  assert.equal(content(h).terminal, "dev/t2");
  finishA();
  await first;
  assert.equal(content(h).terminal, "dev/t2");
  assert.equal(h.review.starting.size, 0);

  h.workspace = "workspace-a";
  h.review.sync(h.renderCx);
  assert.equal(h.review.address(), "dev/t1");
  assert.equal(content(h).terminal, "dev/t1");
});

test("late launches and focus callbacks reject source changes even before another render", async () => {
  const h = harness();
  await h.discover();
  let finish;
  h.launchGates.set(h.workspace, new Promise(resolve => { finish = resolve; }));
  h.review.open(h.cx);
  h.cwd = "/different-source";
  finish();
  await h.settle();
  assert.equal(content(h).terminal, undefined);
  h.review.focus("dev/t1", h.cx);
  h.tick();
  assert(!h.commands.some(([name]) => name === "pane.focus"));
});

for (const { reuse, earlyLaunch } of [
  { reuse: false, earlyLaunch: false },
  { reuse: true, earlyLaunch: false },
  { reuse: false, earlyLaunch: true },
]) {
  test(`one Review click opens and focuses ${reuse ? "a reused" : "a new"} terminal with ${earlyLaunch ? "launch before layout" : "queued layout commands"}`, async () => {
    const h = harness();
    await h.discover();
    if (reuse) {
      h.review.open(h.cx);
      await h.settle();
    }
    h.tree.children[0].hidden = true;
    h.tree.children[0].size = { px: 368 };
    h.tree.children[0].children[0].active = "files";
    h.commands = [];
    h.timers = [];
    h.deferCommands = true;
    const { tabs, clicks } = tabsHarness(h);
    tabs.render(h.renderCx);
    h.flush();
    clicks.get("panel-review")({}, h.cx);
    // Herdr applies the queued commands after this callback returns.
    assert.equal(h.tree.children[0].hidden, true);
    if (earlyLaunch) await h.settle();
    h.flush();
    assert.equal(h.tree.children[0].hidden, false);
    assert.equal(h.tree.children[0].children[0].active, "review");
    assert.equal(h.tree.children[0].size.px, 640);
    await h.settle();
    h.flush();
    tabs.render(h.renderCx);
    h.flush();
    h.tick();
    assert.equal(content(h).terminal, "dev/t1");
    assert.equal(h.launched.length, 1);
    assert(h.commands.some(([name]) => name === "pane.focus"));
  });
}

function controlsHarness() {
  const h = { p: {}, state: {}, sent: [], closed: [], storage: new Map(), inputs: [],
    clicks: new Map(), labels: new Map() };
  const element = () => {
    let id;
    const builder = new Proxy({}, { get: (_target, key) => (...args) => {
      if (key === "id") id = args[0];
      if (key === "on_click") h.clicks.set(id, args[0]);
      if (key === "child" && id && typeof args[0] === "string") h.labels.set(id, args[0]);
      if (key === "when" && args[0]) args[1](builder);
      return builder;
    } });
    return builder;
  };
  const Controls = load("controls.js", "ReviewControls", {
    div: element, h_flex: element, v_flex: element,
    InputState: { new(options = {}) {
      let value = options.value ?? "";
      const handlers = {};
      const input = {
        on(name, fn) { handlers[name] = fn; },
        focus() {}, value: () => value,
        set_value(v) { value = v; handlers.change?.({}, { notify() {} }); },
        submit() { handlers.submit?.(); },
      };
      h.inputs.push(input);
      return input;
    } },
    Input: { new: element },
    props: () => h.p,
    shared: key => key === "tuicr-review.request" ? h.sent.at(-1) : h.state,
    setShared: (_key, value) => h.sent.push(value),
    theme: () => ({}), openOverlay() {}, closeOverlay: id => h.closed.push(id),
    localStorage: { getItem: k => h.storage.get(k) ?? null,
      setItem: (k, v) => h.storage.set(k, v) },
  });
  h.controls = new Controls();
  return h;
}

test("range drafts restore independently for each workspace", () => {
  const h = controlsHarness();
  h.controls.init({}, {});
  h.state = { repo: "a", workspace: "a" };
  h.controls.render();
  h.inputs[0].set_value("HEAD~1..HEAD");
  h.state = { repo: "b", workspace: "b" };
  h.controls.render();
  assert.equal(h.inputs[0].value(), "");
  h.inputs[0].set_value("main..feature");
  h.state = { repo: "a", workspace: "a" };
  h.controls.render();
  assert.equal(h.inputs[0].value(), "HEAD~1..HEAD");
});

test("branch picker handles remote refs, custom bases, and stale workspace guard", () => {
  const h = controlsHarness();
  h.p = { picker: true, repo: "a", overlay: "popup" };
  h.state = { repo: "a" };
  h.controls.init({}, { focus_handle: () => ({}) });
  h.controls.choose({ ref: "refs/remotes/origin/feature" });
  assert.equal(h.sent[0].range, "HEAD..refs/remotes/origin/feature");
  h.inputs[1].set_value("main");
  h.controls.choose({ ref: "refs/heads/feature" });
  assert.equal(h.sent[1].range, "main..refs/heads/feature");
  h.inputs[1].set_value("--bad");
  h.controls.choose({ ref: "refs/heads/feature" });
  assert.equal(h.sent.length, 2);
  h.inputs[1].set_value("HEAD");
  h.state = { repo: "b" };
  h.controls.choose({ ref: "refs/heads/feature" });
  assert.equal(h.sent.length, 2);
});

const savedReview = (path = "/saved/review one.json", slug = "repo@main/worktree/abc123") => ({
  path, slug, comment_count: 2, updated_at: "2026-11-13T12:00:00Z", active: true,
});
const savedComments = [
  { location: "src/example.js:4-6 [old]", comment_type: "issue", content: "Handle missing input.\nKeep the fallback." },
  { location: "review", comment_type: "none", content: "Add an example." },
];

for (const machine of [null, "dev"]) {
  test(`Copy comments reads ${machine ? "remote" : "local"} saved comments and writes the local clipboard`, async () => {
    const h = harness(), controls = controlsHarness();
    h.machine = machine;
    h.sessions = [savedReview()];
    h.comments.set(h.sessions[0].path, savedComments);
    await h.discover();
    controls.controls.init({}, {});
    controls.state = h.shared["tuicr-review.ui"];
    controls.controls.render();
    // Copy remains available after the review terminal has exited.
    assert.equal(controls.state.terminal, null);
    assert.equal(controls.labels.get("review-copy"), "Copy comments");
    assert(!controls.clicks.has("review-focus"));
    controls.clicks.get("review-copy")();
    h.shared["tuicr-review.request"] = controls.sent[0];
    h.review.sync(h.renderCx);
    assert.equal(h.reviewCalls.length, 0, "copy waits until after render");
    h.tick();
    await h.settle();
    assert.deepEqual(h.reviewCalls.map(call => call.args), [
      ["review", "list", "--repo", "/repo"],
      ["review", "comments", "--session", "/saved/review one.json", "--repo", "/repo"],
    ]);
    for (const { options } of h.reviewCalls) assert.deepEqual(options, { on: machine, cwd: "/repo", timeout: 10000 });
    assert.equal(h.clipboard, [
      "# Review comments: repo@main/worktree/abc123",
      `Repository: /repo (${machine ?? "local"})`,
      "### src/example.js:4-6 [old] [issue]\n\nHandle missing input.\nKeep the fallback.",
      "### review\n\nAdd an example.",
    ].join("\n\n"));
    assert.equal(h.clipboardWrites.length, 1);
    assert.equal(h.toasts.at(-1).level, "success");
    assert.equal(h.review.copying.size, 0);
  });
}

test("multiple saved reviews require an explicit choice, including reviews with no comments", async () => {
  const h = harness(), controls = controlsHarness();
  const older = { ...savedReview("/saved/older.json", "repo@main/commits/old"), updated_at: "2026-11-12T12:00:00Z" };
  const newer = { ...savedReview("/saved/newer.json", "repo@main/worktree/new"), comment_count: 0 };
  h.sessions = [older, newer];
  h.comments.set(older.path, savedComments);
  await h.discover();
  h.review.copyComments(h.cx);
  await h.settle();
  h.review.sync(h.renderCx);
  assert.equal(h.clipboard, "existing clipboard");
  assert.equal(h.reviewCalls.length, 1);
  const popup = h.overlays[0];
  assert.deepEqual(popup.props.sessions.map(s => s.path), [newer.path, older.path]);

  // A path that wasn't offered cannot be used as a clipboard source.
  h.review.copyComments(h.cx, { choice: popup.props.choice, path: "/unlisted.json" });
  assert.equal(h.reviewCalls.length, 1);
  controls.p = { ...popup.props, overlay: "copy-popup" };
  controls.state = h.shared["tuicr-review.ui"];
  controls.controls.init({}, { focus_handle: () => ({}) });
  controls.inputs[0].set_value("COMMITS");
  assert.deepEqual(controls.controls.pickerRows().map(s => s.path), [older.path]);
  controls.controls.render();
  controls.inputs[0].submit();
  assert.deepEqual(controls.closed, ["copy-popup"]);
  h.shared["tuicr-review.request"] = controls.sent[0];
  h.review.sync(h.renderCx);
  h.tick();
  await h.settle();
  assert.deepEqual(h.reviewCalls[1].args, ["review", "comments", "--session", older.path, "--repo", "/repo"]);
  assert(h.clipboard.includes(older.slug));
  assert(!h.clipboard.includes(newer.slug));
});

for (const { name, sessions, response, expected } of [
  { name: "no saved reviews", sessions: [], expected: /No saved reviews.*:w/ },
  { name: "no saved comments", sessions: [savedReview()], expected: /No saved comments.*:w/ },
  { name: "an unsupported CLI", response: { code: 2, stderr: "unrecognized subcommand 'review'" }, expected: /Couldn't copy.*unrecognized/ },
  { name: "a disconnected machine", response: new Error("machine unavailable"), expected: /Couldn't copy.*machine unavailable/ },
  { name: "invalid JSON", response: { code: 0, stdout: "not JSON" }, expected: /Couldn't copy/ },
  { name: "an invalid session list", response: { code: 0, stdout: '{"error":"failed"}' }, expected: /invalid review response/ },
]) {
  test(`Copy comments preserves the clipboard for ${name}`, async () => {
    const h = harness();
    h.sessions = sessions ?? [];
    if (response) h.reviewResponses.set("list", response);
    await h.discover();
    h.review.copyComments(h.cx);
    await h.settle();
    assert.equal(h.clipboard, "existing clipboard");
    assert.equal(h.clipboardWrites.length, 0);
    assert.match(h.toasts.at(-1).body, expected);
    assert.equal(h.review.copying.size, 0);
  });
}

test("comment-read and clipboard failures are reported without a success notification", async () => {
  for (const failure of ["read", "shape", "clipboard"]) {
    const h = harness();
    h.sessions = [savedReview()];
    h.comments.set(h.sessions[0].path, savedComments);
    if (failure === "read") h.reviewResponses.set("comments", { code: 1, stderr: "session no longer exists" });
    if (failure === "shape") h.comments.set(h.sessions[0].path, [{ location: "x", content: null }]);
    if (failure === "clipboard") h.cx.write_to_clipboard = () => { throw new Error("clipboard unavailable"); };
    await h.discover();
    h.review.copyComments(h.cx);
    await h.settle();
    assert.equal(h.clipboard, "existing clipboard");
    assert.equal(h.toasts.at(-1).level, "error");
    assert.equal(h.review.copying.size, 0);
  }
});

for (const phase of ["list", "comments"]) {
  test(`late ${phase} responses cannot copy after a workspace, source, or target change`, async () => {
    for (const change of ["workspace", "source", "target"]) {
      const h = harness();
      h.sessions = [savedReview()];
      h.comments.set(h.sessions[0].path, savedComments);
      let finish, entered;
      h.reviewGates.set(phase, new Promise(resolve => { finish = resolve; }));
      const reading = new Promise(resolve => { entered = resolve; });
      h.reviewStarts.set(phase, entered);
      await h.discover();
      h.review.copyComments(h.cx);
      await reading;
      if (change === "workspace") h.workspace = "workspace-b";
      if (change === "source") h.cwd = "/another-repository";
      if (change === "target") h.review.targets[h.review.current.repo] = "another-review";
      finish();
      await h.settle();
      assert.equal(h.clipboard, "existing clipboard");
      assert.equal(h.overlays.length, 0);
      assert.equal(h.toasts.length, 0);
      assert.equal(h.review.copying.size, 0);
    }
  });
}

test("copy requests are deduplicated per workspace and another workspace can copy independently", async () => {
  const h = harness();
  h.sessions = [savedReview()];
  h.comments.set(h.sessions[0].path, savedComments);
  let finish;
  h.reviewGates.set("list", new Promise(resolve => { finish = resolve; }));
  await h.discover();
  h.review.copyComments(h.cx);
  const first = h.tasks.shift();
  h.review.copyComments(h.cx);
  assert.equal(h.reviewCalls.length, 1);
  h.reviewGates.delete("list");
  h.workspace = "workspace-b";
  h.review.sync(h.renderCx);
  h.review.copyComments(h.cx);
  await h.settle();
  assert.equal(h.clipboardWrites.length, 1);
  finish();
  await first;
  assert.equal(h.clipboardWrites.length, 1);
  assert.equal(h.review.copying.size, 0);
});

test("stale copy requests and session choosers cannot read a different review", async () => {
  const h = harness(), controls = controlsHarness();
  await h.discover();
  const repo = h.review.current.repo, target = h.review.target();
  h.shared["tuicr-review.request"] = { token: "copy", repo, target, action: "copy" };
  h.review.sync(h.renderCx);
  h.review.targets[repo] = "changed-target";
  h.tick();
  await h.settle();
  assert.equal(h.reviewCalls.length, 0);
  controls.p = { copyPicker: true, repo, target, overlay: "old-popup", sessions: [savedReview()] };
  controls.controls.init({}, { focus_handle: () => ({}) });
  for (const state of [{ repo, target: "changed-target" }, { repo: "another-workspace", target }]) {
    controls.state = state;
    controls.controls.choose(savedReview());
  }
  assert.equal(controls.sent.length, 0);
  assert.deepEqual(controls.closed, ["old-popup", "old-popup"]);
});

test("Copy comments is disabled during a copy or when the source is unavailable", () => {
  const h = controlsHarness();
  h.controls.init({}, {});
  for (const state of [{ available: true, copying: true }, { available: false }, { available: true, busy: true }]) {
    h.state = { repo: "a", target: "a", ...state };
    h.controls.render();
    h.clicks.get("review-copy")();
  }
  assert.equal(h.sent.length, 0);
});

test("changing targets saves and exits previous processes instead of accumulating them", async () => {
  const h = harness();
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  for (const [mode, range] of [["worktree", ""], ["range", "HEAD~1..HEAD"], ["range", "main..feature"]]) {
    h.review.start(mode, range, h.cx);
    await h.settle();
    assert.equal(h.live.filter(t => t.state === "live").length, 1);
    assert.equal(Object.keys(h.review.runs).length, 1);
  }
  assert.deepEqual(h.stopped, ["dev/t1", "dev/t2", "dev/t3"]);
  assert(!h.coreCalls.some(args => args[0] === "kill"));
});

for (const change of ["hide", "files", "workspace", "source", "no-source"]) {
  test(`a ${change} change retires the background review after layout settles`, async () => {
    const h = harness();
    await h.discover();
    h.review.start("range", "HEAD~2..HEAD", h.cx);
    await h.settle();
    if (change === "hide") h.tree.children[0].hidden = true;
    if (change === "files") h.tree.children[0].children[0].active = "files";
    if (change === "workspace") h.workspace = "workspace-b";
    if (change === "source") h.cwd = "/another-source";
    if (change === "no-source") { h.cwd = ""; h.tab = "empty-tab"; }
    h.review.sync(h.renderCx);
    assert.equal(h.stopped.length, 0, "cleanup must run outside render");
    assert.equal(content(h).terminal, undefined, "detach before exit can rewrite the layout");
    h.tick();
    await h.settle();
    assert.deepEqual(h.stopped, ["dev/t1"]);
    assert.equal(h.live[0].state, "exited");
  });
}

test("reopening a closed review restarts its remembered range without reusing its exited address", async () => {
  const h = harness();
  await h.discover();
  h.review.start("range", "main..feature", h.cx);
  await h.settle();
  h.tree.children[0].hidden = true;
  h.review.sync(h.renderCx);
  h.tick();
  await h.settle();
  h.review.open(h.cx);
  await h.settle();
  assert.deepEqual(h.launched[1].slice(-2), ["-r", "main..feature"]);
  assert.equal(h.review.address(), "dev/t2");
  assert.equal(h.live.filter(t => t.state === "live").length, 1);
});

test("rapid hide and reopen cancels cleanup before it starts", async () => {
  const h = harness();
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  h.tree.children[0].hidden = true;
  h.review.sync(h.renderCx);
  h.review.open(h.cx);
  h.tick();
  await h.settle();
  assert.equal(h.stopped.length, 0);
  assert.equal(h.launched.length, 1);
});

for (const cwd of ["/repo", "/repo/src", "/repo-other"]) {
  test(`cold discovery preserves only reviews containing the source ${cwd}`, async () => {
    const h = harness();
    await h.discover();
    h.review.open(h.cx);
    await h.settle();
    h.cwd = cwd;
    h.review.probes = {};
    h.review.sync(h.renderCx);
    assert.equal(h.review.current, null);
    h.tick();
    await h.settle();
    if (cwd === "/repo-other") {
      assert.deepEqual(h.stopped, ["dev/t1"], "a common path prefix is not the same repository");
      return;
    }
    assert.equal(h.stopped.length, 0);
    h.review.sync(h.renderCx);
    h.tick();
    await h.settle();
    assert.equal(h.review.address(), "dev/t1");
    assert.equal(h.stopped.length, 0);
  });
}

test("reopening during retirement waits for it before starting a replacement", async () => {
  const h = harness();
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  let release, entered;
  h.stopGates.set("dev/t1", new Promise(resolve => { release = resolve; }));
  const stopping = new Promise(resolve => { entered = resolve; });
  h.stopStarts.set("dev/t1", entered);
  h.tree.children[0].hidden = true;
  h.review.sync(h.renderCx);
  h.tick();
  await stopping;
  h.review.open(h.cx);
  assert.equal(h.launched.length, 1);
  release();
  await h.settle();
  assert.deepEqual(h.stopped, ["dev/t1"]);
  assert.equal(h.launched.length, 2);
  assert.equal(h.review.address(), "dev/t2");
});

test("late launches are retired after their panel closes or their source changes", async () => {
  for (const change of ["hide", "workspace", "close"]) {
    const h = harness();
    await h.discover();
    let release;
    h.launchGates.set(h.workspace, new Promise(resolve => { release = resolve; }));
    h.review.open(h.cx);
    if (change === "hide") h.tree.children[0].hidden = true;
    if (change === "workspace") h.workspace = "workspace-b";
    if (change === "close") await h.review.close();
    release();
    await h.settle();
    h.tick();
    await h.settle();
    assert.equal(h.live[0].state, "exited", change);
    assert.equal(h.launched.length, 1);
  }
});

test("reload cleanup retires obsolete, duplicate, and legacy labeled reviews only", async () => {
  const h = harness();
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  const active = h.live[0];
  h.live.push(
    { ...active, address: "dev/duplicate" },
    { address: "dev/legacy", state: "live", labels: {
      "tuicr-review.panel": "tuicr", "tuicr-review.target": '["dev","/repo","commits",""]',
    } },
    { address: "dev/deleted-workspace", state: "live", labels: {
      "tuicr-review.panel": "tuicr", "tuicr-review.target": '["deleted","dev","/repo","commits",""]',
    } },
    { address: "dev/manual", state: "live", labels: {} },
    { address: "dev/other-mod", state: "live", labels: { "other.panel": "tuicr" } },
  );
  h.review.runs.obsolete = "dev/exited";
  h.review.sync(h.renderCx);
  h.tick();
  await h.settle();
  assert.deepEqual(h.stopped.sort(), ["dev/deleted-workspace", "dev/duplicate", "dev/legacy"]);
  assert.equal(h.review.address(), "dev/t1");
  assert.equal(h.review.runs.obsolete, undefined);
  assert.equal(h.live.find(t => t.address === "dev/manual").state, "live");
  assert.equal(h.live.find(t => t.address === "dev/other-mod").state, "live");
});

test("a comment editor, external editor, or failed save keeps the old review and blocks replacement", async () => {
  for (const reason of ["comment", "editor", "save"]) {
    const h = harness();
    await h.discover();
    h.review.open(h.cx);
    await h.settle();
    const target = h.review.target();
    if (reason === "comment") h.screens.set("dev/t1", "tuicr\n COMMENT    ctrl-s save · esc cancel");
    if (reason === "editor") h.foregrounds.set("dev/t1", "nvim");
    if (reason === "save") h.stopFailures.add("dev/t1");
    h.review.start("worktree", "", h.cx);
    await h.settle();
    assert.equal(h.launched.length, 1);
    assert.equal(h.live[0].state, "live");
    assert.equal(h.review.target(), target);
    assert.equal(h.review.address(), "dev/t1");
    assert.equal(h.toasts.at(-1).action.args.terminal, "dev/t1");
    assert(h.review.errors[h.review.current.repo]);
    assert(!h.coreCalls.some(args => args[0] === "kill"));
    if (reason !== "save") assert.equal(h.stopped.length, 0);
  }
});

test("failed background cleanup reports once and does not repeatedly type into a draft", async () => {
  const h = harness();
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  h.screens.set("dev/t1", "tuicr\n COMMENT    ctrl-s save · esc cancel");
  h.tree.children[0].hidden = true;
  h.review.sync(h.renderCx);
  h.tick();
  await h.settle();
  const calls = h.coreCalls.length;
  h.review.sync(h.renderCx);
  h.tick();
  await h.settle();
  assert.equal(h.coreCalls.length, calls);
  assert.equal(h.stopped.length, 0);
  assert.equal(h.toasts.length, 1);
});

test("the tab controller close hook retires reviews and prevents later launches", async () => {
  const h = harness();
  const { tabs } = tabsHarness(h);
  await h.discover();
  h.review.open(h.cx);
  await h.settle();
  await tabs.close();
  h.review.open(h.cx);
  h.review.start("worktree", "", h.cx);
  h.tick();
  await h.settle();
  assert.equal(h.live[0].state, "exited");
  assert.equal(h.launched.length, 1);
});
