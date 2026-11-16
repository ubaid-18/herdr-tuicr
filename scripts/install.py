#!/usr/bin/env python3
"""Install into a new personal layout. Dry run by default; never overwrite."""

import argparse
import copy
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MOD = "tuicr-review"
FILES = ("main.js", "tabs.js", "controls.js", "controller.js", "quit.sh", "review.svg", "mod.json")


def find(node, name):
    if node.get("id") == name:
        return node
    for child in node.get("children", []):
        result = find(child, name)
        if result is not None:
            return result
    return None


def integrate(original):
    tree = copy.deepcopy(original)
    tabs, panel, body = (find(tree, name) for name in ("tabs", "panel", "panel-body"))
    if tabs is None or panel is None or body is None:
        raise ValueError("Requires a main-style layout with tabs, panel, and panel-body")
    if tabs.get("content", {}).get("mod") != "tabs":
        raise ValueError("Custom tab bar detected; integrate manually to preserve it")
    if body.get("type") != "stack" or not isinstance(body.get("children"), list):
        raise ValueError("panel-body must be a stack with children")
    for name in ("review", "review-controls", "review-terminal"):
        if find(tree, name) is not None:
            raise ValueError(f"Existing {name} node: merge manually, do not overwrite")
    tabs["content"] = {"mod": MOD, "props": {"role": "tabs"}}
    body["children"].append(json.loads((ROOT / "examples/review-node.json").read_text()))
    panel.pop("max", None)
    return tree


def update_clone(target, expected, tree):
    """Edit only the new named clone; its separately saved click/look state stays."""
    if target.is_symlink() or target.read_text() != expected:
        raise ValueError(f"Layout changed during installation: {target}")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=target.parent,
            prefix=f".{target.name}.", suffix=".tmp", delete=False
        ) as stream:
            temporary = Path(stream.name)
            os.chmod(temporary, stat.S_IMODE(target.stat().st_mode))
            stream.write(json.dumps(tree, indent=2) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        if target.is_symlink() or target.read_text() != expected:
            raise ValueError(f"Layout changed during installation: {target}")
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path(
        os.environ.get("HERDR_APP_HOME") or
        str(Path(os.environ.get("XDG_CONFIG_HOME", "~/.config")) / "herdr-app")).expanduser())
    parser.add_argument("--layout", default="main", help="compatible source layout")
    parser.add_argument("--as", dest="target", default="main-tuicr", help="new layout name")
    parser.add_argument("--apply", action="store_true", help="copy, check, clone and switch")
    args = parser.parse_args(argv)
    for name in (args.layout, args.target):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", name):
            parser.error("Layout names may contain letters, numbers, hyphens, underscores")
    home = args.home.expanduser().resolve()
    destination = home / "mods" / MOD
    source = home / "layouts" / f"{args.layout}.json"
    target = home / "layouts" / f"{args.target}.json"
    if destination.exists() or destination.is_symlink():
        parser.error(f"Refusing to overwrite {destination}")
    if target.exists() or target.is_symlink():
        parser.error(f"Refusing to overwrite {target}")
    try:
        integrate(json.loads(source.read_text()))
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f"Copy {ROOT / 'mods' / MOD} -> {destination}")
    print(f"Check mod; clone {args.layout} -> {args.target}; integrate and switch")
    print("Runs Git/tuicr on source machines; no program installation or key changes.")
    if not args.apply:
        print("Dry run only. Add --apply to install.")
        return 0
    if not shutil.which("herdr-app"):
        parser.error("herdr-app must be on PATH")
    env = {**os.environ, "HERDR_APP_HOME": str(home)}

    def command(*argv, quiet=False):
        result = subprocess.run(
            ["herdr-app", *argv], env=env, text=True, capture_output=True, check=True
        )
        if result.stdout and not quiet:
            print(result.stdout.strip())
        return result

    try:
        # Fail before copying anything when the selected app home isn't running.
        command("status", quiet=True)
        destination.mkdir(parents=True, exist_ok=False)
        for filename in FILES:
            shutil.copyfile(ROOT / "mods" / MOD / filename, destination / filename)
        command("check", str(destination))
        command("do", "layout.clone", json.dumps({"name": args.layout, "as": args.target}))
        # layout.set applies to the active layout and clears its click/look
        # state. Edit the specific clone instead; Herdr's watcher merges the
        # structural change with the state copied by layout.clone.
        expected = target.read_text()
        tree = integrate(json.loads(expected))
        update_clone(target, expected, tree)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        detail = (exc.stderr or exc.stdout or str(exc)) if isinstance(exc, subprocess.CalledProcessError) else str(exc)
        print(f"Install stopped: {detail}", file=sys.stderr)
        print(f"No existing files were overwritten. Inspect {destination} and {target}.",
              file=sys.stderr)
        print(f"Your original layout is {args.layout}; switch back if a clone was opened.",
              file=sys.stderr)
        return 1
    print(f"Installed. Original layout {args.layout} is unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
