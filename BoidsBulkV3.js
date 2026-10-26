/* Connect live controls, a backpressured simulation worker, and a single WebGL point draw. */
'use strict';
const canvas = document.getElementById('flock');
const statusLabel = document.getElementById('status');
const defaults = { separation: 1.5, alignment: 1.1, cohesion: 0.7, radius: 45, speed: 100, samples: 12, size: 3 };
const parameters = { ...defaults };
const pointer = { x: 0, y: 0, active: false, mode: 'repel' };
const definitions = [
    ['separation', 'Separation', 0, 4, 0.1],
    ['alignment', 'Alignment', 0, 4, 0.1],
    ['cohesion', 'Cohesion', 0, 4, 0.1],
    ['radius', 'Perception radius', 10, 120, 1],
    ['speed', 'Maximum speed', 20, 240, 5],
    ['samples', 'Samples per grid cell', 4, 32, 1],
    ['size', 'Boid size', 1, 8, 0.5]
];
let worker;
let busy = false;
let paused = false;
let snapshot;
let frameCount = 0;
let lastStats = performance.now();
let lastTime = performance.now();
let gl;
let program;
let buffer;
let sizeUniform;
let ratioUniform;

/** Build a labeled range and update its live parameter value.
 *
 * @param definition - Parameter key, display label, minimum, maximum, and increment.
 * @returns Appends an accessible input and output to the controls.
 */
function addControl(definition) {
    const [key, title, min, max, step] = definition;
    const label = document.createElement('label');
    label.className = 'field';
    label.htmlFor = key;
    label.textContent = title;
    const output = document.createElement('output');
    output.id = `${key}-value`;
    output.textContent = parameters[key];
    label.append(output);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = key;
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = parameters[key];
    input.addEventListener('input', /** Update the selected rule.
     *
     * Inputs: None; uses enclosing state where needed.
     * @returns Synchronizes parameter and output values.
     */ function () {
        parameters[key] = Number(input.value);
        output.textContent = input.value;
    });
    document.getElementById('parameters').append(label, input);
}
definitions.forEach(addControl);

/** Compile a shader and surface driver errors.
 *
 * @param type - WebGL shader stage enum.
 * @param source - GLSL source code.
 * @returns Compiled shader handle.
 */
function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
}

/** Initialize batched oriented point sprites with transparent triangle cutouts.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns Creates the GPU renderer or reports unsupported WebGL.
 */
