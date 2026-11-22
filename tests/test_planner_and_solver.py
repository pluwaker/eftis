"""Unit tests for deep domain modules (planner, cultist_solver, AssistantDB batch/clear)."""

from __future__ import annotations

import os
import tempfile
import unittest

from backend.cultist_solver import evaluate_basket, solve_cultist_circle
from backend.db import AssistantDB
from backend.planner import (
    build_map_payload,
    build_quests_payload,
    resolve_quest_statuses,
)


def _sample_data():
    items = {
        "bolt": {
            "id": "bolt",
            "name": "Болт",
            "shortName": "Болт",
            "basePrice": 2000,
            "fleaPrice": 25000,
            "bestSellRub": 1500,
            "bestSellTrader": "Терапевт",
            "bestBuyRub": None,
            "bestBuySource": "",
            "stashUnitRub": 25000,
            "noFlea": False,
            "types": ["barter"],
            "iconLink": "",
        },
        "watch": {
            "id": "watch",
            "name": "Часы Roler",
            "shortName": "Roler",
            "basePrice": 210_000,
            "fleaPrice": 65_000,
            "bestSellRub": 60_000,
            "bestSellTrader": "Терапевт",
            "bestBuyRub": None,
            "bestBuySource": "",
            "stashUnitRub": 65_000,
            "noFlea": False,
            "types": ["barter"],
            "iconLink": "",
        },
        "figurine": {
            "id": "figurine",
            "name": "Статуэтка льва",
            "shortName": "Лев",
            "basePrice": 220_000,
            "fleaPrice": 120_000,
            "bestSellRub": 110_000,
            "bestSellTrader": "Терапевт",
            "bestBuyRub": None,
            "bestBuySource": "",
            "stashUnitRub": 120_000,
            "noFlea": False,
            "types": ["barter"],
            "iconLink": "",
        },
        "marker": {
            "id": "marker",
            "name": "Маркер MS2000",
            "shortName": "MS2000",
            "basePrice": 10_000,
            "fleaPrice": 22_000,
            "bestSellRub": 14_000,
            "bestSellTrader": "Прапор",
            "bestBuyRub": 16_000,
            "bestBuySource": "Прапор",
            "stashUnitRub": 16_000,
            "noFlea": False,
            "types": ["special"],
            "iconLink": "",
        },
    }
    tasks = {
        "t1": {
            "id": "t1",
            "name": "Первый шаг",
            "traderName": "Прапор",
            "mapId": "m1",
            "mapName": "Таможня",
            "minPlayerLevel": 1,
            "experience": 1000,
            "kappaRequired": True,
            "lightkeeperRequired": False,
            "wikiLink": "",
            "prereqs": [],
            "unlocks": ["t2"],
            "chainDepth": 0,
            "neededKeys": [],
            "objectives": [
                {
                    "id": "o1",
                    "type": "mark",
                    "description": "Отметить бензовоз",
                    "count": 1,
                    "foundInRaid": False,
                    "itemId": "",
                    "itemName": "",
                    "markerItemId": "marker",
                    "markerItemName": "Маркер MS2000",
                    "requiredKeys": [],
                    "maps": ["m1"],
                    "zones": [{"mapId": "m1", "uv": [0.4, 0.5]}],
                }
            ],
        },
        "t2": {
            "id": "t2",
            "name": "Второй шаг",
            "traderName": "Прапор",
            "mapId": "m1",
            "mapName": "Таможня",
            "minPlayerLevel": 3,
            "experience": 2000,
            "kappaRequired": True,
            "lightkeeperRequired": False,
            "wikiLink": "",
            "prereqs": ["t1"],
            "unlocks": [],
            "chainDepth": 1,
            "neededKeys": [],
            "objectives": [],
        },
    }
    maps = {
        "m1": {
            "id": "m1",
            "name": "Таможня",
            "normalizedName": "customs",
            "hasSvg": True,
            "raidDuration": 35,
            "players": "10-12",
            "layers": [],
            "bosses": [],
            "extracts": [],
            "locks": [],
        }
    }
    return {
        "items": items,
        "items_list": list(items.values()),
        "tasks": tasks,
        "maps": maps,
        "maps_by_norm": {"customs": "m1"},
        "rates": {"USD": 150, "EUR": 160},
    }


