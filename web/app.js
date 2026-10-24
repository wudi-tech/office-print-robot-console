const FLOOR_CONFIG_URL = "./config/office_3f.json";

const FALLBACK_FLOOR_CONFIG = {
  id: "office_3f",
  name: "3F 工位与设备",
  floor: "3F 办公区",
  uiMap: {
    viewBox: { width: 900, height: 520 },
    image: "",
    imageBounds: { x: 24, y: 34, width: 852, height: 452 }
  },
  route: {
    verticalCorridors: [250, 610],
    horizontalCorridors: [130, 330]
  },
  stations: [
    { id: "A-01", label: "研发 A-01", type: "desk", marker: "A", selectable: true, ui: { x: 188, y: 151 }, ros: { x: 1.2, y: 2.4, yaw: 1.57 } },
    { id: "B-03", label: "财务 B-03", type: "desk", marker: "B", selectable: true, ui: { x: 188, y: 330 }, ros: { x: 1.2, y: 0.1, yaw: 1.57 } },
    { id: "F-00", label: "前台 F-00", type: "desk", marker: "F", selectable: true, ui: { x: 188, y: 434 }, ros: { x: 1.2, y: -1.2, yaw: 1.57 } },
    { id: "M-01", label: "会议室 M-01", type: "desk", marker: "M", selectable: true, ui: { x: 466, y: 151 }, ros: { x: 4.1, y: 2.4, yaw: 1.57 } },
    { id: "C-05", label: "产品 C-05", type: "desk", marker: "C", selectable: true, ui: { x: 466, y: 330 }, ros: { x: 4.1, y: 0.1, yaw: 1.57 } },
    { id: "D-02", label: "设计 D-02", type: "desk", marker: "D", selectable: true, ui: { x: 466, y: 434 }, ros: { x: 4.1, y: -1.2, yaw: 1.57 } },
    { id: "E-04", label: "行政 E-04", type: "desk", marker: "E", selectable: true, ui: { x: 782, y: 330 }, ros: { x: 7.5, y: 0.1, yaw: 3.14 } },
    { id: "CHG", label: "充电点", type: "dock", marker: "电", selectable: false, ui: { x: 782, y: 434 }, ros: { x: 7.5, y: -1.2, yaw: 3.14 } }
  ]
};

let WORKSTATIONS = normalizeStations(FALLBACK_FLOOR_CONFIG.stations);

const STATE_LABELS = {
  offline: "离线",
  idle: "待命",
  queued: "排队中",
  printing: "打印中",
  printing_en_route: "边走边打印",
  navigating_to_target: "前往工位",
  awaiting_manual_print: "待人工打印",
  delivering: "配送中",
  charging: "充电中",
  done: "已完成",
  canceled: "已取消",
  error: "异常"
};

const DEFAULT_STATUS = {
  robot: {
    state: "idle",
    floor: "3F 办公区",
    location: "A 区走廊",
    x: 782,
    y: 151,
    battery: 86,
    speed: 0
  },
  printer: {
    state: "idle",
    activeJobId: "",
    queueLength: 0,
    waitSeconds: 0,
    progress: 0
  },
  network: {
    ip: "192.168.1.20",
    rssi: -55
  },
  updatedAt: new Date().toISOString()
};

