"""Подключение GitLab только на чтение.

Токены хранятся в памяти процесса и никогда не уходят во фронтенд.
Агент получает GitLabContext: список файлов по категориям и чтение содержимого.
"""
from __future__ import annotations

import fnmatch
import logging
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote, urlparse

import httpx

log = logging.getLogger("web.gitlab")

TIMEOUT = httpx.Timeout(15.0, connect=10.0)
MAX_TREE = 8000
MAX_FILE_BYTES = 200_000
WRITE_SCOPES = {"api", "write_repository", "write_registry", "sudo", "admin_mode"}

SCOPES = [
    {"id": "api", "label": "REST-контроллеры и DTO", "meta": "методы, параметры, статусы"},
    {"id": "openapi", "label": "OpenAPI / Swagger", "meta": "контракт API"},
    {"id": "db", "label": "Схема БД и миграции", "meta": "поля и типы данных"},
    {"id": "docs", "label": "README и docs/", "meta": "описание проекта"},
]

CODE_EXT = (".java", ".kt", ".kts", ".py", ".ts", ".js", ".go", ".cs", ".php", ".rb", ".scala", ".groovy")
IGNORE_DIRS = ("node_modules/", "vendor/", "dist/", "build/", "target/", ".git/", ".idea/", "__pycache__/", "venv/")


class GitLabError(Exception):
    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def classify(path: str) -> str | None:
    p = path.lower()
    if any(d in p for d in IGNORE_DIRS) or "/test/" in p or "/tests/" in p or p.startswith("test"):
        return None
    name = p.rsplit("/", 1)[-1]
    if (("openapi" in p or "swagger" in p) and name.endswith((".yaml", ".yml", ".json"))):
        return "openapi"
    if (name.endswith(".sql") or "/migrations/" in p or "db/migrate" in p or "liquibase" in p or "flyway" in p
            or "alembic" in p or name == "schema.prisma" or fnmatch.fnmatch(name, "*changelog*.xml")):
        return "db"
    if name.endswith(CODE_EXT) and re.search(r"controller|route|router|handler|endpoint|resource|/api/|dto|request|response|schema|model|entity", p):
        return "api"
    if name.startswith("readme") or (p.startswith("docs/") and name.endswith((".md", ".adoc", ".rst"))):
        return "docs"
    return None


class GitLabClient:
    def __init__(self, base_url: str, token: str):
        u = urlparse(base_url.strip())
        if u.scheme not in ("http", "https") or not u.netloc:
            raise GitLabError("bad_url", "Укажите адрес вида https://gitlab.example.kz")
        self.base_url = f"{u.scheme}://{u.netloc}{u.path.rstrip('/')}"
        self.api = self.base_url + "/api/v4"
        self._token = token.strip()
        if not self._token:
            raise GitLabError("no_token", "Нужен токен доступа")

    def _get(self, path: str, params: dict | None = None, raw: bool = False) -> Any:
        try:
            r = httpx.get(self.api + path, params=params, headers={"PRIVATE-TOKEN": self._token}, timeout=TIMEOUT)
        except httpx.TimeoutException as e:
            raise GitLabError("network", "GitLab не ответил вовремя. Повторите позже или проверьте адрес.") from e
        except httpx.HTTPError as e:
            log.warning("GitLab %s: %r", self.base_url, e)
            raise GitLabError("network", "Не удалось подключиться к GitLab по этому адресу. "
                                         "Проверьте адрес и доступ к серверу из сети сервиса.") from e
        if r.status_code == 401:
            raise GitLabError("unauthorized", "Токен недействителен или истёк", 401)
        if r.status_code == 403:
            raise GitLabError("forbidden", "У токена нет доступа к этому ресурсу", 403)
        if r.status_code == 404:
            raise GitLabError("not_found", "Не найдено в GitLab", 404)
        if r.status_code >= 400:
            raise GitLabError("http", f"GitLab ответил {r.status_code}", r.status_code)
        return r if raw else r.json()

    def _paged(self, path: str, params: dict, limit: int) -> list:
        out: list = []
        page = 1
        while len(out) < limit:
            r = self._get(path, {**params, "per_page": 100, "page": page}, raw=True)
            items = r.json()
            out.extend(items)
            nxt = r.headers.get("x-next-page")
            if not items or not nxt:
                break
            page = int(nxt)
        return out[:limit]

    def user(self) -> dict:
        return self._get("/user")

    def token_scopes(self) -> list[str] | None:
        try:
            return list(self._get("/personal_access_tokens/self").get("scopes", []))
        except GitLabError:
            return None  # старые версии GitLab или токен группы/проекта

    def projects(self, search: str = "") -> list[dict]:
        params = {"membership": "true", "simple": "true", "order_by": "last_activity_at", "per_page": 50}
        if search:
            params["search"] = search
        return self._get("/projects", params)

    def project(self, project_id: int | str) -> dict:
        return self._get(f"/projects/{quote(str(project_id), safe='')}")

    def branches(self, project_id: int) -> list[dict]:
        return self._get(f"/projects/{project_id}/repository/branches", {"per_page": 100})

    def tree(self, project_id: int, ref: str) -> list[dict]:
        return self._paged(f"/projects/{project_id}/repository/tree", {"recursive": "true", "ref": ref}, MAX_TREE)

    def raw_file(self, project_id: int, path: str, ref: str) -> str:
        r = self._get(f"/projects/{project_id}/repository/files/{quote(path, safe='')}/raw", {"ref": ref}, raw=True)
        data = r.content[:MAX_FILE_BYTES]
        return data.decode("utf-8", errors="replace")


