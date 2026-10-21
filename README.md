# h125-threejs

A 3D Airbus H125 helicopter built with [three.js](https://threejs.org/) that you can orbit around in the browser.

The model is generated entirely in code from the real aircraft's dimensions (about 12.9 m long with a 10.69 m main rotor), so there are no external model files.

## Run locally

```bash
npm install
npm run dev
```

Then open the URL Vite prints. Drag to orbit, scroll or pinch to zoom, right-drag to pan. The "Spin rotors" button starts the main and tail rotors.

## Project layout

- `src/main.js` sets up the renderer, lighting, ground, camera and orbit controls.
- `src/helicopter.js` builds the H125: lofted fuselage with glazing, engine cowling, rotor head and blades, tail surfaces, skids and lights.

## Deploying

Pushes to `main` build the site and publish it to GitHub Pages via `.github/workflows/deploy.yml`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions** once.
