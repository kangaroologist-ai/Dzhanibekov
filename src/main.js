import './styles.css';
import * as THREE from 'three';
import { createIcons, Crosshair, Pause, Play, RotateCcw } from 'lucide';
import { INERTIA, PRESETS, implicitMidpointStep, invariants, stepWithSubsteps } from './physics.js';

createIcons({ icons: { Crosshair, Pause, Play, RotateCcw } });

const BASE_STEP = 0.004;
const SAMPLE_INTERVAL = 0.018;
const TWO_PI = Math.PI * 2;
const LIGHT_DIRECTION = new THREE.Vector3(-0.35, 0.75, 0.52).normalize();

const els = {
  bodyViewport: document.querySelector('#bodyViewport'),
  omegaViewport: document.querySelector('#omegaViewport'),
  omegaX: document.querySelector('#omegaX'),
  omegaY: document.querySelector('#omegaY'),
  omegaZ: document.querySelector('#omegaZ'),
  playPause: document.querySelector('#playPause'),
  resetSimulation: document.querySelector('#resetSimulation'),
  speedSlider: document.querySelector('#speedSlider'),
  speedValue: document.querySelector('#speedValue'),
  trailSlider: document.querySelector('#trailSlider'),
  trailValue: document.querySelector('#trailValue'),
  ellipsoidToggle: document.querySelector('#ellipsoidToggle'),
  focusTrajectory: document.querySelector('#focusTrajectory'),
  simTime: document.querySelector('#simTime'),
  energyDrift: document.querySelector('#energyDrift'),
  momentumDrift: document.querySelector('#momentumDrift'),
  ratioValue: document.querySelector('#ratioValue'),
  flipAngle: document.querySelector('#flipAngle'),
  omegaReadout: document.querySelector('#omegaReadout'),
  presetButtons: [...document.querySelectorAll('.preset-button')],
};

const state = {
  running: true,
  speed: Number(els.speedSlider.value),
  maxTrail: Number(els.trailSlider.value),
  omega: readOmegaInputs(),
  bodyQuaternion: new THREE.Quaternion(),
  initialInvariants: null,
  initialAxis: new THREE.Vector3(0, 1, 0),
  time: 0,
  sampleClock: 0,
  history: [],
  constraintCurve: [],
};

state.initialInvariants = invariants(state.omega);

const bodyView = createCanvasView(els.bodyViewport, {
  yaw: -0.74,
  pitch: -0.42,
  distance: 6,
  background: '#f3f6f4',
});
const omegaView = createCanvasView(els.omegaViewport, {
  yaw: -0.72,
  pitch: -0.48,
  distance: 8,
  background: '#f8f9fa',
});

const ellipsoidState = {
  energyAxes: [1, 1, 1],
  momentumAxes: [1, 1, 1],
  bounds: 2.5,
};

resetSimulation();
bindControls();

let lastFrame = performance.now();
requestAnimationFrame(animate);

function animate(now) {
  requestAnimationFrame(animate);

  const frameDt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (state.running) {
    advanceSimulation(frameDt * state.speed);
  }

  renderBodyView();
  renderOmegaView();
}

function advanceSimulation(duration) {
  state.omega = stepWithSubsteps(state.omega, duration, BASE_STEP, INERTIA, ({ midpoint, dt }) => {
    applyBodyRotation(midpoint, dt);
    state.time += dt;
    state.sampleClock += dt;

    if (state.sampleClock >= SAMPLE_INTERVAL) {
      state.sampleClock = 0;
      pushOmegaSample(state.omega);
    }
  });

  updateDiagnostics();
}

function applyBodyRotation(omega, dt) {
  const magnitude = Math.hypot(omega.x, omega.y, omega.z);
  if (magnitude < 1e-12) return;

  const axis = new THREE.Vector3(omega.x, omega.y, omega.z).normalize();
  const delta = new THREE.Quaternion().setFromAxisAngle(axis, magnitude * dt);
  state.bodyQuaternion.multiply(delta).normalize();
}

function resetSimulation() {
  state.omega = readOmegaInputs();
  state.initialInvariants = invariants(state.omega);
  state.bodyQuaternion.identity();
  state.time = 0;
  state.sampleClock = 0;
  state.history = [];

  pushOmegaSample(state.omega);
  updateEllipsoids();
  state.constraintCurve = computeConstraintCurve(state.omega);
  updateDiagnostics();
}