const ACTIVE_JOB_STATUSES = ["queued", "printing", "printing_en_route", "navigating_to_target", "delivering", "awaiting_manual_print"];
const STORAGE_KEY = "printRobotConsoleSettings";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  connectionPill: $("#connectionPill"),
  connectionText: $("#connectionText"),
  refreshButton: $("#refreshButton"),
  connectButton: $("#connectButton"),
  connectDialog: $("#connectDialog"),
  settingsForm: $("#settingsForm"),
  modeSelect: $("#modeSelect"),
  apiBaseInput: $("#apiBaseInput"),
  rosbridgeInput: $("#rosbridgeInput"),
  statusTopicInput: $("#statusTopicInput"),
  disconnectButton: $("#disconnectButton"),
  targetStation: $("#targetStation"),
  floorMapTitle: $("#floorMapTitle"),
  mapTitle: $("#mapTitle"),
  floorMapSvg: $("#floorMapSvg"),
  mapBackgroundImage: $("#mapBackgroundImage"),
  demoMapLayer: $("#demoMapLayer"),
  stationMarkers: $("#stationMarkers"),
  robotMarker: $("#robotMarker"),
  routeLine: $("#routeLine"),
  robotStateBadge: $("#robotStateBadge"),
  jobForm: $("#jobForm"),
  submitButton: $("#submitJobButton"),
  connectionGuard: $("#connectionGuard"),
  fileInput: $("#fileInput"),
  fileLabel: $("#fileLabel"),
  dropZone: $("#dropZone"),
  resetFormButton: $("#resetFormButton"),
  regenCodeButton: $("#regenCodeButton"),
  pickupCode: $("#pickupCode"),
  jobsList: $("#jobsList"),
  toast: $("#toast"),
  locationValue: $("#locationValue"),
  floorValue: $("#floorValue"),
  printerValue: $("#printerValue"),
  activeJobValue: $("#activeJobValue"),
  waitValue: $("#waitValue"),
  queueValue: $("#queueValue"),
  batteryValue: $("#batteryValue"),
  networkValue: $("#networkValue")
};

const state = {
  settings: loadSettings(),
  floorConfig: structuredClone(FALLBACK_FLOOR_CONFIG),
  status: structuredClone(DEFAULT_STATUS),
  jobs: [],
  activeFilter: "all",
  connection: "offline",
  pollTimer: null,
  mockTimer: null,
  rosSocket: null,
  toastTimer: null,
  offlineToastShown: false
};

init();

async function init() {
  await loadFloorConfig();
  applyFloorConfig();
  populateStations();
  renderStationMarkers();
  bindEvents();
  applySettingsToForm();
  generatePickupCode();
  renderStatus();
  renderJobs();
  connect();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function loadSettings() {
  const fallbackApi = getDefaultApiBase();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      mode: parsed.mode || "mock",
      apiBase: parsed.apiBase || fallbackApi,
      rosbridgeUrl: parsed.rosbridgeUrl || "",
      statusTopic: parsed.statusTopic || "/print_robot/status"
    };
  } catch {
    return {
      mode: "mock",
      apiBase: fallbackApi,
      rosbridgeUrl: "",
      statusTopic: "/print_robot/status"
    };
  }
}

