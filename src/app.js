import { geoGraticule10, geoOrthographic, geoOrthographicRaw, geoPath, geoProjection } from "d3-geo";
import { easeCubicInOut } from "d3-ease";
import { feature } from "topojson-client";
import { interpolateRaw, planarRaw } from "./projection-math.js";

const canvas = document.querySelector("#map");
const stage = document.querySelector("#stageShell");
const slider = document.querySelector("#morph");
const value = document.querySelector("#morphValue");
const wrapButton = document.querySelector("#wrap");
const context = canvas.getContext("2d");
const flatBuffer = document.createElement("canvas");
const globeBuffer = document.createElement("canvas");
const flatContext = flatBuffer.getContext("2d");
const globeContext = globeBuffer.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const PAPER = "#f3efe5";

let land;
let flatT = 0;
let wrapT = 0;
let centerT = 0;
let globe = false;
let transitionFrame;
let inertiaFrame;
let rotation = [-12, -18, 0];
let zoom = 1;
let dragging = false;
let lastPointer;
let lastPointerTime = 0;
let angularVelocity = [0, 0];

function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  const rect = stage.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  flatBuffer.width = canvas.width;
  flatBuffer.height = canvas.height;
  globeBuffer.width = canvas.width;
  globeBuffer.height = canvas.height;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  flatContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  globeContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function projectionLayout() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const planarWidth = 2 * Math.PI + (5.306001713 - 2 * Math.PI) * flatT;
  const planarHeight = 2 * Math.PI + (2.652999475 - 2 * Math.PI) * flatT;
  const planeScale = Math.min(width * .86 / planarWidth, height * .70 / planarHeight);
  const globeScale = Math.min(width, height) * .39 * zoom;
  const restingOffset = Math.min(28, height * .035);
  const poseT = easeCubicInOut(smoothstep(0, 1, wrapT));
  return {
    scale: planeScale + (globeScale - planeScale) * poseT,
    translate: [width / 2, height / 2 - restingOffset * (1 - centerT)],
    rotate: rotation.map(component => component * poseT)
  };
}

function currentProjection() {
  // Complete the surface curvature early. From 55% onward, this raw geometry
  // exactly matches the clipped frontal globe while its pose keeps moving.
  const shapeT = easeCubicInOut(smoothstep(0, .55, wrapT));
  const raw = interpolateRaw(planarRaw(flatT), geoOrthographicRaw, shapeT);
  const projection = geoProjection(raw).precision(.15);
  const layout = projectionLayout();

  projection
    .scale(layout.scale)
    .translate(layout.translate)
    .rotate(layout.rotate);

  return projection;
}

function globeProjection() {
  const layout = projectionLayout();
  return geoOrthographic()
    .precision(.15)
    .clipAngle(90)
    .scale(layout.scale)
    .translate(layout.translate)
    .rotate(layout.rotate);
}

function drawLayer(target, projection, alpha, outlineAlpha) {
  if (alpha <= 0) return;
  const path = geoPath(projection, target);
  target.save();
  target.globalAlpha = alpha;

  target.beginPath();
  path(geoGraticule10());
  target.strokeStyle = "rgba(48,57,76,.22)";
  target.lineWidth = .7;
  target.stroke();

  target.beginPath();
  path(land);
  target.fillStyle = "#4e88b7";
  target.fill();

  target.globalAlpha = outlineAlpha;
  target.beginPath();
  path({ type: "Sphere" });
  target.strokeStyle = "#30394c";
  target.lineWidth = 1.25;
  target.stroke();
  target.restore();
}

function clearBuffer(target) {
  target.save();
  target.globalAlpha = 1;
  target.fillStyle = PAPER;
  target.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  target.restore();
}

function draw() {
  if (!land) return;
  const flatOutline = 1 - smoothstep(0, .22, wrapT);
  const globeReveal = smoothstep(.55, .70, wrapT);
  const globeOutline = globeReveal;

  // Never apply a spherical clip to the interpolated raw projection: Chrome
  // and Firefox disagree on that invalid intermediate geometry. Instead,
  // crossfade two complete opaque frames only after their front hemispheres
  // are pixel-aligned. The dissolve then removes the rear hemisphere instead
  // of blending two visibly different maps.
  clearBuffer(flatContext);
  drawLayer(flatContext, currentProjection(), 1, flatOutline);
  clearBuffer(globeContext);
  drawLayer(globeContext, globeProjection(), 1, globeOutline);

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.drawImage(flatBuffer, 0, 0);
  if (globeReveal > 0) {
    context.globalAlpha = globeReveal;
    context.drawImage(globeBuffer, 0, 0);
  }
  context.restore();
}

