/* Allocation-free toroidal flock engine shared by the worker and Node verification. */
(function (scope) {
    class FlockEngine {
        /** Create a flock with randomized positions and headings.
         *
         * @param count - Number of boids to allocate.
         * @returns A simulation with reusable typed-array storage.
         */
        constructor(count) {
            this.count = count;
            this.data = new Float32Array(count * 4);
            this.nextData = new Float32Array(count * 4);
            this.next = new Int32Array(count);
            this.frame = 0;
            for (let i = 0; i < count; i += 1) {
                const angle = Math.random() * Math.PI * 2;
                this.data.set([Math.random() * 1920, Math.random() * 1080, Math.cos(angle) * 80, Math.sin(angle) * 80], i * 4);
            }
        }

        /** Advance all boids from an immutable snapshot using a spatial grid.
         *
         * @param p - Live rule weights, speed, perception, and neighbor budget.
         * @param pointer - Pointer position, activity, and attraction mode.
         * @param dt - Simulation time step in seconds.
         * @returns Updated packed positions and velocities.
         */
        step(p, pointer, dt) {
            const cols = Math.max(3, Math.floor(1920 / p.radius));
            const rows = Math.max(3, Math.floor(1080 / p.radius));
            const cellWidth = 1920 / cols;
            const cellHeight = 1080 / rows;
            if (!this.head || this.head.length !== cols * rows) {
                this.head = new Int32Array(cols * rows);
            }
            this.head.fill(-1);
            const a = this.data;
            const b = this.nextData;
            // Rotate insertion order so capped dense-cell sampling does not favor fixed IDs.
            for (let k = 0; k < this.count; k += 1) {
                const i = (k + this.frame * 997) % this.count;
                const cell = Math.floor(a[i * 4] / cellWidth) + Math.floor(a[i * 4 + 1] / cellHeight) * cols;
                this.next[i] = this.head[cell];
                this.head[cell] = i;
            }
            const radius2 = p.radius * p.radius;
            const separation2 = (p.radius * 0.4) ** 2;
            for (let i = 0; i < this.count; i += 1) {
                const offset = i * 4;
                const x = a[offset];
                const y = a[offset + 1];
                let vx = a[offset + 2];
                let vy = a[offset + 3];
                const cx = Math.floor(x / cellWidth);
                const cy = Math.floor(y / cellHeight);
                let sx = 0;
                let sy = 0;
                let ax = 0;
                let ay = 0;
                let dxSum = 0;
                let dySum = 0;
                let neighbors = 0;
                for (let gy = -1; gy <= 1; gy += 1) {
                    for (let gx = -1; gx <= 1; gx += 1) {
                        const cell = ((cx + gx + cols) % cols) + ((cy + gy + rows) % rows) * cols;
                        let j = this.head[cell];
                        let checked = 0;
                        while (j !== -1 && checked < p.samples) {
                            if (j !== i) {
                                let dx = a[j * 4] - x;
                                let dy = a[j * 4 + 1] - y;
                                // Minimum-image distances preserve flocking across wrapped edges.
                                dx -= Math.round(dx / 1920) * 1920;
                                dy -= Math.round(dy / 1080) * 1080;
                                const distance2 = dx * dx + dy * dy;
                                if (distance2 < radius2 && distance2 > 0.0001) {
                                    neighbors += 1;
                                    ax += a[j * 4 + 2];
                                    ay += a[j * 4 + 3];
                                    dxSum += dx;
                                    dySum += dy;
                                    if (distance2 < separation2) {
                                        sx -= dx / distance2;
                                        sy -= dy / distance2;
                                    }
                                }
                            }
                            checked += 1;
                            j = this.next[j];
                        }
                    }
                }
                let fx = sx * p.separation * 160;
                let fy = sy * p.separation * 160;
                if (neighbors > 0) {
                    fx += (ax / neighbors - vx) * p.alignment + dxSum / neighbors * p.cohesion;
                    fy += (ay / neighbors - vy) * p.alignment + dySum / neighbors * p.cohesion;
                }
                if (pointer.active && pointer.mode !== 'none') {
                    const dx = pointer.x - x;
                    const dy = pointer.y - y;
                    const distance = Math.hypot(dx, dy);
                    if (distance < 200 && distance > 1) {
                        const force = (pointer.mode === 'repel' ? -1 : 1) * 350 * (1 - distance / 200) / distance;
                        fx += dx * force;
                        fy += dy * force;
                    }
                }
                const forceLength = Math.hypot(fx, fy);
                const forceScale = Math.min(1, 220 / Math.max(forceLength, 0.001));
                vx += fx * forceScale * dt;
                vy += fy * forceScale * dt;
                const speed = Math.hypot(vx, vy);
                const speedScale = Math.max(p.speed * 0.45, Math.min(p.speed, speed)) / Math.max(speed, 0.001);
                vx *= speedScale;
                vy *= speedScale;
                b[offset] = ((x + vx * dt) % 1920 + 1920) % 1920;
                b[offset + 1] = ((y + vy * dt) % 1080 + 1080) % 1080;
                b[offset + 2] = vx;
                b[offset + 3] = vy;
            }
            this.data = b;
            this.nextData = a;
            this.frame += 1;
            return b;
        }
    }
    scope.FlockEngine = FlockEngine;
})(globalThis);
