import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { props, shared, setShared, theme, openOverlay, closeOverlay } from "herdr";

export class ReviewControls {
  init(_props, cx) {
    if (props()?.picker) {
      this.handle = cx.focus_handle();
      this.at = 0;
      this.filter = InputState.new({ placeholder: "Search local and remote branches…" });
      this.base = InputState.new({ placeholder: "Base revision", value: "HEAD" });
      this.filter.on("change", (_e, cx) => { this.at = 0; cx.notify(); });
      this.filter.on("submit", () => this.choose(this.branchRows()[this.at]));
      this.filter.focus();
      return;
    }
    this.ranges = JSON.parse(localStorage.getItem("tuicr-review.ranges") ?? "{}");
    this.range = InputState.new({ placeholder: "main..HEAD" });
    this.range.on("change", () => {
      if (!this.context) return;
      this.ranges[this.context] = this.range.value();
      localStorage.setItem("tuicr-review.ranges", JSON.stringify(this.ranges));
    });
    this.range.on("submit", () => this.request("start", "range", this.range.value()));
  }

  request(action, mode, range = "") {
    const state = shared("tuicr-review.ui");
    if (!state?.available || state.busy) return;
    setShared("tuicr-review.request", { token: `${Date.now()}-${Math.random()}`, repo: state.repo, action, mode, range });
  }

  branchRows() {
    const query = this.filter.value().trim().toLowerCase();
    return (props()?.branches ?? []).filter(branch => branch.name.toLowerCase().includes(query));
  }

  choose(branch) {
    const p = props(), state = shared("tuicr-review.ui");
    if (!branch || state?.repo !== p.repo || state.busy) return;
    const base = this.base.value().trim() || "HEAD";
    // Pass the full refname as part of one argument; never evaluate shell text.
    if (base.startsWith("-") || /[\x00-\x20]/.test(base) || base.includes("..")) return;
    setShared("tuicr-review.request", { token: `${Date.now()}-${Math.random()}`, repo: p.repo,
      action: "start", mode: "range", range: `${base}..${branch.ref}`, fromBranch: true });
    closeOverlay(p.overlay);
  }

  picker() {
    const t = theme(), rows = this.branchRows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const start = Math.max(0, this.at - 7);
    return v_flex().id("review-branches").track_focus(this.handle).w_full().p(14).gap(10)
      .bg(t.popover).text_color(t.foreground).text_size(12)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); closeOverlay(props().overlay); return; }
        if (!["up", "down"].includes(e.key)) return;
        cx.stop_propagation();
        if (rows.length) this.at = (this.at + (e.key === "down" ? 1 : -1) + rows.length) % rows.length;
        cx.notify();
      })
      .child(div().font_semibold().child("Review another branch"))
      .child(div().text_color(t.muted).child("Compare base → selected branch. No checkout or fetch."))
      .child(h_flex().h(28).items_center().gap(8)
        .child(div().w(40).child("Base"))
        .child(div().flex_1().h_full().px(6).rounded(4).bg(t.background).border_1().border_color(t.border)
          .child(Input.new(this.base).h_full())))
      .child(div().h(30).px(6).rounded(4).bg(t.background).border_1().border_color(t.accent)
        .child(Input.new(this.filter).h_full()))
      .child(v_flex().h(256).gap(2).children(rows.slice(start, start + 8).map((branch, i) =>
        h_flex().id(`branch-${branch.ref}`).h(30).flex_none().px(8).gap(8).items_center().rounded(5)
          .when(start + i === this.at, el => el.bg(t.selected))
          .hover(el => el.bg(t.hover)).cursor_pointer().on_click(() => this.choose(branch))
          .child(div().flex_1().truncate().child(branch.name))
          .child(div().text_color(t.dim).text_size(10).child(branch.remote ? "remote" : "local"))))
        .when(!rows.length, el => el.child(div().text_color(t.dim).child("No matching branches"))))
      .child(div().text_color(t.muted).text_size(11).child("↑/↓ select · Enter review · Esc cancel · Base defaults to HEAD"));
  }

  render() {
    if (props()?.picker) return this.picker();
    const t = theme(), state = shared("tuicr-review.ui") ?? {};
    // Each workspace/repository gets its own draft, including unsubmitted text.
    // Keep the current input during an availability refresh, but clear it when
    // moving to a different workspace while its repository is still loading.
    if (!props()?.empty && (state.repo && state.repo !== this.context
        || state.workspace !== this.workspace)) {
      this.workspace = state.workspace;
      this.context = state.repo ?? null;
      this.range.set_value(this.ranges[this.context] ?? "");
    }
    const request = shared("tuicr-review.request");
    if (!props()?.empty && request?.fromBranch && request.repo === this.context
        && request.token !== this.branchRequest) {
      this.branchRequest = request.token;
      this.range.set_value(request.range);
    }
    if (props()?.empty) return v_flex().size_full().p(16).gap(8).bg(t.background).text_color(t.muted).text_size(12)
      .child(div().child(state.busy ? "Starting tuicr…" : state.loading ? "Checking repository and tuicr…"
        : state.error || (state.available ? "Choose Commits, Working tree, or enter a commit range above."
          : "No available repository review in this workspace.")))
      .child(div().child("Reviews run on the repository's machine and stay running when hidden."))
      .child(div().child("Inside tuicr: ? help · c comment · y export · q quit"));
    const button = (id, label, action) => div().id(id).px(8).h(26).flex_none().flex().items_center().rounded(5)
      .bg(t.raised).text_color(state.busy ? t.dim : t.foreground)
      .when(!state.busy, el => el.cursor_pointer().hover(s => s.bg(t.hover)))
      .on_click(action).child(label);
    return v_flex().size_full().p(10).gap(6).bg(t.chrome).text_color(t.foreground).text_size(11)
      .child(h_flex().gap(8).items_center()
        .child(div().font_semibold().child("Review"))
        .child(div().flex_1().truncate().text_color(t.muted).child(`${state.on ?? "Local"} · ${state.root ?? ""}`)))
      .child(h_flex().gap(6)
        .child(button("review-commits", "Commits", () => this.request("start", "commits")))
        .child(button("review-worktree", "Working tree", () => this.request("start", "worktree")))
        .child(button("review-branch", "Branch…", () => {
          if (!state.available || state.busy) return;
          openOverlay({ mod: "tuicr-review", kind: "popup", width: 520, height: 450,
            props: { picker: true, repo: state.repo, branches: state.branches ?? [] } });
        }))
        .when(!!state.terminal, el => el.child(button("review-focus", "Focus", () => this.request("focus")))))
      .child(h_flex().h(26).gap(6)
        .child(div().flex_1().min_w(0).px(6).rounded(4).bg(t.background).border_1().border_color(t.border)
          .child(Input.new(this.range).h_full().text_color(t.foreground)))
        .child(button("review-range", "Range", () => this.request("start", "range", this.range.value()))))
      .when(!!state.error, el => el.child(div().truncate().text_color(t.blocked).child(state.error)));
  }
}
