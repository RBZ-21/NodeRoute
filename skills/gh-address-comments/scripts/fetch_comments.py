#!/usr/bin/env python3
"""
fetch_comments.py
-----------------
Fetch unresolved GitHub PR review comments so an AI agent can address them.

Cross-repo / fork-aware: always queries the *base* repository, not the head
(fork) repository, because PR review comments live on the repo the PR targets.

Usage
-----
  # Auto-detect from current branch / gh context:
  python fetch_comments.py

  # Explicit:
  python fetch_comments.py --repo owner/repo --pr 42

  # From a full PR URL:
  python fetch_comments.py --pr-url https://github.com/owner/repo/pull/42

Auth failures (missing / expired token, no gh CLI login) exit with a clear
message and a non-zero exit code — no Python traceback.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from typing import Optional


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _get_token_from_env() -> Optional[str]:
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")


def _get_token_from_gh_cli() -> Optional[str]:
    """Return the token stored by the gh CLI, or None if not available."""
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            return result.stdout.strip() or None
    except FileNotFoundError:
        pass  # gh not installed
    except Exception:  # noqa: BLE001
        pass
    return None


def get_token() -> str:
    """Return a GitHub token or exit cleanly with an actionable message."""
    token = _get_token_from_env() or _get_token_from_gh_cli()
    if not token:
        print(
            "Error: No GitHub token found.\n"
            "  • Set the GITHUB_TOKEN (or GH_TOKEN) environment variable, OR\n"
            "  • Log in with: gh auth login",
            file=sys.stderr,
        )
        sys.exit(1)
    return token


# ---------------------------------------------------------------------------
# PR resolution helpers
# ---------------------------------------------------------------------------

_PR_URL_RE = re.compile(
    r"https?://github\.com/(?P<owner>[^/]+)/(?P<repo>[^/]+)/pull/(?P<number>\d+)"
)


def parse_pr_url(url: str) -> tuple[str, str, int]:
    """Parse a full PR URL into (owner, repo, number)."""
    match = _PR_URL_RE.match(url.strip())
    if not match:
        print(f"Error: Could not parse PR URL: {url!r}", file=sys.stderr)
        sys.exit(1)
    return match.group("owner"), match.group("repo"), int(match.group("number"))


def resolve_pr_from_gh_cli() -> tuple[str, str, int]:
    """
    Use `gh pr view` to find the current PR and — critically — derive the
    *base* (target) repository, not the head/fork repository.

    gh pr view returns baseRepository.nameWithOwner which is always the repo
    the PR was opened *against*, regardless of whether the branch comes from
    a fork.
    """
    try:
        result = subprocess.run(
            ["gh", "pr", "view", "--json", "number,url,baseRepository"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except FileNotFoundError:
        print(
            "Error: 'gh' CLI not found. Install it from https://cli.github.com/",
            file=sys.stderr,
        )
        sys.exit(1)

    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "no pull requests found" in stderr.lower() or "not a git repository" in stderr.lower():
            print(
                "Error: No open pull request found for the current branch.\n"
                "  Use --pr <number> --repo <owner/repo> to specify one explicitly.",
                file=sys.stderr,
            )
        elif "auth" in stderr.lower() or "token" in stderr.lower() or "login" in stderr.lower():
            print(
                f"Error: GitHub authentication failed.\n  {stderr}\n"
                "  Run: gh auth login",
                file=sys.stderr,
            )
        else:
            print(f"Error: gh pr view failed:\n  {stderr}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        print(f"Error: Could not parse gh output: {exc}", file=sys.stderr)
        sys.exit(1)

    pr_number: int = data["number"]

    # baseRepository is always the *target* repo — safe for cross-repo / forked PRs
    base_repo: dict = data.get("baseRepository") or {}
    name_with_owner: str = base_repo.get("nameWithOwner", "")
    if not name_with_owner:
        # Fall back to parsing the PR URL
        return parse_pr_url(data["url"]) 

    owner, _, repo = name_with_owner.partition("/")
    return owner, repo, pr_number


def resolve_pr(
    *,
    pr_url: Optional[str],
    repo: Optional[str],
    pr_number: Optional[int],
) -> tuple[str, str, int]:
    """Resolve to (owner, repo_name, pr_number) from the provided args."""
    if pr_url:
        return parse_pr_url(pr_url)

    if pr_number and repo:
        owner, _, repo_name = repo.partition("/")
        if not owner or not repo_name:
            print(f"Error: --repo must be in 'owner/repo' format, got: {repo!r}", file=sys.stderr)
            sys.exit(1)
        return owner, repo_name, pr_number

    # Neither explicit -- fall back to gh CLI auto-detection (base repo)
    return resolve_pr_from_gh_cli()


# ---------------------------------------------------------------------------
# GitHub API helpers
# ---------------------------------------------------------------------------

def _gh_api(path: str, token: str) -> list | dict:
    """
    Call the GitHub REST API via the gh CLI (handles pagination automatically)
    or fall back to curl when gh is unavailable.
    """
    try:
        result = subprocess.run(
            ["gh", "api", "--paginate", path],
            capture_output=True,
            text=True,
            timeout=30,
            env={**os.environ, "GH_TOKEN": token},
        )
    except FileNotFoundError:
        # gh not installed — fall back to curl
        return _gh_api_curl(path, token)

    if result.returncode != 0:
        stderr = result.stderr.strip()
        if result.returncode == 4 or "401" in stderr or "credentials" in stderr.lower():
            print(
                f"Error: GitHub authentication failed while calling {path}.\n"
                "  Run: gh auth login  (or set GITHUB_TOKEN)",
                file=sys.stderr,
            )
            sys.exit(1)
        print(f"Error: gh api {path} failed:\n  {stderr}", file=sys.stderr)
        sys.exit(1)

    # gh --paginate may return multiple JSON arrays concatenated; join them
    raw = result.stdout.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Multiple pages — each page is a separate JSON array
        combined: list = []
        decoder = json.JSONDecoder()
        pos = 0
        while pos < len(raw):
            raw_slice = raw[pos:].lstrip()
            if not raw_slice:
                break
            obj, offset = decoder.raw_decode(raw_slice)
            if isinstance(obj, list):
                combined.extend(obj)
            else:
                combined.append(obj)
            pos += len(raw) - len(raw_slice) + offset
        return combined


def _gh_api_curl(path: str, token: str) -> list | dict:
    url = f"https://api.github.com{path}"
    try:
        result = subprocess.run(
            [
                "curl", "-fsSL",
                "-H", f"Authorization: Bearer {token}",
                "-H", "Accept: application/vnd.github+json",
                "-H", "X-GitHub-Api-Version: 2022-11-28",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except FileNotFoundError:
        print("Error: Neither 'gh' nor 'curl' is available.", file=sys.stderr)
        sys.exit(1)

    if result.returncode != 0:
        print(f"Error: curl {url} failed:\n  {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)

    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        print(f"Error: Could not parse API response: {exc}", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Comment fetching
# ---------------------------------------------------------------------------

def fetch_review_comments(owner: str, repo: str, pr_number: int, token: str) -> list[dict]:
    """Return all review (inline) comments on the PR from the base repository."""
    path = f"/repos/{owner}/{repo}/pulls/{pr_number}/comments"
    data = _gh_api(path, token)
    if not isinstance(data, list):
        return []
    return data


def fetch_issue_comments(owner: str, repo: str, pr_number: int, token: str) -> list[dict]:
    """Return all top-level (issue-style) comments on the PR."""
    path = f"/repos/{owner}/{repo}/issues/{pr_number}/comments"
    data = _gh_api(path, token)
    if not isinstance(data, list):
        return []
    return data


def is_resolved(comment: dict) -> bool:
    """
    GitHub's REST API doesn't expose thread resolution state directly on
    inline comments, but we can approximate: skip comments where the body
    starts with common bot/resolved markers, or that are outdated.
    """
    body: str = (comment.get("body") or "").strip()
    if body.startswith(("✅", "LGTM", "Resolved", "Fixed", "Done", "~~")):
        return True
    # outdated diff position means the code changed under the comment
    if comment.get("position") is None and comment.get("original_position") is not None:
        return True
    return False


def format_comments(review_comments: list[dict], issue_comments: list[dict]) -> list[dict]:
    """Return a structured list of unresolved comments for agent consumption."""
    results = []

    for c in review_comments:
        if is_resolved(c):
            continue
        results.append({
            "type": "review",
            "id": c.get("id"),
            "url": c.get("html_url"),
            "author": c.get("user", {}).get("login"),
            "path": c.get("path"),
            "line": c.get("line") or c.get("original_line"),
            "side": c.get("side", "RIGHT"),
            "body": (c.get("body") or "").strip(),
            "created_at": c.get("created_at"),
            "in_reply_to_id": c.get("in_reply_to_id"),
        })

    for c in issue_comments:
        if is_resolved(c):
            continue
        results.append({
            "type": "issue",
            "id": c.get("id"),
            "url": c.get("html_url"),
            "author": c.get("user", {}).get("login"),
            "path": None,
            "line": None,
            "side": None,
            "body": (c.get("body") or "").strip(),
            "created_at": c.get("created_at"),
            "in_reply_to_id": None,
        })

    results.sort(key=lambda x: x.get("created_at") or "")
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch unresolved PR review comments (cross-repo / fork-safe).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--pr-url", metavar="URL", help="Full PR URL, e.g. https://github.com/owner/repo/pull/42")
    parser.add_argument("--repo", metavar="OWNER/REPO", help="Base repository in owner/repo format")
    parser.add_argument("--pr", metavar="NUMBER", type=int, help="PR number")
    parser.add_argument("--output", choices=["json", "text"], default="json", help="Output format (default: json)")
    parser.add_argument("--include-resolved", action="store_true", help="Include comments that appear resolved")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Resolve token — exits cleanly on auth failure, no traceback
    token = get_token()

    # Resolve PR coordinates — always lands on the BASE repo
    owner, repo_name, pr_number = resolve_pr(
        pr_url=args.pr_url,
        repo=args.repo,
        pr_number=args.pr,
    )

    review_comments = fetch_review_comments(owner, repo_name, pr_number, token)
    issue_comments = fetch_issue_comments(owner, repo_name, pr_number, token)

    if args.include_resolved:
        comments = [
            {**c_dict, "path": c.get("path"), "line": c.get("line") or c.get("original_line")}
            for c, c_dict in [
                (c, {"type": "review", "id": c.get("id"), "url": c.get("html_url"),
                     "author": c.get("user", {}).get("login"), "path": c.get("path"),
                     "line": c.get("line") or c.get("original_line"), "side": c.get("side", "RIGHT"),
                     "body": (c.get("body") or "").strip(), "created_at": c.get("created_at"),
                     "in_reply_to_id": c.get("in_reply_to_id")})
                for c in review_comments
            ] + [
                (c, {"type": "issue", "id": c.get("id"), "url": c.get("html_url"),
                     "author": c.get("user", {}).get("login"), "path": None, "line": None,
                     "side": None, "body": (c.get("body") or "").strip(),
                     "created_at": c.get("created_at"), "in_reply_to_id": None})
                for c in issue_comments
            ]
        ]
        comments.sort(key=lambda x: x.get("created_at") or "")
    else:
        comments = format_comments(review_comments, issue_comments)

    if args.output == "json":
        print(json.dumps(comments, indent=2))
    else:
        if not comments:
            print("No unresolved comments found.")
            return
        for c in comments:
            loc = f"{c['path']}:{c['line']}" if c.get("path") else "(top-level)"
            print(f"[{c['type'].upper()}] #{c['id']} by @{c['author']}  {loc}")
            print(f"  URL: {c['url']}")
            print(f"  {c['body'][:200]}{'...' if len(c.get('body','')) > 200 else ''}")
            print()


if __name__ == "__main__":
    main()
