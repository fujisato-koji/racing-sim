// 物理の世界。地面と固定物、動く小物、車両を持ち、固定刻みで進める。
import type RAPIER from '@dimforge/rapier3d-compat';
import { G } from './params';
import type { Surface } from './surfaces';
import { SURFACES } from './surfaces';
import type { Vehicle } from './vehicle';

export type Rapier = typeof RAPIER;

export const G_GROUND = 1, G_CHASSIS = 2, G_WHEEL = 4, G_PROP = 8;
const groups = (member: number, filter: number) => ((member << 16) | filter) >>> 0;
export const GROUPS = {
  ground: groups(G_GROUND, G_CHASSIS | G_PROP),
  chassis: groups(G_CHASSIS, G_GROUND | G_CHASSIS | G_WHEEL | G_PROP),
  wheel: groups(G_WHEEL, G_CHASSIS | G_WHEEL | G_PROP),
  prop: groups(G_PROP, G_GROUND | G_CHASSIS | G_WHEEL | G_PROP),
  /** サスが地面を探るときの対象（地面と固定物だけ。小物は車輪の衝突形状が押す） */
  suspension: groups(0xffff, G_GROUND),
};

export type PropKind = 'cone' | 'tire';

export interface Prop {
  kind: PropKind;
  body: RAPIER.RigidBody;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly surfaceOf = new Map<number, Surface>();
  readonly vehicles: Vehicle[] = [];
  readonly props: Prop[] = [];
  time = 0;

  constructor(readonly R: Rapier, readonly dt = 1 / 240) {
    this.world = new R.World({ x: 0, y: -G, z: 0 });
    this.world.timestep = dt;
  }

  private fixedBody() {
    return this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
  }

  private finish(desc: RAPIER.ColliderDesc, surface: Surface, body: RAPIER.RigidBody) {
    desc.setCollisionGroups(GROUPS.ground).setFriction(surface.bodyFriction).setRestitution(0.05);
    const c = this.world.createCollider(desc, body);
    this.surfaceOf.set(c.handle, surface);
    return c;
  }

  addStaticMesh(vertices: Float32Array, indices: Uint32Array, surface: Surface) {
    if (indices.length === 0) return null;
    return this.finish(this.R.ColliderDesc.trimesh(vertices, indices), surface, this.fixedBody());
  }

  addStaticConvex(points: Float32Array, surface: Surface) {
    const desc = this.R.ColliderDesc.convexHull(points);
    if (!desc) return null;
    return this.finish(desc, surface, this.fixedBody());
  }

  addStaticBox(center: [number, number, number], half: [number, number, number], yaw: number, surface: Surface = SURFACES.concrete) {
    const desc = this.R.ColliderDesc.cuboid(half[0], half[1], half[2])
      .setTranslation(center[0], center[1], center[2])
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
    return this.finish(desc, surface, this.fixedBody());
  }

  addCone(x: number, y: number, z: number) {
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(x, y + 0.36, z).setCcdEnabled(true));
    this.world.createCollider(this.R.ColliderDesc.cone(0.33, 0.16).setMass(2.2).setTranslation(0, 0.03, 0)
      .setCollisionGroups(GROUPS.prop).setFriction(0.6).setRestitution(0.2), body);
    this.world.createCollider(this.R.ColliderDesc.cuboid(0.19, 0.02, 0.19).setMass(0.8).setTranslation(0, -0.32, 0)
      .setCollisionGroups(GROUPS.prop).setFriction(0.7).setRestitution(0.1), body);
    body.sleep();
    this.props.push({ kind: 'cone', body });
  }

  /** 積んだタイヤを1本ずつ別の物体として置く */
  addTireStack(x: number, y: number, z: number, count: number) {
    for (let i = 0; i < count; i++) {
      const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(x, y + 0.11 + i * 0.225, z)
        .setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.2));
      this.world.createCollider(this.R.ColliderDesc.cylinder(0.11, 0.32).setMass(9)
        .setCollisionGroups(GROUPS.prop).setFriction(0.9).setRestitution(0.25), body);
      body.sleep();
      this.props.push({ kind: 'tire', body });
    }
  }

  step() {
    for (const v of this.vehicles) v.step(this.dt);
    this.world.step();
    for (const v of this.vehicles) v.afterStep();
    this.time += this.dt;
  }

  free() {
    this.world.free();
  }
}
