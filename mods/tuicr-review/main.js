import { View } from "gpui-kit";
import { props } from "herdr";
import { ReviewTabs } from "./tabs.js";
import { ReviewControls } from "./controls.js";

// One mod with independent copies: the tab-bar controller, panel controls,
// empty terminal slot, and branch/review popups. All imports stay inside this folder.
export default class TuicrReview extends View {
  init(p, cx) {
    this.view = props()?.role === "tabs" ? new ReviewTabs() : new ReviewControls();
    this.view.init(p, cx);
  }

  render(cx) {
    return this.view.render(cx);
  }
}