function initializeRenderer() {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) {
        throw new Error('WebGL is unavailable. Enable hardware acceleration and reload.');
    }
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `
        /* Each packed boid contains position and velocity; heading colors reveal local flow. */
        attribute vec4 boid;
        uniform float size;
        uniform float ratio;
        varying vec2 direction;
        varying vec3 color;
        void main() {
            gl_Position = vec4(boid.x / 960.0 - 1.0, 1.0 - boid.y / 540.0, 0.0, 1.0);
            gl_PointSize = size * ratio * 2.0;
            direction = normalize(vec2(boid.z, -boid.w));
            color = mix(vec3(0.30, 0.58, 0.85), vec3(0.45, 0.87, 0.75), direction.x * 0.5 + 0.5);
        }
    `));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
        /* Rotate the sprite's local coordinates to draw a tiny directional arrow. */
        precision mediump float;
        varying vec2 direction;
        varying vec3 color;
        void main() {
            vec2 point = vec2(gl_PointCoord.x - 0.5, 0.5 - gl_PointCoord.y);
            float forward = dot(point, direction);
            float side = abs(dot(point, vec2(-direction.y, direction.x)));
            if (forward < -0.35 || side > (0.5 - forward) * 0.42) discard;
            gl_FragColor = vec4(color, 1.0);
        }
    `));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program));
    }
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const attribute = gl.getAttribLocation(program, 'boid');
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, 0, 0);
    sizeUniform = gl.getUniformLocation(program, 'size');
    ratioUniform = gl.getUniformLocation(program, 'ratio');
    const background = getComputedStyle(document.body).getPropertyValue('--site-bg').trim();
    const hex = background.replace('#', '');
    gl.clearColor(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255, 1);
}

/** Restart with the selected population and discard stale in-flight frames.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns Replaces the worker while preserving controls and pause state.
 */
function restart() {
    if (worker) {
        worker.terminate();
    }
    const count = Number(document.getElementById('count').value);
    document.getElementById('population').textContent = count.toLocaleString('en-US');
    worker = new Worker('./worker.js');
    busy = true;
    statusLabel.textContent = 'Starting flock…';
    worker.onmessage = /** Accept a finished simulation snapshot.
     *
     * @param event - Worker snapshot and timing message.
     * @returns Uploads GPU data and clears request backpressure.
     */ function (event) {
        snapshot = event.data.data;
        busy = false;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, snapshot, gl.DYNAMIC_DRAW);
        document.getElementById('step').textContent = event.data.ms.toFixed(1);
        statusLabel.textContent = paused ? 'Paused' : 'Flock running';
    };
    worker.onerror = /** Report worker failures.
     *
     * @param event - Worker error details.
     * @returns Pauses further simulation requests.
     */ function (event) {
        paused = true;
        statusLabel.textContent = `Simulation error: ${event.message}`;
    };
    worker.postMessage({ type: 'init', count });
}

/** Render the latest snapshot and request at most one pending simulation step.
 *
 * @param now - Browser animation timestamp in milliseconds.
 * @returns Schedules the next drawing frame and updates performance telemetry.
 */
function animate(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    if (!busy && !paused) {
        worker.postMessage({ type: 'step', parameters, pointer, dt: Math.max(dt, 0.001) });
        busy = true;
        lastTime = now;
    }
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (snapshot) {
        gl.uniform1f(sizeUniform, parameters.size);
        gl.uniform1f(ratioUniform, ratio);
        gl.drawArrays(gl.POINTS, 0, snapshot.length / 4);
    }
    frameCount += 1;
    if (now - lastStats >= 1000) {
        document.getElementById('fps').textContent = Math.round(frameCount * 1000 / (now - lastStats));
        frameCount = 0;
        lastStats = now;
    }
    requestAnimationFrame(animate);
}

/** Synchronize programmatic parameter changes with each range and output.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns Refreshes all live parameter controls.
 */
function refreshControls() {
    for (const [key] of definitions) {
        document.getElementById(key).value = parameters[key];
        document.getElementById(`${key}-value`).textContent = parameters[key];
    }
}

document.getElementById('count').addEventListener('input', /** Display the requested population.
 *
 * @param event - Control interaction event.
 * @returns Updates the formatted population output.
 */ function (event) {
    document.getElementById('count-value').textContent = Number(event.target.value).toLocaleString('en-US');
});
document.getElementById('count').addEventListener('change', restart);
document.getElementById('restart').addEventListener('click', restart);
document.getElementById('pause').addEventListener('click', /** Toggle simulation playback.
 *
 * @param event - Control interaction event.
 * @returns Updates pause state, timestamp, and button label.
 */ function (event) {
    paused = !paused;
    lastTime = performance.now();
    event.target.textContent = paused ? 'Resume' : 'Pause';
    statusLabel.textContent = paused ? 'Paused' : 'Flock running';
});
document.getElementById('pointer').addEventListener('change', /** Select pointer behavior.
 *
 * @param event - Control interaction event.
 * @returns Updates the pointer interaction mode.
 */ function (event) {
    pointer.mode = event.target.value;
});
canvas.addEventListener('pointermove', /** Map pointer movement into world coordinates.
 *
 * @param event - Canvas interaction event.
 * @returns Activates the pointer force at the world position.
 */ function (event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - rect.left) / rect.width * 1920;
    pointer.y = (event.clientY - rect.top) / rect.height * 1080;
    pointer.active = true;
});
canvas.addEventListener('pointerleave', /** Stop interaction outside the simulation.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns Deactivates the pointer force.
 */ function () {
    pointer.active = false;
});
canvas.addEventListener('pointerup', /** End touch interaction after release.
 *
 * @param event - Canvas interaction event.
 * @returns Deactivates the pointer for touch events.
 */ function (event) {
    if (event.pointerType === 'touch') {
        pointer.active = false;
    }
});
document.getElementById('preset').addEventListener('change', /** Apply a flock preset.
 *
 * @param event - Control interaction event.
 * @returns Updates rule values and displayed controls.
 */ function (event) {
    const presets = {
        balanced: defaults,
        flow: { ...defaults, alignment: 3, cohesion: 0.4, speed: 150 },
        swarm: { ...defaults, separation: 0.8, cohesion: 2.5, radius: 75 },
        scatter: { ...defaults, separation: 3.5, alignment: 0.2, cohesion: 0.1 }
    };
    Object.assign(parameters, presets[event.target.value]);
    refreshControls();
});
document.getElementById('reset').addEventListener('click', /** Restore the default laboratory state.
 *
 * Inputs: None; uses enclosing state where needed.
 * @returns Resets population, rules, and playback, then restarts.
 */ function () {
    Object.assign(parameters, defaults);
    refreshControls();
    document.getElementById('count').value = 20000;
    document.getElementById('count-value').textContent = '20,000';
    document.getElementById('preset').value = 'balanced';
    document.getElementById('pointer').value = 'repel';
    pointer.mode = 'repel';
    paused = false;
    document.getElementById('pause').textContent = 'Pause';
    restart();
});
canvas.addEventListener('webglcontextlost', /** Handle graphics resource loss.
 *
 * @param event - Canvas interaction event.
 * @returns Pauses the simulation and displays recovery instructions.
 */ function (event) {
    event.preventDefault();
    paused = true;
    statusLabel.textContent = 'Graphics context lost. Reload to restart.';
});
try {
    initializeRenderer();
    restart();
    requestAnimationFrame(animate);
} catch (error) {
    statusLabel.textContent = error.message;
}
