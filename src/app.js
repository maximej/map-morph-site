import { geoGraticule10, geoOrthographicRaw, geoPath, geoProjection } from "d3-geo";
import { easeCubicInOut } from "d3-ease";
import { feature, mesh } from "topojson-client";
import { interpolateRaw, planarRaw } from "./projection-math.js";

const canvas=document.querySelector("#map"),stage=document.querySelector("#stageShell"),slider=document.querySelector("#morph"),value=document.querySelector("#morphValue"),wrapButton=document.querySelector("#wrap"),context=canvas.getContext("2d"),reducedMotion=matchMedia("(prefers-reduced-motion: reduce)");
let land,borders,flatT=0,wrapT=0,globe=false,animationFrame,rotation=[-12,-18,0],zoom=1,dragging=false,lastPointer;

function resize(){const ratio=Math.min(devicePixelRatio||1,2),rect=stage.getBoundingClientRect();canvas.width=Math.round(rect.width*ratio);canvas.height=Math.round(rect.height*ratio);context.setTransform(ratio,0,0,ratio,0,0);draw();}
function currentProjection(){const width=canvas.clientWidth,height=canvas.clientHeight,raw=interpolateRaw(planarRaw(flatT),geoOrthographicRaw,wrapT),projection=geoProjection(raw).precision(.15),planeScale=Math.min(width/6.75,height/3.85),globeScale=Math.min(width,height)*.39*zoom;projection.scale(planeScale+(globeScale-planeScale)*wrapT).translate([width/2,height/2-Math.min(30,height*.035)]).rotate(rotation.map(component=>component*wrapT));if(wrapT>.001)projection.clipAngle(179.999-89.999*easeCubicInOut(wrapT));return projection;}
function draw(){if(!land)return;const width=canvas.clientWidth,height=canvas.clientHeight;context.clearRect(0,0,width,height);const path=geoPath(currentProjection(),context);context.save();context.beginPath();path({type:"Sphere"});context.fillStyle="#fff8e8";context.fill();context.clip();context.beginPath();path(geoGraticule10());context.strokeStyle="rgba(52,53,82,.25)";context.lineWidth=.7;context.stroke();context.beginPath();path(land);context.fillStyle="#e77562";context.fill();context.beginPath();path(borders);context.strokeStyle="rgba(52,53,82,.58)";context.lineWidth=.55;context.stroke();context.restore();context.beginPath();path({type:"Sphere"});context.strokeStyle="#343552";context.lineWidth=1.3;context.stroke();}
function animateWrap(target){cancelAnimationFrame(animationFrame);const start=wrapT,begin=performance.now(),duration=reducedMotion.matches?0:850;const frame=now=>{const progress=duration?Math.min(1,(now-begin)/duration):1;wrapT=start+(target-start)*easeCubicInOut(progress);draw();if(progress<1)animationFrame=requestAnimationFrame(frame);};animationFrame=requestAnimationFrame(frame);}

slider.addEventListener("input",()=>{flatT=Number(slider.value)/100;value.value=`${slider.value} %`;if(globe){globe=false;stage.classList.remove("globe");wrapButton.setAttribute("aria-pressed","false");wrapButton.querySelector(".button-label").textContent="wrap globe";animateWrap(0);}else draw();});
wrapButton.addEventListener("click",()=>{globe=!globe;stage.classList.toggle("globe",globe);wrapButton.setAttribute("aria-pressed",String(globe));wrapButton.querySelector(".button-label").textContent=globe?"unwrap map":"wrap globe";animateWrap(globe?1:0);});
canvas.addEventListener("pointerdown",event=>{if(!globe)return;dragging=true;lastPointer=[event.clientX,event.clientY];canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener("pointermove",event=>{if(!dragging||!globe)return;const next=[event.clientX,event.clientY];rotation[0]+=(next[0]-lastPointer[0])*.34;rotation[1]=Math.max(-75,Math.min(75,rotation[1]-(next[1]-lastPointer[1])*.34));lastPointer=next;draw();});
for(const type of ["pointerup","pointercancel"])canvas.addEventListener(type,()=>dragging=false);
canvas.addEventListener("wheel",event=>{if(!globe)return;event.preventDefault();zoom=Math.max(.65,Math.min(1.4,zoom*Math.exp(-event.deltaY*.001)));draw();},{passive:false});
fetch("assets/world-lowres.json").then(response=>{if(!response.ok)throw new Error("world data unavailable");return response.json();}).then(world=>{land=feature(world,world.objects.countries);borders=mesh(world,world.objects.countries,(a,b)=>a!==b);resize();}).catch(()=>document.querySelector(".message").textContent="map unavailable");
new ResizeObserver(resize).observe(stage);
