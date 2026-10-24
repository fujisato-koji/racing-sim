// タイヤが車体（フェンダー）からはみ出していないかを、代表車種ごとに調べる。
// 車軸の真上のフェンダーの縁（タイヤのすぐ上の、いちばん低い面の外の端）といちばん外側の幅を、タイヤの外側の面（トレッドの半分 + タイヤ幅の半分）と比べる。
// 実行: npx tsx test/tire-fit.ts
import { buildBody } from '../src/render/car-body';
import { carGeometry } from '../src/sim/params';
import { CAR_PRESETS } from '../src/sim/presets';

let fail = 0;
for (const p of CAR_PRESETS) {
  const g = carGeometry(p);
  const body = buildBody(p, g);
  const out: string[] = [];
  for (const [name, az, ax] of [['front', g.frontAxleZ, p.front], ['rear', g.rearAxleZ, p.rear]] as const) {
    // フェンダーの縁：車軸の真上（±0.1 m）で、いちばん下にある車体の点の幅（タイヤのすぐ上の縁）
    // 縁は、いちばん低い所から 3 cm 以内にある点のうち、いちばん外の点
    const pts: [number, number][] = [];
    for (const geo of [body.paint, body.trim]) {
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - az) <= 0.1) pts.push([Math.abs(pos.getX(i)), pos.getY(i)]);
    }
    const minY = Math.min(...pts.map((q) => q[1]));
    const fender = Math.max(...pts.map((q) => q[0]));
    const lip = Math.max(...pts.filter((q) => q[1] <= minY + 0.03).map((q) => q[0]));
    const tire = ax.track / 2 + ax.tireWidth / 2;
    const over = (tire - Math.min(fender, lip)) * 1000;
    if (over > 3) fail++;
    out.push(`${name} タイヤ ${(tire * 1000).toFixed(0)}、縁 ${(lip * 1000).toFixed(0)}、最も外 ${(fender * 1000).toFixed(0)} mm、${over > 3 ? `はみ出し ${over.toFixed(0)} mm NG` : 'OK'}`);
  }
  console.log(`${p.id.padEnd(9)} 幅 ${(p.body.width * 1000).toFixed(0)} mm／${out.join('／')}`);
}
console.log(fail === 0 ? 'すべて通過' : `${fail} か所はみ出している`);
process.exit(fail === 0 ? 0 : 1);
