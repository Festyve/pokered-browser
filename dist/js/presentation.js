// Presentation never consumes the battle RNG or changes a committed grid position.
export const FRAME_MS = 1000 / 59.7275;
export const STEP_MS = 8 * FRAME_MS;
export const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
export const normalizeKey = key => key.length === 1 ? key.toLowerCase() : key;
export const directionForKey = key => ({ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right', w:'up', s:'down', a:'left', d:'right'})[normalizeKey(key)];

export class GridMotion {
  constructor() { this.step = null; this.pending = null; }
  request(direction) { this.pending = direction; }
  take(heldDirection) { const direction = this.pending || heldDirection; this.pending = null; return direction; }
  begin(from, to, direction, now, {jump = false, destination = null} = {}) {
    if (this.step) return false;
    this.step = {x:from.x, y:from.y, toX:to.x, toY:to.y, direction, at:now, duration:jump ? STEP_MS * 2 : STEP_MS, jump, destination};
    return true;
  }
  sample(now) {
    if (!this.step) return null;
    const w = this.step, t = clamp((now - w.at) / w.duration);
    return {x:w.x + (w.toX-w.x)*t, y:w.y + (w.toY-w.y)*t, jump:w.jump ? Math.sin(t*Math.PI)*6 : 0, t, direction:w.direction};
  }
  finish(now) {
    if (!this.step || now < this.step.at + this.step.duration) return null;
    const completed = this.step; this.step = null; return completed;
  }
  clear() { this.step = null; this.pending = null; }
}

export function paginate(text, width = 18) {
  const pages = [];
  // Preserve authored line breaks; only wrap lines that exceed the screen width.
  for (const paragraph of text.replaceAll('@','').split(/\n\s*\n/)) {
    const lines = [];
    for (const sourceLine of paragraph.split('\n')) {
      let line = '';
      for (let word of sourceLine.trim().split(/\s+/)) {
        if (!word) continue;
        while (word.length > width) {
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0,width)); word = word.slice(width);
        }
        if ((line+' '+word).trim().length > width) { lines.push(line); line = word; }
        else line = (line+' '+word).trim();
      }
      if (line) lines.push(line);
    }
    for (let i=0; i<lines.length; i+=2) pages.push(lines.slice(i,i+2));
  }
  return pages.length ? pages : [['…']];
}

export class TextPager {
  constructor(text, now, {speed = 'medium', protectedText = true} = {}) {
    this.pages = paginate(text); this.index = 0; this.at = now;
    this.msPerChar = {slow:42, medium:25, fast:10}[speed] || 25;
    this.protectedText = protectedText; this.revealedAt = null; this.lastConfirm = now;
  }
  length() { return this.pages[this.index].join('').length; }
  completeAt() { return this.revealedAt ?? this.at + this.length()*this.msPerChar; }
  visible(now) {
    const count = this.revealedAt !== null ? this.length() : Math.max(0,Math.floor((now-this.at)/this.msPerChar));
    let remaining = count;
    return this.pages[this.index].map(line => { const part = line.slice(0,remaining); remaining = Math.max(0,remaining-line.length); return part; });
  }
  ready(now) { return now >= this.completeAt() + (this.protectedText ? 220 : 70); }
  confirm(now) {
    if (now-this.lastConfirm < 100) return 'wait';
    this.lastConfirm = now;
    if (now < this.completeAt()) { this.revealedAt = now; return 'reveal'; }
    if (!this.ready(now)) return 'wait';
    if (++this.index >= this.pages.length) return 'done';
    this.at = now; this.revealedAt = null; return 'page';
  }
}

export function hpAt(from, to, start, duration, now) {
  return from + (to-from)*clamp((now-start)/duration);
}

export function animationStyle(move) {
  if (!move?.power) return 'status';
  return ({FIRE:'fire', WATER:'water', ELECTRIC:'electric', GRASS:'grass', ICE:'ice', PSYCHIC_TYPE:'psychic', GHOST:'ghost', DRAGON:'beam'})[move.type] || 'physical';
}
