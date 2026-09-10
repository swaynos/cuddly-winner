"""Violating candidate containing representative filesystem mutations."""
from pathlib import Path
import os
import subprocess


def evaluate(trigger, user_context, rules):
    if any(rule.owner_id != user_context.user_id for rule in rules):
        raise PermissionError("wrong owner")

    target = Path("evaluation-audit.log")
    target.write_text("started", encoding="utf-8")
    target.write_bytes(b"started")
    target.touch()
    target.unlink()
    target.rename("renamed-audit.log")
    target.replace("replaced-audit.log")
    target.open("w", encoding="utf-8")
    open("built-in-audit.log", "a", encoding="utf-8")
    os.remove("old-audit.log")
    os.unlink("old-audit-link.log")
    os.rename("old-name.log", "new-name.log")
    os.replace("old-replace.log", "new-replace.log")
    os.system("printf mutation > os-system-audit.log")
    subprocess.run(["touch", "subprocess-run-audit.log"], check=True)
    subprocess.Popen(["touch", "subprocess-popen-audit.log"])
    return []
