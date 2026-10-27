import { geoGraticule10, geoOrthographicRaw, geoPath, geoProjection } from "d3-geo";
import { easeCubicInOut } from "d3-ease";
import { feature } from "topojson-client";
import { interpolateRaw, planarRaw } from "./projection-math.js";

const canvas = document.querySelector("#map");
const stage = document.querySelector("#stageShell");
const slider = document.querySelector("#morph");
const value = document.querySelector("#morphValue");
const wrapButton = document.querySelector("#wrap");
const context = canvas.getContext("2d");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

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
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function currentProjection() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const raw = interpolateRaw(planarRaw(flatT), geoOrthographicRaw, wrapT);
  const projection = geoProjection(raw).precision(.15);
  const planeScale = Math.min(width / 6.75, height / 3.85);
  const globeScale = Math.min(width, height) * .39 * zoom;
  const restingOffset = Math.min(28, height * .035);

  return projection
    .scale(planeScale + (globeScale - planeScale) * wrapT)
    .translate([width / 2, height / 2 - restingOffset * (1 - centerT)])
    .rotate(rotation.map(component => component * wrapT))
    // Use the same circular preclip throughout. Changing from the default
    // antimeridian clip on click was the source of the visible jump.
    .clipAngle(179.999 - 89.999 * easeCubicInOut(wrapT));
}

function draw() {
  if (!land) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.clearRect(0, 0, width, height);
  const path = geoPath(currentProjection(), context);

  context.save();
  context.beginPath();
  path({ type: "Sphere" });
  context.fillStyle = "#fffdf7";
  context.fill();
  context.clip();

  context.beginPath();
  path(geoGraticule10());
  context.strokeStyle = "rgba(48,57,76,.22)";
  context.lineWidth = .7;
  context.stroke();

  context.beginPath();
  path(land);
  context.fillStyle = "#4e88b7";
  context.fill();
  context.restore();

  context.beginPath();
  path({ type: "Sphere" });
  context.strokeStyle = "#30394c";
  context.lineWidth = 1.25;
  context.stroke();
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
    rotation[1] = Math.max(-75, Math.min(75, rotation[1] + angularVelocity[1] * elapsed));
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
  const duration = reducedMotion.matches ? 0 : 1250;

  const frame = now => {
    const progress = duration ? Math.min(1, (now - begin) / duration) : 1;
    if (target === 1) {
      // First recentre the map, then fold it into the globe.
      centerT = startCenter + (1 - startCenter) * easeCubicInOut(Math.min(1, progress / .28));
      const fold = Math.max(0, (progress - .24) / .76);
      wrapT = startWrap + (1 - startWrap) * easeCubicInOut(fold);
    } else {
      // Unfold completely before returning to the planisphere resting place.
      const unfold = Math.min(1, progress / .76);
      wrapT = startWrap * (1 - easeCubicInOut(unfold));
      const settle = Math.max(0, (progress - .72) / .28);
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
  rotation[1] = Math.max(-75, Math.min(75, rotation[1] + delta[1]));
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
