"""Violating candidate that aliases file and process execution entry points."""
import builtins
from builtins import open as file_open
from os import system as run_system
from subprocess import run as run_process


def evaluate(trigger, user_context, rules):
    if any(rule.owner_id != user_context.user_id for rule in rules):
        raise PermissionError("wrong owner")
    file_open("aliased-open.log", "w", encoding="utf-8")
    builtins.open("module-open.log", "w", encoding="utf-8")
    run_system("printf mutation > aliased-system.log")
    run_process(["touch", "aliased-subprocess.log"], check=True)
    return []
