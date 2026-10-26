/* Worker owns flock state; the main thread requests one frame at a time for backpressure. */
importScripts('./engine.js');
let engine;

/** Initialize or advance the worker-owned flock and transfer a rendering snapshot.
 *
 * @param event - Initialization or simulation-step message.
 * @returns Posts a transferable snapshot and simulation duration to the UI.
 */
onmessage = function (event) {
    const message = event.data;
    if (message.type === 'init') {
        engine = new FlockEngine(message.count);
    }
    const start = performance.now();
    if (message.type === 'step') {
        engine.step(message.parameters, message.pointer, message.dt);
    }
    const snapshot = engine.data.slice();
    postMessage({ data: snapshot, ms: performance.now() - start }, [snapshot.buffer]);
};
