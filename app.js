"use strict";

// --- config (persisted in localStorage) ---------------------------------

const cfg = {
  host: localStorage.getItem("desky.host") || "",
  user: localStorage.getItem("desky.user") || "",
  pass: localStorage.getItem("desky.pass") || "",
};

function baseUrl() {
  return `http://${cfg.host}`;
}

function authHeaders() {
  if (!cfg.user) return {};
  return { Authorization: "Basic " + btoa(`${cfg.user}:${cfg.pass}`) };
}

// --- generic API helpers ---------------------------------------------------

async function pressButton(name) {
  return fetch(`${baseUrl()}/button/${encodeURIComponent(name)}/press`, {
    method: "POST",
    headers: authHeaders(),
  });
}

async function setSwitch(name, on) {
  return fetch(`${baseUrl()}/switch/${encodeURIComponent(name)}/${on ? "turn_on" : "turn_off"}`, {
    method: "POST",
    headers: authHeaders(),
  });
}

async function setNumber(name, value) {
  return fetch(`${baseUrl()}/number/${encodeURIComponent(name)}/set?value=${encodeURIComponent(value)}`, {
    method: "POST",
    headers: authHeaders(),
  });
}

function debounce(fn, delay) {
  let handle;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), delay);
  };
}

// 依目前數值更新滑桿的已選取進度 (--fill CSS 變數)，讓軌道呈現填色效果
function syncRangeFill(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const val = Number(input.value);
  const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
  input.style.setProperty("--fill", `${Math.min(100, Math.max(0, pct))}%`);
}

// --- DOM refs ---------------------------------------------------------------

const el = (id) => document.getElementById(id);

const heightDisplay = el("height-display");
const statusBadge = el("status-badge");
const statusIconSlot = el("status-icon-slot");
const statusText = el("status-text");
const movingIndicator = el("moving-speed-indicator");
const heightHistoryLine = el("height-history-line");
const heightHistoryDot = el("height-history-dot");

const statusDot = el("status-dot");
const settingsStatusDot = el("settings-status-dot");
const settingsStatusText = el("settings-status-text");
const settingsHeightDisplay = el("settings-height-display");
const settingsStatusBadge = el("settings-status-badge");

const thresholdSlider = el("threshold-slider");
const thresholdValDisplay = el("threshold-val-display");
const sitTimeSlider = el("sit-time-slider");
const sitTimeDisplay = el("sit-time-display");
const standTimeSlider = el("stand-time-slider");
const standTimeDisplay = el("stand-time-display");
const scheduleToggle = el("schedule-toggle");

// --- misc UI helpers ---------------------------------------------------------

function triggerVibration(duration = 8) {
  if ("vibrate" in navigator) {
    navigator.vibrate(duration);
  }
}