function getDefaultApiBase() {
  if (location.protocol === "file:") return "http://192.168.1.20:8080";
  return `http://${location.hostname || "localhost"}:8080`;
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

async function loadFloorConfig() {
  try {
    const response = await fetch(FLOOR_CONFIG_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error("floor config not found");
    state.floorConfig = normalizeFloorConfig(await response.json());
    WORKSTATIONS = state.floorConfig.stations;
  } catch {
    state.floorConfig = normalizeFloorConfig(FALLBACK_FLOOR_CONFIG);
    WORKSTATIONS = state.floorConfig.stations;
  }
}

function normalizeFloorConfig(config) {
  const normalized = {
    ...structuredClone(FALLBACK_FLOOR_CONFIG),
    ...config,
    uiMap: {
      ...FALLBACK_FLOOR_CONFIG.uiMap,
      ...(config.uiMap || {}),
      viewBox: {
        ...FALLBACK_FLOOR_CONFIG.uiMap.viewBox,
        ...(config.uiMap?.viewBox || {})
      },
      imageBounds: {
        ...FALLBACK_FLOOR_CONFIG.uiMap.imageBounds,
        ...(config.uiMap?.imageBounds || {})
      }
    },
    route: {
      ...FALLBACK_FLOOR_CONFIG.route,
      ...(config.route || {})
    }
  };
  normalized.stations = normalizeStations(config.stations || FALLBACK_FLOOR_CONFIG.stations);
  return normalized;
}

function normalizeStations(stations) {
  return stations.map((station) => ({
    ...station,
    type: station.type || "desk",
    selectable: station.selectable !== false,
    x: Number(station.ui?.x ?? station.x ?? 0),
    y: Number(station.ui?.y ?? station.y ?? 0),
    marker: station.marker || station.id.split("-")[0]
  }));
}

function applyFloorConfig() {
  const { floorConfig } = state;
  const { viewBox, image, imageBounds } = floorConfig.uiMap;
  elements.floorMapTitle.textContent = floorConfig.name || "工位与设备";
  elements.mapTitle.textContent = `${floorConfig.floor || ""} ${floorConfig.name || "工位地图"}`.trim();
  elements.floorMapSvg.setAttribute("viewBox", `0 0 ${viewBox.width} ${viewBox.height}`);
  state.status.robot.floor = floorConfig.floor || state.status.robot.floor;

  const homeStation = WORKSTATIONS.find((item) => item.type === "dock") || WORKSTATIONS[0];
  if (homeStation) {
    state.status.robot.location = homeStation.label;
    state.status.robot.x = homeStation.x;
    state.status.robot.y = homeStation.y;
  }

  if (image) {
    elements.mapBackgroundImage.setAttribute("href", image);
    elements.mapBackgroundImage.setAttribute("x", imageBounds.x);
    elements.mapBackgroundImage.setAttribute("y", imageBounds.y);
    elements.mapBackgroundImage.setAttribute("width", imageBounds.width);
    elements.mapBackgroundImage.setAttribute("height", imageBounds.height);
    elements.mapBackgroundImage.classList.add("visible");
    elements.demoMapLayer.style.display = "none";
  } else {
    elements.mapBackgroundImage.classList.remove("visible");
    elements.demoMapLayer.style.display = "";
  }
}

function populateStations() {
  elements.targetStation.innerHTML = WORKSTATIONS.filter((item) => item.selectable)
    .map((item) => `<option value="${item.id}">${item.label}</option>`)
    .join("");
}

function renderStationMarkers() {
  elements.stationMarkers.innerHTML = WORKSTATIONS.map((item) => {
    const cls = item.type === "dock" ? "dock" : "";
    return `
      <g class="station-marker ${cls}" data-station="${item.id}" transform="translate(${item.x} ${item.y})">
        <circle r="15"></circle>
        <text y="1">${escapeHtml(item.marker)}</text>
      </g>
    `;
  }).join("");
}

function bindEvents() {
  elements.connectButton.addEventListener("click", () => {
    applySettingsToForm();
    elements.connectDialog.showModal();
  });

  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings = {
      mode: elements.modeSelect.value,
      apiBase: sanitizeBaseUrl(elements.apiBaseInput.value),
      rosbridgeUrl: elements.rosbridgeInput.value.trim(),
      statusTopic: elements.statusTopicInput.value.trim() || "/print_robot/status"
    };
    saveSettings();
    elements.connectDialog.close();
    connect();
  });

  elements.disconnectButton.addEventListener("click", () => {
    disconnect();
    applySettingsToForm();
    showToast("已断开真实连接");
  });

  elements.refreshButton.addEventListener("click", refreshNow);
  elements.targetStation.addEventListener("change", renderRoute);

  elements.jobForm.addEventListener("submit", submitJob);
  elements.resetFormButton.addEventListener("click", resetForm);
  elements.regenCodeButton.addEventListener("click", generatePickupCode);

  elements.fileInput.addEventListener("change", updateFileLabel);
  ["dragenter", "dragover"].forEach((name) => {
    elements.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("dragging");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    elements.dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("dragging");
    });
  });
  elements.dropZone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (!file) return;
    elements.fileInput.files = event.dataTransfer.files;
    updateFileLabel();
  });

  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeFilter = button.dataset.filter;
      $$(".tab").forEach((item) => item.classList.toggle("active", item === button));
      renderJobs();
    });
  });
}

function applySettingsToForm() {
  elements.modeSelect.value = state.settings.mode;
  elements.apiBaseInput.value = state.settings.apiBase;
  elements.rosbridgeInput.value = state.settings.rosbridgeUrl;
  elements.statusTopicInput.value = state.settings.statusTopic;
}

