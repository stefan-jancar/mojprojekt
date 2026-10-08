"""Úložisko dát.

- GitHubStore: všetko (JSON dáta aj PDF súbory) sa ukladá ako commity do GitHub repozitára.
- LocalStore: pri lokálnom vývoji bez tokenu sa ukladá do priečinka .data/
"""
import base64
import json
import os
from pathlib import Path
from urllib.parse import quote

import httpx


class StorageError(Exception):
    pass


class Conflict(StorageError):
    pass


class LocalStore:
    kind = "local"

    def __init__(self, root: str):
        self.root = Path(root)

    def _p(self, path: str) -> Path:
        p = (self.root / path).resolve()
        if not str(p).startswith(str(self.root.resolve())):
            raise StorageError("Neplatná cesta")
        return p

    def read_json(self, path, default):
        p = self._p(path)
        if not p.exists():
            return default, None
        return json.loads(p.read_text("utf-8")), "local"

    def write_json(self, path, data, sha, message):
        p = self._p(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")

    def read_bytes(self, path) -> bytes:
        p = self._p(path)
        if not p.exists():
            raise StorageError("Súbor neexistuje")
        return p.read_bytes()

    def write_bytes(self, path, content: bytes, message):
        p = self._p(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(content)

    def delete(self, path, message):
        p = self._p(path)
        if p.exists():
            p.unlink()


class GitHubStore:
    kind = "github"

    def __init__(self, token: str, repo: str, branch: str = "main"):
        self.repo = repo
        self.branch = branch
        self.http = httpx.Client(
            base_url="https://api.github.com",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "moj-priestor-app",
            },
            timeout=30,
        )

    def _url(self, path: str) -> str:
        return f"/repos/{self.repo}/contents/{quote(path)}"

    def _meta(self, path):
        r = self.http.get(self._url(path), params={"ref": self.branch})
        if r.status_code == 404:
            return None
        self._check(r)
        return r.json()

    @staticmethod
    def _check(r: httpx.Response):
        if r.status_code in (409, 422) or (r.status_code == 400 and "sha" in r.text):
            raise Conflict(r.text)
        if r.status_code >= 400:
            raise StorageError(f"GitHub {r.status_code}: {r.text[:300]}")

    def read_json(self, path, default):
        meta = self._meta(path)
        if meta is None:
            return default, None
        if meta.get("content"):
            raw = base64.b64decode(meta["content"])
        else:  # súbory nad 1 MB nemajú content v odpovedi
            raw = self.read_bytes(path)
        return json.loads(raw.decode("utf-8")), meta["sha"]

    def write_json(self, path, data, sha, message):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self._put(path, body, sha, message)

    def _put(self, path, content: bytes, sha, message):
        payload = {
            "message": message,
            "content": base64.b64encode(content).decode("ascii"),
            "branch": self.branch,
        }
        if sha:
            payload["sha"] = sha
        r = self.http.put(self._url(path), json=payload)
        self._check(r)

    def read_bytes(self, path) -> bytes:
        r = self.http.get(
            self._url(path),
            params={"ref": self.branch},
            headers={"Accept": "application/vnd.github.raw"},
        )
        if r.status_code == 404:
            raise StorageError("Súbor neexistuje")
        self._check(r)
        return r.content

    def write_bytes(self, path, content: bytes, message):
        meta = self._meta(path)
        self._put(path, content, meta["sha"] if meta else None, message)

    def delete(self, path, message):
        meta = self._meta(path)
        if not meta:
            return
        r = self.http.request(
            "DELETE",
            self._url(path),
            json={"message": message, "sha": meta["sha"], "branch": self.branch},
        )
        self._check(r)


def mutate(store, path, default, fn, message):
    """Načíta JSON, aplikuje fn(data) a zapíše späť. Pri konflikte to skúsi znova."""
    for _ in range(3):
        data, sha = store.read_json(path, default)
        result = fn(data)
        try:
            store.write_json(path, data, sha, message)
            return result
        except Conflict:
            continue
    raise StorageError("Nepodarilo sa uložiť (konflikt), skús znova.")


def make_store():
    token = os.environ.get("GITHUB_TOKEN")
    repo = os.environ.get("GITHUB_DATA_REPO")
    if token and repo:
        return GitHubStore(token, repo, os.environ.get("GITHUB_DATA_BRANCH", "main"))
    root = os.environ.get("LOCAL_DATA_DIR") or str(Path(__file__).resolve().parent.parent / ".data")
    return LocalStore(root)
