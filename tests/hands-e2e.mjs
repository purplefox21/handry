// Handry · © 2026 Berat Olekli (purplefox) · github.com/purplefox21/handry
// Hand gestures, the logic (app/public/hands-gestures.js) with made-up hands: pointer, click, drag, scroll,
// open palm and fist do nothing, a pinch without pointing first doesn't click, the button is let go when the
// hand goes. No camera, no screen, no mouse.
import { createHands, measure } from '../app/public/hands-gestures.js';

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) failed++; };

// A right hand seen from the camera, fingers up, in metres. Each finger 'out', 'fold' or 'bent' (for a pinch).
const P = (x, y, z = 0) => ({ x, y, z });
function hand({ index = 'out', middle = 'fold', ring = 'fold', pinky = 'fold', pinch = false, thumbOnIndex = false, at = { x: 0.5, y: 0.54 }, gesture = null } = {}) {
  const w = [P(0, 0), P(-0.025, -0.02), P(-0.045, -0.04), P(-0.06, -0.06), P(-0.07, -0.08)];
  const shapes = { index, middle, ring, pinky };
  const bases = { index: -0.025, middle: -0.005, ring: 0.015, pinky: 0.032 };
  for (const name of ['index', 'middle', 'ring', 'pinky']) {
    const b = bases[name];
    const s = shapes[name];
    if (s === 'out') w.push(P(b, -0.09), P(b, -0.13), P(b, -0.155), P(b, -0.175));
    else if (s === 'bent') w.push(P(b, -0.09), P(b - 0.005, -0.125, -0.01), P(b - 0.015, -0.14, -0.025), P(b - 0.03, -0.145, -0.035));
    else w.push(P(b, -0.09), P(b, -0.1, -0.03), P(b, -0.08, -0.04), P(b, -0.065, -0.025));
  }
  if (pinch) w[4] = P(w[8].x + 0.004, w[8].y + 0.004, w[8].z);
  if (thumbOnIndex) w[4] = P(-0.02, -0.07, -0.03); // a fist with the thumb over the index finger
  const image = w.map(p => ({ x: at.x + (p.x - w[5].x), y: at.y + (p.y - w[5].y), z: p.z }));
  return { image, world: w, gesture };
}

const screen = { w: 1512, h: 982 };
let t = 0;
const run = (h, frames, hands) => {
  const events = [];
  for (let i = 0; i < frames; i++) { t += 33; events.push(...hands.step(typeof h === 'function' ? h(i) : h, t)); }
  return events;
};
const of = (events, type) => events.filter(e => e.type === type);

// The shapes themselves
{
  const m = measure(hand().world);
  check('işaret parmağı düz, diğerleri bükük', m.fingers.index.straight > 0.95 && m.fingers.middle.straight < 0.6, JSON.stringify(m.fingers));
  check('çimdik yakın, açık el uzak', measure(hand({ index: 'bent', pinch: true }).world).pinch < 0.1 && m.pinch > 0.8);
}

// Pointer: the middle of the picture is the middle of the screen; the hand to the user's right goes right.
{
  const hands = createHands({ screen });
  const mid = of(run(hand(), 20, hands), 'move').pop();
  check('imleç ortada', mid && Math.abs(mid.x - 756) < 30 && Math.abs(mid.y - 491) < 30, JSON.stringify(mid));
  const right = of(run(hand({ at: { x: 0.4, y: 0.54 } }), 25, hands), 'move').pop();
  check('el sağa (kamerada sola): imleç sağa', right && right.x > 1050, JSON.stringify(right));
  check('imleç modunda', hands.pose === 'point', hands.pose);
  const far = run(hand({ at: { x: 0.02, y: 0.54 } }), 15, hands);
  check('çerçevenin çok dışındaki el imleci oynatmaz', of(far, 'move').length === 0, JSON.stringify(far.slice(0, 3)));
}

