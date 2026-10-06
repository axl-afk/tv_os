const api = window.ultimateTvSurface;

const frameEl = document.getElementById("frame");
const boot = document.getElementById("boot");
const bootText = document.getElementById("bootText");
const controls = document.getElementById("controls");
const exitBtn = document.getElementById("exitBtn");
const surfaceStatus = document.getElementById("surfaceStatus");

let frameUrl = null;
let sourceWidth = 1920;
let sourceHeight = 1080;
let hideTimer = null;
let decodingFrame = false;
let pendingFrame = null;

function showControls() {
  document.body.classList.add("controls-visible");
  controls.classList.add("visible");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    controls.classList.remove("visible");
    document.body.classList.remove("controls-visible");
  }, 2200);
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return new Uint8Array(value.data);
  }
  if (value?.data instanceof Uint8Array) return value.data;
  return new Uint8Array(value || []);
}

function renderFrame(frame) {
  const bytes = bytesFrom(frame.png);
  if (!bytes.length) {
    decodingFrame = false;
    return;
  }

  decodingFrame = true;
  sourceWidth = Number(frame.width) || sourceWidth;
  sourceHeight = Number(frame.height) || sourceHeight;

  const blob = new Blob([bytes], { type: "image/png" });
  const nextUrl = URL.createObjectURL(blob);

  frameEl.onload = () => {
    if (frameUrl) URL.revokeObjectURL(frameUrl);
    frameUrl = nextUrl;
    boot.classList.add("hidden");
    decodingFrame = false;

    if (pendingFrame) {
      const next = pendingFrame;
      pendingFrame = null;
      renderFrame(next);
    }
  };

  frameEl.onerror = () => {
    URL.revokeObjectURL(nextUrl);
    decodingFrame = false;
  };

  frameEl.src = nextUrl;
}

api.onFrame((frame) => {
  if (decodingFrame) {
    pendingFrame = frame;
    return;
  }
  renderFrame(frame);
});

api.onStatus((status) => {
  surfaceStatus.textContent = status?.message || "Embedded TV mode";
  if (status?.error) {
    boot.classList.remove("hidden");
    bootText.textContent = status.error;
  }
});

window.addEventListener("mousemove", showControls);
window.addEventListener("mousedown", showControls);

window.addEventListener("keydown", (event) => {
  const map = {
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Enter: 66,
    " ": 66,
    Escape: 4,
    Backspace: 4,
    Home: 3,
    MediaPlayPause: 85,
  };

  const keyCode = map[event.key];
  if (keyCode !== undefined) {
    event.preventDefault();
    api.key(keyCode);
  }

  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "q") {
    event.preventDefault();
    api.exit();
  }
});

frameEl.addEventListener("click", (event) => {
  const rect = frameEl.getBoundingClientRect();
  const containerRatio = rect.width / rect.height;
  const imageRatio = sourceWidth / sourceHeight;

  let drawnWidth;
  let drawnHeight;
  let offsetX = 0;
  let offsetY = 0;

  if (containerRatio > imageRatio) {
    drawnHeight = rect.height;
    drawnWidth = drawnHeight * imageRatio;
    offsetX = (rect.width - drawnWidth) / 2;
  } else {
    drawnWidth = rect.width;
    drawnHeight = drawnWidth / imageRatio;
    offsetY = (rect.height - drawnHeight) / 2;
  }

  const localX = event.clientX - rect.left - offsetX;
  const localY = event.clientY - rect.top - offsetY;
  if (localX < 0 || localY < 0 || localX > drawnWidth || localY > drawnHeight) return;

  api.tap(localX / drawnWidth, localY / drawnHeight);
});

exitBtn.addEventListener("click", () => api.exit());

showControls();
