// @ts-nocheck
import { escHtml, fmtNum as fmtNumBase, fmtRub as fmtRubBase, GUIDE_BOOK_SVG } from "../utils/format";

export interface EngineDeps {
  state: any;
  renderCache: any;
  api: (url: string, opts?: RequestInit) => Promise<any>;
  t: (key: string, vars?: Record<string, any> | null) => string;
  openQuestGuide: (taskId: string) => void;
  showToast: (msg: string) => void;
  invalidateDataCache: (clearMaps?: boolean) => void;
  ensureQuestsData: (force?: boolean) => Promise<any>;
}

export function createQuestTreeEngine(deps: EngineDeps) {
  const { state, renderCache, api, t, openQuestGuide, showToast, invalidateDataCache, ensureQuestsData } = deps;
  const esc = escHtml;
  const fmtNum = (n: unknown) => fmtNumBase(n, state.lang);
  const fmtRub = (n: unknown) => fmtRubBase(n, state.lang);
  const GUIDE_BOOK_ICO = GUIDE_BOOK_SVG;
// --- TAB 1B: SWIMLANE METRO QUEST TREE ---
const getTreeStatusLabel = (st) => {
  const map = {
    completed: t("status_completed"),
    active: t("status_active"),
    available: t("status_available"),
    locked: t("status_locked"),
    failed: t("status_failed"),
  };
  return map[st] || st || "—";
};

const getTreeStatusShort = (st) => {
  if (st === "completed") return "✓";
  const en = { active: "ACTIVE", available: "AVAIL", locked: "LOCKED", failed: "FAILED" };
  const ru = { active: "АКТИВЕН", available: "ДОСТУПЕН", locked: "ЗАКРЫТ", failed: "ПРОВАЛ" };
  return (state.lang === "en" ? en : ru)[st] || st;
};

const TRADER_ORDER = [
  "Прапор", "Prapor",
  "Терапевт", "Therapist",
  "Лыжник", "Skier",
  "Миротворец", "Peacekeeper",
  "Механик", "Mechanic",
  "Барахольщик", "Ragman",
  "Егерь", "Jaeger",
  "Скупщик", "Fence",
  "Реф", "Ref",
  "Водитель БТР", "BTR Driver",
  "Смотритель", "Lightkeeper",
  "Марафон", "Marathon",
  "Особые / Ивенты", "Special / Events",
  "Разное", "Other",
];

const TRADER_COLORS = {
  "Прапор": "#fb923c", "Prapor": "#fb923c",
  "Терапевт": "#2dd4bf", "Therapist": "#2dd4bf",
  "Лыжник": "#60a5fa", "Skier": "#60a5fa",
  "Миротворец": "#38bdf8", "Peacekeeper": "#38bdf8",
  "Механик": "#e5a93c", "Mechanic": "#e5a93c",
  "Барахольщик": "#a78bfa", "Ragman": "#a78bfa",
  "Егерь": "#84cc16", "Jaeger": "#84cc16",
  "Скупщик": "#94a3b8", "Fence": "#94a3b8",
  "Реф": "#f472b6", "Ref": "#f472b6",
  "Водитель БТР": "#818cf8", "BTR Driver": "#818cf8",
  "Смотритель": "#fb7185", "Lightkeeper": "#fb7185",
  "Марафон": "#34d399", "Marathon": "#34d399",
  "Особые / Ивенты": "#64748b", "Special / Events": "#64748b",
  "Разное": "#64748b", "Other": "#64748b",
};

const TREE_LINE_PALETTE = [
  "#e5a93c",
  "#38bdf8",
  "#4ade80",
  "#f472b6",
  "#a78bfa",
  "#fb7185",
  "#2dd4bf",
  "#a3e635",
  "#fb923c",
  "#60a5fa",
];

function normalizeGroupTrader(traderName) {
  if (!traderName) return state.lang === "en" ? "Other" : "Разное";
  if (TRADER_COLORS[traderName]) return traderName;
  const cleaned = traderName.split("]]")[0].split(" или ")[0].split(" or ")[0].trim();
  return TRADER_COLORS[cleaned] ? cleaned : traderName;
}

let themePalette = null;

function readTreeThemePalette() {
  const docEl = document.documentElement;
  const cs = getComputedStyle(docEl);
  const g = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  themePalette = {
    border: g("--border", "rgba(255,255,255,0.08)"),
    borderStrong: g("--border-strong", "rgba(255,255,255,0.18)"),
    bg: g("--bg", "#0c0d0f"),
    surface: g("--surface", "#121417"),
    surface2: g("--surface-2", "#181b20"),
    text: g("--text", "#e6e7eb"),
    muted: g("--text-muted", "#9398a3"),
    subtle: g("--text-subtle", "#666c77"),
    accent: g("--accent", "#d99b26"),
    accentBright: g("--accent-bright", "#eab349"),
    accentBorder: g("--accent-border", "rgba(217,155,38,0.4)"),
    accentDim: g("--accent-dim", "rgba(217,155,38,0.14)"),
    accentGlow: g("--accent-glow", "rgba(217,155,38,0.22)"),
    blue: g("--blue", "#38bdf8"),
    blueDim: g("--blue-dim", "rgba(56,189,248,0.14)"),
    green: g("--green", "#22c55e"),
    greenDim: g("--green-dim", "rgba(34,197,94,0.14)"),
    redDim: g("--red-dim", "rgba(239,68,68,0.14)"),
    isNeon: docEl.dataset.glowMode === "neon",
  };
  return themePalette;
}

const treeCam = {
  zoom: 0.84,
  panX: 20,
  panY: 16,
  targetZoom: 0.84,
  targetPanX: 20,
  targetPanY: 16,
  velX: 0,
  velY: 0,
  isDragging: false,
  lastFrameTs: 0,
  hoveredId: null,
  vpW: 0,
  vpH: 0,
  stageW: 1200,
  stageH: 700,
  positions: new Map(), // id -> { x, y, w, h }
  hasAutoFitted: false,
  rafId: null,
  lastZoomText: "",
};

const treeLayout = {
  cards: [],
  cardById: new Map(),
  edges: [],
  lanes: [],
  stageW: 1200,
  stageH: 700,
  selectedId: null,
  fullChain: new Set(),
  directPrereqs: new Set(),
  directUnlocks: new Set(),
  searchQuery: "",
};

let measureCtx = null;
function getMeasureCtx() {
  if (!measureCtx) {
    const c = document.createElement("canvas");
    measureCtx = c.getContext("2d");
  }
  return measureCtx;
}

function wrapTitleLines(ctx, text, maxW) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width <= maxW || !line) {
      line = test;
    } else {
      lines.push(line);
      line = w;
      if (lines.length === 2) {
        // Truncate second line if more words remain
        let t = line;
        while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
          t = t.slice(0, -1);
        }
        lines[1] = `${t}…`;
        return lines;
      }
    }
  }
  if (line) {
    if (lines.length === 1 && ctx.measureText(line).width > maxW) {
      let t = line;
      while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
        t = t.slice(0, -1);
      }
      line = `${t}…`;
    }
    lines.push(line);
  }
  return lines.slice(0, 2);
}

function truncateTextToWidth(ctx, text, maxW) {
  const s = String(text || "");
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rad);
    return;
  }
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawCanvasArrowHead(ctx, x, y, angle, size = 5.5) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - size * Math.cos(angle - 0.45), y - size * Math.sin(angle - 0.45));
  ctx.lineTo(x - size * Math.cos(angle + 0.45), y - size * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
}