// Click: point, pinch, let go: one down and one up at the same place, no move in between.
{
  const hands = createHands({ screen });
  run(hand(), 15, hands);
  const e = [...run(hand({ index: 'bent', pinch: true }), 5, hands), ...run(hand(), 5, hands)];
  const downs = of(e, 'down'), ups = of(e, 'up');
  check('çimdik: bir bas, bir bırak', downs.length === 1 && ups.length === 1, JSON.stringify(e));
  check('tıklama aynı yerde', downs[0] && ups[0] && downs[0].x === ups[0].x && downs[0].y === ups[0].y);
  const between = e.slice(e.indexOf(downs[0]), e.indexOf(ups[0]));
  check('basılıyken imleç kaymaz', of(between, 'move').length === 0, JSON.stringify(between));
}

// Drag: pinch and move.
{
  const hands = createHands({ screen });
  run(hand(), 15, hands);
  const e = run(i => hand({ index: 'bent', pinch: true, at: { x: 0.5 - Math.min(i, 10) * 0.012, y: 0.54 } }), 20, hands);
  e.push(...run(hand({ at: { x: 0.38, y: 0.54 } }), 3, hands));
  const down = of(e, 'down')[0], up = of(e, 'up')[0];
  check('sürükleme: basılıyken imleç gider', of(e, 'move').length > 3 && hands.dragging === false);
  check('bırakınca yeni yerde', down && up && up.x - down.x > 250, JSON.stringify({ down, up }));
}

// A pinch that didn't start from pointing (after a long open palm) doesn't click; a fist with the thumb over
// the index finger isn't a pinch.
{
  const hands = createHands({ screen });
  run(hand({ index: 'out', middle: 'out', ring: 'out', pinky: 'out' }), 40, hands);
  const e = run(hand({ index: 'bent', middle: 'out', ring: 'out', pinky: 'out', pinch: true }), 6, hands);
  check('işaret etmeden çimdik tıklamaz', of(e, 'down').length === 0, JSON.stringify(e));
  const hands2 = createHands({ screen });
  run(hand(), 15, hands2);
  const f = run(hand({ index: 'fold', thumbOnIndex: true }), 8, hands2);
  check('yumruk tıklamaz', of(f, 'down').length === 0, JSON.stringify(f));
}

// Open palm: nothing moves; the model's own "Open_Palm" wins over the fingers.
{
  const hands = createHands({ screen });
  run(hand(), 15, hands);
  const e = run(i => hand({ index: 'out', middle: 'out', ring: 'out', pinky: 'out', at: { x: 0.5 - i * 0.01, y: 0.54 } }), 20, hands);
  check('açık avuç: imleç durur', of(e, 'move').length <= 2 && hands.pose === 'palm', `${of(e, 'move').length} ${hands.pose}`);
  const g = run(i => hand({ gesture: { name: 'Open_Palm', score: 0.9 }, at: { x: 0.5 + i * 0.01, y: 0.54 } }), 20, hands);
  check('modelin "açık avuç"u da durdurur', of(g, 'move').length === 0, `${of(g, 'move').length}`);
}

// Scroll: two fingers, the hand up from where it started scrolls up (+), down scrolls down (-); no pointer moves.
{
  const hands = createHands({ screen });
  run(hand(), 10, hands);
  const two = y => hand({ index: 'out', middle: 'out', at: { x: 0.5, y } });
  run(two(0.54), 6, hands);
  const up = run(i => two(0.54 - Math.min(i, 5) * 0.03), 15, hands);
  const down = run(i => two(0.54 + Math.min(i, 5) * 0.03), 15, hands);
  const sum = e => of(e, 'scroll').reduce((s, x) => s + x.dy, 0);
  check('iki parmak yukarı: yukarı kaydırır', sum(up) > 100, `${sum(up)}`);
  check('aşağı: aşağı kaydırır', sum(down) < -100, `${sum(down)}`);
  check('kaydırırken imleç oynamaz', of([...up, ...down], 'move').length === 0);
}

// The hand goes while the button is down: it is let go.
{
  const hands = createHands({ screen });
  run(hand(), 15, hands);
  run(hand({ index: 'bent', pinch: true }), 4, hands);
  const e = run(null, 1, hands);
  check('el kaybolunca tuş bırakılır', of(e, 'up').length === 1, JSON.stringify(e));
  run(hand(), 15, hands);
  run(hand({ index: 'bent', pinch: true }), 4, hands);
  check('kapanırken de bırakılır', of(hands.reset(), 'up').length === 1);
}

console.log(failed ? `\n${failed} hata` : '\nhepsi tamam');
process.exit(failed ? 1 : 0);
