#!/usr/bin/env python3
"""Check each role in an isolated app home; never install into the user's home."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "mods" / "tuicr-review"


def main():
    preferred = Path("/tmp/opencode")
    with tempfile.TemporaryDirectory(
        prefix="herdr-tuicr-check-", dir=preferred if preferred.is_dir() else None
    ) as work:
        home = Path(work)
        for role in ("controls", "tabs", "empty", "picker"):
            destination = home / role / "mods" / "tuicr-review"
            shutil.copytree(SOURCE, destination, ignore=shutil.ignore_patterns(
                "*.d.ts", "jsconfig.json", "node_modules"))
            options = {
                "controls": {},
                "tabs": {"role": "tabs"},
                "empty": {"empty": True},
                "picker": {"picker": True, "overlay": "test", "repo": "test", "branches": [
                    {"ref": "refs/heads/example", "name": "example", "remote": False},
                    {"ref": "refs/remotes/origin/example", "name": "origin/example",
                     "remote": True},
                ]},
            }[role]
            # The native check supplies no props. Inject only fixture props into
            # this disposable copy; all element descriptions are the actual code.
            for name in ("main.js", "controls.js"):
                path = destination / name
                source = path.read_text().replace("props()", "fixtureProps()")
                path.write_text(f"const fixtureProps = () => ({json.dumps(options)});\n"
                                + source)
            print(f"Checking {role}", flush=True)
            subprocess.run(
                ["herdr-app", "check", str(destination)],
                env={**os.environ, "HERDR_APP_HOME": str(home / role)},
                check=True,
            )


if __name__ == "__main__":
    main()
