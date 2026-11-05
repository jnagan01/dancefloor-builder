"""Hosted synthetic suites only. Durable evidence survives interruption."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import re

SUITES = {
    "reporting": ["python3", "-m", "unittest", "discover", "-s", ".github/weekly", "-p", "test_*.py", "-v"],
    "vitest": ["bunx", "vitest", "run", "--reporter=default", "--reporter=json", "--outputFile=test-results/weekly/vitest.json"],
    "adversarial": ["bunx", "vitest", "run", "tests/weeklyAdversarial.test.ts", "--reporter=json", "--outputFile=test-results/weekly/adversarial.json"],
    "native": ["node", "tests/native/run.mjs"],
    "offline": ["node", "tests/native/offline.mjs"],
    "race": ["node", "tests/native/offline-ui-race.mjs"],
    "prep": ["node", "tests/native/prep.mjs"],
}


def valid_vitest(data):
    return (data.get("success") is True and data.get("numTotalTests", 0) > 0
            and data.get("numPassedTests") == data.get("numTotalTests")
            and data.get("numPendingTests", 0) == 0 and data.get("numTodoTests", 0) == 0)


def main():
    output = Path("test-results/weekly")
    output.mkdir(parents=True, exist_ok=True)
    seed = os.environ.get("WEEKLY_SEED", "20261105")
    if not seed.isdigit() or not 0 <= int(seed) <= 4294967295:
        raise ValueError("seed must be uint32")
    os.environ["WEEKLY_SEED"] = seed
    result = {"schema": 1, "commit": os.environ.get("GITHUB_SHA", "local"),
              "run_id": os.environ.get("GITHUB_RUN_ID", "local"), "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT", "1"), "seed": seed,
              "limits": {"records": 100000, "import_bytes": 5242880, "minutes": 45},
              "suites": {name: {"status": "not_run"} for name in SUITES}}
    def persist():
        temp = output / "result.tmp"
        temp.write_text(json.dumps(result, indent=2))
        temp.replace(output / "result.json")
    persist()
    end = time.monotonic() + 38 * 60
    for name, command in SUITES.items():
        if time.monotonic() >= end:
            break
        entry = result["suites"][name]
        entry.update(status="running")
        persist()
        start = time.monotonic()
        with (output / f"{name}.log").open("w") as log:
            proc = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                code = proc.wait(timeout=min(12 * 60, max(1, end - start)))
                entry.update(status="passed" if code == 0 else "failed", exit_code=code)
                if code == 0 and name in ("vitest", "adversarial"):
                    try:
                        data = json.loads((output / f"{name}.json").read_text())
                        entry["tests"] = data.get("numTotalTests", 0)
                        if not valid_vitest(data):
                            entry["status"] = "incomplete"
                    except (OSError, ValueError):
                        entry["status"] = "incomplete"
                if code == 0 and name in ("native", "offline", "race", "prep"):
                    log.flush()
                    text = (output / f"{name}.log").read_text()
                    patterns = {"native": r"Native checks: ([1-9][0-9]*) passed\.",
                                "offline": r"([1-9][0-9]*) offline Electron flows passed",
                                "race": r"offline UI race checks passed",
                                "prep": r"Preparation UI checks: ([1-9][0-9]*) passed\."}
                    found = re.search(patterns[name], text)
                    checks = len(re.findall(r"^PASS ", text, re.MULTILINE))
                    entry["checks"] = checks
                    if not found or checks == 0 or (found.groups() and int(found[1]) != checks):
                        entry["status"] = "incomplete"
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                entry["status"] = "timeout"
        entry["seconds"] = round(time.monotonic() - start, 2)
        persist()
    return 0 if all(s["status"] == "passed" for s in result["suites"].values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())