@dataclass
class Connection:
    id: str
    url: str
    username: str
    scopes: list[str] | None
    created_at: float
    client: GitLabClient = field(repr=False)

    def public(self) -> dict:
        return {"id": self.id, "url": self.url, "username": self.username, "scopes": self.scopes,
                "created_at": self.created_at}


@dataclass
class Project:
    id: str
    connection_id: str
    gitlab_id: int
    path: str
    name: str
    web_url: str
    default_branch: str
    status: str = "indexing"  # indexing | ready | error
    error: str | None = None
    synced_at: float | None = None
    counts: dict = field(default_factory=dict)
    samples: dict = field(default_factory=dict)
    total_files: int = 0
    files: list[dict] = field(default_factory=list, repr=False)

    def public(self) -> dict:
        return {"id": self.id, "connection_id": self.connection_id, "gitlab_id": self.gitlab_id,
                "path": self.path, "name": self.name, "web_url": self.web_url,
                "default_branch": self.default_branch, "status": self.status, "error": self.error,
                "synced_at": self.synced_at, "counts": self.counts, "samples": self.samples,
                "total_files": self.total_files}


def index_tree(tree: list[dict]) -> tuple[list[dict], dict, dict]:
    files, counts, samples = [], {s["id"]: 0 for s in SCOPES}, {s["id"]: [] for s in SCOPES}
    for item in tree:
        if item.get("type") != "blob":
            continue
        cat = classify(item["path"])
        if cat:
            files.append({"path": item["path"], "category": cat})
            counts[cat] += 1
            if len(samples[cat]) < 6:
                samples[cat].append(item["path"])
    return files, counts, samples