function drawEdgeBatch(ctx, edges, wLeft, wRight, wTop, wBottom, selId, fullChain, z, pal, dimmedPass) {
  let currentDash = false;
  ctx.setLineDash([]);
  const showArrowsBase = z >= 0.30;

  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (e.maxX < wLeft || e.minX > wRight || e.maxY < wTop || e.minY > wBottom) continue;

    let stroke = e.baseStroke;
    let width = e.isCross ? 1.3 : 1.8;
    let alpha = e.isCross ? 0.22 : 0.78;
    let dashed = e.isCross;
    let arrow = showArrowsBase;

    if (selId) {
      const directHit = e.from === selId || e.to === selId;
      const chainHit = fullChain.has(e.from) && fullChain.has(e.to);
      const isDimmed = !directHit && !chainHit;
      if (dimmedPass && !isDimmed) continue;
      if (!dimmedPass && isDimmed) continue;

      if (directHit) {
        stroke = e.from === selId ? "#4ade80" : "#38bdf8";
        width = 2.6;
        alpha = 1;
        dashed = false;
        arrow = true;
      } else if (chainHit) {
        stroke = e.isCross ? pal.accentBright : e.baseStroke;
        width = 2.1;
        alpha = 0.96;
        dashed = false;
        arrow = true;
      } else {
        width = 1.1;
        alpha = 0.09;
        dashed = false;
        arrow = false;
      }
    }

    if (dashed !== currentDash) {
      currentDash = dashed;
      ctx.setLineDash(dashed ? [4, 4] : []);
    }

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(e.x1, e.y1);
    ctx.bezierCurveTo(e.cx1, e.cy1, e.cx2, e.cy2, e.x2, e.y2);
    ctx.stroke();

    if (arrow) {
      if (currentDash) {
        currentDash = false;
        ctx.setLineDash([]);
      }
      ctx.fillStyle = stroke;
      drawCanvasArrowHead(ctx, e.x2, e.y2, e.arrowAngle, 5.5);
    }
  }
  if (currentDash) ctx.setLineDash([]);
}

