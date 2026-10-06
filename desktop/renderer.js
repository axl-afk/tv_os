const api = window.ultimateTv;

const els = {
  statusPill: document.getElementById("statusPill"),
  statusText: document.getElementById("statusText"),
  avd: document.getElementById("avdSelect"),
  deviceName: document.getElementById("deviceName"),
  coldBoot: document.getElementById("coldBoot"),
  fullscreen: document.getElementById("fullscreen"),
  remoteModeSelect: document.getElementById("remoteModeSelect"),
  start: document.getElementById("startBtn"),
  stop: document.getElementById("stopBtn"),
  refresh: document.getElementById("refreshBtn"),
  docs: document.getElementById("docsBtn"),
  sessionMessage: document.getElementById("sessionMessage"),
  platform: document.getElementById("platform"),
  arch: document.getElementById("arch"),
  sdk: document.getElementById("sdk"),
  checks: document.getElementById("checks"),
  remoteMode: document.getElementById("remoteMode"),
  pairingCode: document.getElementById("pairingCode"),
  pairingCodeValue: document.getElementById("pairingCodeValue"),
};

function friendlyPlatform(value) {
  return ({ darwin: "macOS", win32: "Windows", linux: "Linux" })[value] || value;
}

function setStatus(status) {
  const busy = ["starting", "waiting-adb", "booting", "starting-remote", "stopping"].includes(status.state);
  const running = status.state === "running";
  const error = status.state === "error";

  els.statusPill.className = "status-pill" + (running ? " running" : error ? " error" : busy ? " busy" : "");
  els.statusText.textContent = status.state.replace("-", " ");
  els.sessionMessage.textContent = status.message || "Ready.";
  if (status.pairingCode) {
    els.pairingCode.hidden = false;
    els.pairingCodeValue.textContent = status.pairingCode;
  } else {
    els.pairingCode.hidden = true;
    els.pairingCodeValue.textContent = "------";
  }
  els.start.disabled = busy || running;
  els.stop.disabled = !busy && !running && !error;
  els.avd.disabled = busy || running;
  els.deviceName.disabled = busy || running;
  els.coldBoot.disabled = busy || running;
  els.fullscreen.disabled = busy || running;
  els.remoteModeSelect.disabled = busy || running;

  if (running) {
    els.remoteMode.textContent = status.remoteMode === "native"
      ? "Native Google Android TV Remote Service"
      : "Compatibility remote service";
  } else {
    els.remoteMode.textContent = "Waiting for session";
  }
}

function renderChecks(info) {
  const checks = [
    ["Android SDK", Boolean(info.sdkRoot), info.sdkRoot || "Not found"],
    ["ADB", info.adb, info.adb ? "Ready" : "Missing"],
    ["Emulator", info.emulator, info.emulator ? "Ready" : "Missing"],
  ];

  els.checks.innerHTML = checks.map(([name, ok, detail]) =>
    `<div class="check ${ok ? "ok" : "bad"}"><b>${ok ? "✓" : "!"} ${name}</b><small>${detail}</small></div>`
  ).join("");
}

async function refresh() {
  const info = await api.systemInfo();
  els.platform.textContent = friendlyPlatform(info.platform);
  els.arch.textContent = info.arch;
  els.sdk.textContent = info.sdkRoot || "Not found";
  renderChecks(info);

  const current = els.avd.value;
  els.avd.innerHTML = "";
  for (const name of info.avds) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    els.avd.appendChild(option);
  }
  if (current && info.avds.includes(current)) els.avd.value = current;

  if (!info.avds.length) {
    const option = document.createElement("option");
    option.textContent = "No TV AVDs found";
    option.value = "";
    els.avd.appendChild(option);
  }

  setStatus(await api.status());
}

els.start.addEventListener("click", async () => {
  if (!els.avd.value) return;
  try {
    await api.start({
      avd: els.avd.value,
      deviceName: els.deviceName.value.trim() || "Ultimate TV OS",
      coldBoot: els.coldBoot.checked,
      fullscreen: els.fullscreen.checked,
      remoteMode: els.remoteModeSelect.value,
    });
  } catch (error) {
    setStatus({ state: "error", message: error?.message || String(error) });
  }
});

els.stop.addEventListener("click", async () => {
  try {
    setStatus(await api.stop());
  } catch (error) {
    setStatus({ state: "error", message: error?.message || String(error) });
  }
});

els.refresh.addEventListener("click", refresh);
els.docs.addEventListener("click", () => api.openDocs());
api.onStatus(setStatus);
refresh().catch((error) => setStatus({ state: "error", message: String(error) }));
