import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GridMotion,STEP_MS,TextPager,hpAt,directionForKey} from '../dist/js/presentation.js';
import {initializeCampaign,meets,applyStage,stageFor,awardGym,setBlock,cellAt,syncGeometry,objectVisible} from '../dist/js/campaign.js';
const json=name=>JSON.parse(readFileSync(new URL(`../dist/data/${name}.json`,import.meta.url)));
const events=json('events'),world=json('world'),db=json('pokemon'),music=json('music');
const fresh=()=>initializeCampaign({bag:{},flags:{},badges:[],defeated:{},collected:{}});
test('rapid movement input cannot replace an in-progress tile or commit twice',()=>{
  const motion=new GridMotion(),state={x:3,y:6};assert.ok(motion.begin(state,{x:4,y:6},'right',0));
  for(let i=0;i<50;i++){motion.request(i%2?'up':'left');assert.equal(motion.begin(state,{x:9,y:9},'up',1),false);}
  assert.equal(motion.sample(STEP_MS/2).x,3.5);assert.deepEqual(state,{x:3,y:6});assert.equal(motion.finish(STEP_MS-1),null);
  assert.equal(motion.finish(STEP_MS).toX,4);assert.equal(motion.finish(STEP_MS+1),null);assert.equal(motion.take('down'),'up');assert.equal(motion.take('down'),'down');
  for(const key of ['w','W','ArrowUp'])assert.equal(directionForKey(key),'up');
});
test('dialogue requires separate reveal and advance presses, with a settle interval',()=>{
  const pager=new TextPager('First line\nSecond line\n\nNext page',0,{speed:'slow'});
  assert.equal(pager.confirm(110),'reveal');assert.equal(pager.confirm(115),'wait');assert.equal(pager.confirm(220),'wait');assert.equal(pager.index,0);
  assert.equal(pager.confirm(450),'page');assert.equal(pager.index,1);assert.deepEqual(pager.visible(450),['']);
  assert.equal(pager.confirm(560),'reveal');assert.equal(pager.confirm(850),'done');
});
test('HP interpolation is continuous, clamped and independent from game state',()=>{
  assert.equal(hpAt(50,10,100,1000,50),50);assert.equal(hpAt(50,10,100,1000,600),30);assert.equal(hpAt(50,10,100,1000,1500),10);
});
test('quest rewards and consumption persist exactly once',()=>{
  const s=fresh();applyStage(s,'bill',stageFor(events,'bill','enterMachine'));assert.equal(s.visibility.BILLSHOUSE_BILL_POKEMON,false);
  applyStage(s,'bill',stageFor(events,'bill','runPC'));assert.ok(s.flags.EVENT_MET_BILL);assert.equal(s.visibility.BILLSHOUSE_BILL1,true);
  const stage=stageFor(events,'bill','receiveTicket');assert.ok(applyStage(s,'bill',stage));assert.equal(applyStage(s,'bill',stage),false);assert.equal(s.bag.S_S_TICKET,1);
  assert.equal(applyStage(s,'strength',stageFor(events,'strength','reward')),false);s.bag.GOLD_TEETH=1;assert.ok(applyStage(s,'strength',stageFor(events,'strength','reward')));assert.equal(s.bag.GOLD_TEETH,0);assert.equal(s.bag.HM_STRENGTH,1);
});
test('all eight leaders have valid original teams, text and one-time rewards',()=>{
  const s=fresh();for(const g of events.gyms){assert.ok(db.trainers[g.trainerClass][g.party-1].length);for(const k of [...g.intro,...g.victory])assert.ok(world.texts[k]||events.texts[k],k);assert.ok(awardGym(s,g));assert.equal(awardGym(s,g),false);assert.equal(s.bag[g.item],1);}
  assert.equal(s.badges.length,8);assert.ok(meets(s,['SEVEN_BADGES']));assert.equal(meets(s,['SILPH_CO_LIBERATED']),false);
});
test('original quest, rival and League text references resolve',()=>{
  for(const q of Object.values(events.quests))for(const stage of q.stages)for(const k of stage.text)assert.ok(world.texts[k]||events.texts[k],k);
  for(const r of events.rivals){for(const party of Object.values(r.partyByStarter))assert.ok(db.trainers[r.trainerClass][party-1]);for(const k of [...r.intro,...r.after])assert.ok(world.texts[k]||events.texts[k],k);}
  for(const g of events.league)assert.ok(db.trainers[g.trainerClass][g.party-1]);
});
test('door, quiz and boulder flags change both visible blocks and collision',()=>{
  const s=fresh(),gate=events.field.cinnabarQuiz.gates[0];syncGeometry(s,events);const original=world.maps.CINNABAR_GYM.collision[gate.y*2][gate.x*2];
  s.flags[gate.flag]=true;syncGeometry(s,events);assert.equal(s.mapEdits.CINNABAR_GYM[`${gate.x},${gate.y}`],gate.openBlock);
  assert.equal(cellAt(world,s,'CINNABAR_GYM',gate.x*2,gate.y*2),world.tilesets.FACILITY.blocks[gate.openBlock].collision[0][0]);
  assert.equal(world.maps.CINNABAR_GYM.collision[gate.y*2][gate.x*2],original);
  const b=events.field.boulderSwitches[0];s.flags[b.flag]=true;syncGeometry(s,events);assert.equal(s.mapEdits[b.map][`${b.blockChange.x},${b.blockChange.y}`],b.blockChange.openBlock);
  const r=events.field.eventBlockChanges[0];for(const key of r.requiresDefeated)s.defeated[key]=true;syncGeometry(s,events);assert.ok(s.flags[r.flag]);
});
test('cut patches replace the exact local collision and survive a save round trip',()=>{
  const s=fresh(),m=world.maps.VERMILION_CITY;let found=false;
  for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++)if(m.tileIds[y][x]===0x3d){const block=m.blocks[Math.floor(y/2)][Math.floor(x/2)],swap=events.field.cutTreeBlockSwaps.find(p=>p.from===block);assert.ok(swap);setBlock(s,m.id,Math.floor(x/2),Math.floor(y/2),swap.to);const restored=JSON.parse(JSON.stringify(s));assert.equal(cellAt(world,restored,m.id,x,y),1);found=true;}
  assert.ok(found);
});
test('Bill and Silph victories change blocking NPC visibility',()=>{
  const s=fresh(),guard=world.maps.CERULEAN_CITY.objects.find(o=>o.objectId==='CERULEANCITY_GUARD2');assert.ok(objectVisible(s,guard,'CERULEAN_CITY'));s.flags.EVENT_MET_BILL=true;assert.equal(objectVisible(s,guard,'CERULEAN_CITY'),false);
  s.flags.EVENT_BEAT_SILPH_CO_GIOVANNI=true;for(const o of world.maps.SAFFRON_CITY.objects)if(o.sprite==='SPRITE_ROCKET')assert.equal(objectVisible(s,o,'SAFFRON_CITY'),false);
});
test('every map has a playable original music sequence, with valid loop boundaries',()=>{
  assert.equal(Object.keys(music.tracks).length,46);for(const id of Object.keys(world.maps))assert.ok(music.tracks[music.mapMusic[id]],id);
  for(const track of Object.values(music.tracks))for(const c of track.channels){assert.ok(c.duration>=0);if(c.loopStart!==null){assert.ok(c.loopStart>=0);assert.ok(c.loopEnd>c.loopStart);}for(const n of c.notes){assert.ok(n.time>=0);assert.ok(n.duration>0);}}
});
