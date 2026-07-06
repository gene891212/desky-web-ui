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

// --- DOM refs ---------------------------------------------------------------

const el = (id) => document.getElementById(id);

const heightDisplay = el("height-display");
const statusBadge = el("status-badge");
const statusText = el("status-text");
const movingIndicator = el("moving-speed-indicator");

const statusDot = el("status-dot");
const settingsStatusDot = el("settings-status-dot");

const thresholdSlider = el("threshold-slider");
const thresholdValDisplay = el("threshold-val-display");
const sitTimeSlider = el("sit-time-slider");
const sitTimeDisplay = el("sit-time-display");
const standTimeSlider = el("stand-time-slider");
const standTimeDisplay = el("stand-time-display");
const scheduleToggle = el("schedule-toggle");

// --- misc UI helpers ---------------------------------------------------------

function triggerVibration(duration = 15) {
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

  const dotClass = type === "success" ? "bg-emerald-400" : type === "error" ? "bg-rose-400" : "bg-indigo-400";
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

function handleState(data) {
  switch (data.id) {
    case "sensor-desk_height":
      heightDisplay.textContent = data.value.toFixed(1);
      break;

    case "binary_sensor-is_sitting":
      if (data.value) {
        statusText.textContent = "坐姿模式";
        statusBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-500/10 text-indigo-400 border border-indigo-900";
      } else {
        statusText.textContent = "站姿模式";
        statusBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/10 text-emerald-400 border border-emerald-900";
      }
      break;

    case "switch-work":
      if (!isEditing(scheduleToggle)) scheduleToggle.checked = !!data.value;
      break;

    case "number-stand_and_sit_height_threshold":
      if (!isEditing(thresholdSlider)) thresholdSlider.value = data.value;
      thresholdValDisplay.textContent = Number(data.value).toFixed(1);
      break;

    case "number-sitting_time":
      if (!isEditing(sitTimeSlider)) sitTimeSlider.value = data.value;
      sitTimeDisplay.textContent = `${data.value} 分`;
      break;

    case "number-standing_time":
      if (!isEditing(standTimeSlider)) standTimeSlider.value = data.value;
      standTimeDisplay.textContent = `${data.value} 分`;
      break;
  }
}

// --- SSE connection with retry ----------------------------------------------

let source = null;
let reconnectTimer = null;

function setConnected(connected) {
  const dotClass = connected ? "block w-3 h-3 rounded-full bg-emerald-500" : "block w-3 h-3 rounded-full bg-rose-500";
  statusDot.className = dotClass;
  settingsStatusDot.className = dotClass;
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
  if (direction) {
    movingIndicator.textContent = direction === "up" ? "上升中" : "下降中";
    movingIndicator.className = "text-right text-[10px] text-indigo-400 font-extrabold";
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
    triggerVibration(25);
    setMoving(direction);
    setSwitch(entityName, true);
  };

  const stop = () => {
    setMoving(null);
    setSwitch(entityName, false);
    triggerVibration(10);
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
  btn.addEventListener("click", async () => {
    triggerVibration(40);
    try {
      await pressButton(btn.dataset.button);
      showToast(`已發送移動至預設 ${btn.dataset.button} 的指令`, "success");
    } catch {
      showToast("發送失敗，請檢查連線", "error");
    }
  });
});

document.querySelectorAll(".ghost-save-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    triggerVibration(40);
    try {
      await pressButton(btn.dataset.button);
      showToast("已成功將目前高度儲存至記憶體", "success");
    } catch {
      showToast("儲存失敗，請檢查連線", "error");
    }
  });
});

el("btn-request").addEventListener("click", async () => {
  if (!cfg.host) {
    showToast("發送失敗：請先設定連線位址", "error");
    triggerVibration([50, 50]);
    return;
  }
  triggerVibration(30);
  showToast("正在發送喚醒命令，要求回報即時高度...", "info");
  try {
    await pressButton("Request Desk Height");
    triggerVibration([40, 20]);
    showToast("已發送高度回報請求", "success");
  } catch {
    showToast("發送失敗，請檢查連線", "error");
  }
});

// --- schedule switch & sliders ------------------------------------------------

scheduleToggle.addEventListener("change", () => {
  triggerVibration(30);
  setSwitch("Work", scheduleToggle.checked);
});

const setThreshold = debounce((v) => setNumber("Stand and Sit Height Threshold", v), 300);
thresholdSlider.addEventListener("input", () => {
  thresholdValDisplay.textContent = Number(thresholdSlider.value).toFixed(1);
  setThreshold(thresholdSlider.value);
});

const setSittingTime = debounce((v) => setNumber("Sitting Time", v), 300);
sitTimeSlider.addEventListener("input", () => {
  sitTimeDisplay.textContent = `${sitTimeSlider.value} 分`;
  setSittingTime(sitTimeSlider.value);
});

const setStandingTime = debounce((v) => setNumber("Standing Time", v), 300);
standTimeSlider.addEventListener("input", () => {
  standTimeDisplay.textContent = `${standTimeSlider.value} 分`;
  setStandingTime(standTimeSlider.value);
});

// --- view toggle (control <-> settings) --------------------------------------

const controlView = el("control-view");
const settingsView = el("settings-view");

function switchView(viewName) {
  triggerVibration(20);
  if (viewName === "settings") {
    controlView.classList.add("hidden");
    settingsView.classList.remove("hidden");
  } else {
    settingsView.classList.add("hidden");
    controlView.classList.remove("hidden");
  }
  setTimeout(() => lucide.createIcons(), 20);
}
window.switchView = switchView;

["dot-connect-btn", "settings-dot-connect-btn"].forEach((id) => {
  el(id).addEventListener("click", () => {
    triggerVibration(20);
    showToast("正在嘗試重新連線...", "info");
    connect();
  });
});

// --- settings panel -----------------------------------------------------------

el("input-desk-address").value = cfg.host;
el("input-username").value = cfg.user;
el("input-password").value = cfg.pass;

el("btn-save-settings").addEventListener("click", () => {
  cfg.host = el("input-desk-address").value.trim();
  cfg.user = el("input-username").value.trim();
  cfg.pass = el("input-password").value;
  localStorage.setItem("desky.host", cfg.host);
  localStorage.setItem("desky.user", cfg.user);
  localStorage.setItem("desky.pass", cfg.pass);
  triggerVibration(30);
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
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((reg) => reg.unregister());
    });
    if (window.caches) {
      caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
    }
  }
});
