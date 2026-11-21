"""Cultist Circle optimizer for 1-5 item sacrifices."""

from __future__ import annotations

from typing import Any


THRESHOLDS = {
    "quest_hideout": {
        "target_base_value": 400_000,
        "label": "400 000+ ₽ (Шанс ~25% на 6ч — квесты/Убежище, иначе 14ч)",
    },
    "high_tier": {
        "target_base_value": 350_001,
        "label": "350 001+ ₽ (14ч — пул редкого лута)",
    },
}

# Well-known deterministic one-time/fixed recipes for reference
FIXED_RECIPES = [
    {"input": "1x Figurka Cultist (Любая)", "output": "Различные редкие награды (см. актуальные патчи)", "note": "Уникальные рецепты не используют порог Base Value"},
    {"input": "5x MP5 (или комбинация на >=400k Base)", "output": "Надёжный способ закрыть порог 400k+", "note": "Популярный вариант при покупке у Миротворца"},
]


def _pick_item_price(item: dict[str, Any], allow_traders: bool) -> tuple[int, str]:
    flea = int(item.get("fleaPrice") or 0)
    trader = int(item.get("bestBuyRub") or 0) if allow_traders else 0

    candidates: list[tuple[int, str]] = []
    if flea > 0:
        candidates.append((flea, "Барахолка"))
    if trader > 0:
        candidates.append((trader, item.get("bestBuySource") or "Торговец"))
    if not candidates:
        return (0, "")
    return min(candidates, key=lambda x: x[0])


