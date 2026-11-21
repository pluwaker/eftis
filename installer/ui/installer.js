(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;

  const I18N = {
    ru: {
      setup_tag: "SETUP v2.0.0",
      uninstall_tag: "UNINSTALL v2.0.0",
      status_ready: "STATUS: READY",
      status_busy: "STATUS: WORKING",
      status_done: "STATUS: COMPLETE",
      step_1: "Параметры",
      step_2: "Установка",
      step_3: "Готово",
      step_un_1: "Подтверждение",
      step_un_2: "Удаление",
      step_un_3: "Готово",
      setup_title: "Установка Eftis",
      update_title: "Обновление Eftis",
      setup_desc: "Локальный тактический помощник для Escape from Tarkov: квесты, Kappa, карты, гайды и Круг Сектантов.",
      install_dir: "Папка установки",
      browse: "Обзор...",
      chk_desktop: "Создать ярлык на рабочем столе",
      chk_start: "Добавить ярлык в меню «Пуск»",
      spec_space: "~55 МБ",
      cancel: "Отмена",
      btn_install: "Установить Eftis",
      btn_update: "Обновить Eftis",
      prog_title: "Установка компонентов...",
      prog_sub: "Распаковка файлов и настройка окружения.",
      prog_un_title: "Удаление Eftis...",
      prog_un_sub: "Удаление файлов программы и ярлыков.",
      prog_prep: "Подготовка...",
      done_title: "Eftis установлен",
      done_desc: "Приложение готово к работе. Все модули и база данных работают локально на вашем ПК.",
      done_un_title: "Eftis удалён",
      done_un_desc: "Программа и её ярлыки удалены с вашего компьютера.",
      done_path: "Путь установки",
      close: "Закрыть",
      launch: "Запустить Eftis",
      un_title: "Удаление Eftis",
      un_desc: "Файлы программы, ярлыки и запись в списке установленных программ будут удалены.",
      un_path: "Папка программы",
      chk_remove_data: "Удалить пользовательские данные, прогресс квестов и настройки",
      btn_uninstall: "Удалить Eftis",
    },
    en: {
      setup_tag: "SETUP v2.0.0",
      uninstall_tag: "UNINSTALL v2.0.0",
      status_ready: "STATUS: READY",
      status_busy: "STATUS: WORKING",
      status_done: "STATUS: COMPLETE",
      step_1: "Configure",
      step_2: "Install",
      step_3: "Complete",
      step_un_1: "Confirm",
      step_un_2: "Uninstall",
      step_un_3: "Complete",
      setup_title: "Install Eftis",
      update_title: "Update Eftis",
      setup_desc: "Local tactical companion for Escape from Tarkov: quests, Kappa, interactive maps, guides, and Cultist Circle.",
      install_dir: "Install location",
      browse: "Browse...",
      chk_desktop: "Create desktop shortcut",
      chk_start: "Add Start Menu shortcut",
      spec_space: "~55 MB",
      cancel: "Cancel",
      btn_install: "Install Eftis",
      btn_update: "Update Eftis",
      prog_title: "Installing components...",
      prog_sub: "Extracting binaries and configuring environment.",
      prog_un_title: "Uninstalling Eftis...",
      prog_un_sub: "Removing program files and shortcuts.",
      prog_prep: "Preparing...",
      done_title: "Eftis installed",
      done_desc: "Ready for deployment. All modules and your local database run locally on your PC.",
      done_un_title: "Eftis removed",
      done_un_desc: "Program files and shortcuts have been removed from your PC.",
      done_path: "Install path",
      close: "Close",
      launch: "Launch Eftis",
      un_title: "Uninstall Eftis",
      un_desc: "Program files, shortcuts, and the Apps & Features entry will be removed.",
      un_path: "Program folder",
      chk_remove_data: "Delete user data, quest progress, and settings",
      btn_uninstall: "Uninstall Eftis",
    },
  };

  let lang = "ru";
  let isUninstall = false;
  let isInstalled = false;
  let finalInstallDir = "";

  const $ = (id) => document.getElementById(id);

  function setStep(activeStep) {
    document.querySelectorAll(".step-item").forEach((el) => {
      const s = Number(el.dataset.step);
      el.classList.toggle("active", s === activeStep);
      el.classList.toggle("done", s < activeStep);
    });
  }

  function showView(name) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $(`view-${name}`)?.classList.add("active");
  }

  function showError(msg) {
    const el = $("errorBanner");
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    el.hidden = false;
  }

  function applyLang() {
    const d = I18N[lang];
    $("btnLang").textContent = lang.toUpperCase();
    $("tbTag").textContent = isUninstall ? d.uninstall_tag : d.setup_tag;
    $("stepLbl1").textContent = isUninstall ? d.step_un_1 : d.step_1;
    $("stepLbl2").textContent = isUninstall ? d.step_un_2 : d.step_2;
    $("stepLbl3").textContent = isUninstall ? d.step_un_3 : d.step_3;
    $("setupHeading").textContent = isInstalled ? d.update_title : d.setup_title;
    $("setupDesc").textContent = d.setup_desc;
    $("lblInstallDir").textContent = d.install_dir;
    $("btnBrowse").textContent = d.browse;
    $("lblChkDesktop").textContent = d.chk_desktop;
    $("lblChkStartMenu").textContent = d.chk_start;
    $("specSpace").textContent = d.spec_space;
    $("btnCancelSetup").textContent = d.cancel;
    $("btnInstall").textContent = isInstalled ? d.btn_update : d.btn_install;
    $("progHeading").textContent = isUninstall ? d.prog_un_title : d.prog_title;
    $("progSub").textContent = isUninstall ? d.prog_un_sub : d.prog_sub;
    $("doneHeading").textContent = isUninstall ? d.done_un_title : d.done_title;
    $("doneDesc").textContent = isUninstall ? d.done_un_desc : d.done_desc;
    $("lblDonePath").textContent = d.done_path;
    $("btnFinishClose").textContent = d.close;
    $("btnLaunch").textContent = d.launch;
    $("btnLaunch").style.display = isUninstall ? "none" : "";
    $("unHeading").textContent = d.un_title;
    $("unDesc").textContent = d.un_desc;
    $("lblUnPath").textContent = d.un_path;
    $("lblRemoveData").textContent = d.chk_remove_data;
    $("btnCancelUn").textContent = d.cancel;
    $("btnUninstall").textContent = d.btn_uninstall;
  }

  function appendLog(line) {
    const box = $("progLog");
    if (!line) return;
    box.textContent += (box.textContent ? "\n" : "") + line;
    box.scrollTop = box.scrollHeight;
  }

  // Animated ASCII Background Shader (matches AsciiShaderBg.tsx)
  function startAsciiBg() {
    const canvas = $("asciiBg");
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;

    const GLYPHS = " .·:-=+*#%░▒▓┼│─";
    const CW = 13;
    const CH = 18;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cwPx = Math.round(CW * dpr);
    let chPx = Math.round(CH * dpr);
    let cols = 0;
    let rows = 0;
    let atlas = null;
    let pointerX = -9999;
    let pointerY = -9999;
    let pointerActive = 0;
    let lastFrame = 0;
    const startTime = performance.now();

    function buildAtlas() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cwPx = Math.round(CW * dpr);
      chPx = Math.round(CH * dpr);
      atlas = document.createElement("canvas");
      atlas.width = GLYPHS.length * cwPx;
      atlas.height = 4 * chPx;
      const actx = atlas.getContext("2d");
      actx.font = `500 ${Math.round(12 * dpr)}px "Consolas", monospace`;
      actx.textAlign = "center";
      actx.textBaseline = "middle";
      const tiers = [
        "rgba(130, 140, 158, 0.12)",
        "rgba(162, 170, 184, 0.22)",
        "rgba(217, 155, 38, 0.28)",
        "rgba(234, 179, 73, 0.44)",
      ];
      for (let t = 0; t < tiers.length; t++) {
        actx.fillStyle = tiers[t];
        const cy = t * chPx + chPx * 0.52;
        for (let g = 1; g < GLYPHS.length; g++) {
          actx.fillText(GLYPHS[g], g * cwPx + cwPx * 0.5, cy);
        }
      }
    }

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      buildAtlas();
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / CW);
      rows = Math.ceil(h / CH);
    }

    function draw(t) {
      if (!atlas || !cols || !rows) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const invCols = 1 / Math.max(1, cols);
      const invRows = 1 / Math.max(1, rows);
      const aspect = (rows * CH) / Math.max(1, cols * CW);
      const pCol = pointerX / CW;
      const pRow = pointerY / CH;
      pointerActive *= 0.94;

      for (let r = 0; r < rows; r++) {
        const ny = r * invRows;
        const yPx = r * chPx;
        const vWeight = 0.65 + 0.35 * Math.sin(ny * Math.PI);
        for (let c = 0; c < cols; c++) {
          const nx = c * invCols;
          let boost = 0;
          if (pointerActive > 0.02) {
            const pd = Math.hypot((c - pCol) * 0.85, r - pRow);
            if (pd < 8.5) boost = (1 - pd / 8.5) * pointerActive;
          }
          const f1 = Math.sin(nx * 5.2 - t * 0.28) * Math.cos(ny * 4.3 - t * 0.2);
          const f2 = 0.55 * Math.sin((nx - ny * 0.9) * 7.8 - t * 0.34);
          const frac = ((((f1 + f2) * 2.5) % 1) + 1) % 1;
          const iso = Math.max(0, 1 - Math.abs(frac - 0.5) * 9.0);
          const dist = Math.hypot(nx - 0.16, (ny - 0.16) * aspect);
          const ring = Math.pow(Math.max(0, Math.sin(dist * 15.0 - t * 1.35) * 0.5 + 0.5), 7.0) * Math.max(0.15, 1 - dist * 0.72);
          const energy = Math.min(1, (iso * 0.62 + ring * 0.55 + boost * 0.75) * vWeight);
          if (energy < 0.13) continue;

          const gIdx = (iso > 0.65 && (r + c) % 5 === 0)
            ? 13
            : (ring > 0.45 && iso > 0.25)
              ? 10 + Math.min(2, Math.floor(energy * 3))
              : Math.min(GLYPHS.length - 1, Math.max(1, Math.floor(energy * (GLYPHS.length - 1))));
          const tier = boost > 0.35 || ring > 0.48 ? (energy > 0.58 ? 3 : 2) : energy > 0.48 ? 1 : 0;
          ctx.drawImage(atlas, gIdx * cwPx, tier * chPx, cwPx, chPx, c * cwPx, yPx, cwPx, chPx);
        }
      }
    }

    function loop(now) {
      requestAnimationFrame(loop);
      if (document.hidden || now - lastFrame < 56) return;
      lastFrame = now;
      draw((now - startTime) * 0.001);
    }

    window.addEventListener("pointermove", (e) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      pointerActive = 0.9;
    }, { passive: true });
    window.addEventListener("resize", resize);
    resize();
    requestAnimationFrame(loop);
  }

  async function init() {
    startAsciiBg();

    $("btnLang").addEventListener("click", () => {
      lang = lang === "ru" ? "en" : "ru";
      applyLang();
    });
    $("btnMin").addEventListener("click", () => invoke("minimize_window"));
    $("btnClose").addEventListener("click", () => invoke("close_window"));
    $("btnCancelSetup").addEventListener("click", () => invoke("close_window"));
    $("btnCancelUn").addEventListener("click", () => invoke("close_window"));
    $("btnFinishClose").addEventListener("click", () => invoke("close_window"));

    $("btnBrowse").addEventListener("click", async () => {
      const picked = await invoke("browse_install_dir", { currentDir: $("installDirInput").value });
      if (picked) $("installDirInput").value = picked;
    });

    $("btnInstall").addEventListener("click", async () => {
      showError("");
      const dir = $("installDirInput").value.trim();
      if (!dir) return;
      finalInstallDir = dir;
      $("progLog").textContent = "";
      $("progFill").style.width = "0%";
      $("progPctText").textContent = "0%";
      $("progStepText").textContent = I18N[lang].prog_prep;
      $("statusBadgeText").textContent = I18N[lang].status_busy;
      setStep(2);
      showView("installing");
      try {
        await invoke("run_install", {
          installDir: dir,
          desktopShortcut: $("chkDesktop").checked,
          startMenuShortcut: $("chkStartMenu").checked,
          lang,
        });
      } catch (err) {
        showError(String(err));
        setStep(1);
        showView("setup");
      }
    });

    $("btnUninstall").addEventListener("click", async () => {
      showError("");
      $("progLog").textContent = "";
      $("progFill").style.width = "0%";
      $("progPctText").textContent = "0%";
      $("progStepText").textContent = I18N[lang].prog_prep;
      $("statusBadgeText").textContent = I18N[lang].status_busy;
      setStep(2);
      showView("installing");
      try {
        await invoke("run_uninstall", {
          installDir: finalInstallDir,
          removeUserData: $("chkRemoveData").checked,
          lang,
        });
      } catch (err) {
        showError(String(err));
        setStep(1);
        showView("uninstall");
      }
    });

    $("btnLaunch").addEventListener("click", async () => {
      await invoke("launch_app", { installDir: finalInstallDir });
    });

    await listen("install-progress", (event) => {
      const { percent, step, log } = event.payload || {};
      if (typeof percent === "number") {
        $("progFill").style.width = `${percent}%`;
        $("progPctText").textContent = `${percent}%`;
      }
      if (step) $("progStepText").textContent = step;
      if (log) appendLog(log);
    });

    await listen("install-done", (event) => {
      const dir = event.payload?.installDir || finalInstallDir;
      finalInstallDir = dir;
      $("donePathValue").textContent = dir;
      $("statusBadgeText").textContent = I18N[lang].status_done;
      setStep(3);
      showView("complete");
    });

    await listen("install-error", (event) => {
      const msg = String(event.payload || "Unknown error");
      $("statusBadgeText").textContent = I18N[lang].status_ready;
      showError(msg);
      setStep(1);
      showView(isUninstall ? "uninstall" : "setup");
    });

    try {
      const info = await invoke("get_installer_info");
      lang = info.lang === "en" ? "en" : "ru";
      isUninstall = Boolean(info.uninstall);
      isInstalled = Boolean(info.alreadyInstalled);
      finalInstallDir = info.installDir || "";
      $("installDirInput").value = finalInstallDir;
      $("unPathValue").textContent = finalInstallDir;
      applyLang();
      setStep(1);
      showView(isUninstall ? "uninstall" : "setup");
    } catch (err) {
      showError(String(err));
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
