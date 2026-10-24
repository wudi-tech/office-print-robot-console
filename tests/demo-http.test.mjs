import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("live demo HTTP: pages, contracts, synthetic upload, cancellation and errors", async (t) => {
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(process.execPath, ["web/server.mjs"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, "close");
      child.kill();
      await closed;
    }
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { ready = (await fetch(`${base}/api/health`)).ok; } catch {}
    if (ready) break;
    if (child.exitCode !== null) throw new Error(`Server exited: ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(ready, true, "demo server must start");
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.deepEqual(health, { ok: true, name: "print_robot_demo_server", demo: true });

  for (const asset of ["/", "/app.js", "/styles.css", "/sw.js", "/manifest.webmanifest", "/favicon.svg"]) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200, asset);
    assert.ok((await response.text()).length > 0, asset);
  }
  const config = await (await fetch(`${base}/api/floor-config`)).json();
  assert.equal(config.rosMap.yaml, "");
  assert.ok(config.stations.some((station) => station.id === "C-05"));
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.ok(status.robot && status.printer && status.network && status.updatedAt);
  const before = await (await fetch(`${base}/api/jobs`)).json();
  assert.equal(before.jobs.length, 2);
  assert.ok(before.jobs.every((job) => job.fileName.startsWith("demo-")));

  const body = new FormData();
  body.set("file", new Blob(["SYNTHETIC DEMO CONTENT - DO NOT PRINT"], { type: "text/plain" }), "synthetic-demo.txt");
  for (const [key, value] of Object.entries({recipient:"DEMO USER",targetStation:"C-05",copies:"2",pages:"1-2",colorMode:"mono",duplex:"duplex",paperSize:"A4",priority:"high",printMode:"manual_at_station",pickupCode:"000000"})) body.set(key,value);
  const submitted = await fetch(`${base}/api/jobs`, { method: "POST", body });
  assert.equal(submitted.status, 201);
  const { ok, job } = await submitted.json();
  assert.equal(ok, true);
  assert.equal(job.fileName, "synthetic-demo.txt");
  assert.equal(job.recipient, "DEMO USER");
  assert.equal(job.targetStation, "C-05");
  assert.equal(job.printSettings.copies, 2);
  assert.equal(job.printSettings.printMode, "manual_at_station");
  assert.equal(job.printSettings.duplex, "duplex");
  assert.equal(job.status, "queued");
  assert.ok(job.targetPose && job.targetUi);
  assert.equal(job.filePath, undefined, "demo must not claim a saved upload");
  const canceled = await (await fetch(`${base}/api/jobs/${job.id}/cancel`, { method: "POST" })).json();
  assert.equal(canceled.job.status, "canceled");
  assert.equal(canceled.job.progress, 0);
  const missing = await (await fetch(`${base}/api/jobs/DOES-NOT-EXIST/cancel`, { method: "POST" })).json();
  assert.equal(missing.ok, false);
  assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
  const options = await fetch(`${base}/api/jobs`, { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
});
