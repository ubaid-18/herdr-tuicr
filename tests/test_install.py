import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
import io
import shutil
import subprocess
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("install", ROOT / "scripts/install.py")
install = importlib.util.module_from_spec(spec)
spec.loader.exec_module(install)


def layout():
    return {"id": "root", "children": [
        {"id": "tabs", "content": {"mod": "tabs"}},
        {"id": "panel", "max": 900, "children": [
            {"id": "panel-body", "type": "stack", "active": "files", "children": [
                {"id": "files", "content": {"mod": "files"}},
                {"id": "changes", "content": {"mod": "changes"}},
            ]},
        ]},
    ]}


class InstallerTests(unittest.TestCase):
    def test_integrate_preserves_original(self):
        original = layout()
        changed = install.integrate(original)
        self.assertIsNone(install.find(original, "review"))
        self.assertEqual(install.find(original, "tabs")["content"]["mod"], "tabs")
        self.assertEqual(install.find(changed, "tabs")["content"],
                         {"mod": "tuicr-review", "props": {"role": "tabs"}})
        self.assertEqual(len(install.find(changed, "panel-body")["children"]), 3)
        self.assertNotIn("max", install.find(changed, "panel"))

    def test_refuse_custom_tabs(self):
        tree = layout()
        install.find(tree, "tabs")["content"]["mod"] = "my-tabs"
        with self.assertRaisesRegex(ValueError, "Custom tab bar"):
            install.integrate(tree)

    def test_refuse_existing_review(self):
        with self.assertRaisesRegex(ValueError, "Existing review"):
            install.integrate(install.integrate(layout()) | {
                "children": [
                    {"id": "tabs", "content": {"mod": "tabs"}},
                    *install.integrate(layout())["children"][1:],
                ]
            })

    def test_refuse_missing_stack(self):
        with self.assertRaisesRegex(ValueError, "main-style"):
            install.integrate({"id": "root"})

    def test_dry_run_writes_nothing_and_refuses_collisions(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode" if Path("/tmp/opencode").is_dir() else None) as work:
            home = Path(work)
            (home / "layouts").mkdir()
            (home / "layouts/main.json").write_text(json.dumps(layout()))
            with redirect_stdout(io.StringIO()):
                self.assertEqual(install.main(["--home", str(home)]), 0)
            self.assertFalse((home / "mods").exists())
            self.assertFalse((home / "layouts/main-tuicr.json").exists())
            (home / "layouts/main-tuicr.json").write_text("keep me")
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                install.main(["--home", str(home)])
            self.assertEqual((home / "layouts/main-tuicr.json").read_text(), "keep me")

    def test_apply_targets_clone_after_layout_switch_and_preserves_state(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode" if Path("/tmp/opencode").is_dir() else None) as work:
            home = Path(work)
            layouts = home / "layouts"
            states = layouts / ".state"
            states.mkdir(parents=True)
            original = json.dumps(layout())
            (layouts / "main.json").write_text(original)
            personal = layouts / "personal-work.json"
            personal.write_text('{"id":"personal-work","theme":"keep-me"}')
            state = json.dumps({
                "nodes": {"panel": {"size": {"px": 820}, "hidden": False},
                          "panel-body": {"active": "changes"}},
                "theme": "personal-theme",
            })
            (states / "main.json").write_text(state)
            commands = []
            active = "main"

            def app(argv, **kwargs):
                nonlocal active
                self.assertEqual(kwargs["env"]["HERDR_APP_HOME"], str(home))
                commands.append(argv[1:])
                if argv[1:3] == ["do", "layout.clone"]:
                    self.assertEqual(json.loads(argv[3]), {"name": "main", "as": "main-tuicr"})
                    shutil.copyfile(layouts / "main.json", layouts / "main-tuicr.json")
                    shutil.copyfile(states / "main.json", states / "main-tuicr.json")
                    # The user switches away before integration finishes.
                    active = "personal-work"
                if argv[1:3] == ["do", "layout.set"]:
                    (layouts / f"{active}.json").write_text(argv[3])
                    (states / "main-tuicr.json").write_text("{}")
                return subprocess.CompletedProcess(argv, 0, stdout="", stderr="")

            with patch.object(install.shutil, "which", return_value="/bin/herdr-app"), \
                 patch.object(install.subprocess, "run", side_effect=app), \
                 redirect_stdout(io.StringIO()):
                self.assertEqual(install.main(["--home", str(home), "--apply"]), 0)
            self.assertEqual((layouts / "main.json").read_text(), original)
            self.assertEqual(personal.read_text(), '{"id":"personal-work","theme":"keep-me"}')
            self.assertEqual((states / "main.json").read_text(), state)
            self.assertEqual((states / "main-tuicr.json").read_text(), state)
            installed = json.loads((layouts / "main-tuicr.json").read_text())
            self.assertEqual(install.find(installed, "tabs")["content"]["mod"], install.MOD)
            self.assertIsNotNone(install.find(installed, "review-terminal"))
            self.assertFalse(any(cmd[:2] == ["do", "layout.set"] for cmd in commands))
            for filename in install.FILES:
                self.assertEqual((home / "mods" / install.MOD / filename).read_bytes(),
                                 (ROOT / "mods" / install.MOD / filename).read_bytes())

    def test_no_running_app_fails_before_copying(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode" if Path("/tmp/opencode").is_dir() else None) as work:
            home = Path(work)
            (home / "layouts").mkdir()
            (home / "layouts/main.json").write_text(json.dumps(layout()))
            with patch.object(install.shutil, "which", return_value="/bin/herdr-app"), \
                 patch.object(install.subprocess, "run", side_effect=subprocess.CalledProcessError(
                     2, "herdr-app status", stderr="no Herdr window")), \
                 redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(install.main(["--home", str(home), "--apply"]), 1)
            self.assertFalse((home / "mods").exists())
            self.assertFalse((home / "layouts/main-tuicr.json").exists())

    def test_clone_update_refuses_stale_or_symlinked_files(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode" if Path("/tmp/opencode").is_dir() else None) as work:
            target = Path(work) / "clone.json"
            target.write_text("newer user edit")
            with self.assertRaisesRegex(ValueError, "changed during installation"):
                install.update_clone(target, "old snapshot", layout())
            self.assertEqual(target.read_text(), "newer user edit")
            link = Path(work) / "link.json"
            link.symlink_to(target)
            with self.assertRaisesRegex(ValueError, "changed during installation"):
                install.update_clone(link, "newer user edit", layout())
            self.assertEqual(target.read_text(), "newer user edit")
            self.assertEqual(sorted(p.name for p in Path(work).iterdir()), ["clone.json", "link.json"])

    def test_clone_update_failure_leaves_complete_original_and_no_temporary_file(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode" if Path("/tmp/opencode").is_dir() else None) as work:
            target = Path(work) / "clone.json"
            original = json.dumps(layout())
            target.write_text(original)
            with patch.object(install.os, "replace", side_effect=OSError("disk error")), \
                 self.assertRaisesRegex(OSError, "disk error"):
                install.update_clone(target, original, install.integrate(layout()))
            self.assertEqual(target.read_text(), original)
            self.assertEqual(list(Path(work).iterdir()), [target])

    def test_clone_update_detects_edits_while_preparing_replacement(self):
        with tempfile.TemporaryDirectory(dir="/tmp/opencode" if Path("/tmp/opencode").is_dir() else None) as work:
            target = Path(work) / "clone.json"
            original = json.dumps(layout())
            target.write_text(original)
            with patch.object(install.os, "fsync", side_effect=lambda _fd: target.write_text("concurrent edit")), \
                 self.assertRaisesRegex(ValueError, "changed during installation"):
                install.update_clone(target, original, install.integrate(layout()))
            self.assertEqual(target.read_text(), "concurrent edit")
            self.assertEqual(list(Path(work).iterdir()), [target])


if __name__ == "__main__":
    unittest.main()