function drawTreeFrame() {
  const vp = document.getElementById("questTreeViewport");
  const stage = document.getElementById("questTreeStage");
  const canvas = document.getElementById("questTreeCanvas");
  const lbl = document.getElementById("treeZoomLabel");
  if (!vp || !canvas) return;

  if (stage) {
    const wantStage = treeLayout.cards.length === 0 ? "block" : "none";
    if (stage.style.display !== wantStage) stage.style.display = wantStage;
  }

  let vw = treeCam.vpW;
  let vh = treeCam.vpH;
  if (vw <= 0 || vh <= 0) {
    vw = vp.clientWidth;
    vh = vp.clientHeight;
    treeCam.vpW = vw;
    treeCam.vpH = vh;
  }

  const z = treeCam.zoom;
  const zoomStr = `${Math.round(z * 100)}%`;
  if (lbl && treeCam.lastZoomText !== zoomStr) {
    treeCam.lastZoomText = zoomStr;
    lbl.textContent = zoomStr;
  }

  if (vw <= 0 || vh <= 0) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(vw * dpr);
  const ch = Math.round(vh * dpr);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }

  const panX = treeCam.panX;
  const panY = treeCam.panY;
  const pal = themePalette || readTreeThemePalette();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * panX, dpr * panY);

  const invZ = 1 / Math.max(0.05, z);
  const wLeft = -panX * invZ;
  const wTop = -panY * invZ;
  const wRight = (vw - panX) * invZ;
  const wBottom = (vh - panY) * invZ;

  // 1. Draw visible swimlane bands & headers (zero measureText per frame)
  for (let i = 0; i < treeLayout.lanes.length; i++) {
    const lane = treeLayout.lanes[i];
    if (lane.startY + lane.laneHeight < wTop || lane.startY > wBottom) continue;

    ctx.globalAlpha = 1;
    ctx.fillStyle = lane.bandRgba;
    ctx.fillRect(0, lane.startY, Math.min(440, treeLayout.stageW), lane.laneHeight);
    ctx.strokeStyle = pal.border;
    ctx.lineWidth = Math.max(1, 1 * invZ);
    ctx.beginPath();
    ctx.moveTo(0, lane.startY);
    ctx.lineTo(treeLayout.stageW, lane.startY);
    ctx.stroke();

    if (z >= 0.24) {
      const hx = 14;
      const hy = lane.startY + 10;
      ctx.fillStyle = pal.bg;
      ctx.fillRect(hx, hy, lane.headerWidth, 24);
      ctx.strokeStyle = pal.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(hx, hy, lane.headerWidth, 24);
      ctx.fillStyle = lane.traderColor;
      ctx.fillRect(hx, hy, 3, 24);
      ctx.fillStyle = pal.text;
      ctx.font = `600 12px "IBM Plex Sans", sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(lane.grpName, hx + 10, hy + 12);
      ctx.font = `500 10.5px "JetBrains Mono", monospace`;
      ctx.fillStyle = pal.muted;
      ctx.fillText(lane.countText, hx + 16 + lane.nameWidth, hy + 12);
    }

    if (lane.soloHeaderY !== null && z >= 0.35) {
      ctx.font = `600 10px "JetBrains Mono", monospace`;
      ctx.fillStyle = pal.subtle;
      ctx.textBaseline = "top";
      ctx.fillText(lane.soloHeaderText, 20, lane.soloHeaderY);
    }
  }

  // 2. Draw frustum-culled Bezier edges (2-pass when selected so chain sits cleanly on top)
  const selId = treeLayout.selectedId;
  const fullChain = treeLayout.fullChain;
  if (selId) {
    drawEdgeBatch(ctx, treeLayout.edges, wLeft, wRight, wTop, wBottom, selId, fullChain, z, pal, true);
    drawEdgeBatch(ctx, treeLayout.edges, wLeft, wRight, wTop, wBottom, selId, fullChain, z, pal, false);
  } else {
    drawEdgeBatch(ctx, treeLayout.edges, wLeft, wRight, wTop, wBottom, null, fullChain, z, pal, false);
  }

  // 3. Draw frustum-culled cards on Canvas 2D with smooth LOD
  const hoveredId = treeCam.hoveredId;
  const searchQ = treeLayout.searchQuery;
  const hasSearch = searchQ.length >= 2;
  const directPrereqs = treeLayout.directPrereqs;
  const directUnlocks = treeLayout.directUnlocks;
  const px1 = Math.max(1, invZ);
  const showCompactTitle = z >= 0.26 && z < 0.48;
  const showFullCard = z >= 0.48;
  const showMetaRow = z >= 0.56;

  for (let i = 0; i < treeLayout.cards.length; i++) {
    const c = treeLayout.cards[i];
    if (c.x + c.w < wLeft || c.x > wRight || c.y + c.h < wTop || c.y > wBottom) continue;

    const isSel = selId === c.id;
    const isHovered = hoveredId === c.id;
    const isPrereq = Boolean(selId && directPrereqs.has(c.id));
    const isUnlock = Boolean(selId && directUnlocks.has(c.id));
    const inChain = Boolean(selId && fullChain.has(c.id));
    const isDimmed = Boolean(selId && !inChain);
    const isSearchHit = Boolean(hasSearch && c.nameLower.includes(searchQ));

    let alpha = 1;
    if (isDimmed && !isHovered && !isSearchHit) alpha = 0.24;
    else if (isSel || isPrereq || isUnlock || isHovered || isSearchHit) alpha = 1;
    else if (inChain) alpha = 0.96;
    else if (c.stKey === "completed") alpha = 0.78;
    else if (c.stKey === "locked") alpha = 0.85;

    ctx.globalAlpha = alpha;

    // Background fill
    const useSurface2 = isSel || isHovered || c.stKey === "active" || c.stKey === "available";
    ctx.fillStyle = useSurface2 ? pal.surface2 : pal.surface;
    roundRectPath(ctx, c.x, c.y, c.w, c.h, 4);
    ctx.fill();

    // Base border
    let borderStroke = pal.border;
    let borderW = px1;
    if (isHovered || inChain) borderStroke = pal.borderStrong;
    else if (c.stKey === "active") borderStroke = "rgba(56, 189, 248, 0.36)";
    else if (c.stKey === "available") borderStroke = pal.accentBorder;
    else if (c.stKey === "failed") borderStroke = "rgba(239, 68, 68, 0.45)";
    ctx.strokeStyle = borderStroke;
    ctx.lineWidth = borderW;
    ctx.stroke();

    // Left trader/branch accent stripe (3px)
    ctx.fillStyle = c.color;
    ctx.fillRect(c.x, c.y + 1, 3, c.h - 2);

    // Highlight outlines
    if (isSel) {
      ctx.strokeStyle = pal.accentGlow;
      ctx.lineWidth = Math.max(4, 4 * invZ);
      roundRectPath(ctx, c.x - 1, c.y - 1, c.w + 2, c.h + 2, 5);
      ctx.stroke();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = Math.max(2, 2 * invZ);
      roundRectPath(ctx, c.x, c.y, c.w, c.h, 4);
      ctx.stroke();
    } else if (isPrereq) {
      ctx.strokeStyle = pal.blue;
      ctx.lineWidth = Math.max(1.5, 1.5 * invZ);
      roundRectPath(ctx, c.x, c.y, c.w, c.h, 4);
      ctx.stroke();
    } else if (isUnlock) {
      ctx.strokeStyle = pal.green;
      ctx.lineWidth = Math.max(1.5, 1.5 * invZ);
      roundRectPath(ctx, c.x, c.y, c.w, c.h, 4);
      ctx.stroke();
    } else if (isSearchHit) {
      ctx.strokeStyle = pal.blue;
      ctx.lineWidth = Math.max(2, 2 * invZ);
      roundRectPath(ctx, c.x, c.y, c.w, c.h, 4);
      ctx.stroke();
    }

    if (showCompactTitle) {
      ctx.fillStyle = pal.text;
      ctx.font = `600 12px "IBM Plex Sans", sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(c.shortTitle, c.x + 11, c.y + c.h * 0.5);
    } else if (showFullCard) {
      const innerX = c.x + 11;
      const rightEdge = c.x + c.w - 9;

      // Top row: dot + trader name (left)
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(innerX + 3, c.y + 13, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = pal.muted;
      ctx.font = `500 10.5px "IBM Plex Sans", sans-serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(c.traderShort, innerX + 10, c.y + 13);

      // Top row right: status pill + optional badge
      let pillRight = rightEdge;
      const stW = c.stPillW;
      const stX = pillRight - stW;
      const stY = c.y + 6;
      const stH = 14;
      let stBg = null;
      let stBorder = pal.border;
      let stFg = pal.subtle;
      if (c.stKey === "active") {
        stBg = pal.blueDim;
        stBorder = "rgba(56, 189, 248, 0.35)";
        stFg = pal.blue;
      } else if (c.stKey === "available") {
        stBg = pal.accentDim;
        stBorder = pal.accentBorder;
        stFg = pal.accentBright;
      } else if (c.stKey === "completed") {
        stBg = pal.greenDim;
        stBorder = "rgba(34, 197, 94, 0.25)";
        stFg = "#4ade80";
      } else if (c.stKey === "failed") {
        stBg = pal.redDim;
        stBorder = "rgba(239, 68, 68, 0.3)";
        stFg = "#f87171";
      }
      if (stBg) {
        ctx.fillStyle = stBg;
        ctx.fillRect(stX, stY, stW, stH);
      }
      ctx.strokeStyle = stBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(stX, stY, stW, stH);
      ctx.fillStyle = stFg;
      ctx.font = `600 9.5px "JetBrains Mono", monospace`;
      ctx.fillText(c.stLabel, stX + 4, stY + 7.5);
      pillRight = stX - 4;

      if (c.badgeText) {
        const bW = c.badgeW;
        const bX = pillRight - bW;
        ctx.fillStyle = c.badgeIsAmber ? pal.accentDim : pal.bg;
        ctx.fillRect(bX, stY, bW, stH);
        ctx.strokeStyle = c.badgeIsAmber ? pal.accentBorder : pal.border;
        ctx.strokeRect(bX, stY, bW, stH);
        ctx.fillStyle = c.badgeIsAmber ? pal.accentBright : pal.muted;
        ctx.font = `600 9px "JetBrains Mono", monospace`;
        ctx.fillText(c.badgeText, bX + 4, stY + 7.5);
      }

      // Title (1-2 pre-wrapped lines)
      ctx.fillStyle = pal.text;
      ctx.font = `600 12px "IBM Plex Sans", sans-serif`;
      ctx.textBaseline = "top";
      const titleTop = c.y + 23;
      for (let li = 0; li < c.titleLines.length; li++) {
        ctx.fillText(c.titleLines[li], innerX, titleTop + li * 15);
      }

      // Bottom meta row
      if (showMetaRow) {
        const metaY = c.y + c.h - 14;
        ctx.fillStyle = pal.subtle;
        ctx.font = `400 10.5px "IBM Plex Sans", sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(c.metaLeft, innerX, metaY);
        if (c.metaRight) {
          ctx.fillText(c.metaRight, rightEdge - c.metaRightW, metaY);
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

function stepTreeCamera(now) {
  treeCam.rafId = null;
  const prevTs = treeCam.lastFrameTs || now;
  treeCam.lastFrameTs = now;
  const dt = Math.min(0.05, Math.max(0.001, (now - prevTs) / 1000));

  if (!treeCam.isDragging) {
    const speed = Math.hypot(treeCam.velX, treeCam.velY);
    if (speed > 12) {
      treeCam.targetPanX += treeCam.velX * dt;
      treeCam.targetPanY += treeCam.velY * dt;
      treeCam.panX = treeCam.targetPanX;
      treeCam.panY = treeCam.targetPanY;
      const decay = Math.exp(-7.5 * dt);
      treeCam.velX *= decay;
      treeCam.velY *= decay;
    } else {
      treeCam.velX = 0;
      treeCam.velY = 0;
    }
  }

  const k = 1 - Math.exp(-16 * dt);
  treeCam.zoom += (treeCam.targetZoom - treeCam.zoom) * k;
  treeCam.panX += (treeCam.targetPanX - treeCam.panX) * k;
  treeCam.panY += (treeCam.targetPanY - treeCam.panY) * k;

  const stillZooming = Math.abs(treeCam.zoom - treeCam.targetZoom) > 0.0004;
  const stillPanning = Math.abs(treeCam.panX - treeCam.targetPanX) > 0.25 || Math.abs(treeCam.panY - treeCam.targetPanY) > 0.25;
  const stillGliding = !treeCam.isDragging && Math.hypot(treeCam.velX, treeCam.velY) > 12;
  const keepRunning = stillZooming || stillPanning || stillGliding;

  if (!keepRunning) {
    treeCam.zoom = treeCam.targetZoom;
    treeCam.panX = treeCam.targetPanX;
    treeCam.panY = treeCam.targetPanY;
    treeCam.velX = 0;
    treeCam.velY = 0;
    treeCam.lastFrameTs = 0;
    if (!treeCam.isDragging) {
      state.isGesturing = false;
      window.__eftGesturing = false;
    }
  }

  drawTreeFrame();

  if (keepRunning) {
    treeCam.rafId = requestAnimationFrame(stepTreeCamera);
  }
}

function scheduleTreeFrame(immediate = false) {
  if (immediate) {
    if (treeCam.rafId) {
      cancelAnimationFrame(treeCam.rafId);
      treeCam.rafId = null;
    }
    treeCam.zoom = treeCam.targetZoom;
    treeCam.panX = treeCam.targetPanX;
    treeCam.panY = treeCam.targetPanY;
    treeCam.velX = 0;
    treeCam.velY = 0;
    treeCam.lastFrameTs = 0;
    if (!treeCam.isDragging) {
      state.isGesturing = false;
      window.__eftGesturing = false;
    }
    drawTreeFrame();
    return;
  }
  if (!treeCam.rafId) {
    treeCam.lastFrameTs = performance.now();
    treeCam.rafId = requestAnimationFrame(stepTreeCamera);
  }
}

function applyTreeTransform(immediate = false) {
  scheduleTreeFrame(immediate);
}

function findCardAtWorld(wx, wy) {
  for (let i = treeLayout.cards.length - 1; i >= 0; i--) {
    const c = treeLayout.cards[i];
    if (wx >= c.x && wx <= c.x + c.w && wy >= c.y && wy <= c.y + c.h) {
      return c;
    }
  }
  return null;
}

function fitQuestTreeToView(boxes = null, minClamp = 0.16, animate = true) {
  const vp = document.getElementById("questTreeViewport");
  if (!vp) return;
  const vw = treeCam.vpW || vp.clientWidth || 1140;
  const vh = treeCam.vpH || vp.clientHeight || 660;
  const list = boxes || [...treeCam.positions.values()];
  if (!list.length) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  list.forEach((b) => {
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  });
  minY = Math.min(minY, 0);
  const pad = 28;
  const contentW = Math.max(300, maxX - minX + pad * 2);
  const contentH = Math.max(220, maxY - minY + pad * 2);
  const rawZ = Math.min(vw / contentW, vh / contentH);
  const z = Math.max(minClamp, Math.min(1.0, rawZ));
  treeCam.targetZoom = z;
  treeCam.targetPanX = Math.round(Math.max(16, (vw - (maxX - minX) * z) / 2) - minX * z);
  treeCam.targetPanY = Math.round(Math.max(16, (vh - (maxY - minY) * z) / 2) - minY * z);
  treeCam.velX = 0;
  treeCam.velY = 0;
  applyTreeTransform(!animate);
}

function frameTreeStart() {
  const vp = document.getElementById("questTreeViewport");
  const vw = treeCam.vpW || vp?.clientWidth || 1140;
  const vh = treeCam.vpH || vp?.clientHeight || 660;
  const list = [...treeCam.positions.values()];
  if (!list.length) return;

  let maxX = -Infinity, maxY = -Infinity;
  list.forEach((b) => {
    if (b.x + b.w > maxX) maxX = b.x + b.w;
    if (b.y + b.h > maxY) maxY = b.y + b.h;
  });
  const fitZ = Math.min(1.0, Math.min(vw / (maxX + 48), vh / (maxY + 48)));
  if (fitZ >= 0.56) {
    fitQuestTreeToView(list, 0.56, false);
    return;
  }
  treeCam.targetZoom = 0.8;
  treeCam.targetPanX = 16;
  treeCam.targetPanY = 14;
  treeCam.velX = 0;
  treeCam.velY = 0;
  applyTreeTransform(true);
}

function centerTreeOnTask(taskId, minZoom = 0.85, animate = true) {
  const vp = document.getElementById("questTreeViewport");
  const box = treeCam.positions.get(taskId);
  if (!vp || !box) return;
  const vw = treeCam.vpW || vp.clientWidth || 1140;
  const vh = treeCam.vpH || vp.clientHeight || 660;
  treeCam.targetZoom = Math.max(treeCam.targetZoom, minZoom);
  treeCam.targetPanX = Math.round(vw / 2 - (box.x + box.w / 2) * treeCam.targetZoom);
  treeCam.targetPanY = Math.round(vh / 2 - (box.y + box.h / 2) * treeCam.targetZoom);
  treeCam.velX = 0;
  treeCam.velY = 0;
  applyTreeTransform(!animate);
}

function getChainSets(taskId, byId) {
  const ancestors = new Set();
  const descendants = new Set();
  if (!taskId || !byId.has(taskId)) return { ancestors, descendants };

  const stackUp = [...(byId.get(taskId).prereqs || [])];
  while (stackUp.length) {
    const pid = stackUp.pop();
    if (ancestors.has(pid) || !byId.has(pid)) continue;
    ancestors.add(pid);
    (byId.get(pid).prereqs || []).forEach((pp) => stackUp.push(pp));
  }
  const stackDown = [...(byId.get(taskId).unlocks || [])];
  while (stackDown.length) {
    const uid = stackDown.pop();
    if (descendants.has(uid) || !byId.has(uid)) continue;
    descendants.add(uid);
    (byId.get(uid).unlocks || []).forEach((uu) => stackDown.push(uu));
  }
  return { ancestors, descendants };
}

["treeTraderFilter", "treeImportanceFilter", "treeStatusFilter", "treeChainOnly"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("change", () => {
    treeCam.hasAutoFitted = false;
    renderQuestTree();
  });
});

document.getElementById("treeColorMode")?.addEventListener("change", () => {
  renderQuestTree();
});

const treeSearchEl = document.getElementById("treeSearch");
if (treeSearchEl) {
  treeSearchEl.addEventListener("input", () => updateQuestTreeSelection());
  treeSearchEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = treeSearchEl.value.trim().toLowerCase();
    if (!q || !state.quests) return;
    const hit = (state.quests.tasks || []).find((t) => treeCam.positions.has(t.id) && t.name.toLowerCase().includes(q));
    if (hit) {
      state.selectedTreeTaskId = hit.id;
      updateQuestTreeSelection();
      centerTreeOnTask(hit.id);
    }
  });
}

document.getElementById("btnTreeZoomIn")?.addEventListener("click", () => {
  const vp = document.getElementById("questTreeViewport");
  const cx = (treeCam.vpW || vp?.clientWidth || 800) / 2;
  const cy = (treeCam.vpH || vp?.clientHeight || 500) / 2;
  zoomTreeAt(1.24, cx, cy);
});
document.getElementById("btnTreeZoomOut")?.addEventListener("click", () => {
  const vp = document.getElementById("questTreeViewport");
  const cx = (treeCam.vpW || vp?.clientWidth || 800) / 2;
  const cy = (treeCam.vpH || vp?.clientHeight || 500) / 2;
  zoomTreeAt(0.8, cx, cy);
});
document.getElementById("btnTreeFit")?.addEventListener("click", () => fitQuestTreeToView(null, 0.16, true));
document.getElementById("btnTreeFocusActive")?.addEventListener("click", () => {
  if (!state.quests) return;
  const candidate = (state.quests.tasks || []).find(
    (t) => treeCam.positions.has(t.id) && (t.status === "active" || t.status === "available")
  );
  if (!candidate) return showToast(t("tree_no_active"));
  state.selectedTreeTaskId = candidate.id;
  updateQuestTreeSelection();
  centerTreeOnTask(candidate.id);
});

function zoomTreeAt(factor, vx, vy) {
  const next = Math.max(0.16, Math.min(1.85, treeCam.targetZoom * factor));
  const ratio = next / treeCam.targetZoom;
  treeCam.targetPanX = vx - (vx - treeCam.targetPanX) * ratio;
  treeCam.targetPanY = vy - (vy - treeCam.targetPanY) * ratio;
  treeCam.targetZoom = next;
  treeCam.velX = 0;
  treeCam.velY = 0;
  scheduleTreeFrame();
}

(function bindTreeViewportInteractions() {
  const vp = document.getElementById("questTreeViewport");
  if (!vp) return;

  readTreeThemePalette();
  window.addEventListener("eft-theme-change", () => {
    readTreeThemePalette();
    scheduleTreeFrame();
  });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        const h = Math.round(entry.contentRect.height);
        if (w > 0 && h > 0 && (w !== treeCam.vpW || h !== treeCam.vpH)) {
          treeCam.vpW = w;
          treeCam.vpH = h;
          scheduleTreeFrame(true);
        }
      }
    });
    ro.observe(vp);
  }

  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    state.isGesturing = true;
    window.__eftGesturing = true;
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 28;
    else if (e.deltaMode === 2) delta *= 300;
    const normDelta = Math.max(-180, Math.min(180, delta));
    const factor = Math.exp(-normDelta * 0.0022);
    const r = vp.getBoundingClientRect();
    zoomTreeAt(factor, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  let drag = null;
  let moved = false;

  vp.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    treeCam.velX = 0;
    treeCam.velY = 0;
    treeCam.targetPanX = treeCam.panX;
    treeCam.targetPanY = treeCam.panY;
    treeCam.targetZoom = treeCam.zoom;
    treeCam.isDragging = true;
    const now = performance.now();
    drag = {
      x: e.clientX,
      y: e.clientY,
      px: treeCam.panX,
      py: treeCam.panY,
      lastX: e.clientX,
      lastY: e.clientY,
      lastTime: now,
      vx: 0,
      vy: 0,
    };
    moved = false;
    state.isGesturing = true;
    window.__eftGesturing = true;
    vp.classList.add("dragging");
    vp.setPointerCapture(e.pointerId);
  });

  vp.addEventListener("pointermove", (e) => {
    if (!drag) {
      const r = vp.getBoundingClientRect();
      const wx = (e.clientX - r.left - treeCam.panX) / treeCam.zoom;
      const wy = (e.clientY - r.top - treeCam.panY) / treeCam.zoom;
      const hit = findCardAtWorld(wx, wy);
      const nextHover = hit ? hit.id : null;
      if (nextHover !== treeCam.hoveredId) {
        treeCam.hoveredId = nextHover;
        vp.classList.toggle("hovering-node", Boolean(nextHover));
        scheduleTreeFrame();
      }
      return;
    }

    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (moved) {
      const now = performance.now();
      const dt = Math.max(0.004, (now - drag.lastTime) / 1000);
      const instVx = (e.clientX - drag.lastX) / dt;
      const instVy = (e.clientY - drag.lastY) / dt;
      drag.vx = Math.max(-2800, Math.min(2800, drag.vx * 0.65 + instVx * 0.35));
      drag.vy = Math.max(-2800, Math.min(2800, drag.vy * 0.65 + instVy * 0.35));
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.lastTime = now;

      treeCam.panX = drag.px + dx;
      treeCam.panY = drag.py + dy;
      treeCam.targetPanX = treeCam.panX;
      treeCam.targetPanY = treeCam.panY;
      scheduleTreeFrame();
    }
  });

  vp.addEventListener("pointerleave", () => {
    if (!drag && treeCam.hoveredId !== null) {
      treeCam.hoveredId = null;
      vp.classList.remove("hovering-node");
      scheduleTreeFrame();
    }
  });

  const endDrag = (e) => {
    if (!drag) return;
    treeCam.isDragging = false;
    vp.classList.remove("dragging");
    try { vp.releasePointerCapture(e.pointerId); } catch (_) {}

    if (!moved) {
      const r = vp.getBoundingClientRect();
      const wx = (e.clientX - r.left - treeCam.panX) / treeCam.zoom;
      const wy = (e.clientY - r.top - treeCam.panY) / treeCam.zoom;
      const id = findCardAtWorld(wx, wy)?.id || null;
      if (id) {
        const chainOnly = document.getElementById("treeChainOnly")?.checked;
        state.selectedTreeTaskId = state.selectedTreeTaskId === id ? null : id;
        if (chainOnly) {
          treeCam.hasAutoFitted = false;
          renderQuestTree();
        } else {
          updateQuestTreeSelection();
        }
      }
      state.isGesturing = false;
      window.__eftGesturing = false;
    } else if (performance.now() - drag.lastTime < 80 && Math.hypot(drag.vx, drag.vy) > 40) {
      treeCam.velX = drag.vx;
      treeCam.velY = drag.vy;
      scheduleTreeFrame();
    } else {
      state.isGesturing = false;
      window.__eftGesturing = false;
    }
    drag = null;
  };
  vp.addEventListener("pointerup", endDrag);
  vp.addEventListener("pointercancel", endDrag);

  vp.addEventListener("dblclick", (e) => {
    const r = vp.getBoundingClientRect();
    const wx = (e.clientX - r.left - treeCam.panX) / treeCam.zoom;
    const wy = (e.clientY - r.top - treeCam.panY) / treeCam.zoom;
    const hit = findCardAtWorld(wx, wy);
    if (hit) {
      state.selectedTreeTaskId = hit.id;
      updateQuestTreeSelection();
      centerTreeOnTask(hit.id, 1.0, true);
      return;
    }
    fitQuestTreeToView(null, 0.16, true);
  });
})();