function sanitizeBaseUrl(value) {
  const trimmed = value.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function connect() {
  disconnectTimers();
  if (state.rosSocket) {
    state.rosSocket.close();
    state.rosSocket = null;
  }
  if (state.settings.mode === "mock") {
    state.status = createDemoStatus();
    state.jobs = [];
    seedMockJobs();
    setConnection("warning", "演示模式");
    startMockLoop();
    renderStatus();
    renderJobs();
    return;
  }

  clearRealtimeData();
  setConnection("warning", "连接中");
  pollRdk({ showError: true });
  state.pollTimer = window.setInterval(pollRdk, 3000);

  if (state.settings.rosbridgeUrl) {
    connectRosbridge();
  }
}

function disconnect() {
  disconnectTimers();
  if (state.rosSocket) {
    state.rosSocket.close();
    state.rosSocket = null;
  }
  clearRealtimeData();
  setConnection("warning", "已断开");
}

function disconnectTimers() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.mockTimer) {
    window.clearInterval(state.mockTimer);
    state.mockTimer = null;
  }
}

async function pollRdk(options = {}) {
  if (state.settings.mode !== "rdk") return;
  const apiBase = sanitizeBaseUrl(state.settings.apiBase || "");
  if (!apiBase) {
    handleRdkOffline("请先填写 RDK X5 HTTP API 地址", options.showError);
    return;
  }

  try {
    const healthResponse = await fetch(`${apiBase}/api/health`, { cache: "no-store" });
    if (!healthResponse.ok) throw new Error("RDK health check failed");
    const healthPayload = await healthResponse.json();
    if (!isRdkBridgeHealth(healthPayload)) {
      throw new Error("当前地址不是 RDK X5 print_robot_bridge");
    }

    const [statusResponse, jobsResponse] = await Promise.all([
      fetch(`${apiBase}/api/status`, { cache: "no-store" }),
      fetch(`${apiBase}/api/jobs`, { cache: "no-store" })
    ]);
    if (!statusResponse.ok || !jobsResponse.ok) {
      throw new Error("RDK API returned an error");
    }
    state.offlineToastShown = false;
    setConnection("connected", "桥接 API 已连接");
    const statusPayload = await statusResponse.json();
    const jobsPayload = await jobsResponse.json();
    applyStatusPayload(statusPayload);
    state.jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
    renderJobs();
  } catch (error) {
    handleRdkOffline(error.message, options.showError);
  }
}

function isRdkBridgeHealth(payload = {}) {
  return payload.ok === true && payload.name === "print_robot_bridge";
}

function handleRdkOffline(message, showError = false) {
  clearRealtimeData();
  setConnection("warning", "RDK 离线");
  if (showError || !state.offlineToastShown) {
    showToast(message ? `无法连接 RDK X5：${message}` : "无法连接 RDK X5，真实任务已锁定");
    state.offlineToastShown = true;
  }
}

function connectRosbridge() {
  try {
    state.rosSocket = new WebSocket(state.settings.rosbridgeUrl);
  } catch {
    showToast("rosbridge 地址无效");
    return;
  }

  state.rosSocket.addEventListener("open", () => {
    state.rosSocket.send(
      JSON.stringify({
        op: "subscribe",
        id: "status-subscription",
        topic: state.settings.statusTopic,
        type: "std_msgs/msg/String",
        throttle_rate: 500
      })
    );
    if (!isRdkConnected()) {
      setConnection("warning", "等待 RDK API");
    }
  });

  state.rosSocket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.op !== "publish") return;
      const msg = payload.msg?.data ? JSON.parse(payload.msg.data) : payload.msg;
      applyStatusPayload(msg);
    } catch {
      showToast("收到 ROS2 状态消息，但格式不是预期 JSON");
    }
  });

  state.rosSocket.addEventListener("close", () => {
    if (state.settings.mode === "rdk" && !isRdkConnected()) {
      setConnection("warning", "ROS2 已断开");
    }
  });
}

function refreshNow() {
  if (state.settings.mode === "mock") {
    tickMock();
    showToast("演示状态已刷新");
  } else {
    pollRdk({ showError: true });
  }
}

