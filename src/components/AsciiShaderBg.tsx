import React, { useEffect, useRef } from "react";
import { Rgb } from "../theme/theme";

interface AsciiShaderBgProps {
  shaderMode: string;
  activeTab: string;
  accentRgb: Rgb;
  accentBrightRgb: Rgb;
  isLight: boolean;
}

const GLYPHS = " .·:-=+*#%░▒▓┼│─";
const CW = 13;
const CH = 18;

export const AsciiShaderBg: React.FC<AsciiShaderBgProps> = ({
  shaderMode,
  activeTab,
  accentRgb,
  accentBrightRgb,
  isLight,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef({ shaderMode, activeTab, accentRgb, accentBrightRgb, isLight });
  propsRef.current = { shaderMode, activeTab, accentRgb, accentBrightRgb, isLight };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reducedMq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cwPx = CW * dpr;
    let chPx = CH * dpr;
    let cols = 0;
    let rows = 0;
    let atlas: HTMLCanvasElement | null = null;
    let lastFrame = 0;
    const startTime = performance.now();
    let pointerX = -9999;
    let pointerY = -9999;
    let pointerActive = 0;
    let rafId = 0;
    let disposed = false;

    const buildAtlas = () => {
      const { accentRgb: acc, accentBrightRgb: accHi, isLight: light } = propsRef.current;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cwPx = Math.round(CW * dpr);
      chPx = Math.round(CH * dpr);
      atlas = document.createElement("canvas");
      atlas.width = GLYPHS.length * cwPx;
      atlas.height = 4 * chPx;
      const actx = atlas.getContext("2d");
      if (!actx) return;
      actx.font = `500 ${Math.round(12 * dpr)}px "JetBrains Mono", Consolas, monospace`;
      actx.textAlign = "center";
      actx.textBaseline = "middle";

      const slateLo = light ? "64, 72, 86" : "130, 140, 158";
      const slateHi = light ? "42, 48, 60" : "162, 170, 184";
      const tiers = [
        `rgba(${slateLo}, ${light ? "0.10" : "0.11"})`,
        `rgba(${slateHi}, ${light ? "0.18" : "0.20"})`,
        `rgba(${Math.round(acc.r)}, ${Math.round(acc.g)}, ${Math.round(acc.b)}, 0.24)`,
        `rgba(${Math.round(accHi.r)}, ${Math.round(accHi.g)}, ${Math.round(accHi.b)}, 0.38)`,
      ];
      for (let t = 0; t < tiers.length; t++) {
        actx.fillStyle = tiers[t];
        const cy = t * chPx + chPx * 0.52;
        for (let g = 1; g < GLYPHS.length; g++) {
          actx.fillText(GLYPHS[g], g * cwPx + cwPx * 0.5, cy);
        }
      }
    };

    const drawShaderFrame = (t: number) => {
      if (!atlas || !cols || !rows) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const { shaderMode: mode, activeTab: tab } = propsRef.current;
      if (mode === "off") return;

      const invCols = 1 / Math.max(1, cols);
      const invRows = 1 / Math.max(1, rows);
      const aspect = (rows * CH) / Math.max(1, cols * CW);
      const pCol = pointerX / CW;
      const pRow = pointerY / CH;
      pointerActive *= 0.94;

      const isMapTab = tab === "maps";
      const tabBoost = isMapTab ? 1.24 : 1.0;

      for (let r = 0; r < rows; r++) {
        const ny = r * invRows;
        const yPx = r * chPx;
        const vWeight = (0.65 + 0.35 * Math.sin(ny * Math.PI)) * tabBoost;

        for (let c = 0; c < cols; c++) {
          const nx = c * invCols;

          let boost = 0;
          if (pointerActive > 0.02) {
            const pd = Math.hypot((c - pCol) * 0.85, r - pRow);
            if (pd < 8.5) boost = (1 - pd / 8.5) * pointerActive;
          }

          let energy = 0;
          let gIdx = 1;
          let tier = 0;

          if (mode === "matrix") {
            const band = 0.5 + 0.5 * Math.sin(nx * 10.5 - t * 1.4 + Math.sin(ny * 5.0 + c * 0.13) * 0.9);
            const streak = Math.pow(Math.max(0, Math.sin(nx * 24.0 - t * 2.1 + r * 0.45)), 5.0);
            energy = Math.min(1, (band * 0.36 + streak * 0.72 + boost * 0.75) * vWeight);
            if (energy < (isMapTab ? 0.12 : 0.16)) continue;
            gIdx = streak > 0.55 ? 11 : Math.min(GLYPHS.length - 1, Math.max(1, Math.floor(energy * (GLYPHS.length - 1))));
            tier = boost > 0.35 || streak > 0.65 ? 3 : energy > 0.52 ? 2 : 1;
          } else if (mode === "radar") {
            const sweepX = ((t * 0.22) % 1.25) - 0.12;
            const dx = nx - sweepX;
            const wrapDx = dx >= 0 ? dx : dx + 1.25;
            const beam = Math.max(0, 1 - wrapDx * 4.5);
            const grid = r % 6 === 0 && c % 10 === 0 ? 0.55 : 0;
            energy = Math.min(1, (beam * 0.75 + grid * 0.5 + boost * 0.75) * tabBoost);
            if (energy < 0.12) continue;
            gIdx = grid > 0.4 ? 13 : beam > 0.65 ? 11 : Math.min(10, Math.max(2, Math.floor(energy * 10)));
            tier = beam > 0.55 || boost > 0.35 ? 3 : beam > 0.2 ? 2 : 0;
          } else if (mode === "minimal") {
            const breeze = 0.5 + 0.5 * Math.sin(nx * 4.0 - t * 0.35 + ny * 1.8);
            if ((r + c) % 3 !== 0 && boost < 0.15) continue;
            energy = Math.min(1, (breeze * 0.35 + boost * 0.7) * vWeight);
            if (energy < 0.16) continue;
            gIdx = boost > 0.4 ? 6 : energy > 0.38 ? 3 : 2;
            tier = boost > 0.35 ? 2 : 0;
          } else {
            const f1 = Math.sin(nx * 5.2 - t * 0.24) * Math.cos(ny * 4.3 - t * 0.17);
            const f2 = 0.55 * Math.sin((nx - ny * 0.9) * 7.8 - t * 0.31);
            const elev = f1 + f2;
            const frac = (((elev * 2.5) % 1) + 1) % 1;
            const iso = Math.max(0, 1 - Math.abs(frac - 0.5) * 9.0);

            const rdx = nx - 0.16;
            const rdy = (ny - 0.16) * aspect;
            const dist = Math.hypot(rdx, rdy);
            const ring =
              Math.pow(Math.max(0, Math.sin(dist * 15.0 - t * 1.35) * 0.5 + 0.5), 7.0) *
              Math.max(0.15, 1 - dist * 0.72);

            energy = Math.min(1, (iso * 0.62 + ring * 0.55 + boost * 0.75) * vWeight);
            if (energy < (isMapTab ? 0.1 : 0.13)) continue;

            if (iso > 0.65 && (r + c) % 5 === 0) {
              gIdx = 13;
            } else if (ring > 0.45 && iso > 0.25) {
              gIdx = 10 + Math.min(2, Math.floor(energy * 3));
            } else {
              gIdx = Math.min(GLYPHS.length - 1, Math.max(1, Math.floor(energy * (GLYPHS.length - 1))));
            }

            tier = boost > 0.35 || ring > 0.48 ? (energy > 0.58 ? 3 : 2) : energy > 0.48 ? 1 : 0;
          }

          ctx.drawImage(atlas, gIdx * cwPx, tier * chPx, cwPx, chPx, c * cwPx, yPx, cwPx, chPx);
        }
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(320, Math.round(rect.width || window.innerWidth));
      const h = Math.max(240, Math.round(rect.height || window.innerHeight));
      const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!atlas || nextDpr !== dpr) buildAtlas();
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / CW);
      rows = Math.ceil(h / CH);
      drawShaderFrame(reducedMq?.matches ? 4.2 : (performance.now() - startTime) * 0.001);
    };

    const shouldRun = () =>
      !disposed &&
      !document.hidden &&
      !reducedMq?.matches &&
      propsRef.current.shaderMode !== "off";

    const loop = (now: number) => {
      if (!shouldRun()) {
        rafId = 0;
        return;
      }
      rafId = requestAnimationFrame(loop);
      if ((window as any).__eftGesturing) return;
      if (now - lastFrame < 56) return;
      lastFrame = now;
      drawShaderFrame((now - startTime) * 0.001);
    };

    const kickLoop = () => {
      if (rafId === 0 && shouldRun()) {
        lastFrame = 0;
        rafId = requestAnimationFrame(loop);
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        kickLoop();
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerX = e.clientX - rect.left;
      pointerY = e.clientY - rect.top;
      pointerActive = 0.9;
    };

    const onThemeRebuild = () => {
      buildAtlas();
      drawShaderFrame((performance.now() - startTime) * 0.001);
      kickLoop();
    };

    if (window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("eft-theme-change", onThemeRebuild);

    buildAtlas();
    resize();
    kickLoop();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("eft-theme-change", onThemeRebuild);
    };
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("eft-theme-change"));
  }, [shaderMode, accentRgb, accentBrightRgb, isLight, activeTab]);

  return <canvas ref={canvasRef} id="asciiShaderBg" className="ascii-shader-bg" aria-hidden="true" />;
};