function bindControls() {
  els.playPause.addEventListener('click', () => {
    state.running = !state.running;
    els.playPause.innerHTML = state.running
      ? '<i data-lucide="pause"></i><span>暂停</span>'
      : '<i data-lucide="play"></i><span>继续</span>';
    createIcons({ icons: { Pause, Play } });
  });

  els.resetSimulation.addEventListener('click', resetSimulation);

  els.speedSlider.addEventListener('input', () => {
    state.speed = Number(els.speedSlider.value);
    els.speedValue.textContent = `${state.speed.toFixed(1)}×`;
  });

  els.trailSlider.addEventListener('input', () => {
    state.maxTrail = Number(els.trailSlider.value);
    els.trailValue.textContent = String(state.maxTrail);
    trimTrail();
  });

  els.ellipsoidToggle.addEventListener('change', renderOmegaView);
  els.focusTrajectory.addEventListener('click', focusOmegaCamera);

  els.presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      applyPreset(button.dataset.preset);
      resetSimulation();
    });
  });
}

function applyPreset(name) {
  const preset = PRESETS[name];
  els.omegaX.value = preset.x;
  els.omegaY.value = preset.y;
  els.omegaZ.value = preset.z;

  els.presetButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.preset === name);
  });
}

function readOmegaInputs() {
  return {
    x: readFiniteNumber(els.omegaX.value, PRESETS.middle.x),
    y: readFiniteNumber(els.omegaY.value, PRESETS.middle.y),
    z: readFiniteNumber(els.omegaZ.value, PRESETS.middle.z),
  };
}

function readFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pushOmegaSample(omega) {
  state.history.push(new THREE.Vector3(omega.x, omega.y, omega.z));
  trimTrail();
}

function trimTrail() {
  if (state.history.length > state.maxTrail) {
    state.history.splice(0, state.history.length - state.maxTrail);
  }
}

function updateEllipsoids() {
  const { energy, angularMomentum } = state.initialInvariants;
  ellipsoidState.energyAxes = [
    Math.sqrt(Math.max((2 * energy) / INERTIA.x, 1e-12)),
    Math.sqrt(Math.max((2 * energy) / INERTIA.y, 1e-12)),
    Math.sqrt(Math.max((2 * energy) / INERTIA.z, 1e-12)),
  ];
  ellipsoidState.momentumAxes = [
    angularMomentum / INERTIA.x,
    angularMomentum / INERTIA.y,
    angularMomentum / INERTIA.z,
  ];
  ellipsoidState.bounds = Math.max(
    ...ellipsoidState.energyAxes,
    ...ellipsoidState.momentumAxes,
    1,
  );
  focusOmegaCamera();
}

function focusOmegaCamera() {
  omegaView.yaw = -0.72;
  omegaView.pitch = -0.48;
  omegaView.distance = Math.max(ellipsoidState.bounds * 3.4, 4);
}

function updateDiagnostics() {
  const current = invariants(state.omega);
  const energyDrift = relativeDrift(current.energy, state.initialInvariants.energy);
  const momentumDrift = relativeDrift(
    current.angularMomentumSq,
    state.initialInvariants.angularMomentumSq,
  );

  const bodyMiddleAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(state.bodyQuaternion);
  const flipAngle = THREE.MathUtils.radToDeg(state.initialAxis.angleTo(bodyMiddleAxis));

  els.simTime.textContent = `t = ${state.time.toFixed(2)} s`;
  els.energyDrift.textContent = formatDrift(energyDrift);
  els.momentumDrift.textContent = formatDrift(momentumDrift);
  els.ratioValue.textContent = current.ratio.toFixed(4);
  els.flipAngle.textContent = `${flipAngle.toFixed(0)}°`;
  els.omegaReadout.textContent = `ω = (${state.omega.x.toFixed(3)}, ${state.omega.y.toFixed(3)}, ${state.omega.z.toFixed(3)})`;
}

function relativeDrift(value, reference) {
  if (Math.abs(reference) < Number.EPSILON) return 0;
  return value / reference - 1;
}

function formatDrift(value) {
  const ppm = value * 1_000_000;
  if (Math.abs(ppm) < 0.005) return '0.00 ppm';
  if (Math.abs(ppm) < 10_000) return `${ppm.toFixed(2)} ppm`;
  return `${(value * 100).toFixed(3)}%`;
}

function createCanvasView(container, options) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const view = {
    canvas,
    context,
    width: 1,
    height: 1,
    dpr: 1,
    yaw: options.yaw,
    pitch: options.pitch,
    distance: options.distance,
    background: options.background,
    scale: 1,
  };

  container.appendChild(canvas);
  resizeCanvasView(view, container);
  new ResizeObserver(() => resizeCanvasView(view, container)).observe(container);
  bindCanvasOrbit(view);
  return view;
}

