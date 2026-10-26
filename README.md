# BoidsBulkV3

Large-flock browser simulation, starting with 20,000 boids and supporting a selectable population of 1,000–100,000.

Open `BoidsBulkV3.html` through an HTTP server. The existing website serves it at `/Projects/BoidsBulkV3/BoidsBulkV3.html`; `index.html` also supports directory access. Shared navigation and palette are supplied by the parent website at `/NavBar.js` and `/Theme.css`.

Adjust separation, alignment, cohesion, perception radius, maximum speed, samples per cell, and visual size in real time. Presets, pause/resume, restart, reset, and pointer attraction/repulsion are included. Population changes restart the flock; other parameters preserve its current state.

The simulation runs in a Web Worker with typed arrays, a toroidal spatial grid, and synchronous snapshot updates. At most nine cells are visited per boid, with a configurable sample budget per cell. This approximates dense neighborhoods rather than checking every nearby boid. Grid insertion rotates between frames to vary the sampled neighbors. One pending worker request limits backlog. Rendering uses one WebGL point-sprite draw call per frame.

## Verification

JavaScript syntax checks pass. Engine checks ran 30 steps each at 20,000 and 100,000 boids and verified finite state, wrapped bounds, and maximum speed. On the development server, average steps were approximately 30 ms and 148 ms respectively with default settings; these are CPU engine measurements, not browser frame-rate guarantees. The telemetry distinguishes draw FPS from simulation milliseconds. WebGL browser visual verification was unavailable in this environment. The page and worker returned HTTP 200 through the existing Apache virtual host.

Higher populations, perception radii, and sampling budgets require more CPU time. WebGL and Web Worker support are required. No external JavaScript packages or build step are needed.
