import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

// Execute the archived app in a minimal DOM harness, skipping only automatic init.
// This checks application logic, not browser rendering, service workers or ROS.
async function harness(fetchImpl) {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent: "", innerHTML: "", value: "C-05", disabled: false, hidden: true,
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, addEventListener() {}
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: node, querySelectorAll: () => [] },
    location: { protocol: "http:", hostname: "localhost" },
    localStorage: { getItem: () => null },
    window: { clearTimeout() {}, setTimeout() { return 1; } },
    structuredClone, fetch: fetchImpl, console
  });
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  assert.equal(source.split("\ninit();").length, 2);
  vm.runInContext(source.replace("\ninit();", "\n// init skipped by test harness"), context);
  vm.runInContext('state.settings.mode="rdk";state.settings.apiBase="http://127.0.0.1:1";', context);
  return { context, nodes, run: (code) => vm.runInContext(code, context) };
}

test("RDK mode rejects the demo health identity and clears stale data", async () => {
  const requests = [];
  const h = await harness(async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ ok: true, name: "print_robot_demo_server", demo: true }) };
  });
  h.run('state.jobs=[{id:"STALE"}];state.connection="connected";');
  await h.run("pollRdk({showError:true})");
  assert.equal(requests.length, 1, "wrong service must fail at health check");
  assert.equal(h.run("isRdkConnected()"), false);
  assert.equal(h.run("state.jobs.length"), 0);
  assert.equal(h.nodes.get("#submitJobButton").disabled, true);
  assert.equal(h.nodes.get("#connectionGuard").hidden, false);
});

test("network failure locks real submission and returns an offline message", async () => {
  const h = await harness(fetch); // port 1 is blocked/refused, no remote/hardware request
  await h.run("pollRdk({showError:true})");
  assert.equal(h.run("state.status.robot.state"), "offline");
  assert.equal(h.run("state.status.robot.battery"), null);
  assert.equal(h.run("state.status.network.ip"), "未连接");
  assert.equal(h.nodes.get("#connectionText").textContent, "RDK 离线");
  assert.match(h.nodes.get("#toast").textContent, /无法连接 RDK X5/);
  await h.run("submitJob({preventDefault(){}})");
  assert.equal(h.nodes.get("#toast").textContent, "未连接 RDK X5，不能下发真实任务");
  await h.run('cancelJob("MISSING")');
  assert.equal(h.nodes.get("#toast").textContent, "未连接 RDK X5，不能取消真实任务");
});

test("health alone is insufficient when status/jobs API fails", async () => {
  let count = 0;
  const h = await harness(async () => {
    count++;
    return count === 1
      ? { ok: true, json: async () => ({ ok: true, name: "print_robot_bridge" }) }
      : { ok: false };
  });
  await h.run("pollRdk()");
  assert.equal(count, 3);
  assert.equal(h.run("isRdkConnected()"), false);
  assert.equal(h.nodes.get("#submitJobButton").disabled, true);
});