def solve_cultist_circle(
    items_list: list[dict[str, Any]],
    target_base_value: int = 400_000,
    max_slots: int = 5,
    allow_traders: bool = True,
    exclude_types: tuple[str, ...] = ("keys", "keycard", "ammo", "ammoBox", "preset"),
    top_n: int = 6,
) -> list[dict[str, Any]]:
    """Find cheapest 1..max_slots combinations reaching target_base_value."""
    max_slots = max(1, min(5, int(max_slots)))
    target = int(target_base_value)

    candidates: list[dict[str, Any]] = []
    for it in items_list:
        base = int(it.get("basePrice") or 0)
        if base < 15_000:
            continue
        if any(t in (it.get("types") or []) for t in exclude_types):
            continue
        # Skip single items smaller than target / max_slots unless super cheap ratio
        if base * max_slots < target:
            continue
        cost, source = _pick_item_price(it, allow_traders=allow_traders)
        if cost <= 0:
            continue
        # Filter suspicious outlier prices where fleaPrice is unrealistically tiny (< 5% of basePrice and no trader)
        if source == "Барахолка" and it.get("avg24hPrice") and cost < it["avg24hPrice"] * 0.35:
            cost = int(it["avg24hPrice"])

        ratio = base / cost
        if ratio < 0.7:
            continue

        candidates.append(
            {
                "id": it["id"],
                "name": it["name"],
                "shortName": it["shortName"],
                "basePrice": base,
                "cost": cost,
                "source": source,
                "ratio": round(ratio, 3),
                "maxQty": max(1, min(max_slots, int(it.get("maxQty") or max_slots))),
                "iconLink": it.get("iconLink", ""),
            }
        )

    # Keep a strong, diverse shortlist: top by ratio + top single-slot items + top mid-base items
    by_ratio = sorted(candidates, key=lambda x: (-x["ratio"], x["cost"]))[:36]
    by_single = sorted([c for c in candidates if c["basePrice"] >= target], key=lambda x: x["cost"])[:10]
    by_half = sorted([c for c in candidates if c["basePrice"] >= target // 2], key=lambda x: x["cost"])[:15]
    by_fifth = sorted([c for c in candidates if c["basePrice"] >= target // max_slots], key=lambda x: (-x["ratio"], x["cost"]))[:25]

    pool_map: dict[str, dict[str, Any]] = {}
    for c in by_ratio + by_single + by_half + by_fifth:
        pool_map[c["id"]] = c
    pool = sorted(pool_map.values(), key=lambda x: (-x["ratio"], x["cost"]))

    if not pool:
        return []

    n = len(pool)
    suffix_max_base = [0] * (n + 1)
    for i in range(n - 1, -1, -1):
        suffix_max_base[i] = max(pool[i]["basePrice"], suffix_max_base[i + 1])

    results: list[tuple[int, int, list[int]]] = []  # (total_cost, -total_base, indices)
    seen_multisets: set[tuple[int, ...]] = set()
    best_cutoff = 10**12

    def dfs(start_idx: int, same_used: int, slots_used: int, cur_cost: int, cur_base: int, chosen: list[int]) -> None:
        nonlocal best_cutoff
        if cur_base >= target:
            key = tuple(chosen)
            if key not in seen_multisets:
                seen_multisets.add(key)
                results.append((cur_cost, -cur_base, list(chosen)))
                if len(results) > 40:
                    results.sort(key=lambda r: (r[0], r[1]))
                    del results[25:]
                    best_cutoff = results[-1][0]
            return

        rem_slots = max_slots - slots_used
        if rem_slots == 0 or start_idx >= n:
            return
        if cur_base + rem_slots * suffix_max_base[start_idx] < target:
            return
        if cur_cost >= best_cutoff:
            return

        for i in range(start_idx, n):
            cand = pool[i]
            used_for_i = same_used if i == start_idx else 0
            if used_for_i >= cand["maxQty"]:
                continue
            new_cost = cur_cost + cand["cost"]
            if new_cost >= best_cutoff:
                continue
            # Tighter upper bound using suffix_max_base from index i onwards
            if cur_base + cand["basePrice"] + (rem_slots - 1) * suffix_max_base[i] < target:
                continue
            chosen.append(i)
            dfs(i, used_for_i + 1, slots_used + 1, new_cost, cur_base + cand["basePrice"], chosen)
            chosen.pop()

    dfs(0, 0, 0, 0, 0, [])

    results.sort(key=lambda r: (r[0], r[1]))
    # Deduplicate by item composition and format nicely
    formatted: list[dict[str, Any]] = []
    for total_cost, neg_base, idxs in results[:top_n]:
        total_base = -neg_base
        grouped: dict[str, dict[str, Any]] = {}
        for idx in idxs:
            c = pool[idx]
            if c["id"] not in grouped:
                grouped[c["id"]] = {**c, "qty": 0}
            grouped[c["id"]]["qty"] += 1

        formatted.append(
            {
                "totalCost": total_cost,
                "totalBaseValue": total_base,
                "slotsUsed": len(idxs),
                "efficiency": round(total_base / total_cost, 2) if total_cost else 0,
                "items": list(grouped.values()),
            }
        )

    return formatted


def evaluate_basket(
    items_by_id: dict[str, dict[str, Any]],
    entries: list[dict[str, Any]],
    allow_traders: bool = True,
) -> dict[str, Any]:
    """Evaluate a custom 1-5 item Cultist Circle basket."""
    total_base = 0
    total_cost = 0
    total_slots = 0
    detailed = []

    for ent in entries:
        iid = ent.get("id", "")
        qty = max(1, int(ent.get("qty", 1)))
        it = items_by_id.get(iid)
        if not it:
            continue
        cost, source = _pick_item_price(it, allow_traders=allow_traders)
        base = int(it.get("basePrice") or 0)
        total_base += base * qty
        total_cost += cost * qty
        total_slots += qty
        detailed.append(
            {
                "id": iid,
                "name": it["name"],
                "qty": qty,
                "unitBase": base,
                "unitCost": cost,
                "source": source or "Не продаётся",
            }
        )

    if total_base >= 400_000:
        tier = "6ч (25% квесты/Убежище) или 14ч редкий лут"
    elif total_base >= 350_001:
        tier = "14ч редкий лут"
    else:
        tier = "Ниже порога 350 001 ₽ (обычный пул)"

    return {
        "totalBaseValue": total_base,
        "totalCost": total_cost,
        "slotsUsed": total_slots,
        "validSlots": 1 <= total_slots <= 5,
        "tier": tier,
        "items": detailed,
    }
