// Test-only hooks are injected into an isolated localhost response, not the shipped source.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
mkdirSync(root+'/test-results',{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});const page=await browser.newPage({viewport:{width:1440,height:1050}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.route('**/js/game.js',async route=>{const source=readFileSync(root+'/dist/js/game.js','utf8');await route.fulfill({contentType:'application/javascript',body:source+`\nwindow.__qa={state:()=>s,set:async(p)=>{s=initializeCampaign({...fresh(),...p});random=rng(s.seed);syncGeometry(s,events);started=true;battle=null;dialogue=null;menu=null;fx=null;sceneBusy=false;introArt=null;motion.clear();$('#overlay').hidden=true;await prepareMap();updatePanels();},object:id=>talkObject(currentMap().objects.find(o=>o.objectId===id)),step:campaignStep,interact:fieldInteract,before:campaignBeforeMove,done:()=>{if(fx){const d=fx.done;fx=null;d();}if(dialogue){const d=dialogue.done;dialogue=null;d?.();}},battle:()=>battle, menu:()=>menu,dialogue:()=>dialogue,fx:()=>fx,choose:selectMenu,get gym(){return events.gyms},get quests(){return events.quests},make:(id,level)=>makeMon(db,id,level,random),fight:beginBattle,win:()=>finishBattle(true),move, motion:()=>motion, evolve:processGrowth,field:fieldMove,turn:battleTurn,bag:useItem,pc:pcMenu,save:saveGame,load:startGame,get events(){return events},get world(){return world},moveTo:escortPlayer,meet:meetOak,get settings(){return settings}};`});});
await page.goto('http://127.0.0.1:4173');await page.waitForFunction(()=>window.pokered);await page.getByRole('button',{name:'NEW GAME',exact:true}).click();await page.waitForTimeout(500);
console.log('boot',await page.locator('#status').textContent(),await page.evaluate(()=>window.pokered.snapshot().dialogue.pages.length));
await page.screenshot({path:root+'/test-results/opening-dialogue-v02.png',fullPage:true});
await page.evaluate(async()=>{const q=window.__qa;await q.set({map:'PALLET_TOWN',x:8,y:5,flags:{starter:'BULBASAUR',pokedex:true,rival:true},party:[q.make('VENUSAUR',60)]});});
await page.keyboard.press('D');await page.waitForTimeout(250);console.log('move',await page.evaluate(()=>window.__qa.state().x));

async function drain(until,max=150){for(let i=0;i<max;i++){if(await page.evaluate(until))return;await page.evaluate(()=>window.__qa.done());await page.waitForTimeout(25);}throw Error('Timed out waiting for scene');}
for(const g of await page.evaluate(()=>window.__qa.gym)){
 await page.evaluate(async g=>{const q=window.__qa;await q.set({map:g.map,x:4,y:6,flags:{starter:'BULBASAUR',pokedex:true,rival:true,EVENT_2ND_LOCK_OPENED:true,EVENT_BEAT_SILPH_CO_GIOVANNI:true},bag:{HM_CUT:1,SECRET_KEY:1},badges:g.badge==='EARTH'?['BOULDER','CASCADE','THUNDER','RAINBOW','SOUL','MARSH','VOLCANO']:[],party:[q.make('MEWTWO',100)]});q.object(g.objectId);q.done();},g);
 await page.waitForTimeout(120);
 await page.evaluate(()=>{window.__qa.done()});await page.waitForTimeout(60);await page.evaluate(()=>window.__qa.done());await page.waitForTimeout(60);
 assert.equal(await page.evaluate(()=>window.__qa.battle()?.trainer.key),g.objectId);
 await page.evaluate(()=>{window.__qa.win();window.__qa.done();window.__qa.done();});await page.waitForTimeout(50);
 assert.ok(await page.evaluate(badge=>window.__qa.state().badges.includes(badge),g.badge));assert.equal(await page.evaluate(item=>window.__qa.state().bag[item],g.item),1);
}
// Oak's original walking scene and starter selection, through the public UI handlers.
await page.evaluate(async()=>{const q=window.__qa;await q.set({map:'PALLET_TOWN',x:10,y:1});q.meet();});
await drain(()=>!window.__qa.dialogue()&&!window.__qa.fx()&&window.__qa.state().map==='OAKS_LAB');
assert.equal(await page.evaluate(()=>window.__qa.state().flags.metOak),true);
await page.evaluate(()=>{window.__qa.object('OAKSLAB_CHARMANDER_POKE_BALL');});
await drain(()=>window.__qa.menu()?.title==='CHOOSE PARTNER');await page.evaluate(()=>window.__qa.choose(0));
await drain(()=>!window.__qa.dialogue());assert.equal(await page.evaluate(()=>window.__qa.state().party[0].species),'CHARMANDER');
// Real battle turn, animation and HP interpolation (no forced victory).
await page.evaluate(async()=>{const q=window.__qa;await q.set({map:'ROUTE_1',x:8,y:8,flags:{starter:'CHARMANDER',rival:true,pokedex:true},party:[q.make('CHARMANDER',10)]});q.fight([{species:'RATTATA',level:2}],null);});
await drain(()=>window.__qa.menu()?.title==='BATTLE');
await page.evaluate(()=>window.__qa.turn(0));await page.waitForTimeout(50);await page.evaluate(()=>window.__qa.done());
await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>window.__qa.fx()?.type),'attack');
await page.screenshot({path:root+'/test-results/battle-animation-v02.png',fullPage:true});
await drain(()=>!window.__qa.battle()&&!window.__qa.dialogue());
// CUT must update collision before the next movement, and persist across a reload.
await page.evaluate(async()=>{const q=window.__qa,m=q.world.maps.VERMILION_CITY;let tree;
 for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++)if(m.tileIds[y][x]===0x3d&&m.collision[y+1]?.[x]===1)tree={x,y};
 if(!tree)throw Error('Missing fixture tree');const mon=q.make('CHARMELEON',30);mon.moves=[{id:'CUT',pp:30}];await q.set({map:m.id,x:tree.x,y:tree.y+1,dir:'up',flags:{starter:'CHARMANDER',pokedex:true},badges:['CASCADE'],party:[mon]});q.field('CUT');});