function renderTreeLegend(allTasks) {
  const bar = document.getElementById("treeLegendBar");
  if (!bar) return;
  const activeTrader = document.getElementById("treeTraderFilter")?.value || "all";
  const byTrader = new Map();
  allTasks.forEach((t) => {
    const tr = normalizeGroupTrader(t.traderName);
    if (!byTrader.has(tr)) byTrader.set(tr, { total: 0, done: 0 });
    const entry = byTrader.get(tr);
    entry.total += 1;
    if (t.status === "completed") entry.done += 1;
  });

  const sortedTraders = [...byTrader.keys()].sort((a, b) => {
    const ia = TRADER_ORDER.indexOf(a);
    const ib = TRADER_ORDER.indexOf(b);
    const wa = ia === -1 ? 99 : ia;
    const wb = ib === -1 ? 99 : ib;
    return wa !== wb ? wa - wb : a.localeCompare(b, "ru");
  });

  bar.innerHTML = [
    `<button type="button" class="tree-legend-chip ${activeTrader === "all" ? "active" : ""}" data-legend-trader="all">
      <span>${esc(state.lang === "en" ? "All Branches" : "Все линии")}</span>
      <span class="cnt">${allTasks.length}</span>
    </button>`,
    ...sortedTraders.map((tr) => {
      const stats = byTrader.get(tr);
      const col = TRADER_COLORS[tr] || "#94a3b8";
      return `
        <button type="button" class="tree-legend-chip ${activeTrader === tr ? "active" : ""}" data-legend-trader="${esc(tr)}" title="${esc(tr)}">
          <span class="swatch" style="background:${col};"></span>
          <span>${esc(tr)}</span>
          <span class="cnt">${stats.done}/${stats.total}</span>
        </button>
      `;
    }),
  ].join("");
}

