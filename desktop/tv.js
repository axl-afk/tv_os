const api = window.ultimateTvSurface;

const frameEl = document.getElementById("frame");
const boot = document.getElementById("boot");
const bootText = document.getElementById("bootText");
const pairing = document.getElementById("pairing");
const pairingCode = document.getElementById("pairingCode");

let sourceWidth = 1280;
let sourceHeight = 720;
let latestFrame = null;
let rafScheduled = false;
let textureWidth = 0;
let textureHeight = 0;
let pointerGesture = null;

const gl = frameEl.getContext("webgl", {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: "high-performance",
});

if (!gl) {
  bootText.textContent = "WebGL is unavailable on this display.";
  throw new Error("WebGL is unavailable.");
}

function shader(type, source) {
  const value = gl.createShader(type);
  gl.shaderSource(value, source);
  gl.compileShader(value);
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(value) || "Shader compilation failed.");
  }
  return value;
}

const program = gl.createProgram();
gl.attachShader(
  program,
  shader(
    gl.VERTEX_SHADER,
    `
      attribute vec2 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vTexCoord = aTexCoord;
      }
    `,
  ),
);
gl.attachShader(
  program,
  shader(
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      varying vec2 vTexCoord;
      uniform sampler2D uTexture;
      void main() {
        gl_FragColor = texture2D(uTexture, vTexCoord);
      }
    `,
  ),
);
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
  throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed.");
}
gl.useProgram(program);

const vertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([
    -1, -1, 0, 1,
     1, -1, 1, 1,
    -1,  1, 0, 0,
    -1,  1, 0, 0,
     1, -1, 1, 1,
     1,  1, 1, 0,
  ]),
  gl.STATIC_DRAW,
);

const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
const position = gl.getAttribLocation(program, "aPosition");
const texCoord = gl.getAttribLocation(program, "aTexCoord");

gl.enableVertexAttribArray(position);
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
gl.enableVertexAttribArray(texCoord);
gl.vertexAttribPointer(
  texCoord,
  2,
  gl.FLOAT,
  false,
  stride,
  2 * Float32Array.BYTES_PER_ELEMENT,
);

const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
gl.clearColor(0, 0, 0, 1);

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return new Uint8Array(value.data);
  }
  if (value?.data instanceof Uint8Array) return value.data;
  return new Uint8Array(value || []);
}

function resizeCanvas() {
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(frameEl.clientWidth * scale));
  const height = Math.max(1, Math.round(frameEl.clientHeight * scale));
  if (frameEl.width !== width || frameEl.height !== height) {
    frameEl.width = width;
    frameEl.height = height;
  }
}

function setLetterboxedViewport() {
  resizeCanvas();

  const targetWidth = frameEl.width;
  const targetHeight = frameEl.height;
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;

  let width;
  let height;
  let x = 0;
  let y = 0;

  if (targetRatio > sourceRatio) {
    height = targetHeight;
    width = Math.round(height * sourceRatio);
    x = Math.floor((targetWidth - width) / 2);
  } else {
    width = targetWidth;
    height = Math.round(width / sourceRatio);
    y = Math.floor((targetHeight - height) / 2);
  }

  gl.viewport(x, y, width, height);
}

function drawFrame(frame) {
  const pixels = bytesFrom(frame.pixels);
  const width = Number(frame.width) || sourceWidth;
  const height = Number(frame.height) || sourceHeight;
  const expected = width * height * 3;

  if (pixels.length < expected) {
    api.frameConsumed();
    return;
  }

  sourceWidth = width;
  sourceHeight = height;

  gl.bindTexture(gl.TEXTURE_2D, texture);

  if (textureWidth !== width || textureHeight !== height) {
    textureWidth = width;
    textureHeight = height;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      width,
      height,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      pixels,
    );
  } else {
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      width,
      height,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      pixels,
    );
  }

  gl.viewport(0, 0, frameEl.width, frameEl.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  setLetterboxedViewport();
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  boot.classList.add("hidden");
  api.frameConsumed();
}

function scheduleFrame() {
  if (rafScheduled) return;
  rafScheduled = true;

  requestAnimationFrame(() => {
    rafScheduled = false;
    const frame = latestFrame;
    latestFrame = null;
    if (frame) drawFrame(frame);
  });
}

api.onFrame((frame) => {
  latestFrame = frame;
  scheduleFrame();
});

api.onStatus((status) => {
  if (status?.pairingCode) {
    pairingCode.textContent = status.pairingCode;
    pairing.classList.remove("hidden");
  } else {
    pairing.classList.add("hidden");
    pairingCode.textContent = "";
  }

  if (status?.error) {
    boot.classList.remove("hidden");
    bootText.textContent = status.error;
  }
});

window.addEventListener("resize", () => {
  resizeCanvas();
  gl.viewport(0, 0, frameEl.width, frameEl.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  setLetterboxedViewport();
});

window.addEventListener("keydown", (event) => {
  const map = {
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Enter: 66,
    Escape: 4,
    Backspace: 67,
    Delete: 112,
    Tab: 61,
    Home: 3,
    MediaPlayPause: 85,
  };

  const keyCode = map[event.key];
  if (keyCode !== undefined) {
    event.preventDefault();
    api.key(keyCode);
    return;
  }

  if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
    event.preventDefault();
    api.text(event.key);
  }
});

window.addEventListener("paste", (event) => {
  const value = event.clipboardData?.getData("text");
  if (!value) return;
  event.preventDefault();
  api.text(value);
});

function normalizedPoint(clientX, clientY) {
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

  const localX = clientX - rect.left - offsetX;
  const localY = clientY - rect.top - offsetY;
  if (
    localX < 0 ||
    localY < 0 ||
    localX > drawnWidth ||
    localY > drawnHeight
  ) {
    return null;
  }

  return {
    x: localX / drawnWidth,
    y: localY / drawnHeight,
  };
}

frameEl.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.pointerType === "mouse") return;

  const point = normalizedPoint(event.clientX, event.clientY);
  if (!point) return;

  event.preventDefault();
  frameEl.setPointerCapture?.(event.pointerId);
  pointerGesture = {
    pointerId: event.pointerId,
    start: point,
    latest: point,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startedAt: performance.now(),
  };
});

frameEl.addEventListener("pointermove", (event) => {
  if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;
  const point = normalizedPoint(event.clientX, event.clientY);
  if (point) pointerGesture.latest = point;
});

function finishPointerGesture(event) {
  if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;

  event.preventDefault();
  const gesture = pointerGesture;
  pointerGesture = null;

  try {
    frameEl.releasePointerCapture?.(event.pointerId);
  } catch {}

  const end = normalizedPoint(event.clientX, event.clientY) ?? gesture.latest;
  const dx = event.clientX - gesture.startClientX;
  const dy = event.clientY - gesture.startClientY;
  const distance = Math.hypot(dx, dy);
  const durationMs = performance.now() - gesture.startedAt;

  // A drag must move far enough to be intentional. This prevents a swipe
  // from also generating the click/tap that browsers normally emit.
  if (distance >= 12) {
    api.swipe(
      gesture.start.x,
      gesture.start.y,
      end.x,
      end.y,
      Math.min(1200, Math.max(80, durationMs)),
    );
  } else {
    api.tap(end.x, end.y);
  }
}

frameEl.addEventListener("pointerup", finishPointerGesture);
frameEl.addEventListener("pointercancel", (event) => {
  if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;
  pointerGesture = null;
});

resizeCanvas();
gl.clear(gl.COLOR_BUFFER_BIT);
