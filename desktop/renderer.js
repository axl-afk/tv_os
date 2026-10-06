const api = window.ultimateTv;

let runtimeReady = false;
let sessionStatus = { state: "idle" };

const els = {
  statusPill: document.getElementById("statusPill"),
  statusText: document.getElementById("statusText"),
  avd: document.getElementById("avdSelect"),
  deviceName: document.getElementById("deviceName"),
  coldBoot: document.getElementById("coldBoot"),
  displaySelect: document.getElementById("displaySelect"),
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

  runtimeBadge: document.getElementById("runtimeBadge"),
  runtimeProgressTrack: document.getElementById("runtimeProgressTrack"),
  runtimeProgressFill: document.getElementById("runtimeProgressFill"),
  runtimeMessage: document.getElementById("runtimeMessage"),
  licenseRow: document.getElementById("licenseRow"),
  licenseAccept: document.getElementById("licenseAccept"),
  licenseBtn: document.getElementById("licenseBtn"),
  installRuntime: document.getElementById("installRuntimeBtn"),
  removeRuntime: document.getElementById("removeRuntimeBtn"),
};

function friendlyPlatform(value) {
  return ({ darwin: "macOS", win32: "Windows", linux: "Linux" })[value] || value;
}

function sessionBusy(state) {
  return ["starting", "waiting-adb", "booting", "starting-remote", "stopping"].includes(state);
}

function updateControls() {
  const busy = sessionBusy(sessionStatus.state);
  const running = sessionStatus.state === "running";

  els.start.disabled = !runtimeReady || !els.avd.value || busy || running;
  els.stop.disabled = !busy && !running && sessionStatus.state !== "error";
  els.avd.disabled = !runtimeReady || busy || running;
  els.deviceName.disabled = busy || running;
  els.coldBoot.disabled = busy || running;
  els.displaySelect.disabled = busy || running;
  els.remoteModeSelect.disabled = busy || running;
}

function setStatus(status) {
  sessionStatus = status;
  const busy = sessionBusy(status.state);
  const running = status.state === "running";
  const error = status.state === "error";

  els.statusPill.className =
    "status-pill" + (running ? " running" : error ? " error" : busy ? " busy" : "");
  els.statusText.textContent = status.state.replace("-", " ");
  els.sessionMessage.textContent =
    status.message || (runtimeReady ? "Ready." : "Install the TV Runtime to begin.");

  if (status.pairingCode) {
    els.pairingCode.hidden = false;
    els.pairingCodeValue.textContent = status.pairingCode;
  } else {
    els.pairingCode.hidden = true;
    els.pairingCodeValue.textContent = "------";
  }

  if (running) {
    els.remoteMode.textContent =
      status.remoteMode === "native"
        ? "Native Google Android TV Remote Service"
        : "Compatibility remote service";
  } else {
    els.remoteMode.textContent = runtimeReady ? "Runtime ready" : "Runtime not installed";
  }

  updateControls();
}

function setRuntimeStatus(status) {
  const wasReady = runtimeReady;
  runtimeReady = Boolean(status.ready);

  const installing = ["checking", "downloading", "extracting", "configuring"].includes(status.state);
  const percent = typeof status.progress === "number" ? status.progress : 0;

  els.runtimeMessage.textContent = status.message || "Checking runtime…";
  els.runtimeProgressFill.style.width = runtimeReady ? "100%" : percent + "%";
  els.runtimeProgressTrack.classList.toggle("active", installing);

  if (runtimeReady) {
    els.runtimeBadge.textContent = "Ready";
    els.runtimeBadge.className = "runtime-badge ready";
    els.licenseRow.hidden = true;
    els.installRuntime.hidden = true;
    els.removeRuntime.hidden = false;
  } else if (status.state === "error") {
    els.runtimeBadge.textContent = "Error";
    els.runtimeBadge.className = "runtime-badge error";
    els.licenseRow.hidden = false;
    els.installRuntime.hidden = false;
    els.installRuntime.disabled = false;
    els.removeRuntime.hidden = true;
  } else if (installing) {
    els.runtimeBadge.textContent = "Installing";
    els.runtimeBadge.className = "runtime-badge installing";
    els.licenseRow.hidden = true;
    els.installRuntime.hidden = false;
    els.installRuntime.disabled = true;
    els.removeRuntime.hidden = true;
  } else {
    els.runtimeBadge.textContent = "Not installed";
    els.runtimeBadge.className = "runtime-badge";
    els.licenseRow.hidden = false;
    els.installRuntime.hidden = false;
    els.installRuntime.disabled = !els.licenseAccept.checked;
    els.removeRuntime.hidden = true;
  }

  updateControls();

  if (!wasReady && runtimeReady) {
    refresh().catch((error) => setStatus({ state: "error", message: String(error) }));
  }
}