function resizeCanvasView(view, container) {
  const rect = container.getBoundingClientRect();
  view.width = Math.max(rect.width, 1);
  view.height = Math.max(rect.height, 1);
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.canvas.width = Math.round(view.width * view.dpr);
  view.canvas.height = Math.round(view.height * view.dpr);
  view.context.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
}

function bindCanvasOrbit(view) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  view.canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    view.canvas.setPointerCapture(event.pointerId);
  });

  view.canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;

    view.yaw += dx * 0.008;
    view.pitch = clamp(view.pitch + dy * 0.008, -1.18, 1.18);
  });

  view.canvas.addEventListener('pointerup', (event) => {
    dragging = false;
    view.canvas.releasePointerCapture(event.pointerId);
  });

  view.canvas.addEventListener('pointercancel', () => {
    dragging = false;
  });
}

function renderBodyView() {
  const view = bodyView;
  const ctx = view.context;
  view.scale = Math.min(view.width, view.height) * 0.34;
  clearView(view);
  drawGroundGrid(view);
  drawTBody(view);
  drawBodyAxes(view);
}

function renderOmegaView() {
  const view = omegaView;
  view.scale = Math.min(view.width, view.height) / (ellipsoidState.bounds * 2.95);
  clearView(view);

  if (els.ellipsoidToggle.checked) {
    drawEllipsoidSurface(view, ellipsoidState.momentumAxes, '#3478d9', 0.14);
    drawEllipsoidSurface(view, ellipsoidState.energyAxes, '#2f9d69', 0.16);
    drawEllipsoidWireframe(view, ellipsoidState.momentumAxes, '#3478d9', 0.22);
    drawEllipsoidWireframe(view, ellipsoidState.energyAxes, '#2f9d69', 0.24);
  }

  drawOmegaAxes(view);
  drawConstraintCurve(view);
  drawTrajectory(view);
  drawOmegaLegend(view);
}

function clearView(view) {
  const ctx = view.context;
  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.fillStyle = view.background;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.restore();
}

function drawGroundGrid(view) {
  const lines = [];
  const size = 2.8;
  const step = 0.4;
  for (let value = -size; value <= size + 1e-9; value += step) {
    lines.push([new THREE.Vector3(value, -1.35, -size), new THREE.Vector3(value, -1.35, size)]);
    lines.push([new THREE.Vector3(-size, -1.35, value), new THREE.Vector3(size, -1.35, value)]);
  }

  const ctx = view.context;
  ctx.save();
  ctx.strokeStyle = '#d3ded9';
  ctx.lineWidth = 1;
  lines.forEach(([start, end]) => drawProjectedLine(view, start, end));
  ctx.restore();
}

function drawTBody(view) {
  const parts = [
    { size: [1.5, 0.34, 0.34], position: [0, 0.58, 0], color: '#dfe8e4' },
    { size: [0.38, 1.55, 0.34], position: [0, -0.18, 0], color: '#dfe8e4' },
    { size: [0.18, 0.4, 0.38], position: [-0.76, 0.58, 0], color: '#d16b31' },
    { size: [0.18, 0.4, 0.38], position: [0.76, 0.58, 0], color: '#d16b31' },
  ];

  const faces = [];
  parts.forEach((part) => faces.push(...cuboidFaces(part)));
  faces.sort((a, b) => a.depth - b.depth);

  const ctx = view.context;
  faces.forEach((face) => {
    ctx.beginPath();
    face.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = shadeColor(face.color, face.shade);
    ctx.strokeStyle = 'rgba(35, 47, 50, 0.36)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();
  });
}

function cuboidFaces(part) {
  const [sx, sy, sz] = part.size;
  const [px, py, pz] = part.position;
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const vertices = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ].map(([x, y, z]) =>
    new THREE.Vector3(x + px, y + py, z + pz).applyQuaternion(state.bodyQuaternion),
  );

  const faceIndices = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
    [0, 1, 5, 4],
    [3, 7, 6, 2],
  ];

  return faceIndices.map((indices) => {
    const points3 = indices.map((index) => vertices[index]);
    const normal = new THREE.Vector3()
      .subVectors(points3[1], points3[0])
      .cross(new THREE.Vector3().subVectors(points3[2], points3[1]))
      .normalize();
    const shade = 0.56 + Math.max(0, normal.dot(LIGHT_DIRECTION)) * 0.44;
    const projected = points3.map((point) => projectPoint(bodyView, point));
    const depth =
      points3.reduce((sum, point) => sum + cameraTransform(bodyView, point).z, 0) / points3.length;

    return { points: projected, depth, shade, color: part.color };
  });
}

