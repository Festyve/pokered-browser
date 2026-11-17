// Native JavaScript battle rules. No emulator, ROM, or CPU interpreter.
export const SPECIAL = new Set(['FIRE','WATER','GRASS','ELECTRIC','ICE','PSYCHIC_TYPE','DRAGON']);
export const pretty = s => String(s || '').replaceAll('_',' ');
export function rng(seed = 0x726564) {
  return {seed: seed >>> 0, next() {this.seed = (Math.imul(this.seed,1664525)+1013904223)>>>0; return this.seed/4294967296;}, int(n) {return Math.floor(this.next()*n);}};
}
export function experience(level, growth='GROWTH_MEDIUM_FAST') {
  const n=level;
  if(growth.includes('MEDIUM_SLOW')) return Math.max(0,Math.floor(6*n*n*n/5-15*n*n+100*n-140));
  if(growth.includes('FAST')) return Math.floor(n*n*n*(growth.includes('MEDIUM')?1:0.8));
  if(growth.includes('SLOW')) return Math.floor(n*n*n*1.25);
  return n*n*n;
}
export function statsFor(base, level, dvs={}, evs={}) {
  return Object.fromEntries(Object.entries(base).map(([key,value])=>[key, Math.floor(((value+(dvs[key]??8))*2+Math.floor(Math.min(255,Math.ceil(Math.sqrt(evs[key]||0)))/4))*level/100)+(key==='hp'?level+10:5)]));
}
export function makeMon(db, species, level, random=rng()) {
  const s=db.species[species]; if(!s) throw new Error(`Unknown species ${species}`);
  const dvs={attack:random.int(16),defense:random.int(16),speed:random.int(16),special:random.int(16)};
  dvs.hp=((dvs.attack&1)<<3)|((dvs.defense&1)<<2)|((dvs.speed&1)<<1)|(dvs.special&1);
  const learned=[...(s.startingMoves||s.moves||[]),...(s.learnset||[]).filter(x=>x.level<=level).map(x=>x.move)].filter(x=>x!=='NO_MOVE'&&db.moves[x]);
  const moves=[...new Set(learned)].slice(-4).map(id=>({id,pp:db.moves[id].pp}));
  const stats=statsFor(s.stats,level,dvs);
  return {species,level,dvs,evs:{},stats,hp:stats.hp,moves,status:null,exp:experience(level,s.growth),stages:{},sleep:0};
}
export function typeEffect(db, type, targetTypes) {
  return [...new Set(targetTypes)].reduce((m,t)=>m*(db.typeChart.find(e=>e.attack===type&&e.defense===t)?.multiplier??1),1);
}
export function stageMultiplier(n=0) {return n>=0?(2+n)/2:2/(2-n);}
export function damage(db, attacker, defender, move, random=rng()) {
  if(!move.power) return {amount:0,effectiveness:1,critical:false};
  const baseSpeed=db.species[attacker.species].stats.speed;
  const highCrit=['KARATE_CHOP','RAZOR_LEAF','CRABHAMMER','SLASH'].includes(move.id);
  const critical=random.int(256)<Math.min(255,Math.floor(baseSpeed/2)*(highCrit?8:1));
  const special=SPECIAL.has(move.type), a=special?'special':'attack', d=special?'special':'defense';
  let atk=attacker.stats[a],def=defender.stats[d];
  if(!critical) {atk=Math.max(1,Math.floor(atk*stageMultiplier(attacker.stages[a])));def=Math.max(1,Math.floor(def*stageMultiplier(defender.stages[d])));if(a==='attack'&&attacker.status==='BRN')atk=Math.max(1,Math.floor(atk/2));}
  if(atk>255||def>255){atk=Math.max(1,Math.floor(atk/4));def=Math.max(1,Math.floor(def/4));}
  let value=Math.floor(Math.floor(Math.floor(2*attacker.level*(critical?2:1)/5+2)*move.power*atk/def)/50)+2;
  if(db.species[attacker.species].types.includes(move.type)) value=Math.floor(value*1.5);
  const effectiveness=typeEffect(db,move.type,db.species[defender.species].types);
  value=Math.floor(value*effectiveness);
  if(value>1)value=Math.floor(value*(217+random.int(39))/255);
  return {amount:effectiveness===0?0:Math.max(1,value),effectiveness,critical};
}
function stage(mon,key,n,log){mon.stages[key]=Math.max(-6,Math.min(6,(mon.stages[key]||0)+n));log.push(`${pretty(mon.species)}'s ${key.toUpperCase()} ${n>0?'rose':'fell'}!`);}
export function useMove(db, a, d, index, random=rng()) {
  const log=[]; let slot=a.moves[index];
  if(a.status==='SLP'){if(a.sleep-->0)return [`${pretty(a.species)} is fast asleep!`];a.status=null;return [`${pretty(a.species)} woke up!`];}
  if(a.status==='FRZ')return [`${pretty(a.species)} is frozen solid!`];
  if(a.status==='PAR'&&random.int(4)===0)return [`${pretty(a.species)} is fully paralyzed!`];
  if(!slot||slot.pp<=0){if(a.moves.some(m=>m.pp>0))return ['No PP left for this move!'];slot={id:'STRUGGLE',pp:1};}
  const m={...db.moves[slot.id],id:slot.id};slot.pp--;
  log.push(`${pretty(a.species)} used ${pretty(slot.id)}!`);
  const accuracy=Math.min(255,Math.floor(m.accuracy*255/100*stageMultiplier((a.stages.accuracy||0)-(d.stages.evasion||0))));
  if(random.int(256)>=accuracy)return [...log,'But it missed!'];
  const ef=m.effect||'';
  if(m.power){
    let result=damage(db,a,d,m,random);
    if(ef==='SPECIAL_DAMAGE_EFFECT')result.amount=['SEISMIC_TOSS','NIGHT_SHADE'].includes(m.id)?a.level:m.id==='DRAGON_RAGE'?40:m.id==='SONICBOOM'?20:result.amount;
    if(ef==='SUPER_FANG_EFFECT')result.amount=Math.max(1,Math.floor(d.hp/2));
    const hits=ef==='ATTACK_TWICE_EFFECT'?2:ef==='TWO_TO_FIVE_ATTACKS_EFFECT'?[2,2,2,3,3,3,4,5][random.int(8)]:1;
    const dealt=Math.min(d.hp,result.amount*hits);d.hp=Math.max(0,d.hp-dealt);
    if(result.critical)log.push('Critical hit!');
    if(result.effectiveness>1)log.push("It's super effective!");
    if(result.effectiveness>0&&result.effectiveness<1)log.push("It's not very effective...");
    if(result.effectiveness===0)log.push("It doesn't affect the foe!");
    if(hits>1)log.push(`Hit ${hits} times!`);
    if(ef.includes('DRAIN_HP')||ef==='DREAM_EATER_EFFECT'){a.hp=Math.min(a.stats.hp,a.hp+Math.max(1,Math.floor(dealt/2)));log.push('Health was absorbed!');}
    if(ef==='RECOIL_EFFECT'){a.hp=Math.max(0,a.hp-Math.max(1,Math.floor(dealt/4)));log.push('Hit with recoil!');}
    if(ef==='EXPLODE_EFFECT')a.hp=0;
    if(d.hp>0&&!d.status&&result.effectiveness>0&&random.int(100)<(ef.endsWith('2')?30:10)){
      for(const [word,status] of [['POISON','PSN'],['BURN','BRN'],['PARALYZE','PAR'],['FREEZE','FRZ']])if(ef.startsWith(word)&&ef.includes('SIDE')){d.status=status;log.push(`${pretty(d.species)}: ${status}!`);}
    }
  } else {
    const match=ef.match(/^(ATTACK|DEFENSE|SPEED|SPECIAL|ACCURACY|EVASION)_(UP|DOWN)([12])/);
    if(match){const up=match[2]==='UP';stage(up?a:d,match[1].toLowerCase(),(up?1:-1)*Number(match[3]),log);}
    else if(ef==='HEAL_EFFECT'){a.hp=Math.min(a.stats.hp,a.hp+Math.floor(a.stats.hp/2));if(m.id==='REST'){a.hp=a.stats.hp;a.status='SLP';a.sleep=2;}log.push('HP was restored!');}
    else if(ef==='LEECH_SEED_EFFECT'){d.seeded=true;log.push('The foe was seeded!');}
    else if(['SLEEP_EFFECT','POISON_EFFECT','PARALYZE_EFFECT'].includes(ef)){if(d.status)log.push('But it failed!');else{d.status=ef==='SLEEP_EFFECT'?'SLP':ef==='POISON_EFFECT'?'PSN':'PAR';d.sleep=1+random.int(7);log.push(`${pretty(d.species)}: ${d.status}!`);}}
    else if(ef==='SPLASH_EFFECT')log.push('No effect!');
    else log.push('This move effect is not yet translated.');
  }
  return log;
}
export function endTurn(mon, opponent) {
  const log=[];
  if(mon.hp>0&&['PSN','BRN'].includes(mon.status)){mon.hp=Math.max(0,mon.hp-Math.max(1,Math.floor(mon.stats.hp/16)));log.push(`${pretty(mon.species)} is hurt by ${mon.status==='PSN'?'poison':'its burn'}!`);}
  if(mon.hp>0&&mon.seeded){const n=Math.min(mon.hp,Math.max(1,Math.floor(mon.stats.hp/16)));mon.hp-=n;opponent.hp=Math.min(opponent.stats.hp,opponent.hp+n);log.push('LEECH SEED saps health!');}
  return log;
}
export function addExperience(db, mon, enemy, trainer=false) {
  const reward=Math.floor(db.species[enemy.species].baseExp*enemy.level*(trainer?1.5:1)/7),log=[`${pretty(mon.species)} gained ${reward} EXP. points!`];
  mon.exp+=reward;
  for(const [key,v] of Object.entries(db.species[enemy.species].stats))mon.evs[key]=Math.min(65535,(mon.evs[key]||0)+v);
  while(mon.level<100&&mon.exp>=experience(mon.level+1,db.species[mon.species].growth)){
    const old=mon.stats.hp;mon.level++;mon.stats=statsFor(db.species[mon.species].stats,mon.level,mon.dvs,mon.evs);mon.hp+=mon.stats.hp-old;
    log.push(`${pretty(mon.species)} grew to level ${mon.level}!`);
    for(const learned of db.species[mon.species].learnset||[])if(learned.level===mon.level&&db.moves[learned.move]&&!mon.moves.some(m=>m.id===learned.move)){
      if(mon.moves.length===4){const forgotten=mon.moves.shift();log.push(`Forgot ${pretty(forgotten.id)}.`);}
      mon.moves.push({id:learned.move,pp:db.moves[learned.move].pp});log.push(`Learned ${pretty(learned.move)}!`);
    }
  }
  return log;
}
export function heal(db, party){for(const m of party){m.hp=m.stats.hp;m.status=null;m.seeded=false;m.stages={};for(const move of m.moves)move.pp=db.moves[move.id]?.pp||0;}}
