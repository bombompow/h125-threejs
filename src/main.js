import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createH125 } from './helicopter.js';

const canvas = document.getElementById('scene');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -9;
sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9;
sun.shadow.camera.bottom = -9;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 30;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f96, 0.4));

// Ground: a soft shadow catcher on top of a large matte floor.
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(60, 64),
  new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const pad = new THREE.Mesh(
  new THREE.RingGeometry(6.2, 6.4, 96),
  new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8 })
);
pad.rotation.x = -Math.PI / 2;
pad.position.y = 0.002;
scene.add(pad);

const helicopter = createH125();
scene.add(helicopter.root);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
const home = { position: new THREE.Vector3(7.5, 3.6, 8.5), target: new THREE.Vector3(-1.6, 1.5, 0) };
camera.position.copy(home.position);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(home.target);
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

document.getElementById('reset').addEventListener('click', () => {
  camera.position.copy(home.position);
  controls.target.copy(home.target);
  controls.update();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Rotor speed eases in and out instead of snapping on or off.
let rotorSpeed = 0;
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const targetSpeed = spinning ? 1 : 0;
  rotorSpeed += (targetSpeed - rotorSpeed) * Math.min(dt * 0.8, 1);
  helicopter.update(dt, rotorSpeed);
  controls.update();
  renderer.render(scene, camera);
});

// Exposed for screenshots and debugging in the browser console.
window.__h125 = { scene, camera, controls, helicopter };