function drawBodyAxes(view) {
  const axes = [
    ['x', '#d94b4b', new THREE.Vector3(1, 0, 0)],
    ['y', '#2f9d69', new THREE.Vector3(0, 1, 0)],
    ['z', '#3478d9', new THREE.Vector3(0, 0, 1)],
  ];
  axes.forEach(([label, color, direction]) => {
    const end = direction.clone().multiplyScalar(1.35).applyQuaternion(state.bodyQuaternion);
    drawArrow3D(view, new THREE.Vector3(0, 0, 0), end, color, label);
  });
}

function drawOmegaAxes(view) {
  const length = ellipsoidState.bounds * 1.22;
  [
    ['ωx', '#d94b4b', new THREE.Vector3(length, 0, 0)],
    ['ωy', '#2f9d69', new THREE.Vector3(0, length, 0)],
    ['ωz', '#3478d9', new THREE.Vector3(0, 0, length)],
  ].forEach(([label, color, end]) => drawArrow3D(view, new THREE.Vector3(0, 0, 0), end, color, label));
}

function drawEllipsoidSurface(view, axes, color, alpha) {
  const ctx = view.context;
  const patches = [];
  const latSegments = 15;
  const lonSegments = 30;

  for (let lat = 0; lat < latSegments; lat += 1) {
    const phi0 = -Math.PI / 2 + (lat / latSegments) * Math.PI;
    const phi1 = -Math.PI / 2 + ((lat + 1) / latSegments) * Math.PI;

    for (let lon = 0; lon < lonSegments; lon += 1) {
      const theta0 = (lon / lonSegments) * TWO_PI;
      const theta1 = ((lon + 1) / lonSegments) * TWO_PI;
      const points3 = [
        ellipsoidPoint(axes, phi0, theta0),
        ellipsoidPoint(axes, phi0, theta1),
        ellipsoidPoint(axes, phi1, theta1),
        ellipsoidPoint(axes, phi1, theta0),
      ];
      const normal = new THREE.Vector3()
        .subVectors(points3[1], points3[0])
        .cross(new THREE.Vector3().subVectors(points3[2], points3[1]))
        .normalize();
      const depth =
        points3.reduce((sum, point) => sum + cameraTransform(view, point).z, 0) / points3.length;
      const shade = 0.62 + Math.max(0, normal.dot(LIGHT_DIRECTION)) * 0.32;
      patches.push({
        depth,
        points: points3.map((point) => projectPoint(view, point)),
        fill: shadeColorRgba(color, shade, alpha),
      });
    }
  }

  patches.sort((a, b) => a.depth - b.depth);

  ctx.save();
  patches.forEach((patch) => {
    ctx.beginPath();
    patch.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = patch.fill;
    ctx.fill();
  });
  ctx.restore();
}

function drawEllipsoidWireframe(view, axes, color, alpha) {
  const ctx = view.context;
  ctx.save();
  ctx.strokeStyle = hexToRgba(color, alpha);
  ctx.lineWidth = 1;

  for (let lat = -60; lat <= 60; lat += 30) {
    const phi = THREE.MathUtils.degToRad(lat);
    const points = [];
    for (let step = 0; step <= 96; step += 1) {
      const theta = (step / 96) * TWO_PI;
      points.push(ellipsoidPoint(axes, phi, theta));
    }
    drawProjectedPolyline(view, points);
  }

  for (let lon = 0; lon < 180; lon += 30) {
    const theta = THREE.MathUtils.degToRad(lon);
    const points = [];
    for (let step = 0; step <= 96; step += 1) {
      const phi = -Math.PI / 2 + (step / 96) * Math.PI;
      points.push(ellipsoidPoint(axes, phi, theta));
    }
    drawProjectedPolyline(view, points);
  }
  ctx.restore();
}

function ellipsoidPoint([a, b, c], phi, theta) {
  return new THREE.Vector3(
    a * Math.cos(phi) * Math.cos(theta),
    b * Math.sin(phi),
    c * Math.cos(phi) * Math.sin(theta),
  );
}