document.getElementById("treeLegendBar")?.addEventListener("click", (e) => {
  const chip = e.target.closest(".tree-legend-chip[data-legend-trader]");
  if (!chip) return;
  const trader = chip.dataset.legendTrader;
  const sel = document.getElementById("treeTraderFilter");
  if (!sel) return;
  sel.value = (sel.value === trader && trader !== "all") ? "all" : trader;
  treeCam.hasAutoFitted = false;
  renderQuestTree();
});

function populateTreeTraderSelect(data) {
  const traderSel = document.getElementById("treeTraderFilter");
  if (!traderSel || !data) return;
  const prev = traderSel.value;
  const traders = [...new Set((data.tasks || []).map((t) => normalizeGroupTrader(t.traderName)).filter(Boolean))].sort((a, b) => {
    const ia = TRADER_ORDER.indexOf(a);
    const ib = TRADER_ORDER.indexOf(b);
    const wa = ia === -1 ? 99 : ia;
    const wb = ib === -1 ? 99 : ib;
    return wa !== wb ? wa - wb : a.localeCompare(b, numLocale());
  });
  traderSel.innerHTML = `<option value="all">${esc(t("tree_all_traders"))}</option>` +
    traders.map((tr) => `<option value="${esc(tr)}">${esc(tr)}</option>`).join("");
  if ([...traderSel.options].some((o) => o.value === prev)) traderSel.value = prev;
}

async function loadQuestTree(force = false) {
  const sig = `${state.mode}:${state.lang}:${state.dataRev}`;
  if (!force && renderCache.treeSig === sig && treeLayout.cards.length) {
    scheduleTreeFrame(true);
    return;
  }
  await ensureQuestsData(force);
  populateTreeTraderSelect(state.quests);
  renderQuestTree();
  renderCache.treeSig = sig;
}

