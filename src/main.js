import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createH125 } from './helicopter.js';

const canvas = document.getElementById('scene');
// Phones and low-core devices get a lighter render setup.
const lowPower = window.matchMedia('(max-width: 700px)').matches || (navigator.hardwareConcurrency || 8) <= 4;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd9dee4);
scene.fog = new THREE.Fog(0xd9dee4, 30, 70);

// Studio-style image based lighting, generated in code so no HDR download is needed.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(6, 12, 5);
sun.castShadow = true;
sun.shadow.mapSize.setScalar(lowPower ? 1024 : 2048);
sun.shadow.camera.left = -11;
sun.shadow.camera.right = 11;
sun.shadow.camera.top = 11;
sun.shadow.camera.bottom = -11;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.4));

// Ground: pale concrete with a darker helipad, touchdown ring and "H" marking.
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(60, 64),
  new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const marking = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.75 });
const addFlat = (geometry, material, x, z, y) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
};
addFlat(new THREE.CircleGeometry(7.8, 96), new THREE.MeshStandardMaterial({ color: 0x9da3aa, roughness: 0.9 }), -1.5, 0, 0.002);
addFlat(new THREE.RingGeometry(7.2, 7.45, 96), marking, -1.5, 0, 0.004);
addFlat(new THREE.PlaneGeometry(3.4, 0.45), marking, -1.5, 1.1, 0.004);
addFlat(new THREE.PlaneGeometry(3.4, 0.45), marking, -1.5, -1.1, 0.004);
addFlat(new THREE.PlaneGeometry(0.45, 1.75), marking, -1.5, 0, 0.004);

const helicopter = createH125();
scene.add(helicopter.root);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
const views = {
  home: { position: [8, 3.8, 9.5], target: [-2, 1.5, 0] },
  front: { position: [11, 2.2, 0], target: [0, 1.6, 0] },
  side: { position: [-2, 1.8, 15], target: [-2, 1.6, 0] },
  rear: { position: [-12, 3, -6], target: [-2.5, 1.6, 0] },
  top: { position: [-2, 17, 0.01], target: [-2, 0, 0] },
  cockpit: { position: [4.6, 1.9, 1.6], target: [1.6, 1.3, 0] },
};
const viewPose = (name) => ({
  position: new THREE.Vector3(...views[name].position),
  target: new THREE.Vector3(...views[name].target),
});

// Keep the horizontal field of view at least 40 degrees so portrait phones
// see the whole helicopter instead of a cropped middle.
const fitCamera = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  const minHorizontal = THREE.MathUtils.degToRad(40);
  const vertical = 2 * Math.atan(Math.tan(minHorizontal / 2) / camera.aspect);
  camera.fov = Math.max(40, THREE.MathUtils.radToDeg(vertical));
  camera.updateProjectionMatrix();
};
fitCamera();
camera.position.copy(viewPose('home').position);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(viewPose('home').target);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 3;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.495;
controls.update();

const spinButton = document.getElementById('spin');
let spinning = false;
spinButton.addEventListener('click', () => {
  spinning = !spinning;
  spinButton.setAttribute('aria-pressed', String(spinning));
  spinButton.textContent = spinning ? 'Stop rotors' : 'Spin rotors';
});

// Smoothly fly the camera to a preset view.
let flight = null;
const flyTo = (name) => {
  const to = viewPose(name);
  flight = { fromPos: camera.position.clone(), fromTarget: controls.target.clone(), to, start: performance.now() };
};
controls.addEventListener('start', () => (flight = null));
document.querySelectorAll('[data-view]').forEach((button) => {
  button.addEventListener('click', () => flyTo(button.dataset.view));
});

window.addEventListener('resize', () => {
  fitCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const loading = document.getElementById('loading');

// Rotor speed eases in and out instead of snapping on or off.
let rotorSpeed = 0;
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const targetSpeed = spinning ? 1 : 0;
  rotorSpeed += (targetSpeed - rotorSpeed) * Math.min(dt * 0.8, 1);
  helicopter.update(dt, rotorSpeed);
  if (flight) {
    // Timed on the wall clock so slow frames don't stretch the move.
    const t = Math.min((performance.now() - flight.start) / 1200, 1);
    const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    camera.position.lerpVectors(flight.fromPos, flight.to.position, e);
    controls.target.lerpVectors(flight.fromTarget, flight.to.target, e);
    if (t === 1) flight = null;
  }
  controls.update();
  renderer.render(scene, camera);
  loading.classList.add('done');
});

// Exposed for screenshots and debugging in the browser console.
window.__h125 = { scene, camera, controls, helicopter };