class GitLabStore:
    def __init__(self):
        self.connections: dict[str, Connection] = {}
        self.projects: dict[str, Project] = {}
        self._lock = threading.Lock()

    # --- подключения
    def connect(self, url: str, token: str) -> Connection:
        client = GitLabClient(url, token)
        user = client.user()
        scopes = client.token_scopes()
        if scopes is not None:
            extra = WRITE_SCOPES.intersection(scopes)
            if extra:
                raise GitLabError(
                    "write_scope",
                    f"У токена есть права на запись ({', '.join(sorted(extra))}). "
                    "Создайте токен только с read_api и read_repository.",
                )
        conn = Connection(id=uuid.uuid4().hex[:10], url=client.base_url, username=user.get("username", "?"),
                          scopes=scopes, created_at=time.time(), client=client)
        with self._lock:
            self.connections[conn.id] = conn
        return conn

    def disconnect(self, conn_id: str) -> None:
        with self._lock:
            self.connections.pop(conn_id, None)
            for pid in [p.id for p in self.projects.values() if p.connection_id == conn_id]:
                self.projects.pop(pid, None)

    def get_conn(self, conn_id: str) -> Connection:
        conn = self.connections.get(conn_id)
        if not conn:
            raise GitLabError("not_found", "Подключение не найдено")
        return conn

    # --- проекты
    def add_project(self, conn_id: str, gitlab_id: int | str) -> Project:
        conn = self.get_conn(conn_id)
        info = conn.client.project(gitlab_id)
        for p in self.projects.values():
            if p.connection_id == conn_id and p.gitlab_id == info["id"]:
                self.resync(p.id)
                return p
        proj = Project(id=uuid.uuid4().hex[:10], connection_id=conn_id, gitlab_id=info["id"],
                       path=info.get("path_with_namespace", str(gitlab_id)), name=info.get("name", ""),
                       web_url=info.get("web_url", ""), default_branch=info.get("default_branch") or "main")
        with self._lock:
            self.projects[proj.id] = proj
        self.resync(proj.id)
        return proj

    def resync(self, project_id: str) -> None:
        proj = self.get_project(project_id)
        proj.status, proj.error = "indexing", None
        threading.Thread(target=self._index, args=(proj,), daemon=True).start()

    def _index(self, proj: Project) -> None:
        try:
            conn = self.get_conn(proj.connection_id)
            tree = conn.client.tree(proj.gitlab_id, proj.default_branch)
            proj.files, proj.counts, proj.samples = index_tree(tree)
            proj.total_files = sum(1 for t in tree if t.get("type") == "blob")
            proj.status, proj.synced_at = "ready", time.time()
        except GitLabError as e:
            proj.status, proj.error = "error", e.message
        except Exception as e:  # noqa: BLE001
            log.exception("индексация проекта %s", proj.path)
            proj.status, proj.error = "error", "Не удалось проиндексировать проект — нажмите «Обновить» или повторите позже"

    def remove_project(self, project_id: str) -> None:
        with self._lock:
            self.projects.pop(project_id, None)

    def get_project(self, project_id: str) -> Project:
        p = self.projects.get(project_id)
        if not p:
            raise GitLabError("not_found", "Проект не подключён")
        return p

    def context(self, project_id: str, ref: str | None, scopes: list[str]) -> "GitLabContext":
        proj = self.get_project(project_id)
        conn = self.get_conn(proj.connection_id)
        return GitLabContext(conn.client, proj, ref or proj.default_branch, scopes or [s["id"] for s in SCOPES])


class GitLabContext:
    """То, что получает конвейер агента. Токена внутри нет — только клиент с методами чтения."""

    def __init__(self, client: GitLabClient, project: Project, ref: str, scopes: list[str]):
        self._client = client
        self._project = project
        self.project = project.path
        self.ref = ref
        self.scopes = list(scopes)
        self._files: list[dict] | None = None
        self._cache: dict[str, str] = {}

    def files(self) -> list[dict]:
        if self._files is None:
            if self.ref == self._project.default_branch and self._project.status == "ready":
                all_files = self._project.files
            else:
                all_files, _, _ = index_tree(self._client.tree(self._project.gitlab_id, self.ref))
            self._files = [f for f in all_files if f["category"] in self.scopes]
        return self._files

    def read(self, path: str) -> str:
        if path not in self._cache:
            self._cache[path] = self._client.raw_file(self._project.gitlab_id, path, self.ref)
        return self._cache[path]

    def collect(self, max_files: int = 60, max_bytes: int = 600_000) -> list[dict]:
        out, total = [], 0
        order = {"openapi": 0, "api": 1, "db": 2, "docs": 3}
        for f in sorted(self.files(), key=lambda f: (order.get(f["category"], 9), f["path"]))[:max_files]:
            try:
                content = self.read(f["path"])
            except GitLabError:
                continue
            if total + len(content) > max_bytes:
                break
            total += len(content)
            out.append({**f, "content": content})
        return out

    def web_url(self, path: str, line: int | None = None) -> str:
        url = f"{self._project.web_url}/-/blob/{quote(self.ref, safe='')}/{quote(path)}"
        return url + (f"#L{line}" if line else "")


store = GitLabStore()
