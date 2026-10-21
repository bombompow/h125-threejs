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
const home = { position: new THREE.Vector3(8, 3.8, 9.5), target: new THREE.Vector3(-2, 1.5, 0) };
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