function renderChecks(info) {
  const checks = [
    [
      "Ultimate TV Runtime",
      Boolean(info.runtime?.ready),
      info.runtime?.ready ? "Installed and managed by Ultimate TV" : "Install from this app",
    ],
    ["ADB", info.runtime?.ready && info.adb, info.runtime?.ready && info.adb ? "Ready" : "Pending runtime"],
    ["TV Engine", info.runtime?.ready && info.emulator, info.runtime?.ready && info.emulator ? "Ready" : "Pending runtime"],
  ];

  els.checks.innerHTML = checks
    .map(
      ([name, ok, detail]) =>
        `<div class="check ${ok ? "ok" : "bad"}"><b>${ok ? "✓" : "!"} ${name}</b><small>${detail}</small></div>`,
    )
    .join("");
}

async function refresh() {
  const info = await api.systemInfo();
  els.platform.textContent = friendlyPlatform(info.platform);
  els.arch.textContent = info.arch;
  els.sdk.textContent =
    info.sdkSource === "ultimate-tv"
      ? "Ultimate TV managed"
      : info.sdkSource === "system"
        ? "External SDK detected (development only)"
        : "Not installed";

  setRuntimeStatus(info.runtime);
  renderChecks(info);

  const currentDisplay = els.displaySelect.value;
  els.displaySelect.innerHTML = "";
  for (const display of info.displays || []) {
    const option = document.createElement("option");
    option.value = display.id;
    option.textContent =
      display.label +
      " — " +
      display.width +
      "×" +
      display.height +
      (display.primary ? " (Primary)" : "");
    els.displaySelect.appendChild(option);
  }
  if (currentDisplay && (info.displays || []).some((display) => display.id === currentDisplay)) {
    els.displaySelect.value = currentDisplay;
  } else {
    const primary = (info.displays || []).find((display) => display.primary);
    if (primary) els.displaySelect.value = primary.id;
  }

  const current = els.avd.value;
  els.avd.innerHTML = "";

  if (info.runtime?.ready) {
    for (const name of info.avds) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name === "Ultimate_TV_OS" ? "Ultimate TV" : name;
      els.avd.appendChild(option);
    }
  }

  if (current && info.avds.includes(current)) els.avd.value = current;

  if (!info.runtime?.ready || !info.avds.length) {
    const option = document.createElement("option");
    option.textContent = info.runtime?.ready ? "TV runtime needs repair" : "Install TV Runtime first";
    option.value = "";
    els.avd.appendChild(option);
  }

  setStatus(await api.status());
}

els.installRuntime.addEventListener("click", async () => {
  if (!els.licenseAccept.checked) return;
  els.installRuntime.disabled = true;
  try {
    const status = await api.installRuntime(true);
    setRuntimeStatus(status);
  } catch (error) {
    setRuntimeStatus({
      state: "error",
      ready: false,
      message: error?.message || String(error),
    });
  }
});

els.removeRuntime.addEventListener("click", async () => {
  if (sessionStatus.state === "running" || sessionBusy(sessionStatus.state)) return;
  els.removeRuntime.disabled = true;
  try {
    setRuntimeStatus(await api.removeRuntime());
    await refresh();
  } catch (error) {
    setRuntimeStatus({
      state: "error",
      ready: runtimeReady,
      message: error?.message || String(error),
    });
  } finally {
    els.removeRuntime.disabled = false;
  }
});

els.licenseAccept.addEventListener("change", () => {
  if (!runtimeReady) els.installRuntime.disabled = !els.licenseAccept.checked;
});

els.licenseBtn.addEventListener("click", () => api.openAndroidLicense());

els.start.addEventListener("click", async () => {
  if (!runtimeReady || !els.avd.value) return;
  try {
    await api.start({
      avd: els.avd.value,
      deviceName: els.deviceName.value.trim() || "Ultimate TV OS",
      coldBoot: els.coldBoot.checked,
      displayId: els.displaySelect.value,
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
api.onRuntimeStatus(setRuntimeStatus);

refresh().catch((error) => setStatus({ state: "error", message: String(error) }));
