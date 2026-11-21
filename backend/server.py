"""Local HTTP server (REST API + static frontend) on 127.0.0.1."""

from __future__ import annotations

import json
import mimetypes
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from .cultist_solver import FIXED_RECIPES, THRESHOLDS, evaluate_basket, solve_cultist_circle
from .db import AssistantDB
from .log_watcher import ReadOnlyEftWatcher
from .planner import build_map_payload, build_quests_payload
from .tarkov_data import TarkovDataStore


class AppContext:
    def __init__(
        self,
        config_path: Path,
        config: dict[str, Any],
        db: AssistantDB,
        data_store: TarkovDataStore,
        watcher: ReadOnlyEftWatcher,
        frontend_dir: Path,
    ) -> None:
        self.config_path = config_path
        self.config = config
        self.db = db
        self.data_store = data_store
        self.watcher = watcher
        self.frontend_dir = frontend_dir


def _mode_from_qs(qs: dict[str, list[str]], default: str = "regular") -> str:
    m = (qs.get("mode") or [default])[0]
    return "pve" if m == "pve" else "regular"


def _lang_from_qs(qs: dict[str, list[str]], default: str = "ru") -> str:
    raw = (qs.get("lang") or [default])[0]
    return "en" if str(raw or "").lower().startswith("en") else "ru"


def _lang_from_body(body: dict[str, Any], default: str = "ru") -> str:
    raw = body.get("lang") or default
    return "en" if str(raw or "").lower().startswith("en") else "ru"


def _compute_item_counter(ctx: AppContext, mode: str, lang: str = "ru") -> dict[str, Any]:
    data = ctx.data_store.get_mode_data(mode, lang=lang)
    items_map = data.get("items") or {}
    rows = ctx.db.list_tracked_items(mode)

    items = []
    completed_items = 0
    total_units_current = 0
    raw_units_current = 0
    total_units_target = 0

    for row in rows:
        iid = str(row.get("item_id") or "")
        cat = items_map.get(iid) if iid else None
        cur_q = max(0, int(row.get("current_qty") or 0))
        tgt_q = max(1, int(row.get("target_qty") or 1))
        done = cur_q >= tgt_q
        if done:
            completed_items += 1
        total_units_current += min(cur_q, tgt_q)
        raw_units_current += cur_q
        total_units_target += tgt_q
        items.append(
            {
                "id": int(row["id"]),
                "itemId": iid,
                "name": (cat or {}).get("name") or row["name"],
                "shortName": (cat or {}).get("shortName") or row.get("short_name") or "",
                "iconLink": (cat or {}).get("iconLink") or row.get("icon_link") or "",
                "currentQty": cur_q,
                "targetQty": tgt_q,
                "firOnly": bool(row.get("fir_only")),
                "categoryTag": row.get("category_tag") or "general",
                "notes": row.get("notes") or "",
                "updatedAt": row.get("updated_at") or "",
                "done": done,
                "fleaPrice": (cat or {}).get("fleaPrice"),
                "bestSellRub": (cat or {}).get("bestSellRub"),
                "bestSellTrader": (cat or {}).get("bestSellTrader") or "",
                "stashUnitRub": (cat or {}).get("stashUnitRub"),
            }
        )

    total_items = len(items)
    pct_complete = round((total_units_current / total_units_target) * 100) if total_units_target > 0 else 0
    return {
        "mode": mode,
        "items": items,
        "summary": {
            "totalItems": total_items,
            "completedItems": completed_items,
            "activeItems": total_items - completed_items,
            "totalUnitsCurrent": total_units_current,
            "rawUnitsCurrent": raw_units_current,
            "totalUnitsTarget": total_units_target,
            "pctComplete": pct_complete,
        },
    }