class TestPlannerAndSolver(unittest.TestCase):
    def test_cultist_solver_respects_max_qty(self) -> None:
        d = _sample_data()["items"]
        # Own only 1 watch (210k base) and 1 figurine (220k base) => must combine both to hit 400k+
        pool = [
            {**d["watch"], "maxQty": 1},
            {**d["figurine"], "maxQty": 1},
        ]
        sols = solve_cultist_circle(pool, target_base_value=400_000, max_slots=5, allow_traders=False)
        self.assertTrue(sols)
        best = sols[0]
        self.assertGreaterEqual(best["totalBaseValue"], 400_000)
        for ent in best["items"]:
            self.assertEqual(ent["qty"], 1)

        # Single copy alone cannot reach 400k
        impossible = solve_cultist_circle([{**d["watch"], "maxQty": 1}], target_base_value=400_000, max_slots=5, allow_traders=False)
        self.assertEqual(impossible, [])

    def test_evaluate_basket_tier(self) -> None:
        d = _sample_data()["items"]
        res = evaluate_basket(d, [{"id": "watch", "qty": 2}], allow_traders=False)
        self.assertEqual(res["totalBaseValue"], 420_000)
        self.assertEqual(res["slotsUsed"], 2)
        self.assertIn("6ч", res["tier"])

    def test_quest_status_and_map_payload(self) -> None:
        data = _sample_data()
        resolved = resolve_quest_statuses(data["tasks"], {})
        self.assertEqual(resolved["t1"][0], "available")
        self.assertEqual(resolved["t2"][0], "locked")

        q_payload = build_quests_payload(data, {}, [])
        self.assertEqual(q_payload["counts"]["available"], 1)
        self.assertEqual(q_payload["kappa"], {"done": 0, "total": 2})

        m_payload = build_map_payload(data, {}, "customs", "<svg/>", None)
        self.assertIsNotNone(m_payload)
        self.assertEqual(len(m_payload["activeMapTasks"]), 2)
        self.assertEqual(m_payload["activeMapTasks"][0]["taskId"], "t1")
        self.assertEqual(m_payload["activeMapTasks"][0]["status"], "available")
        self.assertEqual(m_payload["activeMapTasks"][1]["taskId"], "t2")
        self.assertEqual(m_payload["activeMapTasks"][1]["status"], "locked")
        self.assertEqual(m_payload["activeMapTasks"][0]["points"][0]["neededItems"][0]["name"], "Маркер MS2000")

    def test_db_batch_and_clear_quest_status(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            db = AssistantDB(os.path.join(td, "unit.db"))
            try:
                with db.batch():
                    db.set_quest_status("pve", "t1", "active", "Первый шаг", "Прапор", 1000)
                    db.upsert_tracked_item("pve", "Болт", 2, item_id="bolt", category_tag="quest")
                self.assertEqual(db.get_quest_statuses("pve")["t1"]["status"], "active")
                self.assertEqual(len(db.list_tracked_items("pve")), 1)
                db.clear_quest_status("pve", "t1")
                self.assertNotIn("t1", db.get_quest_statuses("pve"))
            finally:
                db.close()

    def test_completed_quest_cannot_revert_to_active_from_log(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            db = AssistantDB(os.path.join(td, "unit.db"))
            try:
                # 1. Quest completed on Nov 11
                db.set_quest_status("pve", "t1", "completed", "Квест 1", "Прапор", 1000, source="log", occurred_at="2026-11-11T14:37:00")
                self.assertEqual(db.get_quest_statuses("pve")["t1"]["status"], "completed")

                # 2. Older log from Oct 31 arrives with 'active' -> must NOT revert completed status
                applied = db.set_quest_status("pve", "t1", "active", "Квест 1", "Прапор", 1000, source="log", occurred_at="2026-10-31T00:22:00")
                self.assertFalse(applied)
                self.assertEqual(db.get_quest_statuses("pve")["t1"]["status"], "completed")

                # 3. Manual user change can still change it
                applied_manual = db.set_quest_status("pve", "t1", "active", "Квест 1", "Прапор", 1000, source="manual")
                self.assertTrue(applied_manual)
                self.assertEqual(db.get_quest_statuses("pve")["t1"]["status"], "active")

                # 4. Now manual 'active' cannot be overwritten by log
                applied_log = db.set_quest_status("pve", "t1", "failed", "Квест 1", "Прапор", 1000, source="log")
                self.assertFalse(applied_log)
                self.assertEqual(db.get_quest_statuses("pve")["t1"]["status"], "active")
            finally:
                db.close()

    def test_reconcile_and_transitive_prerequisites(self) -> None:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as td:
            db = AssistantDB(os.path.join(td, "unit.db"))
            try:
                tasks_dict = {
                    "t1": {"id": "t1", "name": "Часть 1", "prereqs": [], "taskRequirements": []},
                    "t2": {"id": "t2", "name": "Часть 2", "prereqs": ["t1"], "taskRequirements": [{"task": "t1", "status": ["complete"]}]},
                    "t3": {"id": "t3", "name": "Часть 3", "prereqs": ["t2"], "taskRequirements": [{"task": "t2", "status": ["complete"]}]},
                }
                # t1 falsely has 'active' in progress, but has 'completed' in history (from log)
                db.set_quest_status("pve", "t1", "completed", "Часть 1", source="log", occurred_at="2026-11-10T10:00:00")
                # Simulate old bug: direct SQL update to 'active' with source 'log'
                with db._connect() as conn:
                    conn.execute("UPDATE quest_progress SET status = 'active', source = 'log', updated_at = '2026-10-31T00:00:00' WHERE task_id = 't1'")
                # t3 is active
                db.set_quest_status("pve", "t3", "active", "Часть 3", source="log", occurred_at="2026-11-12T10:00:00")

                rec = db.reconcile_quest_progress("pve", tasks_dict)
                self.assertEqual(rec["restoredFromHistory"], 1)  # t1 restored to completed
                self.assertEqual(rec["inferredPrereqs"], 1)       # t2 inferred as completed because t3 is active

                st = db.get_quest_statuses("pve")
                self.assertEqual(st["t1"]["status"], "completed")
                self.assertEqual(st["t2"]["status"], "completed")
                self.assertEqual(st["t3"]["status"], "active")

                # Test planner resolution
                resolved = resolve_quest_statuses(tasks_dict, st)
                self.assertEqual(resolved["t1"][0], "completed")
                self.assertEqual(resolved["t2"][0], "completed")
                self.assertEqual(resolved["t3"][0], "active")
            finally:
                db.close()

    def test_extract_entries_multiline_json(self) -> None:
        from backend.log_watcher import ReadOnlyEftWatcher

        chunk = (
            "2026-11-13 20:29:36.083|1.3.0.1.48558|Info|push-notifications|Got notification | ChatMessageReceived\n"
            "{\n"
            '  "type": "new_message",\n'
            '  "message": {\n'
            '    "type": 12,\n'
            '    "text": "quest started",\n'
            '    "templateId": "5ac346a886f7744e1b083d67 successMessageText",\n'
            '    "items": {\n'
            '      "data": [\n'
            '        {\n'
            '          "_tpl": "5449016a4bdc2d6f028b456f",\n'
            '          "upd": {\n'
            '            "StackObjectsCount": 165000\n'
            "          }\n"
            "        }\n"
            "      ]\n"
            "    }\n"
            "  }\n"
            "}\n"
            "2026-11-13 20:29:36.084|1.3.0.1.48558|Info|push-notifications|NotificationMessageProcessor.ProcessMessage | Received notification: Type: ChatMessageReceived, Time: 0, Duration: Default, ShowNotification: False\n"
        )
        entries = ReadOnlyEftWatcher._extract_entries(chunk)
        self.assertEqual(len(entries), 2)
        ts, msg, obj = entries[0]
        self.assertEqual(ts, "2026-11-13T20:29:36.083")
        self.assertIsNotNone(obj)
        self.assertEqual(obj["message"]["type"], 12)
        self.assertEqual(obj["message"]["items"]["data"][0]["upd"]["StackObjectsCount"], 165000)

    def test_map_payload_completed_and_locked_status(self) -> None:
        data = _sample_data()
        saved = {
            "t1": {"status": "completed", "source": "log", "updated_at": "2026-11-15T12:00:00"},
            "t2": {"status": "active", "source": "log", "updated_at": "2026-11-15T12:05:00"},
        }
        m_payload = build_map_payload(data, saved, "customs", "<svg/>", None)
        self.assertIsNotNone(m_payload)
        tasks = m_payload["activeMapTasks"]
        self.assertEqual(len(tasks), 2)
        # Active is sorted first, then completed
        self.assertEqual(tasks[0]["taskId"], "t2")
        self.assertEqual(tasks[0]["status"], "active")
        self.assertEqual(tasks[1]["taskId"], "t1")
        self.assertEqual(tasks[1]["status"], "completed")

    def test_tarkov_data_task_expansion(self) -> None:
        from pathlib import Path
        from backend.tarkov_data import TarkovDataStore
        ds = TarkovDataStore(Path("cache"))
        pve_data = ds.get_mode_data("pve")
        tasks = pve_data["tasks"]
        # Ensure expanded catalog contains client locale quests (>650 quests)
        self.assertGreater(len(tasks), 650)
        # Verify key quest names can be resolved
        self.assertEqual(ds.lookup_task_name("66b493bc2d8cd3b5e90a3648", "pve"), "Марафон")
        self.assertEqual(ds.lookup_task_name("625d6ffaf7308432be1d44c5", "pve"), "Сетевой провайдер. Часть 2")

        # Verify wiki relations enriched prerequisites and unlocks
        np2 = tasks.get("625d6ffaf7308432be1d44c5")
        self.assertIsNotNone(np2)
        # Network Provider 2 must require Network Provider 1
        np1_id = "625d6ff5ddc94657c21a1625"
        self.assertIn(np1_id, np2["prereqs"])
        # Network Provider 2 must unlock Assessment 1
        as1_id = "625d6ffcaa168e51321d69d7"
        self.assertIn(as1_id, np2["unlocks"])
        as1 = tasks.get(as1_id)
        self.assertIsNotNone(as1)
        self.assertIn("625d6ffaf7308432be1d44c5", as1["prereqs"])
        self.assertGreater(as1["chainDepth"], np2["chainDepth"])

    def test_tracked_items_crud_and_adjust(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = AssistantDB(os.path.join(tmp, "items.db"))
            try:
                id1 = db.upsert_tracked_item(
                    game_mode="pve",
                    name="Болт",
                    target_qty=5,
                    current_qty=1,
                    item_id="bolt",
                    short_name="Болт",
                    fir_only=True,
                    category_tag="hideout",
                    notes="Верстак 2",
                )
                id2 = db.upsert_tracked_item(
                    game_mode="pve",
                    name="Светодиод LEDX",
                    target_qty=2,
                    current_qty=0,
                    item_id="ledx",
                    category_tag="quest",
                )
                rows = db.list_tracked_items("pve")
                self.assertEqual(len(rows), 2)

                adj1 = db.adjust_tracked_item("pve", id1, delta=3)
                self.assertIsNotNone(adj1)
                self.assertEqual(adj1["current_qty"], 4)

                # Clamp at >= 0 on negative delta
                adj1_zero = db.adjust_tracked_item("pve", id1, delta=-10)
                self.assertEqual(adj1_zero["current_qty"], 0)

                # Direct set current_qty and target_qty completes id1
                adj1_done = db.adjust_tracked_item("pve", id1, current_qty=6, target_qty=6)
                self.assertEqual(adj1_done["current_qty"], 6)
                self.assertEqual(adj1_done["target_qty"], 6)

                removed = db.clear_completed_tracked_items("pve")
                self.assertEqual(removed, 1)
                remaining = db.list_tracked_items("pve")
                self.assertEqual([r["id"] for r in remaining], [id2])

                db.delete_tracked_item("pve", id2)
                self.assertEqual(db.list_tracked_items("pve"), [])
            finally:
                db.close()

    def test_tarkov_help_guide_parser_and_bilingual_store(self) -> None:
        from pathlib import Path
        from backend.tarkov_data import TarkovDataStore

        sample_html = (
            '<div class="QuestGuide_content__RNYiS">'
            '<p>Сперва нужно найти ключ на Таможне в комнате 205.</p>'
            '<p><a href="/ru/map/tamozhnya"><span>Ключ на карте</span></a></p>'
            '<div class="bb-image"><div class="bb-image__image">'
            '<img src="https://minio.tarkov.help/production/img/articles/key_205.webp" alt="Куртка 205" />'
            '</div><div class="js-tooltip"><div class="bb-image__text"><span>Куртка 205</span></div></div></div>'
            '<p>Дальше откройте грузовик на стройке.</p>'
            '<div class="bb-image"><div class="bb-image__image">'
            '<img src="https://minio.tarkov.help/production/img/articles/truck_spot.webp" alt="Водительская дверь" />'
            '</div></div>'
            '<p>Осталось выйти живым с локации.</p>'
            '<img src="https://minio.tarkov.help/production/img/icons/kappa.svg" alt="icon" />'
            '<img src="https://minio.tarkov.help/production/img/items/5734758f.png" alt="item" />'
            '<img src="https://minio.tarkov.help/production/img/traders/prapor.png" alt="trader" />'
            '</div>'
        )
        _, sections, imgs_obj, img_urls = TarkovDataStore._structure_guide_html(sample_html, lang="ru")
        self.assertEqual(len(sections), 3)
        self.assertEqual(sections[0]["blocks"], [{"type": "p", "text": "Сперва нужно найти ключ на Таможне в комнате 205."}])
        self.assertEqual([im["caption"] for im in sections[0]["images"]], ["Куртка 205"])
        self.assertEqual(sections[1]["blocks"], [{"type": "p", "text": "Дальше откройте грузовик на стройке."}])
        self.assertEqual([im["caption"] for im in sections[1]["images"]], ["Водительская дверь"])
        self.assertEqual(sections[2]["blocks"], [{"type": "p", "text": "Осталось выйти живым с локации."}])
        self.assertEqual(sections[2]["images"], [])
        self.assertEqual(len(img_urls), 2)

        ds = TarkovDataStore(Path("cache"))
        ru_tasks = ds.get_mode_data("pve", lang="ru")["tasks"]
        en_tasks = ds.get_mode_data("pve", lang="en")["tasks"]
        self.assertTrue(all("fandom.com" not in (t.get("wikiLink") or "") for t in ru_tasks.values()))
        self.assertTrue(all("fandom.com" not in (t.get("wikiLink") or "") for t in en_tasks.values()))
        self.assertEqual(ru_tasks["5936d90786f7742b1420ba5b"]["name"], "Проба пера")
        self.assertEqual(en_tasks["5936d90786f7742b1420ba5b"]["name"], "Debut")

        g_en = ds.get_task_guide("5936d90786f7742b1420ba5b", "pve", lang="en")
        self.assertEqual(g_en["guideSource"], "tarkov.help")
        self.assertEqual(g_en["source"], "en")
        self.assertIn("tarkov.help/en/quest/", g_en["guideUrl"])
        self.assertGreaterEqual(len(g_en["wikiSections"]), 1)

    def test_map_floors_and_lock_floor_resolution(self) -> None:
        from pathlib import Path
        from backend.tarkov_data import TarkovDataStore

        ds = TarkovDataStore(Path("cache"))
        maps = ds.get_mode_data("pve")["maps"]

        labs = next(m for m in maps.values() if m["normalizedName"] == "the-lab")
        self.assertEqual([f["id"] for f in labs["floors"]], ["technical", "first", "second"])
        self.assertEqual([f["svgIds"][0] for f in labs["floors"]], ["Technical_Level", "First_Level", "Second_Level"])
        lab_lock_floors = {lk["floorId"] for lk in labs["locks"]}
        self.assertIn("first", lab_lock_floors)
        self.assertIn("second", lab_lock_floors)

        customs = next(m for m in maps.values() if m["normalizedName"] == "customs")
        customs_ids = [f["id"] for f in customs["floors"]]
        self.assertIn("first", customs_ids)
        self.assertIn("second", customs_ids)
        self.assertIn("third", customs_ids)

    def test_map_svg_aliases_and_non_svg_filtering(self) -> None:
        from pathlib import Path
        from backend.tarkov_data import TarkovDataStore

        ds = TarkovDataStore(Path("cache"))
        maps_by_norm = {m["normalizedName"]: m for m in ds.get_mode_data("regular")["maps"].values()}

        for alias in ("night-factory", "ground-zero-21"):
            self.assertIn(alias, maps_by_norm)
            mp = maps_by_norm[alias]
            self.assertTrue(mp["hasSvg"])
            self.assertTrue(mp["bounds"])
            self.assertTrue(any(ex.get("uv") is not None for ex in mp["extracts"]))

        for no_svg in ("ground-zero-tutorial", "infected-lab", "infected-factory", "the-lab-dark", "icebreaker"):
            if no_svg in maps_by_norm:
                self.assertFalse(maps_by_norm[no_svg]["hasSvg"])

    def test_storyline_quests_chain_and_guides(self) -> None:
        from pathlib import Path
        from backend.tarkov_data import STORYLINE_QUESTS, TarkovDataStore

        ds = TarkovDataStore(Path("cache"))
        ru_tasks = ds.get_mode_data("regular", lang="ru")["tasks"]
        en_tasks = ds.get_mode_data("regular", lang="en")["tasks"]

        self.assertEqual(len(STORYLINE_QUESTS), 14)
        for sq in STORYLINE_QUESTS:
            sid = sq["id"]
            self.assertIn(sid, ru_tasks)
            self.assertIn(sid, en_tasks)
            self.assertEqual(ru_tasks[sid]["traderName"], "Сюжет")
            self.assertEqual(en_tasks[sid]["traderName"], "Storyline")
            self.assertFalse(ru_tasks[sid]["kappaRequired"])

        tour = ru_tasks["story-tour"]
        self.assertEqual(tour["chainDepth"], 0)
        self.assertIn("story-batya", tour["unlocks"])
        self.assertIn("story-boreas", tour["unlocks"])
        self.assertIn("story-the-ticket", tour["unlocks"])

        ticket = ru_tasks["story-the-ticket"]
        self.assertEqual(ticket["chainDepth"], 1)
        for ending in ("story-ticket-kerman", "story-ticket-prapor", "story-ticket-lightkeeper", "story-ticket-survivor"):
            self.assertIn(ending, ticket["unlocks"])
            self.assertEqual(ru_tasks[ending]["chainDepth"], 2)

        batya_guide = ds.get_task_guide("story-batya", "regular", lang="ru")
        self.assertEqual(batya_guide["guideSource"], "tarkov.help")
        self.assertTrue(batya_guide["guideUrl"].endswith("/ru/quest/batya"))

    def test_satellite_meta_and_extract_descriptions(self) -> None:
        from pathlib import Path
        from backend.tarkov_data import TarkovDataStore

        ds = TarkovDataStore(Path("cache"))
        maps_by_norm = {m["normalizedName"]: m for m in ds.get_mode_data("regular", lang="ru")["maps"].values()}

        for norm in ("customs", "woods", "ground-zero", "the-lab"):
            sat = maps_by_norm[norm].get("satellite")
            self.assertIsNotNone(sat)
            self.assertIn("{z}/{x}/{y}", sat["tilePath"])
            cL, cT, cR, cB = sat["crop"]
            self.assertGreater(cR, cL)
            self.assertGreater(cB, cT)

        interchange_ex = {e["name"]: e for e in maps_by_norm["interchange"]["extracts"]}
        self.assertIn("А-Выход у ТЭЦ", interchange_ex)
        self.assertIn("Автомобиль", interchange_ex["А-Выход у ТЭЦ"]["requirement"])
        self.assertIn("20 000", interchange_ex["А-Выход у ТЭЦ"]["requirement"])
        self.assertIn("Тропа к реке (Сигнал)", interchange_ex)
        self.assertEqual(interchange_ex["Тропа к реке (Сигнал)"]["requirement"], "Зелёный флаер")


if __name__ == "__main__":
    unittest.main()