function showToast(message, type = "info") {
  const container = el("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold shadow-md border backdrop-blur-md transition-all duration-300 transform translate-y-4 opacity-0 pointer-events-auto";

  if (type === "success") {
    toast.className += " bg-emerald-950/95 text-emerald-300 border-emerald-900/50";
  } else if (type === "error") {
    toast.className += " bg-rose-950/95 text-rose-300 border-rose-900/50";
  } else {
    toast.className += " bg-slate-900/95 text-slate-300 border-slate-800";
  }

  const dotClass = type === "success" ? "bg-emerald-400" : type === "error" ? "bg-rose-400" : "bg-brand-400";
  toast.innerHTML = `<span class="w-1.5 h-1.5 rounded-full ${dotClass}"></span><span></span>`;
  toast.querySelector("span:last-child").textContent = message;

  container.appendChild(toast);

  setTimeout(() => toast.classList.remove("translate-y-4", "opacity-0"), 10);
  setTimeout(() => {
    toast.classList.add("translate-y-4", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// --- state -> UI ------------------------------------------------------------

function isEditing(input) {
  return document.activeElement === input;
}

function setStatusIcon(iconName) {
  if (!statusIconSlot) return;
  statusIconSlot.innerHTML = `<i data-lucide="${iconName}" class="w-3.5 h-3.5" stroke-width="1.75"></i>`;
  lucide.createIcons();
}

const heightHistoryLimit = 300;
const heightHistory = Array(heightHistoryLimit).fill(null);
let lastPushTime = 0;

function getBezierPath(points) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  
  let d = `M ${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  if (points.length === 2) {
    d += ` L ${points[1].x.toFixed(2)},${points[1].y.toFixed(2)}`;
    return d;
  }
  
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

function smoothPoints(points, windowSize = 5) {
  if (points.length <= windowSize) return points;
  const smoothed = [];
  const half = Math.floor(windowSize / 2);
  
  for (let i = 0; i < points.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    
    for (let w = -half; w <= half; w++) {
      const idx = i + w;
      if (idx >= 0 && idx < points.length) {
        sumX += points[idx].x;
        sumY += points[idx].y;
        count++;
      }
    }
    smoothed.push({ x: sumX / count, y: sumY / count });
  }
  return smoothed;
}

function updateHeightHistory(value) {
  if (!heightHistoryLine || !Number.isFinite(value)) return;

  const now = Date.now();
  const lastVal = heightHistory[heightHistory.length - 1];
  const values = heightHistory.filter(Number.isFinite);

  if (values.length === 0) {
    heightHistory.fill(value);
    lastPushTime = now;
  } else if (value !== lastVal && now - lastPushTime > 800) {
    heightHistory.push(value);
    if (heightHistory.length > heightHistoryLimit) heightHistory.shift();
    lastPushTime = now;
  } else {
    // Real-time update of the last point
    heightHistory[heightHistory.length - 1] = value;
  }

  const heightHistoryArea = el("height-history-area");
  if (values.length <= 1) {
    heightHistoryLine.setAttribute("d", "M 0,50 L 100,50");
    if (heightHistoryArea) heightHistoryArea.setAttribute("d", "M 0,50 L 100,50 L 100,100 L 0,100 Z");
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1.5);
  const isFlat = max === min;
  const points = heightHistory.map((height, index) => {
    if (!Number.isFinite(height)) return null;

    const x = (index / (heightHistoryLimit - 1)) * 100;
    const y = isFlat ? 50 : 90 - ((height - min) / range) * 80;
    return { x, y };
  }).filter(Boolean);

  const lastPoint = points[points.length - 1];
  const smoothed = smoothPoints(points, 5);
  const pathD = getBezierPath(smoothed);

  heightHistoryLine.setAttribute("d", pathD);
  if (heightHistoryArea) {
    const firstX = smoothed[0].x;
    const lastX = smoothed[smoothed.length - 1].x;
    const areaD = pathD + ` L ${lastX.toFixed(2)},100 L ${firstX.toFixed(2)},100 Z`;
    heightHistoryArea.setAttribute("d", areaD);
  }
  if (heightHistoryDot) {
    heightHistoryDot.setAttribute("cx", lastPoint.x.toFixed(2));
    heightHistoryDot.setAttribute("cy", lastPoint.y.toFixed(2));
  }
}

// 定時補點：每 5 秒將當前高度補入歷史，填補靜止期間的空白
setInterval(() => {
  const currentHeight = parseFloat(heightDisplay.textContent);
  if (!Number.isFinite(currentHeight)) return;

  heightHistory.push(currentHeight);
  if (heightHistory.length > heightHistoryLimit) heightHistory.shift();
  lastPushTime = Date.now();
  updateHeightHistory(currentHeight);
}, 4 * 60 * 1000);

function handleState(data) {
  switch (data.id) {
    case "sensor-desk_height":
      {
        const height = Number(data.value);
        if (Number.isFinite(height)) {
          heightDisplay.textContent = height.toFixed(1);
          if (settingsHeightDisplay) settingsHeightDisplay.textContent = height.toFixed(1);
          updateHeightHistory(height);
        }
      }
      break;

    case "binary_sensor-is_sitting":
      if (data.value) {
        setStatusIcon("accessibility");
        statusText.textContent = "坐姿模式";
        statusBadge.className = "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-brand-950 text-brand-400 border border-brand-900/60";
        if (settingsStatusBadge) {
          settingsStatusBadge.textContent = "坐姿";
          settingsStatusBadge.className = "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-950 text-brand-400 border border-brand-900/60";
        }
      } else {
        setStatusIcon("person-standing");
        statusText.textContent = "站姿模式";
        statusBadge.className = "inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-900/60";
        if (settingsStatusBadge) {
          settingsStatusBadge.textContent = "站姿";
          settingsStatusBadge.className = "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-900/60";
        }
      }
      break;

    case "switch-work":
      if (!isEditing(scheduleToggle)) scheduleToggle.checked = !!data.value;
      break;

    case "number-stand_and_sit_height_threshold":
      if (!isEditing(thresholdSlider)) {
        thresholdSlider.value = data.value;
        syncRangeFill(thresholdSlider);
      }
      thresholdValDisplay.textContent = Number(data.value).toFixed(1);
      break;

    case "number-sitting_time":
      if (!isEditing(sitTimeSlider)) {
        sitTimeSlider.value = data.value;
        syncRangeFill(sitTimeSlider);
      }
      sitTimeDisplay.textContent = data.value;
      break;

    case "number-standing_time":
      if (!isEditing(standTimeSlider)) {
        standTimeSlider.value = data.value;
        syncRangeFill(standTimeSlider);
      }
      standTimeDisplay.textContent = data.value;
      break;
  }
}

// --- SSE connection with retry ----------------------------------------------

let source = null;
let reconnectTimer = null;

function setConnected(connected) {
  if (statusDot) {
    // 用 classList 增減而非整串覆寫 className，避免蓋掉 switchView() 加上的 hidden class
    statusDot.classList.remove("bg-emerald-500", "bg-rose-500", "status-live");
    statusDot.classList.add(connected ? "bg-emerald-500" : "bg-rose-500");
    if (connected) statusDot.classList.add("status-live");
  }
  if (settingsStatusDot) {
    settingsStatusDot.className = connected
      ? "block w-2.5 h-2.5 rounded-full bg-emerald-500 status-live"
      : "block w-2.5 h-2.5 rounded-full bg-rose-500";
  }
  if (settingsStatusText) {
    settingsStatusText.textContent = connected ? "已連線" : "未連線";
    settingsStatusText.className = connected 
      ? "text-xs font-bold text-emerald-500" 
      : "text-xs font-bold text-rose-500";
  }
}

function connect() {
  if (!cfg.host) {
    setConnected(false);
    return;
  }

  if (source) source.close();
  clearTimeout(reconnectTimer);

  source = new EventSource(`${baseUrl()}/events`);

  source.addEventListener("state", (e) => {
    setConnected(true);
    handleState(JSON.parse(e.data));
  });

  source.addEventListener("ping", () => setConnected(true));

  source.onerror = () => {
    setConnected(false);
    source.close();
    reconnectTimer = setTimeout(connect, 3000);
  };
}

// --- move buttons (Raise / Lower switches) -----------------------------------

function setMoving(direction) {
  if (!movingIndicator) return;
  if (direction) {
    movingIndicator.textContent = direction === "up" ? "上升中" : "下降中";
    movingIndicator.className = "text-right text-[10px] text-brand-400 font-bold";
  } else {
    movingIndicator.textContent = "靜止";
    movingIndicator.className = "text-right text-[10px] text-slate-500 font-bold";
  }
}

function wireHoldButton(buttonId, entityName, direction) {
  const btn = el(buttonId);

  const start = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!cfg.host) {
      showToast("無法操作：尚未設定連線位址", "error");
      return;
    }
    triggerVibration(12);
    setMoving(direction);
    setSwitch(entityName, true);
  };

  const stop = () => {
    setMoving(null);
    setSwitch(entityName, false);
    triggerVibration(6);
  };

  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointerleave", stop);
  btn.addEventListener("pointercancel", stop);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

wireHoldButton("btn-raise", "Raise Desk", "up");
wireHoldButton("btn-lower", "Lower Desk", "down");

// --- preset / memory buttons --------------------------------------------------

document.querySelectorAll(".preset-recall").forEach((btn) => {
  // 觸碰按下的一瞬間立刻震動，提升即時感
  btn.addEventListener("pointerdown", () => triggerVibration(12));
  btn.addEventListener("click", async () => {
    try {
      await pressButton(btn.dataset.button);
      showToast(`移動至 ${btn.dataset.button}`, "info");
    } catch {
      showToast("發送失敗，請檢查連線", "error");
    }
  });
});

document.querySelectorAll(".ghost-save-btn").forEach((btn) => {
  // 觸碰按下的一瞬間立刻震動
  btn.addEventListener("pointerdown", () => triggerVibration(12));
  btn.addEventListener("click", async () => {
    try {
      await pressButton(btn.dataset.button);
      showToast("已成功將目前高度儲存至記憶體", "info");
    } catch {
      showToast("儲存失敗，請檢查連線", "error");
    }
  });
});

el("btn-request").addEventListener("pointerdown", () => {
  if (!cfg.host) {
    triggerVibration([20, 30, 20]);
  } else {
    triggerVibration(12);
  }
});
el("btn-request").addEventListener("click", async () => {
  if (!cfg.host) {
    showToast("發送失敗：請先設定連線位址", "error");
    return;
  }
  try {
    await pressButton("Request Desk Height");
    triggerVibration([10, 20]);
    showToast("已發送高度回報請求", "info");
  } catch {
    showToast("發送失敗，請檢查連線", "error");
  }
});

// --- schedule switch & sliders ------------------------------------------------

scheduleToggle.addEventListener("change", () => {
  triggerVibration(12);
  const state = scheduleToggle.checked;
  showToast(`已${state ? "開啟" : "關閉"}坐站排程`, "info");
  setSwitch("Work", state).catch(() => {
    showToast("發送失敗，請檢查連線", "error");
  });
});

const setThreshold = debounce((v) => setNumber("Stand and Sit Height Threshold", v), 300);
thresholdSlider.addEventListener("input", () => {
  thresholdValDisplay.textContent = Number(thresholdSlider.value).toFixed(1);
  syncRangeFill(thresholdSlider);
  setThreshold(thresholdSlider.value);
});

const setSittingTime = debounce((v) => setNumber("Sitting Time", v), 300);
sitTimeSlider.addEventListener("input", () => {
  sitTimeDisplay.textContent = sitTimeSlider.value;
  syncRangeFill(sitTimeSlider);
  setSittingTime(sitTimeSlider.value);
});

const setStandingTime = debounce((v) => setNumber("Standing Time", v), 300);
standTimeSlider.addEventListener("input", () => {
  standTimeDisplay.textContent = standTimeSlider.value;
  syncRangeFill(standTimeSlider);
  setStandingTime(standTimeSlider.value);
});

[thresholdSlider, sitTimeSlider, standTimeSlider].forEach(syncRangeFill);

// --- view toggle (control <-> settings) --------------------------------------

const controlView = el("control-view");
const settingsView = el("settings-view");

function switchView(viewName) {
  triggerVibration(8);
  if (viewName === "settings") {
    controlView.classList.add("hidden");
    settingsView.classList.remove("hidden");
    if (statusDot) statusDot.classList.add("hidden");
  } else {
    settingsView.classList.add("hidden");
    controlView.classList.remove("hidden");
    if (statusDot) statusDot.classList.remove("hidden");
  }
  setTimeout(() => lucide.createIcons(), 20);
}
window.switchView = switchView;

["dot-connect-btn", "settings-dot-connect-btn"].forEach((id) => {
  const btn = el(id);
  if (btn) {
    btn.addEventListener("pointerdown", () => triggerVibration(8));
    btn.addEventListener("click", () => {
      showToast("正在嘗試重新連線...", "info");
      connect();
    });
  }
});

// --- settings panel -----------------------------------------------------------

el("input-desk-address").value = cfg.host;
el("input-username").value = cfg.user;
el("input-password").value = cfg.pass;

el("btn-save-settings").addEventListener("pointerdown", () => triggerVibration(12));
el("btn-save-settings").addEventListener("click", () => {
  cfg.host = el("input-desk-address").value.trim();
  cfg.user = el("input-username").value.trim();
  cfg.pass = el("input-password").value;
  localStorage.setItem("desky.host", cfg.host);
  localStorage.setItem("desky.user", cfg.user);
  localStorage.setItem("desky.pass", cfg.pass);
  showToast("設定已儲存，正在重新連線...", "info");
  connect();
});

// --- init ---------------------------------------------------------------------

window.addEventListener("load", () => {
  lucide.createIcons();
  connect();

  // Service worker registration is disabled during development so edits show
  // up immediately. Also unregister any previously installed SW and drop its
  // caches. Re-enable by swapping this back to navigator.serviceWorker.register("sw.js").
  if ("serviceWorker" in navigator) {
    // navigator.serviceWorker.getRegistrations().then((regs) => {
    //   regs.forEach((reg) => reg.unregister());
    // });
    // if (window.caches) {
    //   caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
    // }
    navigator.serviceWorker.register("sw.js")
      .then((reg) => console.log("Service Worker 註冊成功", reg))
      .catch((err) => console.warn("Service Worker 註冊失敗", err));
  }
});