function renderTreeBanner(byId) {
  const banner = document.getElementById("treeSelectedBanner");
  if (!banner) return;
  const selected = state.selectedTreeTaskId ? byId.get(state.selectedTreeTaskId) : null;
  if (!selected) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }
  const { ancestors, descendants } = getChainSets(selected.id, byId);
  const impTags = [
    selected.kappaRequired ? `<span class="badge amber">${esc(t("badge_kappa"))}</span>` : "",
    selected.lightkeeperRequired ? `<span class="badge">${esc(t("tree_chain_lk"))}</span>` : "",
    (selected.prereqs?.length || selected.unlocks?.length)
      ? `<span class="badge">${state.lang === "en" ? `Chain (before: ${ancestors.size} • after: ${descendants.size})` : `В цепочке (до: ${ancestors.size} • после: ${descendants.size})`}</span>`
      : "",
  ].filter(Boolean).join(" ");
  const prereqChips = (selected.prereqs || []).map((pid) => {
    const pt = byId.get(pid);
    if (!pt) return "";
    const pCol = TRADER_COLORS[normalizeGroupTrader(pt.traderName)] || "#94a3b8";
    return `<button class="btn btn-ghost" style="padding:3px 8px;font-size:12px;" onclick="focusTreeTask('${esc(pid)}', true)"><span class="tree-line-dot" style="background:${pCol};"></span>← ${esc(pt.name)}</button>`;
  }).filter(Boolean).join(" ");
  const unlockChips = (selected.unlocks || []).map((uid) => {
    const ut = byId.get(uid);
    if (!ut) return "";
    const uCol = TRADER_COLORS[normalizeGroupTrader(ut.traderName)] || "#94a3b8";
    return `<button class="btn btn-ghost" style="padding:3px 8px;font-size:12px;" onclick="focusTreeTask('${esc(uid)}', true)"><span class="tree-line-dot" style="background:${uCol};"></span>→ ${esc(ut.name)}</button>`;
  }).filter(Boolean).join(" ");
  const chainOnly = Boolean(document.getElementById("treeChainOnly")?.checked);
  const lineCol = TRADER_COLORS[normalizeGroupTrader(selected.traderName)] || "#94a3b8";
  banner.style.display = "block";
  banner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
      <div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span class="tree-line-dot" style="background:${lineCol};width:8px;height:8px;"></span>
          <b>${esc(selected.name)}</b>
          <span class="badge">${esc(normalizeGroupTrader(selected.traderName) || "—")}</span>
          <span class="badge">${esc(getTreeStatusLabel(selected.status))}</span>
          ${impTags}
          <span class="muted">${esc(t("th_map"))}: ${esc(selected.mapName || t("any_map"))} • ${esc(t("th_lvl"))} ${selected.minPlayerLevel || 1}+</span>
        </div>
        ${prereqChips ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;"><span class="muted">${esc(t("guide_chain_prev"))}</span>${prereqChips}</div>` : ""}
        ${unlockChips ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;"><span class="muted">${esc(t("guide_chain_next"))}</span>${unlockChips}</div>` : ""}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn-guide" onclick="openQuestGuide('${esc(selected.id)}')">${GUIDE_BOOK_ICO}${esc(t("btn_guide"))}</button>
        <button class="btn btn-ghost" onclick="toggleTreeChainIsolation()">${esc(chainOnly ? (state.lang === "en" ? "Show All" : "Показать всю ленту") : t("tree_isolate"))}</button>
        <button class="btn btn-ghost" onclick="setTreeTaskStatus('${esc(selected.id)}','active')">${esc(t("status_active"))}</button>
        <button class="btn btn-primary" onclick="setTreeTaskStatus('${esc(selected.id)}','completed')">${esc(t("status_completed"))}</button>
        <button class="btn btn-ghost" onclick="setTreeTaskStatus('${esc(selected.id)}','available')">${esc(t("tree_reset_status"))}</button>
        <button class="btn btn-ghost" onclick="focusTreeTask(null)">✕</button>
      </div>
    </div>
  `;
}

function updateQuestTreeSelection() {
  if (!state.quests) return;
  const allTasks = state.quests.tasks || [];
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const selected = state.selectedTreeTaskId ? byId.get(state.selectedTreeTaskId) : null;
  const { ancestors, descendants } = getChainSets(selected?.id, byId);

  treeLayout.selectedId = selected?.id || null;
  treeLayout.directPrereqs = new Set(selected?.prereqs || []);
  treeLayout.directUnlocks = new Set(selected?.unlocks || []);
  treeLayout.fullChain = new Set(selected ? [selected.id, ...ancestors, ...descendants] : []);
  treeLayout.searchQuery = (document.getElementById("treeSearch")?.value || "").trim().toLowerCase();

  renderTreeBanner(byId);
  scheduleTreeFrame(true);
}

function hexAlphaRgba(hex, alpha) {
  const m = String(hex || "").match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return `rgba(148, 163, 184, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function renderQuestTree() {
  const stage = document.getElementById("questTreeStage");
  if (!stage || !state.quests) return;

  const allTasks = state.quests.tasks || [];
  const byId = new Map(allTasks.map((t) => [t.id, t]));
  const traderVal = document.getElementById("treeTraderFilter")?.value || "all";
  const impVal = document.getElementById("treeImportanceFilter")?.value || "all";
  const stVal = document.getElementById("treeStatusFilter")?.value || "all";
  const colorMode = document.getElementById("treeColorMode")?.value || "chains";
  const chainOnly = Boolean(document.getElementById("treeChainOnly")?.checked);

  renderTreeLegend(allTasks);

  let filtered;
  if (chainOnly && state.selectedTreeTaskId && byId.has(state.selectedTreeTaskId)) {
    const { ancestors, descendants } = getChainSets(state.selectedTreeTaskId, byId);
    const keep = new Set([state.selectedTreeTaskId, ...ancestors, ...descendants]);
    filtered = allTasks.filter((t) => keep.has(t.id));
  } else {
    filtered = allTasks.filter((t) => {
      if (traderVal !== "all" && normalizeGroupTrader(t.traderName) !== traderVal) return false;
      if (impVal === "kappa" && !t.kappaRequired) return false;
      if (impVal === "lightkeeper" && !t.lightkeeperRequired) return false;
      if (impVal === "chains" && !(t.prereqs?.length || t.unlocks?.length)) return false;
      if (stVal === "incomplete" && t.status === "completed") return false;
      if (stVal === "playable" && t.status !== "active" && t.status !== "available") return false;
      return true;
    });
  }

  const statsEl = document.getElementById("treeStatsLabel");
  if (statsEl) {
    statsEl.textContent = state.lang === "en"
      ? `Shown: ${filtered.length} of ${allTasks.length}`
      : `На карте: ${filtered.length} из ${allTasks.length}`;
  }

  renderTreeBanner(byId);
  readTreeThemePalette();

  stage.innerHTML = "";
  treeLayout.cards = [];
  treeLayout.cardById.clear();
  treeLayout.edges = [];
  treeLayout.lanes = [];
  treeCam.positions.clear();

  if (!filtered.length) {
    stage.innerHTML = `<div class="muted" style="padding:24px;white-space:nowrap;">${esc(t("quests_empty"))}</div>`;
    scheduleTreeFrame(true);
    return;
  }

  const visibleIds = new Set(filtered.map((t) => t.id));
  const visPrereqs = new Map();
  const visUnlocks = new Map();
  filtered.forEach((t) => {
    visPrereqs.set(t.id, (t.prereqs || []).filter((p) => visibleIds.has(p)));
    visUnlocks.set(t.id, (t.unlocks || []).filter((u) => visibleIds.has(u)));
  });

  // Group into ordered Trader Swimlanes
  const laneGroups = new Map();
  filtered.forEach((t) => {
    const grp = normalizeGroupTrader(t.traderName);
    if (!laneGroups.has(grp)) laneGroups.set(grp, []);
    laneGroups.get(grp).push(t);
  });

  const orderedGroupNames = [...laneGroups.keys()].sort((a, b) => {
    const ia = TRADER_ORDER.indexOf(a);
    const ib = TRADER_ORDER.indexOf(b);
    const wa = ia === -1 ? 99 : ia;
    const wb = ib === -1 ? 99 : ib;
    return wa !== wb ? wa - wb : a.localeCompare(b, "ru");
  });

  const CARD_W = 228;
  const COL_STEP = 292;
  const ROW_STEP = 92;
  const LANE_PAD_X = 20;
  const LANE_HEAD_H = 44;
  const SWIMLANE_GAP = 26;

  const taskMeta = new Map();
  const laneLayouts = [];
  let maxGridCols = 4;

  orderedGroupNames.forEach((grpName, grpIdx) => {
    const gTasks = laneGroups.get(grpName);
    const gIds = new Set(gTasks.map((t) => t.id));
    const gById = new Map(gTasks.map((t) => [t.id, t]));

    const inPrereqs = new Map();
    const inUnlocks = new Map();
    const chainTasks = [];
    const soloTasks = [];

    gTasks.forEach((t) => {
      const ip = (visPrereqs.get(t.id) || []).filter((p) => gIds.has(p));
      const iu = (visUnlocks.get(t.id) || []).filter((u) => gIds.has(u));
      inPrereqs.set(t.id, ip);
      inUnlocks.set(t.id, iu);
      if (ip.length || iu.length) chainTasks.push(t);
      else soloTasks.push(t);
    });

    const colMemo = new Map();
    const getCol = (tid, seen) => {
      if (colMemo.has(tid)) return colMemo.get(tid);
      if (seen.has(tid)) return 0;
      seen.add(tid);
      let c = 0;
      for (const pid of inPrereqs.get(tid) || []) {
        c = Math.max(c, getCol(pid, seen) + 1);
      }
      seen.delete(tid);
      colMemo.set(tid, c);
      return c;
    };
    chainTasks.forEach((t) => getCol(t.id, new Set()));

    const depthMemo = new Map();
    const getSubtreeSpan = (tid, seen) => {
      if (depthMemo.has(tid)) return depthMemo.get(tid);
      if (seen.has(tid)) return 1;
      seen.add(tid);
      let span = 1;
      for (const uid of inUnlocks.get(tid) || []) {
        if ((colMemo.get(uid) || 0) > (colMemo.get(tid) || 0)) {
          span += getSubtreeSpan(uid, seen);
        }
      }
      seen.delete(tid);
      depthMemo.set(tid, span);
      return span;
    };
    chainTasks.forEach((t) => getSubtreeSpan(t.id, new Set()));

    const primaryParent = new Map();
    const treeChildren = new Map();
    chainTasks.forEach((t) => treeChildren.set(t.id, []));
    chainTasks.forEach((t) => {
      const ps = (inPrereqs.get(t.id) || []).filter((p) => (colMemo.get(p) || 0) < (colMemo.get(t.id) || 0));
      if (!ps.length) return;
      ps.sort((a, b) => (colMemo.get(b) - colMemo.get(a)) || ((depthMemo.get(b) || 0) - (depthMemo.get(a) || 0)));
      primaryParent.set(t.id, ps[0]);
      treeChildren.get(ps[0])?.push(t.id);
    });

    const roots = chainTasks.filter((t) => !primaryParent.has(t.id));
    roots.sort((a, b) => ((depthMemo.get(b.id) || 0) - (depthMemo.get(a.id) || 0)) || (a.minPlayerLevel - b.minPlayerLevel) || a.name.localeCompare(b.name, "ru"));

    const occupied = new Set();
    const localGrid = new Map();
    const branchColorIdx = new Map();
    let nextFreeRow = 0;
    let colorCursor = grpIdx * 3;

    const isSpanFree = (r, cStart, cEnd) => {
      for (let c = cStart; c <= cEnd; c++) {
        if (occupied.has(`${r}:${c}`)) return false;
      }
      return true;
    };
    const markSpan = (r, cStart, cEnd) => {
      for (let c = cStart; c <= cEnd; c++) occupied.add(`${r}:${c}`);
    };

    const placeBranch = (tid, prefRow, bIdx, parentCol) => {
      if (localGrid.has(tid)) return;
      const c = colMemo.get(tid) || 0;
      const spanStart = parentCol >= 0 ? Math.min(c, parentCol + 1) : c;
      let r = prefRow;
      if (!isSpanFree(r, spanStart, c)) {
        r = nextFreeRow;
        while (!isSpanFree(r, spanStart, c)) r++;
      }
      markSpan(r, spanStart, c);
      localGrid.set(tid, { col: c, row: r });
      branchColorIdx.set(tid, bIdx);
      nextFreeRow = Math.max(nextFreeRow, r + 1);

      const chIds = [...(treeChildren.get(tid) || [])].sort((a, b) => {
        const dDiff = (depthMemo.get(b) || 0) - (depthMemo.get(a) || 0);
        if (dDiff !== 0) return dDiff;
        return (gById.get(a)?.name || "").localeCompare(gById.get(b)?.name || "", "ru");
      });

      chIds.forEach((cid, i) => {
        if (i === 0) {
          placeBranch(cid, r, bIdx, c);
        } else {
          let nextIdx = (colorCursor++) % TREE_LINE_PALETTE.length;
          if (nextIdx === bIdx) nextIdx = (nextIdx + 1) % TREE_LINE_PALETTE.length;
          placeBranch(cid, nextFreeRow, nextIdx, c);
        }
      });
    };

    roots.forEach((rt) => {
      const idx = (colorCursor++) % TREE_LINE_PALETTE.length;
      placeBranch(rt.id, nextFreeRow, idx, -1);
    });
    chainTasks.forEach((t) => {
      if (!localGrid.has(t.id)) {
        const idx = (colorCursor++) % TREE_LINE_PALETTE.length;
        placeBranch(t.id, nextFreeRow, idx, -1);
      }
    });

    let laneMaxCol = 0;
    localGrid.forEach((pos) => { if (pos.col > laneMaxCol) laneMaxCol = pos.col; });

    const statusOrder = { active: 0, available: 1, locked: 2, completed: 3, failed: 4 };
    soloTasks.sort((a, b) => {
      const sDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (sDiff !== 0) return sDiff;
      return a.minPlayerLevel - b.minPlayerLevel || a.name.localeCompare(b.name, "ru");
    });

    let soloHeaderRow = null;
    if (soloTasks.length) {
      const soloCols = chainTasks.length ? Math.max(4, Math.min(6, laneMaxCol + 1)) : 6;
      const soloStartRow = chainTasks.length ? nextFreeRow + 0.35 : 0;
      if (chainTasks.length) soloHeaderRow = nextFreeRow + 0.05;
      soloTasks.forEach((t, idx) => {
        const col = idx % soloCols;
        const row = soloStartRow + Math.floor(idx / soloCols);
        localGrid.set(t.id, { col, row });
        if (col > laneMaxCol) laneMaxCol = col;
      });
      nextFreeRow = soloStartRow + Math.ceil(soloTasks.length / soloCols);
    }

    if (laneMaxCol + 1 > maxGridCols) maxGridCols = laneMaxCol + 1;

    const traderColor = TRADER_COLORS[grpName] || "#94a3b8";
    const statusColors = {
      completed: "#22c55e",
      active: "#38bdf8",
      available: "#eab349",
      failed: "#ef4444",
      locked: "#64748b",
    };

    gTasks.forEach((t) => {
      let col;
      if (colorMode === "traders") {
        col = traderColor;
      } else if (colorMode === "status") {
        col = statusColors[t.status] || "#64748b";
      } else {
        col = branchColorIdx.has(t.id)
          ? TREE_LINE_PALETTE[branchColorIdx.get(t.id) % TREE_LINE_PALETTE.length]
          : traderColor;
      }
      taskMeta.set(t.id, { color: col, groupTrader: grpName });
    });

    laneLayouts.push({
      grpName,
      traderColor,
      tasks: gTasks,
      localGrid,
      soloHeaderRow,
      soloCount: soloTasks.length,
      doneCount: gTasks.filter((t) => t.status === "completed").length,
      rowsTotal: Math.max(1, nextFreeRow),
    });
  });

  const stageW = Math.max(960, LANE_PAD_X * 2 + maxGridCols * COL_STEP);
  let cursorY = 0;

  laneLayouts.forEach((lane) => {
    const startY = cursorY;
    const bodyHeight = Math.ceil(lane.rowsTotal * ROW_STEP) + 18;
    const laneHeight = LANE_HEAD_H + bodyHeight;
    cursorY += laneHeight + SWIMLANE_GAP;

    const soloHeaderY = lane.soloHeaderRow !== null
      ? startY + LANE_HEAD_H + Math.round(lane.soloHeaderRow * ROW_STEP) - 4
      : null;

    const mCtx = getMeasureCtx();
    const countText = `${lane.doneCount}/${lane.total}`;
    let nameWidth = lane.grpName.length * 7;
    let countWidth = countText.length * 6.5;
    if (mCtx) {
      mCtx.font = `600 12px "IBM Plex Sans", sans-serif`;
      nameWidth = mCtx.measureText(lane.grpName).width;
      mCtx.font = `500 10.5px "JetBrains Mono", monospace`;
      countWidth = mCtx.measureText(countText).width;
    }
    const headerWidth = Math.ceil(nameWidth + countWidth + 28);
    const soloHeaderText = state.lang === "en"
      ? `STANDALONE QUESTS (${lane.soloCount})`
      : `ОТДЕЛЬНЫЕ КВЕСТЫ (${lane.soloCount})`;

    treeLayout.lanes.push({
      grpName: lane.grpName,
      traderColor: lane.traderColor,
      bandRgba: hexAlphaRgba(lane.traderColor, 0.055),
      startY,
      laneHeight,
      soloHeaderY,
      soloHeaderText,
      soloCount: lane.soloCount,
      doneCount: lane.doneCount,
      total: lane.tasks.length,
      nameWidth,
      countText,
      headerWidth,
    });

    const baseTop = startY + LANE_HEAD_H;
    lane.tasks.forEach((t) => {
      const g = lane.localGrid.get(t.id);
      if (!g) return;
      const x = LANE_PAD_X + g.col * COL_STEP;
      const y = baseTop + Math.round(g.row * ROW_STEP);
      const meta = taskMeta.get(t.id) || { color: lane.traderColor, groupTrader: lane.grpName };
      const stKey = t.status || "locked";
      const stLabel = getTreeStatusShort(stKey);
      const crossDeps = (visPrereqs.get(t.id) || []).filter((pid) => {
        const pt = byId.get(pid);
        return pt && normalizeGroupTrader(pt.traderName) !== lane.grpName;
      }).length;

      const badgeText = t.kappaRequired ? "KAPPA" : (t.lightkeeperRequired ? window.t("badge_lk") : "");
      const badgeIsAmber = Boolean(t.kappaRequired);

      let stPillW = stLabel.length * 6 + 10;
      let badgeW = badgeText ? badgeText.length * 5.8 + 8 : 0;
      let titleLines = [t.name];
      let shortTitle = t.name.length > 26 ? `${t.name.slice(0, 24)}…` : t.name;
      let traderShort = meta.groupTrader;
      const mapLabel = t.mapName || window.t("any_map");
      const lvlLabel = t.minPlayerLevel > 1 ? ` • ${window.t("th_lvl")}.${t.minPlayerLevel}` : "";
      let metaLeft = `${mapLabel}${lvlLabel}`;
      const metaRight = `${crossDeps ? `⇄${crossDeps} ` : ""}←${t.prereqs?.length || 0} →${t.unlocks?.length || 0}`;
      let metaRightW = metaRight.length * 6;

      if (mCtx) {
        mCtx.font = `600 9.5px "JetBrains Mono", monospace`;
        stPillW = Math.ceil(mCtx.measureText(stLabel).width + 8);
        if (badgeText) {
          mCtx.font = `600 9px "JetBrains Mono", monospace`;
          badgeW = Math.ceil(mCtx.measureText(badgeText).width + 8);
        }
        const availTraderW = Math.max(40, CARD_W - 30 - stPillW - (badgeW ? badgeW + 4 : 0));
        mCtx.font = `500 10.5px "IBM Plex Sans", sans-serif`;
        traderShort = truncateTextToWidth(mCtx, meta.groupTrader, availTraderW);

        mCtx.font = `600 12px "IBM Plex Sans", sans-serif`;
        titleLines = wrapTitleLines(mCtx, t.name, CARD_W - 22);
        shortTitle = truncateTextToWidth(mCtx, t.name, CARD_W - 22);

        mCtx.font = `400 10.5px "IBM Plex Sans", sans-serif`;
        metaRightW = Math.ceil(mCtx.measureText(metaRight).width);
        metaLeft = truncateTextToWidth(mCtx, metaLeft, Math.max(40, CARD_W - 26 - metaRightW));
      }

      const h = titleLines.length > 1 ? 76 : 62;
      const box = { x, y, w: CARD_W, h };
      treeCam.positions.set(t.id, box);
      const cardObj = {
        id: t.id,
        task: t,
        nameLower: t.name.toLowerCase(),
        x, y, w: CARD_W, h,
        color: meta.color,
        groupTrader: meta.groupTrader,
        traderShort,
        stKey,
        stLabel,
        stPillW,
        badgeText,
        badgeIsAmber,
        badgeW,
        titleLines,
        shortTitle,
        metaLeft,
        metaRight,
        metaRightW,
      };
      treeLayout.cards.push(cardObj);
      treeLayout.cardById.set(t.id, cardObj);
    });
  });

  treeLayout.stageW = stageW;
  treeLayout.stageH = Math.max(420, cursorY + 24);
  treeCam.stageW = treeLayout.stageW;
  treeCam.stageH = treeLayout.stageH;

  // Precompute Bezier edge geometry + bounding boxes + arrowAngle for ultra-fast Canvas frustum culling
  filtered.forEach((t) => {
    const toBox = treeCam.positions.get(t.id);
    if (!toBox) return;
    const toMeta = taskMeta.get(t.id) || { color: "#94a3b8", groupTrader: "" };
    (visPrereqs.get(t.id) || []).forEach((pid) => {
      const fromBox = treeCam.positions.get(pid);
      if (!fromBox) return;
      const fromMeta = taskMeta.get(pid) || { color: "#94a3b8", groupTrader: "" };
      const isCross = fromMeta.groupTrader !== toMeta.groupTrader;

      const x1 = fromBox.x + fromBox.w;
      const y1 = fromBox.y + fromBox.h / 2;
      const x2 = toBox.x - 4;
      const y2 = toBox.y + toBox.h / 2;
      const dx = (!isCross && x2 >= x1)
        ? Math.max(28, Math.min(62, (x2 - x1) * 0.48 + Math.min(22, Math.abs(y2 - y1) * 0.06)))
        : Math.max(40, Math.min(110, Math.abs(x2 - x1) * 0.38));

      const cx1 = x1 + dx;
      const cy1 = y1;
      const cx2 = x2 - dx;
      const cy2 = y2;
      const rawAngle = Math.atan2(y2 - cy2, x2 - cx2);

      treeLayout.edges.push({
        from: pid,
        to: t.id,
        x1, y1, x2, y2,
        cx1, cy1, cx2, cy2,
        arrowAngle: Number.isFinite(rawAngle) ? rawAngle : 0,
        minX: Math.min(x1, x2, cx1, cx2) - 8,
        maxX: Math.max(x1, x2, cx1, cx2) + 8,
        minY: Math.min(y1, y2, cy1, cy2) - 8,
        maxY: Math.max(y1, y2, cy1, cy2) + 8,
        baseStroke: toMeta.color,
        isCross,
      });
    });
  });

  if (!treeCam.hasAutoFitted) {
    treeCam.hasAutoFitted = true;
    frameTreeStart();
  }
  updateQuestTreeSelection();
}

window.toggleTreeChainIsolation = () => {
  const chk = document.getElementById("treeChainOnly");
  if (!chk) return;
  chk.checked = !chk.checked;
  treeCam.hasAutoFitted = false;
  renderQuestTree();
};

window.focusTreeTask = (id, center = false) => {
  state.selectedTreeTaskId = id;
  if (id && !treeCam.positions.has(id)) {
    const tSel = document.getElementById("treeTraderFilter");
    const iSel = document.getElementById("treeImportanceFilter");
    const sSel = document.getElementById("treeStatusFilter");
    const cChk = document.getElementById("treeChainOnly");
    if (tSel) tSel.value = "all";
    if (iSel) iSel.value = "all";
    if (sSel) sSel.value = "all";
    if (cChk) cChk.checked = false;
    renderQuestTree();
  } else {
    updateQuestTreeSelection();
  }
  if (id && center) centerTreeOnTask(id);
};

window.setTreeTaskStatus = async (taskId, status) => {
  await api("/api/quests/status", {
    method: "POST",
    body: JSON.stringify({ mode: state.mode, taskId, status }),
  });
  showToast(t("toast_status_updated"));
  invalidateDataCache(false);
  await loadQuestTree(true);
};

  return {
    loadQuestTree,
    renderQuestTree,
    scheduleTreeFrame,
    populateTreeTraderSelect,
  };
}
