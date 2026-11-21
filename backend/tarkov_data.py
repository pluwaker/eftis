"""Fetch, translate, and locally cache Escape from Tarkov game data from json.tarkov.dev."""

from __future__ import annotations

import concurrent.futures
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
import re
import threading
import time
import urllib.parse
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter

JSON_BASE = "https://json.tarkov.dev"
TARKOV_HELP_BASE = "https://tarkov.help"
TARKOV_HELP_TRADERS = (
    "prapor", "therapist", "skier", "peacemaker", "mechanic",
    "ragman", "jaeger", "fence", "lightkeeper", "btr_driver",
    "ref", "storyteller",
)
MAPS_CONFIG_URL = "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json"
SVG_FALLBACK_BASES = [
    "https://assets.tarkov.dev/maps/svg",
    "https://raw.githubusercontent.com/the-hideout/tarkov-dev-svg-maps/main",
]

# Maps that do not specify svgPath directly in maps.json
EXTRA_SVG_MAP = {
    "the-lab": "Labs.svg",
    "the-labyrinth": "Labyrinth.svg",
}

# Variant locations that share identical geometry, bounds, floors, and SVG with a base map
MAP_SVG_ALIAS = {
    "night-factory": "factory",
    "ground-zero-21": "ground-zero",
}

USD_ITEM_ID = "5696686a4bdc2da3298b456a"
EUR_ITEM_ID = "569668774bdc2da2298b4568"
RUB_ITEM_ID = "5449016a4bdc2d6f028b456f"


class _TarkovHelpGuideParser(HTMLParser):
    """Parse Tarkov.Help SSR walkthrough HTML into clean step-by-step tactical sections, tables, lists, and screenshots."""

    _SKIP_CLASSES = (
        "js-tooltip", "js-inner", "bb-image__text-tooltip",
        "toc", "navbox", "infobox", "noprint", "reference",
        "mobile-title", "bb-youtube",
    )

    _TRANSITION_RE = re.compile(
        r"^(?:"
        r"сперва|для\s+начала|сначала|дальше|далее|затем|после\s+этого|после\s+чего|"
        r"теперь|осталось|в\s+конце|наконец|дополнительно|кроме\s+того|"
        r"путь\s+лежит|ид[её]м\s+(?:на|в|к)|отправляемся|"
        r"(?:перв|втор|треть|четв[её]рт|пят)(?:ым|ой|ым\s+делом|ое|ая)|"
        r"first[, ]|to\s+start[, ]|next[, ]|then[, ]|after\s+that[, ]|now[, ]|"
        r"finally[, ]|lastly[, ]|additionally[, ]|second[, ]|third[, ]|"
        r"head\s+to\b|the\s+path\s+lies\b|you\s+must\s+extract\b|all\s+that\s+remains\b"
        r")",
        re.IGNORECASE,
    )

    _LEADIN_STRIP_RE = re.compile(
        r"^(?:сперва|для\s+начала|сначала|дальше|далее|затем|после\s+этого|теперь|наконец|first|to\s+start|next|then|after\s+that|now|finally)[,:]?\s*(?:вам\s+)?(?:нужно\s+|надо\s+|необходимо\s+|you\s+need\s+to\s+|we\s+need\s+to\s+)?",
        re.IGNORECASE,
    )

    _MAP_LINK_LINE_RE = re.compile(
        r"(?:на\s+карте|on\s+the\s+map|on\s+map)$",
        re.IGNORECASE,
    )

    def __init__(self, default_title: str = "Пошаговое прохождение") -> None:
        super().__init__(convert_charrefs=True)
        self._default_title = default_title
        self.sections: list[dict[str, Any]] = []
        self.images: list[dict[str, str]] = []
        self._seen_img_urls: set[str] = set()
        self._skip_depth = 0
        self._skip_tags: list[str] = []

        self._current_sec: dict[str, Any] = self._new_section(default_title, 2, explicit=False)
        self._in_heading: int | None = None
        self._heading_buf: list[str] = []

        self._in_p = False
        self._p_buf: list[str] = []

        self._in_li = False
        self._li_buf: list[str] = []
        self._list_depth = 0
        self._list_items: list[str] = []

        self._table_depth = 0
        self._current_table: list[list[str]] = []
        self._current_row: list[str] = []
        self._in_cell = False
        self._cell_buf: list[str] = []

    @staticmethod
    def _new_section(title: str, level: int, explicit: bool = True) -> dict[str, Any]:
        return {"title": title, "level": level, "blocks": [], "images": [], "_explicit": explicit}

    @staticmethod
    def _clean_ws(txt: str) -> str:
        return re.sub(r"\s+", " ", txt or "").strip()

    @staticmethod
    def _clean_table_rows(rows: list[list[str]]) -> list[list[str]]:
        out = [list(r) for r in rows]
        if len(out) >= 3 and len(out[0]) == 1 and len(out[1]) > 1:
            out = out[1:]
        if len(out) < 2:
            return out
        max_cols = max(len(r) for r in out)
        keep_idx = []
        for ci in range(max_cols):
            hdr = (out[0][ci] if ci < len(out[0]) else "").strip().lower()
            has_body = any(ci < len(r) and bool(r[ci].strip()) for r in out[1:])
            if hdr in ("иконка", "icon", "") and not has_body:
                continue
            keep_idx.append(ci)
        if not keep_idx:
            return []
        return [[r[ci] if ci < len(r) else "" for ci in keep_idx] for r in out]

    @staticmethod
    def _clean_img_url(src: str) -> str:
        if not src:
            return ""
        url = src.strip()
        if url.startswith("//"):
            url = "https:" + url
        elif url.startswith("/"):
            url = TARKOV_HELP_BASE + url
        if not url.startswith(("https://", "http://")):
            return ""
        low = url.lower().split("?", 1)[0]
        if not any(low.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".webp")):
            return ""
        if any(ign in low for ign in (
            "/icons/", "/logo/", "/features/", "/items/", "/traders/",
            "placeholder.", "avatar", "ruble", "currency", "site-logo",
            "og-image", "icon512", "favicon",
        )):
            return ""
        return url

    @classmethod
    def _summarize_step_title(cls, text: str, fallback: str) -> str:
        clean = cls._clean_ws(text)
        if not clean:
            return fallback
        # Trim common transition lead-in if meaningful verb/subject follows
        stripped = cls._LEADIN_STRIP_RE.sub("", clean).strip()
        if len(stripped) >= 14:
            clean = stripped[0].upper() + stripped[1:]
        # Take first sentence if it's concise
        sent = re.split(r"(?<=[.!?])\s+", clean, maxsplit=1)[0].rstrip(".")
        if 10 <= len(sent) <= 68:
            return sent
        if len(clean) <= 68:
            return clean.rstrip(".")
        cut = clean[:66].rsplit(" ", 1)[0].rstrip(",.;:-")
        return f"{cut}…"

    def _finalize_section(self, sec: dict[str, Any]) -> None:
        if not (sec["blocks"] or sec["images"]):
            return
        explicit = sec.pop("_explicit", True)
        if not explicit:
            first_text = ""
            for b in sec["blocks"]:
                if b.get("type") == "p" and b.get("text"):
                    first_text = b["text"]
                    break
                if b.get("type") == "list" and b.get("items"):
                    first_text = b["items"][0]
                    break
            if first_text:
                sec["title"] = self._summarize_step_title(first_text, self._default_title)
        self.sections.append(sec)

    def _push_section_if_nonempty(self) -> None:
        self._finalize_section(self._current_sec)

    def _maybe_split_step(self, incoming_text: str) -> None:
        sec = self._current_sec
        has_content = bool(sec["blocks"] or sec["images"])
        if not has_content:
            return
        # Always split when previous step already had screenshots/tables and a new narrative paragraph begins
        has_media_or_table = bool(sec["images"]) or any(b.get("type") == "table" for b in sec["blocks"])
        if has_media_or_table:
            self._push_section_if_nonempty()
            self._current_sec = self._new_section(self._default_title, 2, explicit=False)
            return
        # Also split text-only steps on explicit progression cue phrases
        if incoming_text and self._TRANSITION_RE.search(incoming_text.strip()):
            self._push_section_if_nonempty()
            self._current_sec = self._new_section(self._default_title, 2, explicit=False)

    def _add_image(self, url: str, caption: str = "") -> None:
        if not url:
            return
        cap = self._clean_ws(caption)
        if url not in self._seen_img_urls:
            self._seen_img_urls.add(url)
            entry = {"url": url, "caption": cap}
            self.images.append(entry)
            self._current_sec["images"].append(entry)
        elif cap:
            for existing in self._current_sec["images"]:
                if existing["url"] == url and not existing["caption"]:
                    existing["caption"] = cap
                    break

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        cls_tokens = set(attr_map.get("class", "").lower().split())
        el_id = attr_map.get("id", "").lower()

        if self._skip_depth > 0:
            self._skip_depth += 1
            self._skip_tags.append(tag)
            return

        if tag in ("script", "style", "noscript", "svg") or el_id == "toc" or any(c in cls_tokens for c in self._SKIP_CLASSES):
            self._skip_depth = 1
            self._skip_tags.append(tag)
            return

        if tag in ("h2", "h3", "h4"):
            self._in_heading = int(tag[1])
            self._heading_buf = []
            return

        if tag == "img":
            if self._table_depth > 0:
                return
            raw_src = attr_map.get("data-src") or attr_map.get("src") or ""
            w_attr = int(attr_map["width"]) if attr_map.get("width", "").isdigit() else 999
            h_attr = int(attr_map["height"]) if attr_map.get("height", "").isdigit() else 999
            clean_url = self._clean_img_url(raw_src)
            if clean_url and w_attr >= 80 and h_attr >= 60:
                cap = attr_map.get("alt") or attr_map.get("title") or attr_map.get("data-caption") or ""
                if cap == clean_url.rsplit("/", 1)[-1]:
                    cap = ""
                self._add_image(clean_url, cap)
            return

        if tag == "table":
            if self._table_depth == 0:
                self._current_table = []
            self._table_depth += 1
            return

        if self._table_depth > 0:
            if tag == "tr":
                self._current_row = []
            elif tag in ("th", "td"):
                self._in_cell = True
                self._cell_buf = []
            elif tag == "br" and self._in_cell:
                self._cell_buf.append(" ")
            return

        if tag in ("ul", "ol"):
            if self._list_depth == 0:
                self._list_items = []
            self._list_depth += 1
            return

        if tag == "li" and self._list_depth > 0:
            self._in_li = True
            self._li_buf = []
            return

        if tag == "p" and self._list_depth == 0:
            self._in_p = True
            self._p_buf = []

    def handle_endtag(self, tag: str) -> None:
        if self._skip_depth > 0:
            self._skip_depth -= 1
            if self._skip_tags:
                self._skip_tags.pop()
            return

        if self._in_heading is not None and tag == f"h{self._in_heading}":
            title = self._clean_ws("".join(self._heading_buf))
            if title and title.lower() not in ("содержание", "contents", "как выполнить квест?", "how to complete the quest?"):
                self._push_section_if_nonempty()
                self._current_sec = self._new_section(title, self._in_heading, explicit=True)
            self._in_heading = None
            self._heading_buf = []
            return

        if self._table_depth > 0:
            if tag in ("th", "td") and self._in_cell:
                self._in_cell = False
                self._current_row.append(self._clean_ws("".join(self._cell_buf)))
            elif tag == "tr":
                if any(c for c in self._current_row):
                    self._current_table.append(self._current_row)
            elif tag == "table":
                self._table_depth -= 1
                if self._table_depth == 0 and len(self._current_table) >= 2:
                    cleaned_rows = self._clean_table_rows(self._current_table[:25])
                    if len(cleaned_rows) >= 2:
                        self._current_sec["blocks"].append({"type": "table", "rows": cleaned_rows})
            return

        if tag == "li" and self._in_li:
            self._in_li = False
            txt = self._clean_ws("".join(self._li_buf))
            if txt:
                self._list_items.append(txt)
            return

        if tag in ("ul", "ol") and self._list_depth > 0:
            self._list_depth -= 1
            if self._list_depth == 0 and self._list_items:
                self._maybe_split_step(self._list_items[0])
                self._current_sec["blocks"].append({"type": "list", "items": self._list_items})
                self._list_items = []
            return

        if tag == "p" and self._in_p:
            self._in_p = False
            txt = self._clean_ws("".join(self._p_buf))
            self._p_buf = []
            if not txt or txt in ("*", "—", "-") or len(txt) <= 1:
                return
            if len(txt) <= 55 and self._MAP_LINK_LINE_RE.search(txt):
                return
            self._maybe_split_step(txt)
            self._current_sec["blocks"].append({"type": "p", "text": txt})

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        if self._in_heading is not None:
            self._heading_buf.append(data)
        elif self._in_cell:
            self._cell_buf.append(data)
        elif self._in_li:
            self._li_buf.append(data)
        elif self._in_p:
            self._p_buf.append(data)

    def finish(self) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
        self._push_section_if_nonempty()
        return self.sections, self.images