function computeConstraintCurve(initialOmega) {
  const curve = [new THREE.Vector3(initialOmega.x, initialOmega.y, initialOmega.z)];
  let omega = { ...initialOmega };
  const sampleStep = 0.024;
  const sampleCount = 2600;

  for (let index = 0; index < sampleCount; index += 1) {
    omega = implicitMidpointStep(omega, sampleStep, INERTIA);
    curve.push(new THREE.Vector3(omega.x, omega.y, omega.z));
  }

  return curve;
}

function drawConstraintCurve(view) {
  if (state.constraintCurve.length < 2) return;

  const ctx = view.context;
  ctx.save();
  ctx.strokeStyle = 'rgba(111, 87, 51, 0.48)';
  ctx.lineWidth = 1.5;
  drawProjectedPolyline(view, state.constraintCurve);
  ctx.restore();
}

function drawTrajectory(view) {
  const ctx = view.context;
  if (state.history.length > 1) {
    ctx.save();
    ctx.strokeStyle = '#d16b31';
    ctx.lineWidth = 2.2;
    drawProjectedPolyline(view, state.history);
    ctx.restore();
  }

  const current = new THREE.Vector3(state.omega.x, state.omega.y, state.omega.z);
  const projected = projectPoint(view, current);
  ctx.save();
  ctx.fillStyle = '#f1b434';
  ctx.strokeStyle = '#8a5a00';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(projected.x, projected.y, 5.5, 0, TWO_PI);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawOmegaLegend(view) {
  const ctx = view.context;
  const items = [
    ['#2f9d69', 'T'],
    ['#3478d9', 'L'],
    ['#d16b31', 'ω'],
  ];
  const x = 16;
  const y = view.height - 26;

  ctx.save();
  ctx.font = '600 12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textBaseline = 'middle';
  items.forEach(([color, label], index) => {
    const offset = index * 42;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + offset, y, 4, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = '#526064';
    ctx.fillText(label, x + offset + 8, y);
  });
  ctx.restore();
}

function drawProjectedPolyline(view, points) {
  if (points.length < 2) return;

  const ctx = view.context;
  ctx.beginPath();
  points.forEach((point, index) => {
    const projected = projectPoint(view, point);
    if (index === 0) ctx.moveTo(projected.x, projected.y);
    else ctx.lineTo(projected.x, projected.y);
  });
  ctx.stroke();
}

function drawProjectedLine(view, start, end) {
  const ctx = view.context;
  const a = projectPoint(view, start);
  const b = projectPoint(view, end);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function drawArrow3D(view, start, end, color, label) {
  const ctx = view.context;
  const a = projectPoint(view, start);
  const b = projectPoint(view, end);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = 9;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - Math.cos(angle - 0.45) * head, b.y - Math.sin(angle - 0.45) * head);
  ctx.lineTo(b.x - Math.cos(angle + 0.45) * head, b.y - Math.sin(angle + 0.45) * head);
  ctx.closePath();
  ctx.fill();

  ctx.font = '600 13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.fillText(label, b.x + Math.cos(angle) * 10, b.y + Math.sin(angle) * 10);
  ctx.restore();
}

function projectPoint(view, point) {
  const transformed = cameraTransform(view, point);
  const perspective = view.distance / Math.max(view.distance - transformed.z, 0.2);

  return {
    x: view.width / 2 + transformed.x * view.scale * perspective,
    y: view.height / 2 - transformed.y * view.scale * perspective,
    depth: transformed.z,
  };
}

function cameraTransform(view, point) {
  const cy = Math.cos(view.yaw);
  const sy = Math.sin(view.yaw);
  const cp = Math.cos(view.pitch);
  const sp = Math.sin(view.pitch);

  const x1 = cy * point.x - sy * point.z;
  const z1 = sy * point.x + cy * point.z;
  const y2 = cp * point.y - sp * z1;
  const z2 = sp * point.y + cp * z1;

  return { x: x1, y: y2, z: z2 };
}

function shadeColor(hex, shade) {
  const { r, g, b } = parseHex(hex);
  const lift = 18;
  return `rgb(${clamp(Math.round(r * shade + lift), 0, 255)}, ${clamp(
    Math.round(g * shade + lift),
    0,
    255,
  )}, ${clamp(Math.round(b * shade + lift), 0, 255)})`;
}

function shadeColorRgba(hex, shade, alpha) {
  const { r, g, b } = parseHex(hex);
  const lift = 24;
  return `rgba(${clamp(Math.round(r * shade + lift), 0, 255)}, ${clamp(
    Math.round(g * shade + lift),
    0,
    255,
  )}, ${clamp(Math.round(b * shade + lift), 0, 255)}, ${alpha})`;
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parseHex(hex) {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