function stopInertia() {
  cancelAnimationFrame(inertiaFrame);
  inertiaFrame = undefined;
}

function startInertia() {
  stopInertia();
  if (reducedMotion.matches || Math.hypot(...angularVelocity) < .005) return;
  let previous = performance.now();
  const tick = now => {
    const elapsed = Math.min(32, now - previous);
    previous = now;
    rotation[0] += angularVelocity[0] * elapsed;
    rotation[1] += angularVelocity[1] * elapsed;
    const damping = Math.exp(-.0048 * elapsed);
    angularVelocity[0] *= damping;
    angularVelocity[1] *= damping;
    draw();
    if (globe && Math.hypot(...angularVelocity) > .001)
      inertiaFrame = requestAnimationFrame(tick);
  };
  inertiaFrame = requestAnimationFrame(tick);
}

function animateWrap(target) {
  cancelAnimationFrame(transitionFrame);
  stopInertia();
  const startWrap = wrapT;
  const startCenter = centerT;
  const begin = performance.now();
  const duration = reducedMotion.matches ? 0 : 1650;

  const frame = now => {
    const progress = duration ? Math.min(1, (now - begin) / duration) : 1;
    if (target === 1) {
      // Recenter first, then continuously bend the full map into a globe.
      centerT = startCenter + (1 - startCenter) * easeCubicInOut(Math.min(1, progress / .2));
      const fold = Math.max(0, (progress - .12) / .88);
      wrapT = startWrap + (1 - startWrap) * easeCubicInOut(fold);
    } else {
      // Reveal the rear hemisphere while flattening, then restore the resting
      // offset after the map is fully unfolded.
      wrapT = startWrap * (1 - easeCubicInOut(Math.min(1, progress / .9)));
      const settle = Math.max(0, (progress - .84) / .16);
      centerT = startCenter * (1 - easeCubicInOut(settle));
    }
    draw();
    if (progress < 1) transitionFrame = requestAnimationFrame(frame);
  };
  transitionFrame = requestAnimationFrame(frame);
}

slider.addEventListener("input", () => {
  flatT = Number(slider.value) / 100;
  value.value = `${slider.value} %`;
  if (globe) {
    globe = false;
    stage.classList.remove("globe");
    wrapButton.setAttribute("aria-pressed", "false");
    wrapButton.querySelector(".button-label").textContent = "wrap globe";
    animateWrap(0);
  } else draw();
});

wrapButton.addEventListener("click", () => {
  globe = !globe;
  stage.classList.toggle("globe", globe);
  wrapButton.setAttribute("aria-pressed", String(globe));
  wrapButton.querySelector(".button-label").textContent = globe ? "unwrap map" : "wrap globe";
  animateWrap(globe ? 1 : 0);
});

canvas.addEventListener("pointerdown", event => {
  if (!globe) return;
  stopInertia();
  dragging = true;
  lastPointer = [event.clientX, event.clientY];
  lastPointerTime = performance.now();
  angularVelocity = [0, 0];
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", event => {
  if (!dragging || !globe) return;
  const next = [event.clientX, event.clientY];
  const now = performance.now();
  const elapsed = Math.max(8, now - lastPointerTime);
  const delta = [(next[0] - lastPointer[0]) * .34, -(next[1] - lastPointer[1]) * .34];
  rotation[0] += delta[0];
  rotation[1] += delta[1];
  angularVelocity = [delta[0] / elapsed, delta[1] / elapsed];
  lastPointer = next;
  lastPointerTime = now;
  draw();
});

function releaseGlobe() {
  if (!dragging) return;
  dragging = false;
  startInertia();
}
canvas.addEventListener("pointerup", releaseGlobe);
canvas.addEventListener("pointercancel", releaseGlobe);

canvas.addEventListener("wheel", event => {
  if (!globe) return;
  event.preventDefault();
  zoom = Math.max(.65, Math.min(1.4, zoom * Math.exp(-event.deltaY * .001)));
  draw();
}, { passive: false });

fetch("assets/world-lowres.json")
  .then(response => {
    if (!response.ok) throw new Error("world data unavailable");
    return response.json();
  })
  .then(world => {
    land = feature(world, world.objects.countries);
    resize();
  })
  .catch(() => document.querySelector(".message").textContent = "map unavailable");

new ResizeObserver(resize).observe(stage);