function applyStatusPayload(payload = {}) {
  const robot = payload.robot || payload;
  const printer = payload.printer || {};
  const network = payload.network || {};
  state.status = {
    robot: {
      ...state.status.robot,
      state: robot.state || state.status.robot.state,
      floor: robot.floor || state.status.robot.floor,
      location: robot.location || state.status.robot.location,
      x: Number(robot.x ?? robot.mapX ?? state.status.robot.x),
      y: Number(robot.y ?? robot.mapY ?? state.status.robot.y),
      battery: Number(robot.battery ?? state.status.robot.battery),
      speed: Number(robot.speed ?? state.status.robot.speed)
    },
    printer: {
      ...state.status.printer,
      state: printer.state || payload.printerState || state.status.printer.state,
      activeJobId: printer.activeJobId || payload.activeJobId || "",
      queueLength: Number(printer.queueLength ?? payload.queueLength ?? state.jobs.length),
      waitSeconds: Number(printer.waitSeconds ?? payload.waitSeconds ?? 0),
      progress: Number(printer.progress ?? state.status.printer.progress)
    },
    network: {
      ...state.status.network,
      ip: network.ip || payload.ip || state.status.network.ip,
      rssi: Number(network.rssi ?? payload.rssi ?? state.status.network.rssi)
    },
    updatedAt: payload.updatedAt || new Date().toISOString()
  };

  if (Array.isArray(payload.jobs)) {
    state.jobs = payload.jobs;
    renderJobs();
  }
  renderStatus();
}

function renderStatus() {
  const { robot, printer, network } = state.status;
  const realtimeOffline = state.settings.mode === "rdk" && !isRdkConnected();
  elements.locationValue.textContent = robot.location || "未连接 RDK X5";
  elements.floorValue.textContent = robot.floor || state.floorConfig.floor || "--";
  elements.printerValue.textContent = STATE_LABELS[printer.state] || printer.state || "待机";
  elements.activeJobValue.textContent = printer.activeJobId ? `当前 ${printer.activeJobId}` : "无正在打印任务";
  elements.waitValue.textContent = formatWait(printer.waitSeconds);
  elements.queueValue.textContent = `队列 ${printer.queueLength || state.jobs.filter(isActiveJob).length} 个任务`;
  elements.batteryValue.textContent = formatBattery(robot.battery);
  elements.networkValue.textContent = formatNetwork(network);
  elements.robotStateBadge.textContent = STATE_LABELS[robot.state] || robot.state || "待命";
  elements.robotMarker.setAttribute("transform", `translate(${robot.x} ${robot.y})`);
  elements.robotMarker.classList.toggle("offline", realtimeOffline);
  elements.routeLine.classList.toggle("offline", realtimeOffline);
  renderRoute();
}

function renderRoute() {
  const from = state.status.robot;
  const target = getRouteTarget();
  elements.routeLine.setAttribute("d", buildRoute(from, target));
  $$(".station-marker").forEach((item) => {
    item.classList.toggle("target", item.dataset.station === target.id);
  });
}

function getRouteTarget() {
  const activeJob = state.jobs.find((job) => ACTIVE_JOB_STATUSES.includes(job.status) && job.status !== "queued");
  const targetId = activeJob?.targetStation || elements.targetStation.value || "C-05";
  return WORKSTATIONS.find((item) => item.id === targetId) || WORKSTATIONS.find((item) => item.selectable) || WORKSTATIONS[0];
}

function buildRoute(from, to) {
  const verticalCorridors = state.floorConfig.route.verticalCorridors?.length ? state.floorConfig.route.verticalCorridors : [250, 610];
  const horizontalCorridors = state.floorConfig.route.horizontalCorridors?.length ? state.floorConfig.route.horizontalCorridors : [130, 330];
  const corridorX = nearestCorridor(from.x, verticalCorridors);
  const corridorY = nearestCorridor(to.y, horizontalCorridors);
  return `M${from.x} ${from.y} L${corridorX} ${from.y} L${corridorX} ${corridorY} L${to.x} ${corridorY} L${to.x} ${to.y}`;
}

function nearestCorridor(value, corridors) {
  return corridors.reduce((nearest, current) =>
    Math.abs(current - value) < Math.abs(nearest - value) ? current : nearest
  );
}