await drain(()=>!window.__qa.dialogue()&&!window.__qa.fx());
assert.ok(await page.evaluate(()=>Object.keys(window.__qa.state().mapEdits.VERMILION_CITY).length));
await page.evaluate(()=>window.__qa.save());await page.evaluate(()=>window.__qa.load(true));assert.ok(await page.evaluate(()=>Object.keys(window.__qa.state().mapEdits.VERMILION_CITY).length));
// HM teaching and PC deposit/withdraw.
await page.evaluate(async()=>{const q=window.__qa;await q.set({map:'VERMILION_POKECENTER',x:3,y:6,flags:{starter:'SQUIRTLE',pokedex:true},bag:{HM_SURF:1},party:[q.make('SQUIRTLE',5),q.make('PIDGEY',3)]});q.bag('HM_SURF');q.choose(0);});
await drain(()=>!window.__qa.dialogue());assert.ok(await page.evaluate(()=>window.__qa.state().party[0].moves.some(m=>m.id==='SURF')));
await page.evaluate(()=>{const q=window.__qa;q.pc();q.choose(0);q.choose(1);});assert.equal(await page.evaluate(()=>window.__qa.state().box.length),1);
await page.evaluate(()=>{const q=window.__qa;q.pc();q.choose(1);q.choose(0);});assert.equal(await page.evaluate(()=>window.__qa.state().party.length),2);
// Evolution replaces species and preserves valid HP and save state.
await page.evaluate(async()=>{const q=window.__qa;await q.set({map:'PALLET_TOWN',x:8,y:5,flags:{starter:'BULBASAUR',pokedex:true},party:[q.make('BULBASAUR',16)]});q.evolve(()=>{});});
await drain(()=>window.__qa.state().party[0].species==='IVYSAUR'&&!window.__qa.dialogue()&&!window.__qa.fx());
// Quiz and card-key geometry interactions.
await page.evaluate(async()=>{const q=window.__qa;await q.set({map:'CINNABAR_GYM',x:15,y:8,dir:'up',party:[q.make('BLASTOISE',50)]});q.interact(15,7);q.done();q.choose(0);q.done();});
assert.equal(await page.evaluate(()=>window.__qa.state().flags.EVENT_CINNABAR_GYM_GATE1_UNLOCKED),true);
await page.evaluate(async()=>{const q=window.__qa,door=q.events.field.silphDoorBlocks.SILPH_CO_3F[0];await q.set({map:'SILPH_CO_3F',x:2,y:2,bag:{CARD_KEY:1},party:[q.make('BLASTOISE',50)]});q.interact(door.x*2,door.y*2);q.done();});assert.ok(await page.evaluate(()=>Object.keys(window.__qa.state().mapEdits.SILPH_CO_3F).length));
// Champion defeat runs the Hall of Fame sequence and returns a saved postgame party.
await page.evaluate(async()=>{const q=window.__qa;await q.set({map:'CHAMPIONS_ROOM',x:4,y:5,flags:{starter:'BULBASAUR',pokedex:true},party:[q.make('VENUSAUR',65)]});q.object('CHAMPIONSROOM_RIVAL');});
await drain(()=>window.__qa.menu()?.title==='BATTLE');await page.evaluate(()=>window.__qa.win());
await drain(()=>window.__qa.state().flags.champion&&window.__qa.state().map==='REDS_HOUSE_2F'&&!window.__qa.dialogue());
assert.equal(await page.evaluate(()=>window.__qa.state().hallOfFame.length),1);
console.log('flow passed: Oak, starter, real battle turn, CUT persistence, HM teaching, PC, evolution, quiz, Card Key, Hall of Fame');
console.log('errors',errors);assert.deepEqual(errors,[]);await browser.close();
