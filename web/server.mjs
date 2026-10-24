import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5173);
const floorConfig = loadFloorConfig();
const stations = normalizeStations(floorConfig.stations);
const stationById = new Map(stations.map((station) => [station.id, station]));
const homeStation = stations.find((station) => station.type === "dock") || stations[0];
const activeJobStatuses = ["queued", "printing", "printing_en_route", "navigating_to_target", "delivering", "awaiting_manual_print"];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const jobs = [
  {
    id: "JOB-120318",
    fileName: "demo-meeting.pdf",
    recipient: "演示用户 A",
    targetStation: "M-01",
    targetLabel: "会议室 M-01",
    pickupCode: "384921",
    status: "printing_en_route",
    progress: 34,
    printSettings: {
      copies: 2,
      pages: "全部",
      colorMode: "mono",
      duplex: "duplex",
      paperSize: "A4",
      priority: "normal",
      printMode: "mobile_print"
    },
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
    printSettings: {
      copies: 1,
      pages: "1-2",
      colorMode: "color",
      duplex: "single",
      paperSize: "A4",
      priority: "high",
      printMode: "manual_at_station"
    },
    createdAt: new Date(Date.now() - 1000 * 60 * 2).toISOString()
  }
];

let robot = {
  state: "printing_en_route",
  floor: floorConfig.floor || "3F 办公区",
  location: homeStation?.label || "充电点",
  x: homeStation?.x || 782,
  y: homeStation?.y || 434,
  battery: 86,
  speed: 0
};

const server = createServer(async (request, response) => {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.url === "/api/health") {
      sendJson(response, { ok: true, name: "print_robot_demo_server", demo: true });
      return;
    }

    if (request.url === "/api/status" && request.method === "GET") {
      tick();
      const activeJob = jobs.find((job) => activeJobStatuses.includes(job.status) && job.status !== "queued");
      sendJson(response, {
        robot,
        printer: {
          state: activeJob?.status === "printing_en_route" ? "printing" : activeJob?.status || "idle",
          activeJobId: activeJob?.id || "",
          queueLength: jobs.filter(isActiveJob).length,
          waitSeconds: jobs.filter((job) => job.status === "queued").length * 120,
          progress: activeJob?.progress || 0
        },
        network: {
          ip: "127.0.0.1",
          rssi: -48
        },
        updatedAt: new Date().toISOString()
      });
      return;
    }

    if (request.url === "/api/jobs" && request.method === "GET") {
      sendJson(response, { jobs });
      return;
    }

    if (request.url === "/api/floor-config" && request.method === "GET") {
      sendJson(response, floorConfig);
      return;
    }

    if (request.url === "/api/jobs" && request.method === "POST") {
      const body = await readBody(request);
      const text = body.toString("utf8");
      const fileName = extractMultipartValue(text, "filename") || "uploaded-document.pdf";
      const recipient = extractMultipartField(text, "recipient") || "未填写";
      const targetStation = extractMultipartField(text, "targetStation") || "C-05";
      const station = stationById.get(targetStation);
      const job = {
        id: `JOB-${Date.now().toString().slice(-6)}`,
        fileName,
        recipient,
        targetStation,
        targetLabel: station?.label || targetStation,
        targetPose: station?.ros || null,
        targetUi: station?.ui || null,
        pickupCode: extractMultipartField(text, "pickupCode") || "",
        status: "queued",
        progress: 0,
        printSettings: {
          copies: Number(extractMultipartField(text, "copies") || 1),
          pages: extractMultipartField(text, "pages") || "全部",
          colorMode: extractMultipartField(text, "colorMode") || "mono",
          duplex: extractMultipartField(text, "duplex") || "single",
          paperSize: extractMultipartField(text, "paperSize") || "A4",
          priority: extractMultipartField(text, "priority") || "normal",
          printMode: extractMultipartField(text, "printMode") || "mobile_print"
        },
        createdAt: new Date().toISOString()
      };
      jobs.unshift(job);
      sendJson(response, { ok: true, job }, 201);
      return;
    }

    const cancelMatch = request.url?.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      const jobId = decodeURIComponent(cancelMatch[1]);
      const job = jobs.find((item) => item.id === jobId);
      if (job && isActiveJob(job)) {
        job.status = "canceled";
        job.progress = 0;
      }
      sendJson(response, { ok: Boolean(job), job });
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, { ok: false, error: error.message }, 500);
  }
});

server.listen(port, () => {
  console.log(`Print robot console: http://localhost:${port}`);
});

function loadFloorConfig() {
  const configPath = join(root, "config", "office_3f.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {
      floor: "3F 办公区",
      stations: [
        { id: "M-01", label: "会议室 M-01", type: "desk", selectable: true, ui: { x: 466, y: 151 }, ros: { x: 4.1, y: 2.4, yaw: 1.57 } },
        { id: "B-03", label: "财务 B-03", type: "desk", ui: { x: 188, y: 330 }, ros: { x: 1.2, y: 0.1, yaw: 1.57 } },
        { id: "CHG", label: "充电点", type: "dock", selectable: false, ui: { x: 782, y: 434 }, ros: { x: 7.5, y: -1.2, yaw: 3.14 } }
      ]
    };
  }
}

function normalizeStations(configStations = []) {
  return configStations.map((station) => ({
    ...station,
    x: Number(station.ui?.x ?? station.x ?? 0),
    y: Number(station.ui?.y ?? station.y ?? 0),
    type: station.type || "desk"
  }));
}

function tick() {
  const active = jobs.find((job) => activeJobStatuses.includes(job.status) && job.status !== "queued");
  const queued = jobs.find((job) => job.status === "queued");

  if (!active && queued) {
    queued.status = queued.printSettings?.printMode === "manual_at_station" ? "navigating_to_target" : "printing_en_route";
    queued.progress = 4;
  }

  const current = jobs.find((job) => activeJobStatuses.includes(job.status) && job.status !== "queued");
  if (!current) {
    robot = { ...robot, state: "idle", speed: 0 };
    return;
  }

  current.progress = Math.min(100, current.progress + (current.status === "awaiting_manual_print" ? 8 : 6));
  if (current.status === "printing_en_route" && current.progress >= 70) current.status = "delivering";
  if (current.status === "navigating_to_target" && current.progress >= 72) current.status = "awaiting_manual_print";
  if (current.progress >= 100) {
    current.status = "done";
    current.finishedAt = new Date().toISOString();
  }

  const target = stationById.get(current.targetStation) || stations.find((station) => station.selectable !== false) || homeStation;
  const destination = target;
  robot = {
    ...robot,
    state: current.status === "done" ? "idle" : current.status,
    location: destination.label,
    x: Math.round(robot.x + (destination.x - robot.x) * 0.25),
    y: Math.round(robot.y + (destination.y - robot.y) * 0.25),
    battery: Math.max(18, robot.battery - 0.05),
    speed: ["printing_en_route", "navigating_to_target", "delivering"].includes(current.status) ? 0.22 : 0
  };
}

function isActiveJob(job) {
  return activeJobStatuses.includes(job.status);
}

async function serveStatic(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));
  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-cache"
  });
  response.end(JSON.stringify(payload));
}

function setCors(response) {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function extractMultipartField(text, name) {
  const pattern = new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\s\\S]*?)\\r?\\n--`);
  return pattern.exec(text)?.[1]?.trim();
}

function extractMultipartValue(text, name) {
  const pattern = new RegExp(`${name}="([^"]+)"`);
  return pattern.exec(text)?.[1];
}