function formatWait(seconds) {
  if (!seconds) return "0 分钟";
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.ceil(seconds / 60)} 分钟`;
}

function formatNetwork(network = {}) {
  if (!network.ip || network.ip === "未连接") return "未连接";
  if (!Number.isFinite(Number(network.rssi))) return network.ip;
  return `${network.ip} / WiFi ${network.rssi} dBm`;
}

function formatBattery(value) {
  if (value === null || value === undefined || value === "") return "--";
  const battery = Number(value);
  return Number.isFinite(battery) ? `${Math.round(battery)}%` : "--";
}

function updateFileLabel() {
  const [file] = elements.fileInput.files;
  elements.fileLabel.textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "选择或拖入文件";
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function submitJob(event) {
  event.preventDefault();
  if (state.settings.mode !== "mock" && !isRdkConnected()) {
    showToast("未连接 RDK X5，不能下发真实任务");
    return;
  }

  const formData = new FormData(elements.jobForm);
  const file = formData.get("file");
  if (!file || !file.name) {
    showToast("请选择需要打印的文件");
    return;
  }

  formData.set("pickupCode", elements.pickupCode.value);
  formData.set("submittedAt", new Date().toISOString());

  if (state.settings.mode === "mock") {
    const job = createJobFromForm(formData);
    state.jobs.unshift(job);
    updateQueueEstimate();
    renderJobs();
    showToast("任务已加入演示队列");
    resetForm();
    return;
  }

  try {
    const response = await fetch(`${state.settings.apiBase}/api/jobs`, {
      method: "POST",
      body: formData
    });
    if (!response.ok) throw new Error("submit failed");
    const payload = await response.json();
    if (payload.job) {
      state.jobs.unshift(payload.job);
      renderJobs();
    }
    showToast("任务已下发到 RDK X5");
    resetForm();
    pollRdk();
  } catch {
    showToast("任务下发失败，请检查 RDK X5 HTTP API");
  }
}

function createJobFromForm(formData) {
  const file = formData.get("file");
  const station = WORKSTATIONS.find((item) => item.id === formData.get("targetStation"));
  return {
    id: `JOB-${Date.now().toString().slice(-6)}`,
    fileName: file.name,
    fileSize: file.size,
    recipient: formData.get("recipient"),
    targetStation: formData.get("targetStation"),
    targetLabel: station?.label || formData.get("targetStation"),
    targetPose: station?.ros || null,
    targetUi: station?.ui || { x: station?.x, y: station?.y },
    pickupCode: formData.get("pickupCode"),
    status: "queued",
    progress: 0,
    printSettings: {
      copies: Number(formData.get("copies") || 1),
      pages: formData.get("pages") || "全部",
      colorMode: formData.get("colorMode"),
      duplex: formData.get("duplex"),
      paperSize: formData.get("paperSize"),
      priority: formData.get("priority"),
      printMode: formData.get("printMode")
    },
    createdAt: new Date().toISOString()
  };
}

function resetForm() {
  elements.jobForm.reset();
  elements.fileLabel.textContent = "选择或拖入文件";
  generatePickupCode();
  renderRoute();
}

function generatePickupCode() {
  elements.pickupCode.value = String(Math.floor(100000 + Math.random() * 900000));
}

function seedMockJobs() {
  if (state.jobs.length) return;
  state.jobs = [
    {
      id: "JOB-120318",
      fileName: "demo-meeting.pdf",
      recipient: "演示用户 A",
      targetStation: "M-01",
      targetLabel: "会议室 M-01",
      pickupCode: "384921",
      status: "printing_en_route",
      progress: 38,
      printSettings: { copies: 2, pages: "全部", colorMode: "mono", duplex: "duplex", paperSize: "A4", priority: "normal", printMode: "mobile_print" },
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString()
    },
    {
      id: "JOB-120322",
      fileName: "demo-budget.xlsx",
      recipient: "演示用户 B",
      targetStation: "B-03",
      targetLabel: "财务 B-03",
      pickupCode: "159402",
      status: "queued",
      progress: 0,
      printSettings: { copies: 1, pages: "1-2", colorMode: "color", duplex: "single", paperSize: "A4", priority: "high", printMode: "manual_at_station" },
      createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString()
    }
  ];
  updateQueueEstimate();
}

function startMockLoop() {
  tickMock();
  state.mockTimer = window.setInterval(tickMock, 1800);
}

function tickMock() {
  const active = state.jobs.find((job) => ACTIVE_JOB_STATUSES.includes(job.status) && job.status !== "queued");
  const nextQueued = state.jobs.find((job) => job.status === "queued");

  if (!active && nextQueued) {
    nextQueued.status = nextQueued.printSettings?.printMode === "manual_at_station" ? "navigating_to_target" : "printing_en_route";
    nextQueued.progress = 5;
  }

  const current = state.jobs.find((job) => ACTIVE_JOB_STATUSES.includes(job.status) && job.status !== "queued");
  if (current) {
    const increment = current.status === "awaiting_manual_print" ? 10 : 7;
    current.progress = Math.min(100, current.progress + increment);
    if (current.status === "printing_en_route" && current.progress >= 70) {
      current.status = "delivering";
    } else if (current.status === "navigating_to_target" && current.progress >= 72) {
      current.status = "awaiting_manual_print";
    } else if (current.progress >= 100) {
      current.status = "done";
      current.finishedAt = new Date().toISOString();
    }
    updateMockRobot(current);
  } else {
    state.status.robot = { ...state.status.robot, state: "idle", location: "A 区走廊", speed: 0 };
  }

  updateQueueEstimate();
  renderStatus();
  renderJobs();
}

function updateMockRobot(job) {
  const target = WORKSTATIONS.find((item) => item.id === job.targetStation) || WORKSTATIONS.find((item) => item.selectable) || WORKSTATIONS[0];
  const destination = target;
  const location = target.label;
  const robotState = job.status === "done" ? "idle" : job.status;

  state.status.robot = {
    ...state.status.robot,
    state: robotState,
    location,
    x: lerp(state.status.robot.x, destination.x, 0.28),
    y: lerp(state.status.robot.y, destination.y, 0.28),
    battery: Math.max(18, state.status.robot.battery - 0.1),
    speed: ["printing_en_route", "navigating_to_target", "delivering"].includes(job.status) ? 0.22 : 0
  };
  state.status.printer = {
    state: job.status === "printing_en_route" ? "printing" : job.status,
    activeJobId: job.id,
    queueLength: state.jobs.filter(isActiveJob).length,
    waitSeconds: estimateWaitSeconds(),
    progress: job.progress
  };
}

function lerp(a, b, amount) {
  return Math.round(a + (b - a) * amount);
}

function updateQueueEstimate() {
  state.status.printer.queueLength = state.jobs.filter(isActiveJob).length;
  state.status.printer.waitSeconds = estimateWaitSeconds();
  if (!state.jobs.some(isActiveJob)) {
    state.status.printer.state = "idle";
    state.status.printer.activeJobId = "";
    state.status.printer.progress = 0;
  }
}

function estimateWaitSeconds() {
  return state.jobs.filter((job) => job.status === "queued").length * 120;
}

function renderJobs() {
  const jobs = getFilteredJobs();
  if (!jobs.length) {
    elements.jobsList.innerHTML = `<div class="empty-state">暂无任务</div>`;
    return;
  }

  elements.jobsList.innerHTML = jobs
    .map((job) => {
      const statusLabel = STATE_LABELS[job.status] || job.status;
      const meta = formatJobMeta(job);
      const canCommand = state.settings.mode === "mock" || isRdkConnected();
      return `
        <article class="job-row">
          <div class="job-title">
            <strong title="${escapeHtml(job.fileName)}">${escapeHtml(job.fileName)}</strong>
            <small>${escapeHtml(job.id)} · ${escapeHtml(job.recipient || "未填写")}</small>
          </div>
          <span class="job-status ${job.status}">${statusLabel}</span>
          <div>
            <div class="progress-track" aria-label="进度 ${Math.round(job.progress || 0)}%">
              <span style="width: ${Math.round(job.progress || 0)}%"></span>
            </div>
          </div>
          <div class="job-meta">${escapeHtml(meta)}</div>
          <button class="icon-button" type="button" title="取消任务" aria-label="取消任务" data-cancel="${job.id}" ${isActiveJob(job) && canCommand ? "" : "disabled"}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </article>
      `;
    })
    .join("");

  $$("[data-cancel]").forEach((button) => {
    button.addEventListener("click", () => cancelJob(button.dataset.cancel));
  });
}

function getFilteredJobs() {
  if (state.activeFilter === "active") return state.jobs.filter(isActiveJob);
  if (state.activeFilter === "done") return state.jobs.filter((job) => ["done", "canceled"].includes(job.status));
  return state.jobs;
}

function isActiveJob(job) {
  return ACTIVE_JOB_STATUSES.includes(job.status);
}

function formatJobMeta(job) {
  const settings = job.printSettings || {};
  const color = settings.colorMode === "color" ? "彩色" : "黑白";
  const duplex = settings.duplex === "duplex" ? "双面" : "单面";
  const mode = settings.printMode === "manual_at_station" ? "到达后人工" : "边走边打印";
  return `${job.targetLabel || job.targetStation} · ${color}/${duplex} · ${mode}`;
}

async function cancelJob(jobId) {
  if (state.settings.mode === "mock") {
    const job = state.jobs.find((item) => item.id === jobId);
    if (job) {
      job.status = "canceled";
      job.progress = 0;
      updateQueueEstimate();
      renderJobs();
      showToast("任务已取消");
    }
    return;
  }

  if (!isRdkConnected()) {
    showToast("未连接 RDK X5，不能取消真实任务");
    return;
  }

  try {
    const response = await fetch(`${state.settings.apiBase}/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST"
    });
    if (!response.ok) throw new Error("cancel failed");
    await pollRdk();
    showToast("取消指令已发送");
  } catch {
    showToast("取消失败，请检查 RDK X5 API");
  }
}

