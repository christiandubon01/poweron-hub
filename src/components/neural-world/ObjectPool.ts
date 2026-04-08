/**
 * ObjectPool.ts — NW15: Generic THREE.js object pool for Neural World.
 *
 * Prevents repeated geometry/material allocation for frequently
 * created/destroyed objects like stalactites, churn pools, and fault lines.
 *
 * Usage:
 *   const pool = new MeshPool(() => {
 *     const geo = new THREE.ConeGeometry(0.5, 2, 5)
 *     const mat = new THREE.MeshLambertMaterial({ color: 0xffaa00 })
 *     return new THREE.Mesh(geo, mat)
 *   }, 20)  // pre-allocate 20
 *
 *   const mesh = pool.acquire()   // get from pool (or create new)
 *   mesh.visible = true
 *   scene.add(mesh)
 *   ...
 *   pool.release(mesh)            // return to pool
 *   scene.remove(mesh)
 *   mesh.visible = false
 *
 *   pool.dispose()                // clean up all geometry/materials
 */

import * as THREE from 'three'

export class MeshPool<T extends THREE.Mesh = THREE.Mesh> {
  private available: T[] = []
  private all: T[] = []
  private factory: () => T
  private maxSize: number

  constructor(factory: () => T, preallocate = 0, maxSize = 100) {
    this.factory  = factory
    this.maxSize  = maxSize

    for (let i = 0; i < preallocate; i++) {
      const obj = factory()
      obj.visible = false
      this.available.push(obj)
      this.all.push(obj)
    }
  }

  /** Acquire an object from the pool. Creates a new one if the pool is empty. */
  acquire(): T {
    if (this.available.length > 0) {
      const obj = this.available.pop()!
      obj.visible = true
      return obj
    }
    if (this.all.length >= this.maxSize) {
      // Pool exhausted — return oldest in-use object after resetting
      const oldest = this.all[0]
      oldest.visible = true
      return oldest
    }
    const obj = this.factory()
    obj.visible = true
    this.all.push(obj)
    return obj
  }

  /** Return an object to the pool for reuse. */
  release(obj: T): void {
    obj.visible = false
    if (!this.available.includes(obj)) {
      this.available.push(obj)
    }
  }

  /** Dispose all geometry and materials in the pool. */
  dispose(): void {
    for (const obj of this.all) {
      if (obj.geometry) obj.geometry.dispose()
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose())
      } else if (obj.material) {
        obj.material.dispose()
      }
    }
    this.all = []
    this.available = []
  }

  /** Number of objects currently in pool (available for reuse). */
  get poolSize(): number { return this.available.length }

  /** Total objects ever allocated. */
  get totalAllocated(): number { return this.all.length }
}
