"""
Read-only production verification harness (docs/OIT_READINESS_AUDIT.md, R11).

Runs a series of unauthenticated, non-destructive checks against a deployed
backend to confirm the security posture is intact after a deploy. It verifies:

  - /api/health returns 200
  - security headers are present
  - authenticated endpoints reject anonymous requests (401)
  - Canvas ingestion endpoints reject anonymous requests (401)
  - CORS preflight echoes an allowed origin and is restrictive otherwise

This does NOT exercise the OAuth round-trip or write any data; follow the manual
steps in docs/PROD_VERIFICATION.md for the authenticated flow.

Usage:
    python tools/verify_deploy.py https://your-backend.run.app \
        --origin https://canvassync.app
Exit code is non-zero if any check fails.
"""

from __future__ import annotations

import argparse
import sys

import requests

REQUIRED_SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Strict-Transport-Security": None,  # presence only
    "Content-Security-Policy": None,
}

# Endpoints that must reject anonymous access.
PROTECTED_GET = ["/api/auth/me", "/api/user/data", "/api/user/export"]
PROTECTED_POST = ["/api/canvas/courses", "/api/sync_assignments", "/api/user/disconnect-canvas"]


class Checker:
    def __init__(self, base_url: str, origin: str):
        self.base = base_url.rstrip("/")
        self.origin = origin
        self.failures: list[str] = []
        self.passes = 0

    def check(self, name: str, condition: bool, detail: str = ""):
        if condition:
            self.passes += 1
            print(f"  PASS  {name}")
        else:
            self.failures.append(f"{name} {('- ' + detail) if detail else ''}")
            print(f"  FAIL  {name}  {detail}")

    def run(self):
        print(f"Verifying {self.base} (origin={self.origin})\n")

        # 1. Health
        try:
            r = requests.get(f"{self.base}/api/health", timeout=15)
            self.check("health 200", r.status_code == 200, f"got {r.status_code}")
            for header, expected in REQUIRED_SECURITY_HEADERS.items():
                present = header in r.headers
                ok = present and (expected is None or r.headers.get(header) == expected)
                self.check(f"header {header}", ok, r.headers.get(header, "missing"))
        except requests.RequestException as exc:
            self.check("health reachable", False, str(exc))
            return self.summary()

        # 2. Protected endpoints reject anonymous access
        for path in PROTECTED_GET:
            try:
                r = requests.get(f"{self.base}{path}", timeout=15)
                self.check(f"GET {path} requires auth", r.status_code in (401, 403), f"got {r.status_code}")
            except requests.RequestException as exc:
                self.check(f"GET {path} reachable", False, str(exc))
        for path in PROTECTED_POST:
            try:
                r = requests.post(f"{self.base}{path}", json={}, timeout=15)
                self.check(f"POST {path} requires auth", r.status_code in (401, 403), f"got {r.status_code}")
            except requests.RequestException as exc:
                self.check(f"POST {path} reachable", False, str(exc))

        # 3. CORS preflight: allowed origin echoed
        try:
            r = requests.options(
                f"{self.base}/api/auth/me",
                headers={
                    "Origin": self.origin,
                    "Access-Control-Request-Method": "GET",
                },
                timeout=15,
            )
            allow_origin = r.headers.get("Access-Control-Allow-Origin")
            self.check("CORS allows configured origin", allow_origin == self.origin, f"got {allow_origin}")
        except requests.RequestException as exc:
            self.check("CORS preflight reachable", False, str(exc))

        # 4. CORS preflight: disallowed origin NOT echoed
        try:
            evil = "https://evil.example.com"
            r = requests.options(
                f"{self.base}/api/auth/me",
                headers={"Origin": evil, "Access-Control-Request-Method": "GET"},
                timeout=15,
            )
            allow_origin = r.headers.get("Access-Control-Allow-Origin")
            self.check("CORS rejects unknown origin", allow_origin != evil, f"echoed {allow_origin}")
        except requests.RequestException as exc:
            self.check("CORS reachable", False, str(exc))

        return self.summary()

    def summary(self) -> int:
        print(f"\n{self.passes} passed, {len(self.failures)} failed")
        if self.failures:
            print("Failures:")
            for f in self.failures:
                print(f"  - {f}")
            return 1
        return 0

    def to_dict(self) -> dict:
        return {
            "base_url": self.base,
            "origin": self.origin,
            "passes": self.passes,
            "failures": self.failures,
            "ok": len(self.failures) == 0,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only backend verification")
    parser.add_argument("base_url", help="Backend base URL, e.g. https://x.run.app")
    parser.add_argument("--origin", default="https://canvassync.app", help="An allowed frontend origin")
    parser.add_argument("--json-out", default="", help="Write JSON results to this path")
    args = parser.parse_args()
    checker = Checker(args.base_url, args.origin)
    code = checker.run()
    if args.json_out:
        import json
        from pathlib import Path
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(checker.to_dict(), indent=2), encoding="utf-8")
        print(f"Wrote {out}")
    return code


if __name__ == "__main__":
    sys.exit(main())
