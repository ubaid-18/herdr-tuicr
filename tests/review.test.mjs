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
  };
  h.renderCx = { ...h.cx, notify() { throw new Error("notify during render"); } };
  const Review = load("controller.js", "Review", {
    exec: async (command, args) => {
      if (command === "sh") return { code: h.installed ? 0 : 1, stdout: h.installed ? "/bin/tuicr\n" : "" };
      if (args[0] === "for-each-ref") return { code: 0, stdout:
        "refs/heads/main\t\nrefs/heads/feature\t\nrefs/remotes/origin/feature\t\nrefs/remotes/origin/HEAD\trefs/remotes/origin/main\n" };
      return { code: h.git ? 0 : 1, stdout: h.git ? "/repo\n" : "" };
    },
    hc: async args => {
      h.launched.push(args);
      const on = args.includes("--on") ? args[args.indexOf("--on") + 1] : null;
      const address = `${on ? `${on}/` : ""}t${h.launched.length}`;
      const label = args.find(arg => arg.startsWith("tuicr-review.target="));
      const target = label.slice("tuicr-review.target=".length);
      await h.launchGates.get(JSON.parse(target)[0]);
      h.live.push({ address, state: "live", labels: {
        "tuicr-review.panel": "tuicr", "tuicr-review.target": target,
      } });
      return { code: 0, stdout: JSON.stringify({ address }) };
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
    localStorage,
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
  const h = { p: {}, state: {}, sent: [], closed: [], storage: new Map(), inputs: [] };
  const builder = new Proxy({}, { get: () => () => builder });
  const Controls = load("controls.js", "ReviewControls", {
    div: () => builder, h_flex: () => builder, v_flex: () => builder,
    InputState: { new(options = {}) {
      let value = options.value ?? "";
      const handlers = {};
      const input = {
        on(name, fn) { handlers[name] = fn; },
        focus() {}, value: () => value,
        set_value(v) { value = v; handlers.change?.({}, { notify() {} }); },
      };
      h.inputs.push(input);
      return input;
    } },
    Input: { new: () => builder },
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
