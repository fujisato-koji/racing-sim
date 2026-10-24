// プレイヤーが壁に突っ込んで動けなくなったら、自動でコースに戻るか（確認用）
import RAPIER from '@dimforge/rapier3d-compat';
import { Session } from '../src/game/session';
import { COURSES } from '../src/sim/courses';
import { CAR_PRESETS } from '../src/sim/presets';
await RAPIER.init();
const course = COURSES.find((c) => c.id === 'circuit')!;
let steer = 0.6;
const s = new Session(RAPIER, { course, player: CAR_PRESETS[2], opponents: [], laps: 3 }, () => ({ steer, throttle: 1, brake: 0 }));
const msgs: string[] = [];
let last = '';
for (let i = 0; i < 240 * 40; i++) {
  s.step(s.pw.dt);
  const t = s.notice && s.notice.until > s.pw.time ? s.notice.text : '';
  if (t && t !== last) msgs.push(`${s.race.time.toFixed(1)} s: ${t}（速さ ${s.player!.vehicle.speed.toFixed(1)} m/s）`);
  last = t;
  // 戻されたら、もう一度壁に向かう
  if (i % 2400 === 0) steer = -steer;
}
console.log(msgs.join('\n') || '知らせなし');