function setConnection(mode, text) {
  state.connection = mode;
  elements.connectionPill.classList.toggle("connected", mode === "connected");
  elements.connectionPill.classList.toggle("warning", mode === "warning");
  elements.connectionText.textContent = text;
  updateSubmitAvailability();
}

function isRdkConnected() {
  return state.settings.mode === "rdk" && state.connection === "connected";
}

function updateSubmitAvailability() {
  const locked = state.settings.mode === "rdk" && !isRdkConnected();
  elements.submitButton.disabled = locked;
  elements.connectionGuard.hidden = !locked;
}

function clearRealtimeData() {
  state.jobs = [];
  state.status = createOfflineStatus();
  renderStatus();
  renderJobs();
}

function createDemoStatus() {
  const homeStation = WORKSTATIONS.find((item) => item.type === "dock") || WORKSTATIONS[0] || {};
  return {
    ...structuredClone(DEFAULT_STATUS),
    robot: {
      ...structuredClone(DEFAULT_STATUS.robot),
      floor: state.floorConfig.floor || DEFAULT_STATUS.robot.floor,
      location: homeStation.label || DEFAULT_STATUS.robot.location,
      x: Number(homeStation.x ?? DEFAULT_STATUS.robot.x),
      y: Number(homeStation.y ?? DEFAULT_STATUS.robot.y)
    },
    updatedAt: new Date().toISOString()
  };
}

function createOfflineStatus() {
  const homeStation = WORKSTATIONS.find((item) => item.type === "dock") || WORKSTATIONS[0] || {};
  return {
    robot: {
      state: "offline",
      floor: state.floorConfig.floor || "--",
      location: "未连接 RDK X5",
      x: Number(homeStation.x ?? DEFAULT_STATUS.robot.x),
      y: Number(homeStation.y ?? DEFAULT_STATUS.robot.y),
      battery: null,
      speed: 0
    },
    printer: {
      state: "offline",
      activeJobId: "",
      queueLength: 0,
      waitSeconds: 0,
      progress: 0
    },
    network: {
      ip: "未连接",
      rssi: null
    },
    updatedAt: ""
  };
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("show");
  }, 2800);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