class TarkovDataStore:
    """Thread-safe local cache + translator for regular (PvP) and pve datasets."""

    def __init__(self, cache_dir: Path, ttl_minutes: int = 15) -> None:
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.svg_dir = self.cache_dir / "svg"
        self.svg_dir.mkdir(parents=True, exist_ok=True)
        self.ttl_seconds = max(60, ttl_minutes * 60)
        self._lock = threading.RLock()
        self._memory: dict[str, dict[str, Any]] = {}
        self._maps_cfg: list[dict[str, Any]] | None = None
        self._tarkov_help_lock = threading.RLock()
        self._tarkov_help_idx: dict[str, dict[str, Any]] = {}
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": "EFT-Personal-Assistant/1.0"})
        adapter = HTTPAdapter(pool_connections=16, pool_maxsize=16)
        self._session.mount("https://", adapter)
        self._session.mount("http://", adapter)

    def _refresh_json_bg(self, rel_url: str, cache_path: Path) -> None:
        url = rel_url if rel_url.startswith("http") else f"{JSON_BASE}/{rel_url}"
        try:
            resp = self._session.get(url, timeout=30)
            resp.raise_for_status()
            payload = resp.json()
            tmp_path = cache_path.with_suffix(f".{threading.get_ident()}.tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            tmp_path.replace(cache_path)
        except Exception:
            pass

    def _fetch_json_cached(self, rel_url: str, cache_name: str, force: bool = False) -> Any:
        cache_path = self.cache_dir / cache_name
        cache_path.parent.mkdir(parents=True, exist_ok=True)

        if not force and cache_path.exists():
            age = time.time() - cache_path.stat().st_mtime
            if age < self.ttl_seconds:
                with open(cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            # Stale-while-revalidate: return existing cache immediately (< 12h old) and refresh in background
            if age < 12 * 3600:
                try:
                    with open(cache_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    threading.Thread(target=self._refresh_json_bg, args=(rel_url, cache_path), daemon=True).start()
                    return data
                except Exception:
                    pass

        url = rel_url if rel_url.startswith("http") else f"{JSON_BASE}/{rel_url}"
        try:
            resp = self._session.get(url, timeout=30)
            resp.raise_for_status()
            payload = resp.json()
            tmp_path = cache_path.with_suffix(f".{threading.get_ident()}.tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            tmp_path.replace(cache_path)
            return payload
        except Exception:
            if cache_path.exists():
                with open(cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            raise

    def _load_wiki_relations(self) -> dict[str, dict[str, Any]]:
        """Load optional local quest relation cache without any Fandom network calls."""
        rel_file = self.cache_dir / "wiki_quest_relations.json"
        if rel_file.exists():
            try:
                with open(rel_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    def get_maps_config(self, force: bool = False) -> dict[str, dict[str, Any]]:
        with self._lock:
            if self._maps_cfg is None or force:
                raw = self._fetch_json_cached(MAPS_CONFIG_URL, "maps_config.json", force=force)
                self._maps_cfg = raw
            by_norm: dict[str, dict[str, Any]] = {}
            for entry in self._maps_cfg or []:
                norm = entry.get("normalizedName")
                if not norm:
                    continue
                chosen = None
                for view in entry.get("maps", []):
                    if view.get("projection") == "interactive":
                        chosen = view
                        break
                if chosen:
                    by_norm[norm] = chosen
            for alias, base in MAP_SVG_ALIAS.items():
                if alias not in by_norm and base in by_norm:
                    by_norm[alias] = by_norm[base]
            return by_norm

    def get_svg(self, normalized_name: str) -> str | None:
        maps_cfg = self.get_maps_config()
        cfg = maps_cfg.get(normalized_name, {})
        svg_url = cfg.get("svgPath")
        filename = None
        if svg_url:
            filename = svg_url.rsplit("/", 1)[-1]
        elif normalized_name in EXTRA_SVG_MAP:
            filename = EXTRA_SVG_MAP[normalized_name]
        elif MAP_SVG_ALIAS.get(normalized_name) in EXTRA_SVG_MAP:
            filename = EXTRA_SVG_MAP[MAP_SVG_ALIAS[normalized_name]]

        if not filename:
            return None

        local_path = self.svg_dir / filename
        if local_path.exists() and local_path.stat().st_size > 200:
            return local_path.read_text(encoding="utf-8")

        candidates = []
        if svg_url:
            candidates.append(svg_url)
        for base in SVG_FALLBACK_BASES:
            candidates.append(f"{base}/{filename}")

        for url in candidates:
            try:
                r = self._session.get(url, timeout=20)
                if r.status_code == 200 and "<svg" in r.text:
                    local_path.write_text(r.text, encoding="utf-8")
                    return r.text
            except Exception:
                continue
        return None

    def get_mode_data(self, game_mode: str = "regular", force: bool = False, lang: str = "ru") -> dict[str, Any]:
        mode = "pve" if game_mode == "pve" else "regular"
        norm_lang = "en" if str(lang or "").lower().startswith("en") else "ru"
        cache_key = f"{mode}:{norm_lang}"
        with self._lock:
            cached = self._memory.get(cache_key)
            if not force and cached and (time.time() - cached["loaded_at"] < self.ttl_seconds):
                return cached

        endpoints = [
            "items", f"items_{norm_lang}",
            "tasks", f"tasks_{norm_lang}",
            "maps", f"maps_{norm_lang}",
            "traders", f"traders_{norm_lang}",
        ]
        raw: dict[str, Any] = {}
        with ThreadPoolExecutor(max_workers=9) as pool:
            ep_futures = {
                ep: pool.submit(self._fetch_json_cached, f"{mode}/{ep}", f"{mode}/{ep}.json", force)
                for ep in endpoints
            }
            cfg_future = pool.submit(self.get_maps_config, force)
            for ep, fut in ep_futures.items():
                res = fut.result()
                raw[ep] = res.get("data", res)
            maps_cfg = cfg_future.result()

        built = self._build_normalized(mode, raw, maps_cfg, lang=norm_lang)
        built["loaded_at"] = time.time()
        built["lang"] = norm_lang

        with self._lock:
            self._memory[cache_key] = built

        # Pre-warm Tarkov.Help quest index in background so opening guides is instant
        threading.Thread(target=self._get_tarkov_help_index, args=(norm_lang,), daemon=True).start()
        return built

    @staticmethod
    def _tr(mapping: dict[str, str], key: Any, fallback: str = "") -> str:
        if key is None:
            return fallback
        s = str(key)
        return mapping.get(s, fallback or s)

    @staticmethod
    def _build_map_floors(norm: str, cfg: dict[str, Any], raw_layers: list[dict[str, Any]], lang: str = "ru") -> list[dict[str, Any]]:
        is_en = lang == "en"
        # Special explicit 3-level architecture for The Lab (Labs.svg has Technical_Level, First_Level, Second_Level)
        if norm == "the-lab":
            return [
                {
                    "id": "technical",
                    "label": "Technical (-1F)" if is_en else "Технический (-1 эт.)",
                    "order": -1,
                    "svgIds": ["Technical_Level"],
                    "isolated": True,
                    "extents": [{"height": [-10000, -0.9]}],
                },
                {
                    "id": "first",
                    "label": "1st Floor" if is_en else "1 этаж",
                    "order": 1,
                    "svgIds": ["First_Level"],
                    "isolated": True,
                    "extents": [{"height": [-0.9, 3.0]}],
                },
                {
                    "id": "second",
                    "label": "2nd Floor" if is_en else "2 этаж",
                    "order": 2,
                    "svgIds": ["Second_Level"],
                    "isolated": True,
                    "extents": [{"height": [3.0, 10000]}],
                },
            ]

        if norm == "interchange":
            layers_by_name = {str(l.get("name") or ""): l for l in raw_layers}
            return [
                {
                    "id": "first",
                    "label": "1st Floor / Garage" if is_en else "1 этаж / Парковка",
                    "order": 1,
                    "svgIds": ["Ground_Level"],
                    "isolated": False,
                    "extents": [],
                },
                {
                    "id": "second",
                    "label": "2nd Floor (Mall)" if is_en else "2 этаж (ТЦ)",
                    "order": 2,
                    "svgIds": ["First_Floor"],
                    "isolated": False,
                    "extents": layers_by_name.get("2nd Floor", {}).get("extents") or [],
                },
                {
                    "id": "third",
                    "label": "3rd Floor (Mall)" if is_en else "3 этаж (ТЦ)",
                    "order": 3,
                    "svgIds": ["Second_Floor"],
                    "isolated": False,
                    "extents": layers_by_name.get("3rd Floor", {}).get("extents") or [],
                },
            ]

        if not raw_layers:
            if norm == "terminal":
                return [
                    {"id": "first", "label": "1st Floor / Ground" if is_en else "1 этаж / Улица", "order": 1, "svgIds": ["Ground_Level"], "isolated": False, "extents": []},
                    {"id": "second", "label": "Interiors" if is_en else "Интерьеры", "order": 2, "svgIds": ["First_Floor"], "isolated": False, "extents": []},
                ]
            return []

        isolated = norm in ("factory", "night-factory")
        floors: list[dict[str, Any]] = []
        floor_map_cfg = [
            (("technical",), "underground", "Technical (-1F)" if is_en else "Технический (-1 эт.)", -1, ["Technical_Level"]),
            (("tunnels", "basement"), "underground", "Basement / Tunnels" if is_en else "Подвал / Туннели", -1, ["Basement"]),
            (("bunkers",), "underground", "Bunkers" if is_en else "Бункеры", -1, ["Bunkers"]),
            (("garage",), "underground", "Underground Garage" if is_en else "Подземный гараж", -1, ["Underground_Level"]),
            (("underground",), "underground", "Underground" if is_en else "Подземелье", -1, ["Underground_Level"]),
            (("2nd", "second"), "second", "2nd Floor" if is_en else "2 этаж", 2, ["Second_Floor", "Second_Level"]),
            (("3rd", "third"), "third", "3rd Floor" if is_en else "3 этаж", 3, ["Third_Floor"]),
            (("4th", "fourth"), "fourth", "4th Floor" if is_en else "4 этаж", 4, ["Fourth_Floor"]),
            (("5th", "fifth"), "fifth", "5th Floor" if is_en else "5 этаж", 5, ["Fifth_Floor"]),
        ]

        seen_ids: set[str] = set()
        for idx, lyr in enumerate(raw_layers):
            raw_name = str(lyr.get("name") or "").strip()
            low = raw_name.lower()
            svg_lyr = lyr.get("svgLayer")
            matched = None
            for kws, fid, lbl, order, default_svgs in floor_map_cfg:
                if any(kw in low for kw in kws):
                    svg_ids = list(default_svgs)
                    if svg_lyr and svg_lyr not in svg_ids:
                        svg_ids.insert(0, svg_lyr)
                    matched = {
                        "id": fid,
                        "label": lbl,
                        "order": order,
                        "svgIds": svg_ids,
                        "isolated": isolated,
                        "extents": lyr.get("extents") or [],
                    }
                    break
            if not matched:
                fid = re.sub(r"[^a-z0-9_]+", "_", low).strip("_") or f"floor_{idx}"
                matched = {
                    "id": fid,
                    "label": raw_name,
                    "order": 10 + idx,
                    "svgIds": [svg_lyr] if svg_lyr else [],
                    "isolated": isolated,
                    "extents": lyr.get("extents") or [],
                }
            if matched["id"] not in seen_ids:
                seen_ids.add(matched["id"])
                floors.append(matched)

        # Always include 1st / Ground floor if standard map has multi-floor layers
        has_numbered = any(f["id"] in ("second", "third", "fourth", "fifth", "underground") for f in floors)
        if has_numbered and "first" not in seen_ids:
            base_svg = cfg.get("svgLayer") or "Ground_Level"
            if is_en:
                base_label = "1st Floor" if norm in ("factory", "night-factory") else "1st Floor / Ground"
            else:
                base_label = "1 этаж" if norm in ("factory", "night-factory") else "1 этаж / Улица"
            floors.append(
                {
                    "id": "first",
                    "label": base_label,
                    "order": 1,
                    "svgIds": [base_svg, "First_Floor", "First_Level", "Ground_Floor"],
                    "isolated": isolated,
                    "extents": [],
                }
            )

        floors.sort(key=lambda x: x["order"])
        return floors

    @staticmethod
    def _point_in_extent(x: float, y: float, z: float, ext: dict[str, Any]) -> bool:
        hr = ext.get("height")
        if hr and len(hr) == 2:
            lo, hi = min(float(hr[0]), float(hr[1])), max(float(hr[0]), float(hr[1]))
            if not (lo <= y <= hi):
                return False
        bnds = ext.get("bounds") or []
        if not bnds:
            return True
        for b in bnds:
            if len(b) >= 2:
                x1, z1 = float(b[0][0]), float(b[0][1])
                x2, z2 = float(b[1][0]), float(b[1][1])
                if min(x1, x2) <= x <= max(x1, x2) and min(z1, z2) <= z <= max(z1, z2):
                    return True
        return False

    @classmethod
    def _resolve_point_floor(
        cls,
        norm: str,
        x: float,
        y: float,
        z: float,
        floors_meta: list[dict[str, Any]],
        lang: str = "ru",
    ) -> tuple[str, str]:
        if not floors_meta:
            return "first", ("1st Floor / Ground" if lang == "en" else "1 этаж / Улица")
        for f in floors_meta:
            for ext in f.get("extents") or []:
                if cls._point_in_extent(x, y, z, ext):
                    return f["id"], f["label"]
        first_floor = next((f for f in floors_meta if f["id"] == "first"), None)
        if first_floor:
            return first_floor["id"], first_floor["label"]
        return floors_meta[0]["id"], floors_meta[0]["label"]

    @staticmethod
    def _project_point(x: float, z: float, cfg: dict[str, Any]) -> tuple[float, float] | None:
        bounds = cfg.get("bounds")
        if not bounds or len(bounds) != 2:
            return None
        rot = float(cfg.get("coordinateRotation") or 0.0)
        ang = math.radians(rot)
        cos_a = math.cos(ang)
        sin_a = math.sin(ang)

        def rot_pt(px: float, pz: float) -> tuple[float, float]:
            return (px * cos_a - pz * sin_a, px * sin_a + pz * cos_a)

        rx0, rz0 = rot_pt(float(bounds[0][0]), float(bounds[0][1]))
        rx1, rz1 = rot_pt(float(bounds[1][0]), float(bounds[1][1]))
        min_rx, max_rx = min(rx0, rx1), max(rx0, rx1)
        min_rz, max_rz = min(rz0, rz1), max(rz0, rz1)
        dx = max_rx - min_rx
        dz = max_rz - min_rz
        if dx == 0 or dz == 0:
            return None

        px, pz = rot_pt(float(x), float(z))
        u = (px - min_rx) / dx
        v = (max_rz - pz) / dz
        return (round(u, 5), round(v, 5))

    def _build_normalized(
        self,
        mode: str,
        raw: dict[str, Any],
        maps_cfg: dict[str, dict[str, Any]],
        lang: str = "ru",
    ) -> dict[str, Any]:
        is_en = lang == "en"
        items_raw = raw["items"].get("items", {})
        items_ru = raw.get(f"items_{lang}") or raw.get("items_ru") or {}
        traders_raw = raw["traders"]
        traders_ru = raw.get(f"traders_{lang}") or raw.get("traders_ru") or {}
        tasks_raw = raw["tasks"].get("tasks", {})
        quest_items_raw = raw["tasks"].get("questItems", {})
        tasks_ru = raw.get(f"tasks_{lang}") or raw.get("tasks_ru") or {}
        maps_data = raw["maps"]
        maps_raw = maps_data.get("maps", {})
        mobs_raw = maps_data.get("mobs", {})
        maps_ru = raw.get(f"maps_{lang}") or raw.get("maps_ru") or {}
        any_map_lbl = "Any" if is_en else "Любая"
        flea_lbl = "Flea Market" if is_en else "Барахолка"

        # 1. Traders
        traders: dict[str, dict[str, Any]] = {}
        for tid, t in traders_raw.items():
            traders[tid] = {
                "id": tid,
                "name": self._tr(traders_ru, t.get("name"), tid),
                "normalizedName": t.get("normalizedName", ""),
                "imageLink": t.get("imageLink", ""),
            }

        # 2. Items
        items: dict[str, dict[str, Any]] = {}
        items_list: list[dict[str, Any]] = []
        for iid, it in items_raw.items():
            name = self._tr(items_ru, it.get("name"), it.get("normalizedName", iid))
            short_name = self._tr(items_ru, it.get("shortName"), name)
            types = it.get("types") or []
            no_flea = "noFlea" in types

            best_sell_rub = 0
            best_sell_trader = ""
            for s in it.get("sellToTrader") or []:
                pr = int(s.get("priceRUB") or 0)
                if pr > best_sell_rub:
                    best_sell_rub = pr
                    tid = s.get("trader", "")
                    best_sell_trader = traders.get(tid, {}).get("name", tid)

            best_buy_rub = None
            best_buy_source = ""
            for b in it.get("buyFromTrader") or []:
                pr = int(b.get("priceRUB") or 0)
                if pr > 0 and (best_buy_rub is None or pr < best_buy_rub):
                    best_buy_rub = pr
                    tid = b.get("trader", "")
                    lvl = b.get("minTraderLevel", 1)
                    best_buy_source = f"{traders.get(tid, {}).get('name', tid)} LL{lvl}"

            flea_low = None if no_flea else (it.get("lastLowPrice") or None)
            flea_avg = None if no_flea else (it.get("avg24hPrice") or None)
            flea_price = flea_low or flea_avg

            # Best realistic sell valuation for stash (max of trader or flea)
            stash_unit_rub = max(best_sell_rub, flea_price or 0)

            buy_candidates: list[tuple[int, str]] = []
            if flea_price and flea_price > 0:
                buy_candidates.append((int(flea_price), flea_lbl))
            if best_buy_rub and best_buy_rub > 0:
                buy_candidates.append((int(best_buy_rub), best_buy_source))
            cheapest_buy_rub, cheapest_buy_source = min(buy_candidates, key=lambda x: x[0]) if buy_candidates else (0, "")

            it_norm = it.get("normalizedName", "")
            norm_item = {
                "id": iid,
                "name": name,
                "shortName": short_name,
                "normalizedName": it_norm,
                "basePrice": int(it.get("basePrice") or 0),
                "fleaPrice": flea_price,
                "avg24hPrice": flea_avg,
                "bestSellRub": best_sell_rub,
                "bestSellTrader": best_sell_trader,
                "bestBuyRub": best_buy_rub,
                "bestBuySource": best_buy_source,
                "cheapestBuyRub": cheapest_buy_rub,
                "cheapestBuySource": cheapest_buy_source,
                "stashUnitRub": stash_unit_rub,
                "noFlea": no_flea,
                "width": int(it.get("width") or 1),
                "height": int(it.get("height") or 1),
                "types": types,
                "iconLink": it.get("iconLink", ""),
                "wikiLink": f"https://tarkov.dev/item/{it_norm}" if it_norm else "https://tarkov.dev/items",
                "buyFromTrader": it.get("buyFromTrader") or [],
            }
            items[iid] = norm_item
            items_list.append(norm_item)

        # Currency exchange rates (RUB per 1 USD / 1 EUR from items catalog)
        usd_rub = items.get(USD_ITEM_ID, {}).get("bestBuyRub") or items.get(USD_ITEM_ID, {}).get("basePrice") or 150
        eur_rub = items.get(EUR_ITEM_ID, {}).get("bestBuyRub") or items.get(EUR_ITEM_ID, {}).get("basePrice") or 165

        # 3. Maps (with projected coordinates for extracts, locks, bosses)
        maps: dict[str, dict[str, Any]] = {}
        maps_by_name_id: dict[str, str] = {}
        maps_by_scene: dict[str, str] = {}
        maps_by_norm: dict[str, str] = {}

        for mid, mp in maps_raw.items():
            norm = mp.get("normalizedName", "")
            cfg = maps_cfg.get(norm, {})
            name = self._tr(maps_ru, mp.get("name"), norm or mid)
            name_id = mp.get("nameId", "")
            scene_path = mp.get("scenePath", "")
            if name_id:
                maps_by_name_id[name_id] = mid
            if scene_path:
                maps_by_scene[scene_path] = mid
            if norm:
                maps_by_norm[norm] = mid

            extracts = []
            for ex in mp.get("extracts") or []:
                pos = ex.get("position") or {}
                uv = self._project_point(pos.get("x", 0), pos.get("z", 0), cfg) if pos else None
                extracts.append(
                    {
                        "id": ex.get("id", ""),
                        "name": self._tr(maps_ru, ex.get("name"), ex.get("name", "")),
                        "faction": ex.get("faction", "shared"),
                        "switch": bool(ex.get("switch")),
                        "uv": uv,
                        "y": pos.get("y", 0),
                    }
                )

            # Build unified floor definitions across all maps (including Labs 3 levels & 1st/Ground floor)
            raw_cfg_layers = list(cfg.get("layers") or [])
            floors_meta = self._build_map_floors(norm, cfg, raw_cfg_layers, lang=lang)

            locks = []
            for lk in mp.get("locks") or []:
                pos = lk.get("position") or {}
                uv = self._project_point(pos.get("x", 0), pos.get("z", 0), cfg) if pos else None
                key_id = lk.get("key", "")
                key_item = items.get(key_id, {})
                lx = float(pos.get("x", 0) or 0)
                ly = float(pos.get("y", 0) or 0)
                lz = float(pos.get("z", 0) or 0)
                floor_id, floor_label = self._resolve_point_floor(norm, lx, ly, lz, floors_meta, lang=lang)
                locks.append(
                    {
                        "id": lk.get("id", ""),
                        "lockType": lk.get("lockType", "door"),
                        "needsPower": bool(lk.get("needsPower")),
                        "keyId": key_id,
                        "keyName": key_item.get("name", key_id),
                        "keyShortName": key_item.get("shortName", ""),
                        "keyPrice": key_item.get("fleaPrice") or key_item.get("bestBuyRub") or 0,
                        "uv": uv,
                        "y": pos.get("y", 0),
                        "floorId": floor_id,
                        "floorLabel": floor_label,
                    }
                )

            zone_points: dict[str, list[tuple[float, float]]] = {}
            for sp in mp.get("spawns") or []:
                zn = sp.get("zoneName") or ""
                spos = sp.get("position") or {}
                if zn and "x" in spos and "z" in spos:
                    zone_points.setdefault(zn, []).append((float(spos["x"]), float(spos["z"])))

            label_pos_by_text: dict[str, tuple[float, float]] = {}
            for lb in cfg.get("labels") or []:
                ltxt = str(lb.get("text") or "").strip().lower()
                lpos = lb.get("position") or []
                if ltxt and len(lpos) >= 2:
                    label_pos_by_text[ltxt] = (float(lpos[0]), float(lpos[1]))

            zone_label_aliases = {
                "zonedormitory": "dorms",
                "zonegasstation": "new gas",
                "zoneport": "pier",
                "botzonegate1": "parking",
                "botzonegate2": "warehouse gate",
                "zonegatetowerright": "crane",
                "zonesmuglers": "smugglers boat",
            }
            non_boss_mobs = {
                "pmcBEAR", "pmcUSEC", "infectedAssault", "infectedCivil",
                "infectedPmc", "infectedLaborant", "infectedScreamer",
                "vsRF", "vsRFSniper",
            }

            bosses = []
            for bs in mp.get("bosses") or []:
                mob_key = bs.get("mob", "")
                mob_info = mobs_raw.get(mob_key, {})
                mob_name = self._tr(maps_ru, mob_info.get("name"), mob_key)
                is_boss = mob_key not in non_boss_mobs
                locs = []
                for sl in bs.get("spawnLocations") or []:
                    sl_name = self._tr(maps_ru, sl.get("name"), sl.get("name", ""))
                    skey = sl.get("spawnKey") or sl.get("name") or ""
                    uv = None
                    raw_pos = [p for p in (sl.get("positions") or []) if "x" in p and "z" in p]
                    if raw_pos:
                        cx = sum(float(p["x"]) for p in raw_pos) / len(raw_pos)
                        cz = sum(float(p["z"]) for p in raw_pos) / len(raw_pos)
                        uv = self._project_point(cx, cz, cfg)
                    elif skey in zone_points:
                        zpts = zone_points[skey]
                        cx = sum(p[0] for p in zpts) / len(zpts)
                        cz = sum(p[1] for p in zpts) / len(zpts)
                        uv = self._project_point(cx, cz, cfg)
                    else:
                        alias = zone_label_aliases.get(skey.lower())
                        if alias and alias in label_pos_by_text:
                            lx, lz = label_pos_by_text[alias]
                            uv = self._project_point(lx, lz, cfg)
                    locs.append({
                        "name": sl_name,
                        "chance": round(float(sl.get("chance") or 0) * 100, 1),
                        "uv": uv,
                    })
                bosses.append(
                    {
                        "mob": mob_key,
                        "name": mob_name,
                        "isBoss": is_boss,
                        "chance": round(float(bs.get("spawnChance") or 0) * 100, 1),
                        "spawnLocations": locs,
                    }
                )

            has_svg = bool(
                cfg.get("svgPath")
                or norm in EXTRA_SVG_MAP
                or MAP_SVG_ALIAS.get(norm) in EXTRA_SVG_MAP
            )
            floors_public = [
                {
                    "id": f["id"],
                    "label": f["label"],
                    "svgIds": f["svgIds"],
                    "isolated": f.get("isolated", False),
                }
                for f in floors_meta
            ]
            maps[mid] = {
                "id": mid,
                "name": name,
                "normalizedName": norm,
                "nameId": name_id,
                "scenePath": scene_path,
                "raidDuration": mp.get("raidDuration", 0),
                "players": mp.get("players", ""),
                "hasSvg": has_svg,
                "layers": [f["label"] for f in floors_meta],
                "floors": floors_public,
                "bounds": cfg.get("bounds"),
                "coordinateRotation": cfg.get("coordinateRotation", 0),
                "extracts": extracts,
                "locks": locks,
                "bosses": bosses,
            }

        # 4. Tasks (Quests)
        tasks: dict[str, dict[str, Any]] = {}
        for tid, tk in tasks_raw.items():
            t_norm = str(tk.get("normalizedName") or "")
            tname = self._tr(tasks_ru, tk.get("name"), t_norm or tid)
            trader_id = tk.get("trader", "")
            trader_name = traders.get(trader_id, {}).get("name", trader_id)
            task_map_id = tk.get("map")
            task_map_name = maps.get(task_map_id, {}).get("name", "") if task_map_id else any_map_lbl

            task_requirements = []
            prereqs = []
            for req in tk.get("taskRequirements") or []:
                req_task = req.get("task")
                if req_task:
                    prereqs.append(req_task)
                    req_st = req.get("status") or ["complete"]
                    task_requirements.append({
                        "task": req_task,
                        "status": req_st if isinstance(req_st, list) else [req_st],
                    })

            needed_keys = []
            for nk_group in tk.get("neededKeys") or []:
                for key_id in nk_group.get("keys") or []:
                    key_it = items.get(key_id, {})
                    needed_keys.append(
                        {
                            "id": key_id,
                            "name": key_it.get("name", key_id),
                            "shortName": key_it.get("shortName", ""),
                            "price": key_it.get("fleaPrice") or key_it.get("bestBuyRub") or 0,
                        }
                    )

            objectives = []
            for ob in tk.get("objectives") or []:
                ob_desc = self._tr(tasks_ru, ob.get("description"), ob.get("description", ""))
                ob_maps = ob.get("maps") or ([task_map_id] if task_map_id else [])
                zones_proj = []
                seen_zones: set[tuple[str, str]] = set()
                for z in ob.get("zones") or []:
                    z_map_id = z.get("map")
                    z_id = z.get("id") or ""
                    z_pos = z.get("position") or {}
                    if z_map_id and z_map_id in maps and (z_map_id, z_id) not in seen_zones:
                        seen_zones.add((z_map_id, z_id))
                        cfg = maps_cfg.get(maps[z_map_id]["normalizedName"], {})
                        uv = self._project_point(z_pos.get("x", 0), z_pos.get("z", 0), cfg)
                        if uv:
                            zones_proj.append({"id": z_id, "mapId": z_map_id, "uv": uv, "y": z_pos.get("y", 0)})

                req_item_id = ob.get("item") or ob.get("questItem")
                req_item_name = ""
                req_item_icon = ""
                if req_item_id:
                    if req_item_id in items:
                        req_item_name = items[req_item_id]["name"]
                        req_item_icon = items[req_item_id].get("iconLink", "")
                    elif req_item_id in quest_items_raw:
                        qi = quest_items_raw[req_item_id]
                        req_item_name = self._tr(tasks_ru, qi.get("name"), qi.get("normalizedName", req_item_id))

                marker_id = ob.get("markerItem") or ""
                marker_name = items.get(marker_id, {}).get("name", "") if marker_id else ""

                alt_items = []
                for alt_id in ob.get("items") or []:
                    if alt_id in items:
                        alt_items.append({"id": alt_id, "name": items[alt_id]["name"], "iconLink": items[alt_id].get("iconLink", "")})

                ob_keys = []
                seen_ob_keys: set[str] = set()
                for kg in ob.get("requiredKeys") or []:
                    for kid in kg:
                        if kid not in seen_ob_keys:
                            seen_ob_keys.add(kid)
                            kit = items.get(kid, {})
                            ob_keys.append({"id": kid, "name": kit.get("name", kid), "shortName": kit.get("shortName", "")})

                ob_map_names = [maps[m]["name"] for m in ob_maps if m in maps]

                objectives.append(
                    {
                        "id": ob.get("id", ""),
                        "type": ob.get("type", ""),
                        "description": ob_desc,
                        "optional": bool(ob.get("optional")),
                        "count": int(ob.get("count") or 1),
                        "foundInRaid": bool(ob.get("foundInRaid")),
                        "itemId": req_item_id or "",
                        "itemName": req_item_name,
                        "itemIcon": req_item_icon,
                        "markerItemId": marker_id,
                        "markerItemName": marker_name,
                        "altItems": alt_items,
                        "requiredKeys": ob_keys,
                        "maps": ob_maps,
                        "mapNames": ob_map_names,
                        "zones": zones_proj,
                    }
                )

            finish_rew = tk.get("finishRewards") or {}
            start_rew = tk.get("startRewards") or {}
            reward_items = []
            for entry in finish_rew.get("items") or []:
                rid = entry.get("item") or ""
                rit = items.get(rid, {})
                reward_items.append(
                    {
                        "id": rid,
                        "name": rit.get("name") or rid,
                        "shortName": rit.get("shortName") or "",
                        "iconLink": rit.get("iconLink") or "",
                        "count": int(entry.get("count") or 1),
                    }
                )
            reward_standing = []
            for st_e in finish_rew.get("traderStanding") or []:
                stid = st_e.get("trader") or ""
                reward_standing.append(
                    {
                        "traderId": stid,
                        "traderName": traders.get(stid, {}).get("name", stid),
                        "standing": float(st_e.get("standing") or 0),
                    }
                )
            reward_offers = []
            for of_e in finish_rew.get("offerUnlock") or []:
                oiid = of_e.get("item") or ""
                otid = of_e.get("trader") or ""
                oit = items.get(oiid, {})
                reward_offers.append(
                    {
                        "itemName": oit.get("name") or oiid,
                        "iconLink": oit.get("iconLink") or "",
                        "traderName": traders.get(otid, {}).get("name", otid),
                        "level": int(of_e.get("level") or 1),
                    }
                )
            reward_skills = [
                {"name": str(sk.get("name") or ""), "level": int(sk.get("level") or 0)}
                for sk in (finish_rew.get("skillLevelReward") or [])
                if sk.get("name")
            ]
            reward_crafts = []
            for cr_e in finish_rew.get("craftUnlock") or []:
                st_name = cr_e.get("station") or ""
                rew_its = [
                    items.get(ci.get("item") or "", {}).get("name", ci.get("item") or "")
                    for ci in (cr_e.get("rewardItems") or [])
                ]
                reward_crafts.append(
                    {
                        "station": str(st_name),
                        "level": int(cr_e.get("level") or 1),
                        "items": rew_its,
                    }
                )
            start_items = []
            for entry in start_rew.get("items") or []:
                sid = entry.get("item") or ""
                sit = items.get(sid, {})
                start_items.append(
                    {
                        "id": sid,
                        "name": sit.get("name") or sid,
                        "count": int(entry.get("count") or 1),
                    }
                )

            tarkov_dev_url = f"https://tarkov.dev/task/{t_norm}" if t_norm else "https://tarkov.dev/tasks"
            tasks[tid] = {
                "id": tid,
                "name": tname,
                "normalizedName": t_norm,
                "traderId": trader_id,
                "traderName": trader_name,
                "traderImage": traders.get(trader_id, {}).get("imageLink", ""),
                "mapId": task_map_id or "",
                "mapName": task_map_name,
                "minPlayerLevel": int(tk.get("minPlayerLevel") or 1),
                "experience": int(tk.get("experience") or 0),
                "kappaRequired": bool(tk.get("kappaRequired")),
                "lightkeeperRequired": bool(tk.get("lightkeeperRequired")),
                "restartable": bool(tk.get("restartable")),
                "taskImageLink": tk.get("taskImageLink") or "",
                "wikiLink": tarkov_dev_url,
                "prereqs": prereqs,
                "taskRequirements": task_requirements,
                "unlocks": [],
                "chainDepth": 0,
                "neededKeys": needed_keys,
                "objectives": objectives,
                "rewards": {
                    "items": reward_items,
                    "standing": reward_standing,
                    "offers": reward_offers,
                    "skills": reward_skills,
                    "crafts": reward_crafts,
                    "startItems": start_items,
                },
            }

        # 4b. Supplement missing quests from client locale (tasks_ru / tasks_en)
        for k, v in tasks_ru.items():
            if k.endswith(" name") and isinstance(v, str) and v.strip():
                extra_tid = k[:-5].strip()
                if extra_tid not in tasks:
                    extra_name = v.strip()
                    extra_desc = str(tasks_ru.get(f"{extra_tid} description") or "").strip()
                    extra_objs = []
                    if extra_desc:
                        extra_objs.append({
                            "id": f"{extra_tid}_desc",
                            "type": "custom",
                            "description": extra_desc,
                            "optional": False,
                            "count": 1,
                            "foundInRaid": False,
                            "itemId": "",
                            "itemName": "",
                            "markerItemId": "",
                            "markerItemName": "",
                            "altItems": [],
                            "requiredKeys": [],
                            "maps": [],
                            "zones": [],
                        })

                    t_name_lower = extra_name.lower()
                    lk_req = any(w in t_name_lower for w in [
                        "сетевой провайдер", "проверка. часть", "ключ от башни", "на свет.", "загладить вину", "информатор смотрителя", "маяк смотрителя",
                        "network provider", "assessment", "key to the tower", "knock-knock", "getting acquainted", "make amends",
                    ])
                    if lk_req:
                        tr_name = "Lightkeeper" if is_en else "Смотритель"
                    elif any(w in t_name_lower for w in [
                        "реф", "арена", "знакомый из норвинска", "habet", "morituri", "killer7", "билет", "борей", "должник", "вбить клин", "верни долг", "батя",
                        "easy money", "balancing", "surprise", "create a distraction", "to great heights", "against the conscience",
                    ]):
                        tr_name = "Ref" if is_en else "Реф"
                    elif any(w in t_name_lower for w in ["водитель бтр", "бтр", "тур", "btr driver", "shipping delay", "hot wheels"]):
                        tr_name = "BTR Driver" if is_en else "Водитель БТР"
                    elif any(w in t_name_lower for w in ["марафон", "транзит", "кругосветка", "marathon"]):
                        tr_name = "Marathon" if is_en else "Марафон"
                    else:
                        tr_name = "Special / Events" if is_en else "Особые / Ивенты"

                    tasks[extra_tid] = {
                        "id": extra_tid,
                        "name": extra_name,
                        "normalizedName": re.sub(r"[^a-z0-9]+", "-", extra_name.lower()).strip("-") if is_en else "",
                        "traderId": "",
                        "traderName": tr_name,
                        "traderImage": "",
                        "mapId": "",
                        "mapName": any_map_lbl,
                        "minPlayerLevel": 1,
                        "experience": 0,
                        "kappaRequired": False,
                        "lightkeeperRequired": lk_req,
                        "restartable": False,
                        "taskImageLink": "",
                        "wikiLink": "https://tarkov.dev/tasks",
                        "prereqs": [],
                        "taskRequirements": [],
                        "unlocks": [],
                        "chainDepth": 0,
                        "neededKeys": [],
                        "objectives": extra_objs,
                        "rewards": {},
                    }

        # 4c. Enrich quest relations (prereqs, unlocks) from optional local cache (offline, zero Fandom requests)
        wiki_relations = self._load_wiki_relations()
        if wiki_relations:
            if not is_en:
                for title, wq in wiki_relations.items():
                    node = wq.get("node")
                    if node and node not in tasks:
                        t_title_lower = title.lower()
                        if any(w in t_title_lower for w in [
                            "санта", "снегурочка", "дедов морозов", "на ёлку", "утренник", "подарков не будет",
                            "праздник", "сходка боссов", "клятва гиппократа", "по следам terragroup",
                            "залетные (ивент)", "уют в доме", "остановитесь!", "битва дедов", "добрая снегурочка"
                        ]):
                            continue
                        lk_req = bool(wq.get("lightkeeperRequired") or any(w in t_title_lower for w in ["сетевой", "проверка", "ключ от башни", "на свет", "загладить"]))
                        tasks[node] = {
                            "id": node,
                            "name": title,
                            "normalizedName": "",
                            "traderId": "",
                            "traderName": wq.get("trader") or ("Смотритель" if lk_req else "Разное"),
                            "mapId": "",
                            "mapName": wq.get("map") or any_map_lbl,
                            "minPlayerLevel": 1,
                            "experience": 0,
                            "kappaRequired": False,
                            "lightkeeperRequired": lk_req,
                            "wikiLink": "https://tarkov.dev/tasks",
                            "prereqs": [],
                            "taskRequirements": [],
                            "unlocks": [],
                            "chainDepth": 0,
                            "neededKeys": [],
                            "objectives": [],
                        }

            # Map titles and names for fast lookup
            name_to_id = {t["name"].strip().lower(): tid for tid, t in tasks.items()}
            map_name_to_id = {m["name"].strip().lower(): mid for mid, m in maps.items()}

            # Cycle detection guard: check if adding dest_id as prerequisite of src_id creates a cycle
            def would_create_cycle(src_id: str, dest_id: str) -> bool:
                visited = set()
                q = [dest_id]
                while q:
                    curr = q.pop()
                    if curr == src_id:
                        return True
                    for parent in tasks.get(curr, {}).get("prereqs", []):
                        if parent not in visited and parent in tasks:
                            visited.add(parent)
                            q.append(parent)
                return False

            for tid, tk in list(tasks.items()):
                wq = wiki_relations.get(tk["name"])
                if not wq:
                    for item in wiki_relations.values():
                        if item.get("node") == tid:
                            wq = item
                            break
                if not wq:
                    continue

                if not is_en:
                    if (not tk["traderName"] or tk["traderName"] in ("Разное", "Разное / Игровое", "Особые / Ивенты")) and wq.get("trader"):
                        tk["traderName"] = wq["trader"]

                    if (not tk["mapId"] or tk["mapName"] == any_map_lbl) and wq.get("map"):
                        raw_map = wq["map"].split("<")[0].split(",")[0].strip()
                        m_id = map_name_to_id.get(raw_map.lower())
                        if m_id:
                            tk["mapId"] = m_id
                            tk["mapName"] = maps[m_id]["name"]

                # Link previous quests (prerequisites) only if this task does NOT already have
                # authoritative prerequisites from the game client (tasks.json)
                if not tk.get("prereqs"):
                    for p_title in wq.get("prev") or []:
                        pid = name_to_id.get(p_title.strip().lower())
                        if not pid and p_title in wiki_relations and wiki_relations[p_title].get("node"):
                            pid = wiki_relations[p_title]["node"]
                        if pid and pid in tasks and pid != tid:
                            p_name = tasks[pid]["name"].lower()
                            t_name = tk["name"].lower()
                            if "следопыт" in t_name and "благодарность" in p_name:
                                continue
                            if would_create_cycle(tid, pid):
                                continue

                            if pid not in tk["prereqs"]:
                                tk["prereqs"].append(pid)
                                tk["taskRequirements"].append({"task": pid, "status": ["complete"]})
                            if tid not in tasks[pid]["unlocks"]:
                                tasks[pid]["unlocks"].append(tid)

                # Link next quests (downstream unlocks) only if the child has no prereqs yet
                for n_title in wq.get("next") or []:
                    nid = name_to_id.get(n_title.strip().lower())
                    if not nid and n_title in wiki_relations and wiki_relations[n_title].get("node"):
                        nid = wiki_relations[n_title]["node"]
                    if nid and nid in tasks and nid != tid:
                        child = tasks[nid]
                        n_name = child["name"].lower()
                        t_name = tk["name"].lower()
                        if "шить" in t_name and "часть 4" in t_name and "часть 2" in n_name:
                            continue
                        if "следопыт" in t_name and "благодарность" in n_name:
                            continue
                        if "слава кпсс" in t_name and "вам посылка" in n_name:
                            continue
                        if "жизненный урок" in t_name and "фиксация прибыли" in n_name:
                            continue
                        if would_create_cycle(nid, tid):
                            continue

                        if nid not in tk["unlocks"]:
                            tk["unlocks"].append(nid)
                        if tid not in child["prereqs"]:
                            child["prereqs"].append(tid)
                            child["taskRequirements"].append({"task": tid, "status": ["complete"]})

        # Compute downstream unlocks, topological chainDepth, and clean flags
        for tid, tk in tasks.items():
            for pid in tk["prereqs"]:
                if pid in tasks and tid not in tasks[pid]["unlocks"]:
                    tasks[pid]["unlocks"].append(tid)

        depth_memo: dict[str, int] = {}

        def calc_depth(tid: str, visiting: set[str]) -> int:
            if tid in depth_memo:
                return depth_memo[tid]
            if tid in visiting or tid not in tasks:
                return 0
            visiting.add(tid)
            d = 0
            for pid in tasks[tid]["prereqs"]:
                if pid in tasks:
                    d = max(d, calc_depth(pid, visiting) + 1)
            visiting.remove(tid)
            depth_memo[tid] = d
            return d

        for tid in tasks:
            tasks[tid]["chainDepth"] = calc_depth(tid, set())

        # Authoritative Kappa handling:
        # In modern Escape from Tarkov (Patch 0.15+), Kappa (Collector) requires:
        # 1. Level 42, Scav karma >= 3.0, and Loyalty Level 4 with Prapor, Therapist, Skier, Peacekeeper, Mechanic, Ragman, Jaeger.
        # 2. Specific milestone tasks:
        #    - Стрелок от бога (A Shooter Born in Heaven)
        #    - Почтальон Печкин. Часть 2 (Postman Pat - Part 2)
        #    - Реагент. Часть 3 (Chemical - Part 3)
        #    - Шить — не тужить. Часть 2 (Sew it Good - Part 2)
        #    - Тарковский стрелок. Часть 4 (The Tarkov Shooter - Part 4)
        #    - and Коллекционер (Collector)
        # Plus their direct prerequisite chains (Part 1 -> Part 2, etc.)
        # Side quests like The Guide, Setup, Crisis, Insomnia, Stray Dogs, Hunting Trip,
        # and ALL Ref / Lightkeeper / Marathon / Event quests are explicitly NOT required for Kappa!
        kappa_core_ids = {
            "5c51aac186f77432ea65c552",  # Коллекционер
            "5c0bde0986f77479cf22c2f8",  # Стрелок от бога
            "596760e186f7741e11214d58",  # Почтальон Печкин. Часть 2
            "597a0e5786f77426d66c0636",  # Реагент. Часть 3
            "5ae4497b86f7744cf402ed00",  # Шить — не тужить. Часть 2
            "5bc480a686f7741af0342e29",  # Тарковский стрелок. Часть 4
        }
        # Reset any false kappa flags from previous steps
        for tid, tk in tasks.items():
            if tk.get("kappaRequired") and tid not in kappa_core_ids:
                if tid not in tasks_raw or not tasks_raw[tid].get("kappaRequired"):
                    tk["kappaRequired"] = False

        # Mark core IDs and their direct ancestors
        kappa_verified: set[str] = set()
        k_stack = [cid for cid in kappa_core_ids if cid in tasks]
        while k_stack:
            cur = k_stack.pop()
            if cur in tasks and cur not in kappa_verified:
                kappa_verified.add(cur)
                tasks[cur]["kappaRequired"] = True
                for pid in tasks[cur].get("prereqs", []):
                    if pid in tasks and pid not in kappa_verified:
                        k_stack.append(pid)

        # Ensure excluded categories are NEVER marked as Kappa
        for tid, tk in tasks.items():
            tr_lower = (tk.get("traderName") or "").lower()
            if any(ex in tr_lower for ex in ["смотритель", "lightkeeper", "реф", "ref", "марафон", "бтр", "ивент"]):
                tk["kappaRequired"] = False

        # Transitive Lightkeeper ancestor marking
        lk_seeds = [
            tid
            for tid, tk in tasks.items()
            if tk["lightkeeperRequired"]
            or "смотритель" in (tk.get("traderName") or "").lower()
            or "lightkeeper" in (tk.get("traderName") or "").lower()
        ]
        lk_seen: set[str] = set(lk_seeds)
        lk_stack = list(lk_seeds)
        while lk_stack:
            cur = lk_stack.pop()
            if cur in tasks:
                tasks[cur]["lightkeeperRequired"] = True
                for pid in tasks[cur]["prereqs"]:
                    if pid in tasks and pid not in lk_seen:
                        lk_seen.add(pid)
                        lk_stack.append(pid)

        return {
            "mode": mode,
            "traders": traders,
            "items": items,
            "items_list": items_list,
            "maps": maps,
            "maps_by_name_id": maps_by_name_id,
            "maps_by_scene": maps_by_scene,
            "maps_by_norm": maps_by_norm,
            "maps_cfg": maps_cfg,
            "tasks": tasks,
            "rates": {"RUB": 1, "USD": usd_rub, "EUR": eur_rub},
        }

    def lookup_task_name(self, task_id: str, game_mode: str = "pve") -> str | None:
        try:
            mode_data = self.get_mode_data(game_mode)
            tk = mode_data.get("tasks", {}).get(task_id)
            if tk and tk.get("name"):
                return tk["name"]
        except Exception:
            pass
        return None

    def project_world_coords(self, game_mode: str, map_id: str, x: float, z: float) -> tuple[float, float] | None:
        data = self.get_mode_data(game_mode)
        mp = data["maps"].get(map_id)
        if not mp:
            return None
        cfg = data["maps_cfg"].get(mp["normalizedName"], {})
        return self._project_point(x, z, cfg)

    @staticmethod
    def _build_task_briefing(task: dict[str, Any], all_tasks: dict[str, dict[str, Any]]) -> dict[str, Any]:
        prereqs = [
            {
                "id": pid,
                "name": all_tasks[pid]["name"],
                "traderName": all_tasks[pid].get("traderName", ""),
            }
            for pid in (task.get("prereqs") or [])
            if pid in all_tasks
        ]
        unlocks = [
            {
                "id": uid,
                "name": all_tasks[uid]["name"],
                "traderName": all_tasks[uid].get("traderName", ""),
            }
            for uid in (task.get("unlocks") or [])
            if uid in all_tasks
        ]
        return {
            "taskId": task.get("id", ""),
            "name": task.get("name", ""),
            "traderName": task.get("traderName", ""),
            "traderImage": task.get("traderImage", ""),
            "mapName": task.get("mapName", "Любая"),
            "minPlayerLevel": int(task.get("minPlayerLevel") or 1),
            "experience": int(task.get("experience") or 0),
            "kappaRequired": bool(task.get("kappaRequired")),
            "lightkeeperRequired": bool(task.get("lightkeeperRequired")),
            "restartable": bool(task.get("restartable")),
            "taskImageLink": task.get("taskImageLink", ""),
            "wikiLink": task.get("wikiLink", ""),
            "neededKeys": task.get("neededKeys") or [],
            "objectives": task.get("objectives") or [],
            "rewards": task.get("rewards") or {},
            "prereqs": prereqs,
            "unlocks": unlocks,
        }

    @staticmethod
    def _normalize_quest_title(title: str) -> str:
        txt = (title or "").lower()
        txt = re.sub(r"\[pve\s*zone\]|\(pve\)", " ", txt, flags=re.IGNORECASE)
        txt = txt.replace("ё", "е")
        txt = re.sub(r'[«»"\'.,:;!?()\[\]—–-]', " ", txt)
        return re.sub(r"\s+", " ", txt).strip()

    @staticmethod
    def _structure_guide_html(html_content: str, lang: str = "ru") -> tuple[str, list[dict[str, Any]], list[dict[str, str]], list[str]]:
        if not html_content:
            return "", [], [], []
        default_title = "Step-by-step Walkthrough" if lang == "en" else "Пошаговое прохождение"
        parser = _TarkovHelpGuideParser(default_title=default_title)
        try:
            parser.feed(html_content)
            parser.close()
        except Exception:
            pass
        sections, image_objs = parser.finish()
        images = [img["url"] for img in image_objs]

        clean_html = html_content
        clean_html = re.sub(r"<script.*?</script>", "", clean_html, flags=re.DOTALL | re.IGNORECASE)
        clean_html = re.sub(r"<style.*?</style>", "", clean_html, flags=re.DOTALL | re.IGNORECASE)
        clean_html = re.sub(r'href="/', f'target="_blank" rel="noopener" href="{TARKOV_HELP_BASE}/', clean_html)
        return clean_html, sections, image_objs, images

    @staticmethod
    def _extract_tarkov_help_guide_html(page_html: str) -> str:
        """Extract the balanced <div class='QuestGuide_content__...'> block from Tarkov.Help SSR HTML."""
        if not page_html:
            return ""
        m = re.search(r'<div[^>]+class="[^"]*QuestGuide_content[^"]*"[^>]*>', page_html, re.IGNORECASE)
        if not m:
            return ""
        start = m.start()
        depth = 0
        pos = start
        token_re = re.compile(r"<(/?)div\b[^>]*>", re.IGNORECASE)
        for tm in token_re.finditer(page_html, start):
            if tm.group(1) == "/":
                depth -= 1
                if depth <= 0:
                    return page_html[start:tm.end()]
            else:
                depth += 1
            pos = tm.end()
        return page_html[start:min(len(page_html), start + 24000)]

    def _get_tarkov_help_index(self, lang: str = "ru", force: bool = False) -> dict[str, Any]:
        norm_lang = "en" if lang == "en" else "ru"
        with self._tarkov_help_lock:
            cached = self._tarkov_help_idx.get(norm_lang)
            if not force and cached and (time.time() - cached.get("loaded_at", 0) < 86400):
                return cached

        cache_path = self.cache_dir / f"tarkov_help_index_{norm_lang}.json"
        if not force and cache_path.exists():
            try:
                if time.time() - cache_path.stat().st_mtime < 86400:
                    loaded = json.loads(cache_path.read_text(encoding="utf-8"))
                    if loaded.get("byTitle"):
                        loaded["loaded_at"] = cache_path.stat().st_mtime
                        with self._tarkov_help_lock:
                            self._tarkov_help_idx[norm_lang] = loaded
                        return loaded
            except Exception:
                pass

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        }
        by_title: dict[str, str] = {}
        by_slug: dict[str, str] = {}

        def _fetch_trader(trader_slug: str) -> list[tuple[str, str]]:
            out: list[tuple[str, str]] = []
            try:
                r = self._session.get(f"{TARKOV_HELP_BASE}/{norm_lang}/trader/{trader_slug}/quests", headers=headers, timeout=(3.0, 8.0))
                if r.status_code != 200:
                    return out
                pattern = rf'href="/{norm_lang}/quest/([^"]+)"[^>]*>(.*?)</a>'
                for slug, inner in re.findall(pattern, r.text, re.DOTALL):
                    txt = re.sub(r"<[^>]+>", " ", inner)
                    txt = re.sub(r"\s+", " ", txt).strip()
                    if not txt or txt.lower() in ("читать далее", "read more"):
                        continue
                    out.append((slug.strip(), txt))
            except Exception:
                pass
            return out

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            for pairs in pool.map(_fetch_trader, TARKOV_HELP_TRADERS):
                for slug, title in pairs:
                    by_slug[slug] = title
                    nt = self._normalize_quest_title(title)
                    if nt and nt not in by_title:
                        by_title[nt] = slug

        payload = {"byTitle": by_title, "bySlug": by_slug, "loaded_at": time.time()}
        if by_title:
            try:
                tmp = cache_path.with_suffix(".tmp")
                tmp.write_text(json.dumps({"byTitle": by_title, "bySlug": by_slug}, ensure_ascii=False), encoding="utf-8")
                tmp.replace(cache_path)
            except Exception:
                pass
        with self._tarkov_help_lock:
            self._tarkov_help_idx[norm_lang] = payload
        return payload

    def _resolve_tarkov_help_slug(self, task_name: str, normalized_name: str, lang: str) -> tuple[str, str]:
        """Return (resolved_lang, slug) on Tarkov.Help or ('', '') if unmatched."""
        norm_lang = "en" if lang == "en" else "ru"
        idx = self._get_tarkov_help_index(norm_lang)
        by_title = idx.get("byTitle") or {}
        by_slug = idx.get("bySlug") or {}

        nt = self._normalize_quest_title(task_name)
        if nt and nt in by_title:
            return norm_lang, by_title[nt]

        # Try normalized slug matching on EN index (e.g. 'background-check', strip '-pve-zone')
        clean_norm = re.sub(r"-pve-zone$", "", (normalized_name or "").strip().lower())
        if clean_norm:
            if norm_lang == "en" and clean_norm in by_slug:
                return "en", clean_norm
            en_idx = self._get_tarkov_help_index("en") if norm_lang != "en" else idx
            if clean_norm in (en_idx.get("bySlug") or {}):
                return "en", clean_norm
            # Also try normalized EN title if normalized_name uses hyphens
            en_nt = self._normalize_quest_title(clean_norm.replace("-", " "))
            if en_nt in (en_idx.get("byTitle") or {}):
                return "en", en_idx["byTitle"][en_nt]

        return "", ""

    def _fetch_tarkov_help_guide(self, page_lang: str, slug: str, prefer_lang: str) -> tuple[str, str, str]:
        """Fetch Tarkov.Help quest page and return (guide_html, actual_lang, page_url).
        If page_lang != prefer_lang, follows hreflang alternate URL to get the preferred language when available.
        """
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,ru;q=0.7" if prefer_lang == "en" else "ru-RU,ru;q=0.9,en;q=0.7",
        }
        url = f"{TARKOV_HELP_BASE}/{page_lang}/quest/{slug}"
        try:
            resp = self._session.get(url, headers=headers, timeout=(3.0, 8.0))
            if resp.status_code != 200:
                return "", page_lang, ""
            html_page = resp.text

            # Follow hreflang link if we matched via EN slug while user prefers RU (or vice versa)
            if page_lang != prefer_lang:
                alt_m = re.search(rf'https://tarkov\.help/{prefer_lang}/quest/[a-z0-9-]+', html_page)
                if alt_m:
                    alt_url = alt_m.group(0)
                    alt_resp = self._session.get(alt_url, headers=headers, timeout=(3.0, 8.0))
                    if alt_resp.status_code == 200:
                        alt_guide = self._extract_tarkov_help_guide_html(alt_resp.text)
                        if alt_guide:
                            return alt_guide, prefer_lang, alt_url

            guide_html = self._extract_tarkov_help_guide_html(html_page)
            if not guide_html and page_lang == prefer_lang:
                other = "en" if prefer_lang == "ru" else "ru"
                alt_m = re.search(rf'https://tarkov\.help/{other}/quest/[a-z0-9-]+', html_page)
                if alt_m:
                    alt_url = alt_m.group(0)
                    alt_resp = self._session.get(alt_url, headers=headers, timeout=(3.0, 8.0))
                    if alt_resp.status_code == 200:
                        alt_guide = self._extract_tarkov_help_guide_html(alt_resp.text)
                        if alt_guide:
                            return alt_guide, other, alt_url
            return guide_html, page_lang, url
        except Exception:
            return "", page_lang, ""

    def get_task_guide(self, task_id: str, game_mode: str = "pve", force: bool = False, lang: str = "ru") -> dict[str, Any]:
        norm_lang = "en" if str(lang or "").lower().startswith("en") else "ru"
        mode_data = self.get_mode_data(game_mode, lang=norm_lang)
        tasks = mode_data.get("tasks", {})
        task = tasks.get(task_id)
        if not task:
            return {"error": "Quest not found" if norm_lang == "en" else "Квест не найден"}

        briefing = self._build_task_briefing(task, tasks)
        guides_dir = self.cache_dir / "guides" / norm_lang
        guides_dir.mkdir(parents=True, exist_ok=True)
        cache_file = guides_dir / f"{task_id}.json"

        if not force and cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    cached = json.load(f)
                if cached.get("parserVer") == 4 and cached.get("guideSource") == "tarkov.help":
                    cached["wikiAvailable"] = bool(cached.get("wikiSections") or cached.get("images"))
                    cached["briefing"] = briefing
                    if cached.get("wikiLink"):
                        briefing["wikiLink"] = cached["wikiLink"]
                    return cached
                cache_file.unlink(missing_ok=True)
            except Exception:
                pass

        task_name = task.get("name", "")
        task_norm = task.get("normalizedName", "")
        trader_name = task.get("traderName", "")
        tarkov_dev_url = task.get("wikiLink") or (f"https://tarkov.dev/task/{task_norm}" if task_norm else "https://tarkov.dev/tasks")

        matched_lang, matched_slug = self._resolve_tarkov_help_slug(task_name, task_norm, norm_lang)
        html_content = ""
        used_lang = norm_lang
        resolved_url = tarkov_dev_url
        guide_source = "tarkov.dev"

        if matched_slug:
            html_content, used_lang, page_url = self._fetch_tarkov_help_guide(matched_lang, matched_slug, norm_lang)
            if page_url:
                resolved_url = page_url
                guide_source = "tarkov.help"

        clean_html, wiki_sections, wiki_images, images = self._structure_guide_html(html_content, lang=used_lang)
        wiki_available = bool(wiki_sections or images)
        briefing["wikiLink"] = resolved_url

        result = {
            "parserVer": 4,
            "taskId": task_id,
            "taskName": task_name,
            "traderName": trader_name,
            "wikiLink": resolved_url,
            "guideUrl": resolved_url,
            "guideSource": guide_source,
            "source": used_lang,
            "wikiAvailable": wiki_available,
            "guideHtml": clean_html,
            "wikiSections": wiki_sections,
            "wikiImages": wiki_images,
            "images": images,
            "briefing": briefing,
        }

        if wiki_available:
            try:
                with open(cache_file, "w", encoding="utf-8") as f:
                    json.dump(result, f, ensure_ascii=False)
            except Exception:
                pass

        return result

    _ALLOWED_MEDIA_HOSTS = {"minio.tarkov.help", "assets.tarkov.dev"}

    def fetch_cached_media(self, raw_url: str) -> tuple[bytes, str] | None:
        """Fetch and disk-cache allowlisted Tarkov.Help / Tarkov.dev images over HTTP/1.1."""
        parsed = urllib.parse.urlparse((raw_url or "").strip())
        if parsed.scheme != "https" or parsed.netloc.lower() not in self._ALLOWED_MEDIA_HOSTS:
            return None

        media_dir = self.cache_dir / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(raw_url.encode("utf-8")).hexdigest()[:24]
        ext = Path(parsed.path).suffix.lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
            ext = ".webp"
        mime_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".gif": "image/gif",
        }
        cache_path = media_dir / f"{digest}{ext}"
        if cache_path.exists() and cache_path.stat().st_size > 100:
            return cache_path.read_bytes(), mime_map.get(ext, "image/webp")

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        }
        try:
            resp = self._session.get(raw_url, headers=headers, timeout=(4.0, 12.0))
            if resp.status_code != 200 or len(resp.content) > 12 * 1024 * 1024:
                return None
            ctype = (resp.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            if not ctype.startswith("image/"):
                ctype = mime_map.get(ext, "image/webp")
            tmp = cache_path.with_suffix(".tmp")
            tmp.write_bytes(resp.content)
            tmp.replace(cache_path)
            return resp.content, ctype
        except Exception:
            return None

