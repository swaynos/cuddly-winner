"""
evals/seed_build/_llm_server.py

A strict, scripted, OpenAI-compatible provider for deterministic end-to-end
tests of the installed OpenCode profile.

This is a test double for a model, not a model. It proves runtime wiring:
that the installed agent prompt reached the provider, that the tools OpenCode
offered match the installed permission contract, and that each tool call the
agent made was actually executed or refused by the real product. It proves
nothing about agent judgement.

Wire protocol: `POST /v1/chat/completions` returning server-sent events, the
same shape OpenCode's own subprocess tests use through
`@ai-sdk/openai-compatible`.

Every request is recorded. A request that matches no scripted turn is recorded
as a miss and answered with a harmless stop, so a mis-scripted test fails on an
assertion instead of hanging.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# OpenCode asks the model for a session title on a separate request. It is not
# part of any scripted flow and must never consume a scripted turn.
TITLE_MARKER = "Generate a title for this conversation"


@dataclass
class Turn:
    """One scripted assistant response.

    `match` is a substring that must appear in the serialized request body for
    this turn to be eligible. Scoping every turn to its agent's system prompt
    keeps per-agent ordering intact even when a subagent's requests interleave
    with its parent's.
    """

    name: str
    match: str
    text: str | None = None
    tool: str | None = None
    args: dict | None = None
    served: bool = field(default=False, init=False)

    def __post_init__(self) -> None:
        if self.tool is None and self.text is None:
            raise ValueError(f"turn {self.name!r} must supply text or a tool call")
        if self.tool is not None and self.args is None:
            self.args = {}


@dataclass
class Request:
    """One recorded provider request."""

    path: str
    body: dict
    turn: str | None

    @property
    def system(self) -> str:
        return "\n".join(
            str(message.get("content") or "")
            for message in self.body.get("messages", [])
            if message.get("role") == "system"
        )

    @property
    def tool_names(self) -> list[str]:
        names = []
        for entry in self.body.get("tools") or []:
            name = (entry.get("function") or {}).get("name")
            if name:
                names.append(name)
        return sorted(names)

    def tool_results(self, tool_call_id: str) -> list[str]:
        return [
            str(message.get("content") or "")
            for message in self.body.get("messages", [])
            if message.get("role") == "tool" and message.get("tool_call_id") == tool_call_id
        ]


def _chunk(delta: dict | None = None, finish: str | None = None) -> dict:
    choice: dict = {"index": 0, "delta": delta or {}}
    if finish:
        choice["finish_reason"] = finish
    return {"id": "chatcmpl-e2e", "object": "chat.completion.chunk", "model": "test-model", "choices": [choice]}


def _sse(lines: list[dict]) -> bytes:
    body = "".join(f"data: {json.dumps(line)}\n\n" for line in lines)
    return (body + "data: [DONE]\n\n").encode("utf-8")


def _render(turn: Turn, call_id: str) -> bytes:
    lines = [_chunk({"role": "assistant"})]
    if turn.text:
        lines.append(_chunk({"content": turn.text}))
    if turn.tool:
        lines.append(
            _chunk(
                {
                    "tool_calls": [
                        {
                            "index": 0,
                            "id": call_id,
                            "type": "function",
                            "function": {"name": turn.tool, "arguments": ""},
                        }
                    ]
                }
            )
        )
        lines.append(
            _chunk({"tool_calls": [{"index": 0, "function": {"arguments": json.dumps(turn.args)}}]})
        )
    lines.append(_chunk(finish="tool_calls" if turn.tool else "stop"))
    return _sse(lines)


class ScriptedLLMServer:
    """Serves scripted responses and records every request."""

    def __init__(self, turns: list[Turn]) -> None:
        self._turns = list(turns)
        self._lock = threading.Lock()
        self._requests: list[Request] = []
        self._calls = 0
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    # -- lifecycle ---------------------------------------------------------

    def __enter__(self) -> "ScriptedLLMServer":
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args) -> None:  # keep test output readable
                return

            def do_POST(self) -> None:  # noqa: N802 - http.server API
                length = int(self.headers.get("content-length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                try:
                    body = json.loads(raw or b"{}")
                except json.JSONDecodeError:
                    body = {}
                if not self.path.endswith("/chat/completions"):
                    self._reply(404, b'{"error":"unsupported endpoint"}', "application/json")
                    return
                payload = outer._serve(self.path, body)
                self._reply(200, payload, "text/event-stream")

            def _reply(self, status: int, payload: bytes, content_type: str) -> None:
                self.send_response(status)
                self.send_header("content-type", content_type)
                self.send_header("content-length", str(len(payload)))
                self.send_header("cache-control", "no-cache")
                self.end_headers()
                self.wfile.write(payload)
                self.wfile.flush()

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_exc) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        if self._thread:
            self._thread.join(timeout=5)

    @property
    def url(self) -> str:
        assert self._server, "server is not running"
        return f"http://127.0.0.1:{self._server.server_address[1]}/v1"

    # -- scripting ---------------------------------------------------------

    def _serve(self, path: str, body: dict) -> bytes:
        blob = json.dumps(body)
        with self._lock:
            if TITLE_MARKER in blob:
                self._requests.append(Request(path, body, "__title__"))
                return _sse([_chunk({"role": "assistant"}), _chunk({"content": "E2E"}), _chunk(finish="stop")])
            self._calls += 1
            call_id = f"call_{self._calls}"
            for turn in self._turns:
                if not turn.served and turn.match in blob:
                    turn.served = True
                    self._requests.append(Request(path, body, turn.name))
                    return _render(turn, call_id)
            self._requests.append(Request(path, body, None))
        # An unscripted request means the test's model of the product is wrong.
        # Stop cleanly so the assertion, not a timeout, reports it.
        return _sse([_chunk({"role": "assistant"}), _chunk({"content": "unscripted"}), _chunk(finish="stop")])

    # -- evidence ----------------------------------------------------------

    @property
    def requests(self) -> list[Request]:
        with self._lock:
            return list(self._requests)

    @property
    def misses(self) -> list[Request]:
        return [request for request in self.requests if request.turn is None]

    @property
    def unused(self) -> list[str]:
        return [turn.name for turn in self._turns if not turn.served]

    def served(self, name: str) -> Request | None:
        for request in self.requests:
            if request.turn == name:
                return request
        return None

    def call_id(self, name: str) -> str | None:
        """The tool_call_id OpenCode saw for a scripted turn's tool call."""
        index = 0
        for request in self.requests:
            if request.turn == "__title__":
                continue
            index += 1
            if request.turn == name:
                return f"call_{index}"
        return None

    def result_for(self, name: str) -> str:
        """Concatenated tool results OpenCode reported back for a turn's call."""
        call_id = self.call_id(name)
        if not call_id:
            return ""
        return "\n".join(
            output for request in self.requests for output in request.tool_results(call_id)
        )


