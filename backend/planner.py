"""Pure domain planner for quests and map tasks.

Designed as a deep module with zero HTTP or SQLite dependencies so every calculation
can be tested directly across synthetic datasets and real game snapshots.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any


def resolve_quest_statuses(
    tasks_dict: dict[str, dict[str, Any]],
    saved_quests: dict[str, dict[str, Any]],
) -> dict[str, tuple[str, str, str]]:
    """Resolve effective status (status, source, updated_at) for all tasks.

    Handles:
    - Dedicated status from saved_quests (manual/log/history/inferred).
    - Inferred completion: if task B is active/completed and requires task A to be complete,
      task A must be completed (fixes older completed tasks whose logs were deleted by BSG,
      and fixes tasks erroneously set to 'active' by old log replays).
    - Status-aware prerequisite checks (supports 'complete', 'active', 'failed' requirements).
    """
    # 1. Gather all tasks explicitly saved as completed or active
    completed_ids = {tid for tid, st in saved_quests.items() if st.get("status") == "completed"}
    active_ids = {tid for tid, st in saved_quests.items() if st.get("status") == "active"}
    failed_ids = {tid for tid, st in saved_quests.items() if st.get("status") == "failed"}

    # 2. Transitive deduction: upstream required prerequisites of any active/completed task must be completed
    inferred_completed: set[str] = set()

    def _deduce_upstream(tid: str, visiting: set[str]) -> None:
        if tid in visiting or tid not in tasks_dict:
            return
        visiting.add(tid)
        tk = tasks_dict[tid]
        reqs = tk.get("taskRequirements")
        if reqs:
            for req in reqs:
                pid = req.get("task")
                req_st = [s.lower() for s in (req.get("status") or ["complete"])]
                if pid and pid in tasks_dict and ("complete" in req_st or "completed" in req_st):
                    inferred_completed.add(pid)
                    _deduce_upstream(pid, visiting)
        else:
            for pid in tk.get("prereqs") or []:
                if pid in tasks_dict:
                    inferred_completed.add(pid)
                    _deduce_upstream(pid, visiting)
        visiting.remove(tid)

    for tid in list(completed_ids | active_ids):
        _deduce_upstream(tid, set())

    # 3. Determine effective status for every task
    effective_statuses: dict[str, str] = {}
    resolved: dict[str, tuple[str, str, str]] = {}

    for tid in tasks_dict:
        st_row = saved_quests.get(tid)
        if st_row:
            status = st_row.get("status", "locked")
            source = st_row.get("source", "manual")
            updated_at = st_row.get("updated_at", "")
            # If task was marked 'active' by an old log, but downstream child is completed/active,
            # and it wasn't manually forced by user, infer it as completed
            if status == "active" and tid in inferred_completed and source != "manual":
                status = "completed"
                source = "inferred"
            effective_statuses[tid] = status
            resolved[tid] = (status, source, updated_at)
        elif tid in inferred_completed:
            effective_statuses[tid] = "completed"
            resolved[tid] = ("completed", "inferred", "")

    # 4. Resolve remaining tasks as 'available' or 'locked' based on prerequisites
    for tid, tk in tasks_dict.items():
        if tid in resolved:
            continue

        reqs = tk.get("taskRequirements")
        is_available = True

        if reqs:
            for req in reqs:
                pid = req.get("task")
                if not pid or pid not in tasks_dict:
                    continue
                req_st = [s.lower() for s in (req.get("status") or ["complete"])]
                p_curr = effective_statuses.get(pid, "locked")

                satisfied = False
                if "complete" in req_st or "completed" in req_st:
                    satisfied = (p_curr == "completed")
                elif "active" in req_st:
                    satisfied = (p_curr in ("active", "completed"))
                elif "failed" in req_st:
                    satisfied = (p_curr == "failed")
                else:
                    satisfied = (p_curr == "completed")

                if not satisfied:
                    is_available = False
                    break
        else:
            prereqs = tk.get("prereqs") or []
            is_available = all(effective_statuses.get(p) == "completed" for p in prereqs)

        final_st = "available" if is_available else "locked"
        effective_statuses[tid] = final_st
        resolved[tid] = (final_st, "auto", "")

    return resolved


def build_quests_payload(
    data: dict[str, Any],
    saved_quests: dict[str, dict[str, Any]],
    history: list[dict[str, Any]],
) -> dict[str, Any]:
    tasks_dict = data["tasks"]
    resolved = resolve_quest_statuses(tasks_dict, saved_quests)

    enriched = []
    counts = {"completed": 0, "active": 0, "available": 0, "locked": 0, "failed": 0, "total": len(tasks_dict)}
    kappa_total = 0
    kappa_done = 0
    needed_fir: dict[str, dict[str, Any]] = {}
    needed_keys: dict[str, dict[str, Any]] = {}

    for tid, tk in tasks_dict.items():
        effective, source, updated_at = resolved[tid]
        if effective in counts:
            counts[effective] += 1

        if tk.get("kappaRequired"):
            kappa_total += 1
            if effective == "completed":
                kappa_done += 1

        if effective in ("active", "available"):
            for ob in tk.get("objectives") or []:
                if ob.get("foundInRaid") and ob.get("itemId"):
                    iid = ob["itemId"]
                    if iid not in needed_fir:
                        needed_fir[iid] = {
                            "id": iid,
                            "name": ob.get("itemName") or iid,
                            "count": 0,
                            "tasks": [],
                        }
                    needed_fir[iid]["count"] += int(ob.get("count") or 1)
                    if tk["name"] not in needed_fir[iid]["tasks"]:
                        needed_fir[iid]["tasks"].append(tk["name"])

            for nk in tk.get("neededKeys") or []:
                kid = nk["id"]
                if kid not in needed_keys:
                    needed_keys[kid] = {**nk, "tasks": []}
                if tk["name"] not in needed_keys[kid]["tasks"]:
                    needed_keys[kid]["tasks"].append(tk["name"])

        enriched.append(
            {
                "id": tid,
                "name": tk["name"],
                "traderName": tk["traderName"],
                "mapId": tk["mapId"],
                "mapName": tk["mapName"],
                "minPlayerLevel": tk["minPlayerLevel"],
                "experience": tk["experience"],
                "kappaRequired": tk["kappaRequired"],
                "lightkeeperRequired": tk["lightkeeperRequired"],
                "wikiLink": tk["wikiLink"],
                "prereqs": tk.get("prereqs") or [],
                "unlocks": tk.get("unlocks") or [],
                "chainDepth": int(tk.get("chainDepth") or 0),
                "neededKeys": tk["neededKeys"],
                "objectives": tk["objectives"],
                "status": effective,
                "source": source,
                "updatedAt": updated_at,
            }
        )

    order_weight = {"active": 0, "available": 1, "failed": 2, "locked": 3, "completed": 4}
    enriched.sort(key=lambda x: (order_weight.get(x["status"], 9), x["chainDepth"], x["minPlayerLevel"], x["name"]))

    daily_completed: dict[str, int] = defaultdict(int)
    daily_xp: dict[str, int] = defaultdict(int)
    for ev in history:
        if ev["event_type"] == "completed":
            day = str(ev["occurred_at"])[:10]
            daily_completed[day] += 1
            daily_xp[day] += int(ev.get("xp") or 0)

    velocity = [
        {"date": d, "completed": daily_completed[d], "xp": daily_xp[d]}
        for d in sorted(daily_completed.keys())[-21:]
    ]

    return {
        "counts": counts,
        "kappa": {"done": kappa_done, "total": kappa_total},
        "velocity": velocity,
        "history": history[:60],
        "neededFir": sorted(needed_fir.values(), key=lambda x: x["name"]),
        "neededKeys": sorted(needed_keys.values(), key=lambda x: -int(x.get("price") or 0)),
        "tasks": enriched,
    }


def build_map_payload(
    data: dict[str, Any],
    saved_quests: dict[str, dict[str, Any]],
    norm: str,
    svg_text: str | None,
    last_pin: Any,
    lang: str = "ru",
) -> dict[str, Any] | None:
    is_en = lang == "en"
    mid = data["maps_by_norm"].get(norm)
    if not mid:
        return None
    mp = data["maps"][mid]
    resolved = resolve_quest_statuses(data["tasks"], saved_quests)

    quest_markers = []
    active_map_tasks = []

    for tid, tk in data["tasks"].items():
        status, _, _ = resolved[tid]
        task_points = []
        task_on_map = tk.get("mapId") == mid

        for ob in tk.get("objectives") or []:
            ob_maps = ob.get("maps") or []
            zones_here = [z for z in (ob.get("zones") or []) if z["mapId"] == mid]
            on_this_map = (mid in ob_maps) or bool(zones_here)
            if not on_this_map and not task_on_map:
                continue

            needed_items = []
            if ob.get("markerItemName"):
                needed_items.append({"name": ob["markerItemName"], "count": int(ob.get("count") or 1), "kind": "Marker / Tool" if is_en else "Маркер / инструмент"})
            if ob.get("itemName"):
                needed_items.append({"name": ob["itemName"], "count": int(ob.get("count") or 1), "kind": "Quest Item" if is_en else "Предмет задания"})
            for rk in ob.get("requiredKeys") or []:
                needed_items.append({"name": rk["name"], "count": 1, "kind": "Key" if is_en else "Ключ"})

            for z in zones_here:
                quest_markers.append(
                    {
                        "taskId": tid,
                        "taskName": tk["name"],
                        "traderName": tk["traderName"],
                        "status": status,
                        "kappaRequired": tk["kappaRequired"],
                        "lightkeeperRequired": tk["lightkeeperRequired"],
                        "wikiLink": tk.get("wikiLink", ""),
                        "description": ob["description"],
                        "neededItems": needed_items,
                        "uv": z["uv"],
                    }
                )
                task_points.append({"description": ob["description"], "uv": z["uv"], "neededItems": needed_items})

            if not zones_here and on_this_map:
                task_points.append({"description": ob["description"], "uv": None, "neededItems": needed_items})

        if task_on_map or task_points:
            active_map_tasks.append(
                {
                    "taskId": tid,
                    "taskName": tk["name"],
                    "traderName": tk["traderName"],
                    "status": status,
                    "kappaRequired": tk["kappaRequired"],
                    "lightkeeperRequired": tk["lightkeeperRequired"],
                    "wikiLink": tk.get("wikiLink", ""),
                    "neededKeys": tk["neededKeys"],
                    "points": task_points,
                }
            )

    order_weight = {"active": 0, "available": 1, "locked": 2, "completed": 3, "failed": 4}
    active_map_tasks.sort(key=lambda t: (order_weight.get(t["status"], 9), t["taskName"]))
    return {
        "map": mp,
        "svg": svg_text,
        "questMarkers": quest_markers,
        "activeMapTasks": active_map_tasks,
        "lastPin": last_pin,
    }