def make_handler(ctx: AppContext):
    class AssistantHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _send_cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._send_cors_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _send_json(self, payload: Any, status: int = 200) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _read_json_body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8"))

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)
            default_mode = ctx.config.get("default_game_mode", "regular")
            default_lang = ctx.config.get("language", "ru")

            try:
                if path == "/api/bootstrap":
                    mode = _mode_from_qs(qs, default_mode)
                    lang = _lang_from_qs(qs, default_lang)
                    data = ctx.data_store.get_mode_data(mode, lang=lang)
                    maps_summary = sorted(
                        [
                            {
                                "id": mp["id"],
                                "name": mp["name"],
                                "normalizedName": mp["normalizedName"],
                                "hasSvg": mp["hasSvg"],
                                "raidDuration": mp["raidDuration"],
                                "players": mp["players"],
                                "bossCount": len(mp["bosses"]),
                                "extractCount": len(mp["extracts"]),
                                "lockCount": len(mp["locks"]),
                            }
                            for mp in data["maps"].values()
                            if mp["hasSvg"]
                        ],
                        key=lambda x: x["name"],
                    )
                    self._send_json(
                        {
                            "mode": mode,
                            "lang": lang,
                            "config": ctx.config,
                            "watcher": ctx.watcher.status(),
                            "maps": maps_summary,
                            "rates": data["rates"],
                            "recentRaids": ctx.db.get_recent_raids(mode, limit=10),
                            "cultistTimers": ctx.db.list_cultist_timers(mode),
                            "loadedAt": data["loaded_at"],
                        }
                    )
                    return

                if path == "/api/quests":
                    mode = _mode_from_qs(qs, default_mode)
                    lang = _lang_from_qs(qs, default_lang)
                    data = ctx.data_store.get_mode_data(mode, lang=lang)
                    payload = build_quests_payload(
                        data=data,
                        saved_quests=ctx.db.get_quest_statuses(mode),
                        history=ctx.db.get_quest_history(mode, limit=250),
                    )
                    self._send_json(payload)
                    return

                if path.startswith("/api/tasks/") and path.endswith("/guide"):
                    parts = path.strip("/").split("/")
                    if len(parts) >= 3:
                        task_id = parts[2]
                        mode = _mode_from_qs(qs, default_mode)
                        lang = _lang_from_qs(qs, default_lang)
                        force = (qs.get("force") or ["0"])[0] == "1"
                        guide_data = ctx.data_store.get_task_guide(task_id, mode, force=force, lang=lang)
                        self._send_json(guide_data)
                        return

                if path == "/api/media-proxy":
                    media_url = (qs.get("url") or [""])[0]
                    res = ctx.data_store.fetch_cached_media(media_url)
                    if not res:
                        self.send_error(HTTPStatus.NOT_FOUND, "Media unavailable")
                        return
                    payload_bytes, ctype = res
                    self.send_response(200)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(payload_bytes)))
                    self.send_header("Cache-Control", "public, max-age=86400")
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(payload_bytes)
                    return

                if path.startswith("/api/maps/"):
                    norm = path.split("/api/maps/", 1)[1].strip("/")
                    mode = _mode_from_qs(qs, default_mode)
                    lang = _lang_from_qs(qs, default_lang)
                    data = ctx.data_store.get_mode_data(mode, lang=lang)
                    mid = data["maps_by_norm"].get(norm)
                    if not mid:
                        self._send_json({"error": "Map not found" if lang == "en" else "Карта не найдена"}, status=404)
                        return
                    mp = data["maps"][mid]
                    svg_text = ctx.data_store.get_svg(norm) if mp["hasSvg"] else None
                    payload = build_map_payload(
                        data=data,
                        saved_quests=ctx.db.get_quest_statuses(mode),
                        norm=norm,
                        svg_text=svg_text,
                        last_pin=ctx.db.get_state("last_player_pin"),
                        lang=lang,
                    )
                    self._send_json(payload)
                    return

                if path == "/api/cultist/solve":
                    mode = _mode_from_qs(qs, default_mode)
                    lang = _lang_from_qs(qs, default_lang)
                    target = int((qs.get("target") or ["400000"])[0])
                    slots = int((qs.get("slots") or ["5"])[0])
                    allow_traders = (qs.get("traders") or ["1"])[0] == "1"
                    data = ctx.data_store.get_mode_data(mode, lang=lang)
                    solutions = solve_cultist_circle(
                        data["items_list"],
                        target_base_value=target,
                        max_slots=slots,
                        allow_traders=allow_traders,
                    )
                    self._send_json(
                        {
                            "target": target,
                            "slots": slots,
                            "allowTraders": allow_traders,
                            "thresholds": THRESHOLDS,
                            "fixedRecipes": FIXED_RECIPES,
                            "solutions": solutions,
                            "timers": ctx.db.list_cultist_timers(mode),
                        }
                    )
                    return

                if path == "/api/items/search":
                    mode = _mode_from_qs(qs, default_mode)
                    lang = _lang_from_qs(qs, default_lang)
                    q = ((qs.get("q") or [""])[0]).strip().lower()
                    data = ctx.data_store.get_mode_data(mode, lang=lang)
                    if len(q) < 2:
                        self._send_json({"items": []})
                        return
                    matches = []
                    for it in data["items_list"]:
                        if q in it["name"].lower() or q in it["shortName"].lower() or q in it["normalizedName"]:
                            matches.append(
                                {
                                    "id": it["id"],
                                    "name": it["name"],
                                    "shortName": it["shortName"],
                                    "basePrice": it["basePrice"],
                                    "fleaPrice": it["fleaPrice"],
                                    "bestSellRub": it["bestSellRub"],
                                    "stashUnitRub": it["stashUnitRub"],
                                    "cheapestBuyRub": it["cheapestBuyRub"],
                                    "cheapestBuySource": it["cheapestBuySource"],
                                    "iconLink": it["iconLink"],
                                }
                            )
                            if len(matches) >= 30:
                                break
                    self._send_json({"items": matches})
                    return

                if path == "/api/item-counter":
                    mode = _mode_from_qs(qs, default_mode)
                    lang = _lang_from_qs(qs, default_lang)
                    self._send_json(_compute_item_counter(ctx, mode, lang=lang))
                    return

                # Serve static frontend files
                rel = "index.html" if path in ("/", "") else path.lstrip("/")
                file_path = (ctx.frontend_dir / rel).resolve()
                if not str(file_path).startswith(str(ctx.frontend_dir.resolve())) or not file_path.is_file():
                    self.send_error(HTTPStatus.NOT_FOUND, "Not found")
                    return
                ctype, _ = mimetypes.guess_type(str(file_path))
                raw = file_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", f"{ctype or 'application/octet-stream'}; charset=utf-8")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(raw)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            default_mode = ctx.config.get("default_game_mode", "regular")
            default_lang = ctx.config.get("language", "ru")
            try:
                body = self._read_json_body()

                if path == "/api/quests/status":
                    mode = "pve" if body.get("mode") == "pve" else "regular"
                    task_id = str(body.get("taskId") or "")
                    status = str(body.get("status") or "")
                    if status not in ("available", "locked", "active", "completed", "failed"):
                        self._send_json({"error": "Некорректный статус"}, status=400)
                        return
                    data = ctx.data_store.get_mode_data(mode)
                    tk = data["tasks"].get(task_id)
                    if not tk:
                        self._send_json({"error": "Квест не найден"}, status=404)
                        return
                    if status == "available":
                        ctx.db.clear_quest_status(mode, task_id)
                    else:
                        ctx.db.set_quest_status(
                            game_mode=mode,
                            task_id=task_id,
                            status=status,
                            task_name=tk["name"],
                            trader_name=tk["traderName"],
                            xp=tk["experience"],
                            source="manual",
                        )
                        if status == "completed":
                            ctx.db.reconcile_quest_progress(mode, data["tasks"])
                    self._send_json({"ok": True})
                    return

                if path == "/api/quests/import-logs":
                    self._send_json(ctx.watcher.import_historical_logs())
                    return

                if path == "/api/cultist/evaluate":
                    mode = "pve" if body.get("mode") == "pve" else "regular"
                    allow_traders = bool(body.get("allowTraders", True))
                    entries = body.get("items") or []
                    data = ctx.data_store.get_mode_data(mode)
                    self._send_json(evaluate_basket(data["items"], entries, allow_traders=allow_traders))
                    return

                if path == "/api/cultist/timer":
                    mode = "pve" if body.get("mode") == "pve" else "regular"
                    hours = int(body.get("hours") or 6)
                    note = str(body.get("note") or "")
                    tid = ctx.db.add_cultist_timer(mode, hours, note)
                    self._send_json({"ok": True, "id": tid, "timers": ctx.db.list_cultist_timers(mode)})
                    return

                if path == "/api/item-counter":
                    mode = "pve" if body.get("mode") == "pve" else "regular"
                    lang = _lang_from_body(body, default_lang)
                    name = str(body.get("name") or "").strip()
                    if not name:
                        self._send_json({"error": "Item name required" if lang == "en" else "Название предмета не указано"}, status=400)
                        return
                    row_id = ctx.db.upsert_tracked_item(
                        game_mode=mode,
                        name=name,
                        target_qty=int(body.get("targetQty") or 1),
                        current_qty=int(body.get("currentQty") or 0),
                        item_id=str(body.get("itemId") or ""),
                        short_name=str(body.get("shortName") or ""),
                        icon_link=str(body.get("iconLink") or ""),
                        fir_only=bool(body.get("firOnly")),
                        category_tag=str(body.get("categoryTag") or "general"),
                        notes=str(body.get("notes") or ""),
                        row_id=int(body["id"]) if body.get("id") is not None else None,
                    )
                    payload = _compute_item_counter(ctx, mode, lang=lang)
                    payload["ok"] = True
                    payload["id"] = row_id
                    self._send_json(payload)
                    return

                if path == "/api/item-counter/adjust":
                    mode = "pve" if body.get("mode") == "pve" else "regular"
                    lang = _lang_from_body(body, default_lang)
                    row_id = int(body.get("id"))
                    delta = int(body["delta"]) if body.get("delta") is not None else None
                    cur_q = int(body["currentQty"]) if body.get("currentQty") is not None else None
                    tgt_q = int(body["targetQty"]) if body.get("targetQty") is not None else None
                    updated = ctx.db.adjust_tracked_item(
                        game_mode=mode,
                        row_id=row_id,
                        delta=delta,
                        current_qty=cur_q,
                        target_qty=tgt_q,
                    )
                    if not updated:
                        self._send_json({"error": "Item not found" if lang == "en" else "Позиция не найдена"}, status=404)
                        return
                    payload = _compute_item_counter(ctx, mode, lang=lang)
                    payload["ok"] = True
                    self._send_json(payload)
                    return

                if path == "/api/item-counter/clear-completed":
                    mode = "pve" if body.get("mode") == "pve" else "regular"
                    lang = _lang_from_body(body, default_lang)
                    removed = ctx.db.clear_completed_tracked_items(mode)
                    payload = _compute_item_counter(ctx, mode, lang=lang)
                    payload["ok"] = True
                    payload["removed"] = removed
                    self._send_json(payload)
                    return

                if path == "/api/item-counter/import-quests":
                    mode = "pve" if body.get("mode") == "pve" else "regular"
                    lang = _lang_from_body(body, default_lang)
                    data = ctx.data_store.get_mode_data(mode, lang=lang)
                    q_payload = build_quests_payload(data, ctx.db.get_quest_statuses(mode), [])
                    needed_fir = q_payload.get("neededFir") or []
                    existing = ctx.db.list_tracked_items(mode)
                    existing_ids = {str(r["item_id"]) for r in existing if r.get("item_id")}
                    existing_names = {str(r["name"]).strip().lower() for r in existing}
                    items_map = data.get("items") or {}
                    imported = 0
                    with ctx.db.batch():
                        for entry in needed_fir:
                            iid = str(entry.get("id") or "")
                            iname = str(entry.get("name") or iid).strip()
                            if (iid and iid in existing_ids) or (iname.lower() in existing_names):
                                continue
                            cat = items_map.get(iid) or {}
                            tasks_note = ", ".join((entry.get("tasks") or [])[:3])
                            ctx.db.upsert_tracked_item(
                                game_mode=mode,
                                name=cat.get("name") or iname,
                                target_qty=max(1, int(entry.get("count") or 1)),
                                current_qty=0,
                                item_id=iid,
                                short_name=cat.get("shortName") or "",
                                icon_link=cat.get("iconLink") or "",
                                fir_only=True,
                                category_tag="quest",
                                notes=tasks_note,
                            )
                            if iid:
                                existing_ids.add(iid)
                            existing_names.add(iname.lower())
                            imported += 1
                    payload = _compute_item_counter(ctx, mode, lang=lang)
                    payload["ok"] = True
                    payload["imported"] = imported
                    self._send_json(payload)
                    return

                if path == "/api/sync":
                    mode = "pve" if body.get("mode", default_mode) == "pve" else "regular"
                    lang = _lang_from_body(body, default_lang)
                    ctx.data_store.get_mode_data(mode, force=True, lang=lang)
                    self._send_json({"ok": True, "mode": mode, "lang": lang})
                    return

                if path == "/api/settings":
                    allowed = ("default_game_mode", "language", "watch_logs", "watch_screenshots", "eft_logs_dir", "eft_screenshots_dir")
                    for k in allowed:
                        if k in body:
                            ctx.config[k] = body[k]
                    if ctx.config.get("language") not in ("ru", "en"):
                        ctx.config["language"] = "ru"
                    ctx.config_path.write_text(json.dumps(ctx.config, ensure_ascii=False, indent=2), encoding="utf-8")
                    self._send_json({"ok": True, "config": ctx.config, "watcher": ctx.watcher.status()})
                    return

                if path == "/api/shutdown":
                    self._send_json({"ok": True})
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                    return

                self._send_json({"error": "Not found"}, status=404)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)

        def do_DELETE(self) -> None:
            parsed = urlparse(self.path)
            path = parsed.path
            qs = parse_qs(parsed.query)
            default_mode = ctx.config.get("default_game_mode", "regular")
            try:
                if path.startswith("/api/item-counter/"):
                    row_id = int(path.rsplit("/", 1)[-1])
                    mode = _mode_from_qs(qs, default_mode)
                    lang = _lang_from_qs(qs, ctx.config.get("language", "ru"))
                    ctx.db.delete_tracked_item(mode, row_id)
                    payload = _compute_item_counter(ctx, mode, lang=lang)
                    payload["ok"] = True
                    self._send_json(payload)
                    return

                if path.startswith("/api/cultist/timer/"):
                    tid = int(path.rsplit("/", 1)[-1])
                    ctx.db.delete_cultist_timer(tid)
                    self._send_json({"ok": True})
                    return

                self._send_json({"error": "Not found"}, status=404)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=500)

    return AssistantHandler


def run_server(ctx: AppContext) -> ThreadingHTTPServer:
    host = ctx.config.get("host", "127.0.0.1")
    port = int(ctx.config.get("port", 8745))
    return ThreadingHTTPServer((host, port), make_handler(ctx))