def provider_config(url: str, *, model: str = "test-model") -> dict:
    """Inline OpenCode config selecting only the scripted loopback provider."""
    return {
        "formatter": False,
        "lsp": False,
        "share": "disabled",
        "autoupdate": False,
        "snapshot": False,
        # Even if a real provider credential leaks into the environment, only the
        # scripted loopback provider can be selected.
        "enabled_providers": ["test"],
        # The managed profile registers a research-browser MCP server that would
        # download a browser package on session start. Disable it by name so the
        # test stays offline without editing the installed profile.
        "mcp": {"cuddly-winner-research-browser": {"type": "local", "command": ["true"], "enabled": False}},
        "small_model": f"test/{model}",
        "model": f"test/{model}",
        "provider": {
            "test": {
                "name": "Test",
                "id": "test",
                "env": [],
                "npm": "@ai-sdk/openai-compatible",
                "options": {"apiKey": "test-key", "baseURL": url},
                "models": {
                    model: {
                        "id": model,
                        "name": "Scripted Test Model",
                        "attachment": False,
                        "reasoning": False,
                        "temperature": False,
                        "tool_call": True,
                        "release_date": "2025-01-01",
                        "limit": {"context": 200000, "output": 32000},
                        "cost": {"input": 0, "output": 0},
                        "options": {},
                    }
                },
            }
        },
    }
