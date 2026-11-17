#!/usr/bin/env python3
"""Extract original event references and author a declarative campaign manifest.
This is reference data, NOT an automatic translation of assembly event scripts.
It preserves text branch alternatives for a JS runtime to select deliberately.
"""
import argparse,json,re,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'dist/data/events.json');a=p.parse_args();src=a.source.resolve();out=a.output.resolve()
world=json.loads((out.parent/'world.json').read_text());texts=world['texts'];maps=world['maps']
read=lambda f:(src/f).read_text()
# Supplemental global engine text is stored outside the per-map text directory.
# Keep RAM/number insertions explicit so the runtime can supply battle/item context.
def decode_literal(value):
 return value.replace('#','POKé').replace('<PKMN>','POKéMON').replace('<POKE>','POKé').replace('<MON>','MON').replace('<PLAYER>','{player}').replace('<RIVAL>','{rival}').replace('<LINE>','\n').replace('<DEXEND>','').replace('@','')
supplemental={}
for file in sorted((src/'data/text').glob('*.asm')):
 source=file.read_text()
 # This supplemental directory has one Virtual Console text replacement.
 source=re.sub(r'^IF DEF\(_RED_VC\) \|\| DEF\(_BLUE_VC\)\n[\s\S]*?^ELSE\n([\s\S]*?)^ENDC',r'\1',source,flags=re.M)
 labels=list(re.finditer(r'^(_\w+)::?',source,re.M))
 for i,label in enumerate(labels):
  body=source[label.end():labels[i+1].start() if i+1<len(labels) else len(source)]; chunks=[]
  for raw in body.splitlines():
   match=re.match(r'\s*(text|line|cont|para|next)\s+"([^"\n]*)"',raw)
   if match:
    command,value=match.groups();chunks.append(('\n\n' if command=='para' else '\n' if command in ['line','cont','next'] else '')+decode_literal(value));continue
   match=re.match(r'\s*text_(?:ram|decimal|bcd)\s+(\w+)',raw)
   if match:chunks.append('{'+match[1]+'}')
  value=''.join(chunks).strip()
  if value:supplemental[label[1]]=value
texts.update(supplemental)
def num(v):return int(v.replace('$','0x'),0) if v.startswith('$') else int(v)
def refs(*keys):
 for k in keys:
  if k not in texts:raise ValueError('Unknown original text label '+k)
 return list(keys)
def pref(prefix,contains=None):return [k for k in texts if k.startswith(prefix) and (contains is None or contains in k)]
def stage(id,keys,**kw):return {'id':id,'text':refs(*keys),**kw}
def quest(map,objects,stages,**kw):
 for oid in objects:
  assert any(o['objectId']==oid for o in maps[map]['objects']),oid
 return {'map':map,'objectIds':objects,'stages':stages,**kw}
e={'source':{'url':'https://github.com/pret/pokered','commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=src,text=True).strip(),'method':'Original text/script references plus manually identified declarative quest transitions. Not an assembly VM.'},'texts':supplemental,'scenes':{},'gyms':[],'quests':{},'rivals':[],'league':[],'textPointers':{},'objectTextVariants':{},'marts':{},'items':{},'machines':{},'machineCompatibility':{},'field':{},'limitations':['Every textPointers variant is an alternative original branch, not a single sequence to display.','Map callbacks, movement cutscenes and tile puzzles require explicit runtime implementation.','The manifest is not evidence that every original event has been implemented.']}
# Scope local labels exactly so duplicate .Text blocks resolve correctly.
blocks={};pointers={}
for f in sorted((src/'scripts').glob('*.asm')):
 scope='';key=None
 for line in f.read_text().splitlines():
  match=re.match(r'^([A-Za-z_][\w]*|\.[\w]+)(?:::?)?(?:\s*;.*)?$',line)
  if match:
   label=match[1]
   if label.startswith('.'):key=scope+label
   else:scope=label;key=label
   blocks[key]={'scope':scope,'lines':[],'file':str(f.relative_to(src))}
  elif key:blocks[key]['lines'].append(line.split(';')[0].strip())
 for entry,ident in re.findall(r'dw_const\s+(\w+),\s*(TEXT_\w+)',f.read_text()):pointers[ident]=entry

def trace(label,seen=None):
 seen=set() if seen is None else seen
 if label in seen:return []
 seen.add(label)
 if label in texts:return [label]
 block=blocks.get(label)
 if not block:return [('_'+label)] if '_'+label in texts else []
 result=[]
 for line in block['lines']:
  match=re.match(r'(?:text_far|text_jump|text_asm|ld (?:hl|de),|jp|call)\s+([.\w]+)',line)
  if not match:continue
  target=match[1]
  if target.startswith('.'):target=block['scope']+target
  for r in trace(target,seen):
   if r not in result:result.append(r)
 return result
for ident,entry in pointers.items():e['textPointers'][ident]={'entry':entry,'variants':trace(entry)}
for m in maps.values():
 for o in m['objects']:
  variants=e['textPointers'].get(o['textId'],{}).get('variants',[])
  if variants:e['objectTextVariants'][o['objectId']]=variants
# Complete original opening conversations rather than abbreviated summaries.
e['scenes'].update({
 'oakWarning':refs('_PalletTownOakHeyWaitDontGoOutText','_PalletTownOakItsUnsafeText'),
 'oakLabIntroduction':refs('_OaksLabRivalFedUpWithWaitingText','_OaksLabOakChooseMonText','_OaksLabRivalWhatAboutMeText','_OaksLabOakBePatientText'),
 'oakParcel':refs('_OaksLabOak1DeliverParcelText','_OaksLabOak1ParcelThanksText','_OaksLabRivalGrampsText','_OaksLabRivalWhatDidYouCallMeForText','_OaksLabOakIHaveARequestText','_OaksLabOakMyInventionPokedexText','_OaksLabOakGotPokedexText','_OaksLabOakThatWasMyDreamText','_OaksLabRivalLeaveItAllToMeText'),
 'starterReceived':refs('_OaksLabMonEnergeticText','_OaksLabReceivedMonText','_OaksLabRivalIllTakeThisOneText','_OaksLabRivalReceivedMonText'),
 'rivalLabChallenge':refs('_OaksLabRivalIllTakeYouOnText'),
 'rivalLabWon':refs('_OaksLabRivalIPickedTheWrongPokemonText','_OaksLabRivalSmellYouLaterText'),
 'rivalLabLost':refs('_OaksLabRivalAmIGreatOrWhatText','_OaksLabRivalSmellYouLaterText'),
 'hallOfFame':refs('_ChampionsRoomRivalAfterBattleText','_ChampionsRoomOakText','_ChampionsRoomOakCongratulatesPlayerText','_ChampionsRoomOakDisappointedWithRivalText','_ChampionsRoomOakComeWithMeText','_HallOfFameOakText')
})
for mon in ['Charmander','Squirtle','Bulbasaur']:e['scenes']['choose'+mon]=refs('_OaksLabYouWant'+mon+'Text')
# Gym badges and full victory sequences, as emitted by the original scripts.
gymdefs=[
 ('PEWTER_GYM','BROCK','BOULDER','BIDE',34,'PewterGymBrock',['_PewterGymBrockReceivedBoulderBadgeText','_PewterGymBrockBoulderBadgeInfoText','_PewterGymBrockWaitTakeThisText','_PewterGymReceivedTM34Text','_TM34ExplanationText'],[]),
 ('CERULEAN_GYM','MISTY','CASCADE','BUBBLEBEAM',11,'CeruleanGymMisty',['_CeruleanGymMistyReceivedCascadeBadgeText','_CeruleanGymMistyCascadeBadgeInfoText','_CeruleanGymMistyReceivedTM11Text','_CeruleanGymMistyTM11ExplanationText'],[]),
 ('VERMILION_GYM','LT_SURGE','THUNDER','THUNDERBOLT',24,'VermilionGymLTSurge',['_VermilionGymLTSurgeReceivedThunderBadgeText','_VermilionGymLTSurgeThunderBadgeInfoText','_VermilionGymLTSurgeReceivedTM24Text','_TM24ExplanationText'],['CUT_ACCESS','TRASH_SWITCHES']),
 ('CELADON_GYM','ERIKA','RAINBOW','MEGA_DRAIN',21,'CeladonGymErika',['_CeladonGymErikaReceivedRainbowBadgeText','_CeladonGymRainbowBadgeInfoText','_CeladonGymReceivedTM21Text','_TM21ExplanationText'],['CUT_ACCESS']),
 ('FUCHSIA_GYM','KOGA','SOUL','TOXIC',6,'FuchsiaGymKoga',['_FuchsiaGymKogaReceivedSoulBadgeText','_FuchsiaGymKogaSoulBadgeInfoText','_FuchsiaGymKogaReceivedTM06Text','_FuchsiaGymKogaTM06ExplanationText'],[]),
 ('SAFFRON_GYM','SABRINA','MARSH','PSYWAVE',46,'SaffronGymSabrina',['_SaffronGymSabrinaReceivedMarshBadgeText','_SaffronGymSabrinaMarshBadgeInfoText','_SaffronGymSabrinaReceivedTM46Text','_TM46ExplanationText'],['SILPH_CO_LIBERATED']),
 ('CINNABAR_GYM','BLAINE','VOLCANO','FIRE_BLAST',38,'CinnabarGymBlaine',['_CinnabarGymBlaineReceivedVolcanoBadgeText','_CinnabarGymBlaineVolcanoBadgeInfoText','_CinnabarGymBlaineReceivedTM38Text','_CinnabarGymBlaineTM38ExplanationText'],['SECRET_KEY']),
 ('VIRIDIAN_GYM','GIOVANNI','EARTH','FISSURE',27,'ViridianGymGiovanni',['_ViridianGymGiovanniReceivedEarthBadgeText','_ViridianGymGiovanniEarthBadgeInfoText','_ViridianGymGiovanniReceivedTM27Text','_ViridianGymGiovanniTM27ExplanationText','_ViridianGymGiovanniPostBattleAdviceText'],['SEVEN_BADGES'])]
for map,trainer,badge,move,tm,prefix,victory,requires in gymdefs:
 obj=next(o for o in maps[map]['objects'] if o.get('trainer',{}).get('class')==trainer)
 intro=next((k for k in ['_'+prefix+'PreBattleText','_'+prefix+'Text'] if k in texts),None)
 # Koga's original intro lives in a shared text file under a shorter label.
 if trainer=='KOGA':intro=next((k for k in texts if 'Koga' in k and ('Before' in k or 'PreBattle' in k)),intro)
 e['gyms'].append({'map':map,'objectId':obj['objectId'],'trainerClass':trainer,'party':obj['trainer']['party'],'badge':badge,'item':'TM_'+move,'tm':tm,'move':move,'intro':refs(intro) if intro else [],'victory':refs(*victory),'after':pref('_'+prefix,'PostBattleAdvice'),'requires':requires})
# Quest stages use original event flags. Requirements here are logical facts, not automatic gates.
q=e['quests']
q['bill']=quest('BILLS_HOUSE',['BILLSHOUSE_BILL_POKEMON','BILLSHOUSE_BILL1','BILLSHOUSE_BILL2'],[
 stage('askHelp',['_BillsHouseBillImNotAPokemonText'],choice=True),stage('refuse',['_BillsHouseBillNoYouGottaHelpText']),stage('enterMachine',['_BillsHouseBillUseSeparationSystemText'],setFlags=['EVENT_BILL_SAID_USE_CELL_SEPARATOR'],hide=['BILLSHOUSE_BILL_POKEMON']),
 stage('runPC',['_BillsHouseInitiatedText'],setFlags=['EVENT_USED_CELL_SEPARATOR_ON_BILL','EVENT_MET_BILL'],show=['BILLSHOUSE_BILL1']),stage('receiveTicket',['_BillsHouseBillThankYouText','_SSTicketReceivedText','_BillsHouseBillWhyDontYouGoInsteadOfMeText'],rewards={'S_S_TICKET':1},setFlags=['EVENT_GOT_SS_TICKET']),stage('after',['_BillsHouseBillCheckOutMyRarePokemonText'])],pc={'x':1,'y':4,'facing':'up','coordinateSpace':'targetTile','idleText':refs('_BillsHouseMonitorText')},effects=['Relocate Cerulean guard to allow entry into robbed house.'])
q['cut']=quest('SS_ANNE_CAPTAINS_ROOM',['SSANNECAPTAINSROOM_CAPTAIN'],[stage('reward',['_SSAnneCaptainsRoomRubCaptainsBackText','_SSAnneCaptainsRoomCaptainIFeelMuchBetterText','_SSAnneCaptainsRoomCaptainReceivedHM01Text'],rewards={'HM_CUT':1},setFlags=['EVENT_GOT_HM01']),stage('after',['_SSAnneCaptainsRoomCaptainNotSickAnymoreText'])],requires=['S_S_TICKET'],effects=['S.S. Anne departs after player exits having received HM01.'])
q['bikeVoucher']=quest('POKEMON_FAN_CLUB',['POKEMONFANCLUB_CHAIRMAN'],[stage('intro',['_PokemonFanClubChairmanIntroText'],choice=True),stage('story',['_PokemonFanClubChairmanStoryText','_PokemonFanClubReceivedBikeVoucherText','_PokemonFanClubExplainBikeVoucherText'],rewards={'BIKE_VOUCHER':1}),stage('refuse',['_PokemonFanClubNoStoryText']),stage('after',['_PokemonFanClubChairFinalText'])])
q['bicycle']=quest('BIKE_SHOP',['BIKESHOP_CLERK'],[stage('noVoucher',['_BikeShopClerkWelcomeText','_BikeShopClerkDoYouLikeItText','_BikeShopCantAffordText']),stage('reward',['_BikeShopClerkOhThatsAVoucherText','_BikeShopExchangedVoucherText','_BikeShopComeAgainText'],consume={'BIKE_VOUCHER':1},rewards={'BICYCLE':1}),stage('after',['_BikeShopClerkHowDoYouLikeYourBicycleText'])],requires=['BIKE_VOUCHER'])
q['rocketHideout']=quest('ROCKET_HIDEOUT_B4F',['ROCKETHIDEOUTB4F_GIOVANNI','ROCKETHIDEOUTB4F_ROCKET3','ROCKETHIDEOUTB4F_LIFT_KEY','ROCKETHIDEOUTB4F_SILPH_SCOPE'],[stage('liftKey',['_RocketHideoutB4FRocket3AfterBattleText'],requiresDefeated=['ROCKETHIDEOUTB4F_ROCKET3'],show=['ROCKETHIDEOUTB4F_LIFT_KEY']),stage('giovanniIntro',['_RocketHideoutB4FGiovanniImpressedYouGotHereText']),stage('giovanniDefeated',['_RocketHideoutB4FGiovanniWhatCannotBeText','_RocketHideoutB4FGiovanniHopeWeMeetAgainText'],hide=['ROCKETHIDEOUTB4F_GIOVANNI'],show=['ROCKETHIDEOUTB4F_SILPH_SCOPE'],setFlags=['EVENT_BEAT_ROCKET_HIDEOUT_GIOVANNI'])],requires=['LIFT_KEY'],entrance={'map':'GAME_CORNER','objectId':'GAMECORNER_ROCKET','text':refs('_GameCornerRocketImGuardingThisPosterText','_GameCornerPosterSwitchBehindPosterText')})
q['marowak']=quest('POKEMON_TOWER_6F',[],[stage('intro',['_PokemonTower6FBeGoneText']),stage('identified',['_PokemonTower6FGhostWasCubonesMotherText']),stage('defeated',['_PokemonTower6FSoulWasCalmedText'],setFlags=['EVENT_BEAT_GHOST_MAROWAK'])],trigger={'x':10,'y':16},requires=['SILPH_SCOPE'],battle={'species':'MAROWAK','level':30,'cannotCatch':True})
q['fujiRescue']=quest('POKEMON_TOWER_7F',['POKEMONTOWER7F_MR_FUJI'],[stage('rescue',['_PokemonTower7FMrFujiRescueText'],setFlags=['EVENT_RESCUED_MR_FUJI'],warp={'map':'MR_FUJIS_HOUSE','targetWarp':2,'x':3,'y':7,'facing':'up','lastMap':'LAVENDER_TOWN'},show=['MRFUJISHOUSE_MR_FUJI'])],requires=['EVENT_BEAT_GHOST_MAROWAK'],requiresDefeated=['POKEMONTOWER7F_ROCKET1','POKEMONTOWER7F_ROCKET2','POKEMONTOWER7F_ROCKET3'])
q['pokeFlute']=quest('MR_FUJIS_HOUSE',['MRFUJISHOUSE_MR_FUJI'],[stage('reward',['_MrFujisHouseMrFujiIThinkThisMayHelpYourQuestText','_MrFujisHouseMrFujiReceivedPokeFluteText','_MrFujisHouseMrFujiPokeFluteExplanationText'],rewards={'POKE_FLUTE':1}),stage('after',['_MrFujisHouseMrFujiHasMyFluteHelpedYouText'])],requires=['EVENT_RESCUED_MR_FUJI'])
for route in [12,16]:q['snorlax'+str(route)]=quest('ROUTE_'+str(route),['ROUTE'+str(route)+'_SNORLAX'],[stage('wake',['_Route'+str(route)+'SnorlaxWokeUpText']),stage('after',['_Route12SnorlaxCalmedDownText' if route==12 else '_Route16SnorlaxReturnedToMountainsText'],hide=['ROUTE'+str(route)+'_SNORLAX'])],requires=['POKE_FLUTE'],battle={'species':'SNORLAX','level':30})
q['silphGiovanni']=quest('SILPH_CO_11F',['SILPHCO11F_GIOVANNI'],[stage('intro',['_SilphCo11FGiovanniText']),stage('defeated',['_SilphCo11FGiovanniILostAgainText','_SilphCo11FGiovanniYouRuinedOurPlansText'],setFlags=['EVENT_BEAT_SILPH_CO_GIOVANNI'],hide=['SILPHCO11F_GIOVANNI'])],requires=['CARD_KEY'],effects=['Remove Rocket occupation of Saffron and Silph Co.'])
q['masterBall']=quest('SILPH_CO_11F',['SILPHCO11F_SILPH_PRESIDENT'],[stage('reward',['_SilphCo11FSilphPresidentText','_SilphCo11FSilphPresidentReceivedMasterBallText','_SilphCo11FSilphPresidentMasterBallDescriptionText'],rewards={'MASTER_BALL':1})],requires=['EVENT_BEAT_SILPH_CO_GIOVANNI'])
q['surf']=quest('SAFARI_ZONE_SECRET_HOUSE',['SAFARIZONESECRETHOUSE_FISHING_GURU'],[stage('reward',['_SafariZoneSecretHouseFishingGuruYouHaveWonText','_SafariZoneSecretHouseFishingGuruReceivedHM03Text','_SafariZoneSecretHouseFishingGuruHM03ExplanationText'],rewards={'HM_SURF':1})])
q['strength']=quest('WARDENS_HOUSE',['WARDENSHOUSE_WARDEN'],[stage('noTeeth',['_WardensHouseWardenGibberish1Text']),stage('reward',['_WardensHouseWardenGaveTheGoldTeethText','_WardensHouseWardenTeethPoppedInHisTeethText','_WardensHouseWardenThanksText','_WardensHouseWardenReceivedHM04Text','_WardensHouseWardenHM04ExplanationText'],consume={'GOLD_TEETH':1},rewards={'HM_STRENGTH':1})],requires=['GOLD_TEETH'],pickup={'map':'SAFARI_ZONE_WEST','objectId':'SAFARIZONEWEST_GOLD_TEETH'})
q['fly']=quest('ROUTE_16_FLY_HOUSE',['ROUTE16FLYHOUSE_BRUNETTE_GIRL'],[stage('reward',['_Route16FlyHouseBrunetteGirlText','_Route16FlyHouseBrunetteGirlReceivedHM02Text','_Route16FlyHouseBrunetteGirlHM02ExplanationText'],rewards={'HM_FLY':1})])
q['secretKey']=quest('POKEMON_MANSION_B1F',['POKEMONMANSIONB1F_SECRET_KEY'],[stage('pickup',[],rewards={'SECRET_KEY':1})],effects=['Unlock Cinnabar Gym entrance.'])
# Rival teams are indexed by PLAYER starter; arrays in pokemon.trainers are zero-based.
for id,map,cls,start,coords,pre,post in [
 ('rivalRoute22Early','ROUTE_22','RIVAL1',4,[(29,4),(29,5)],'_Route22RivalBeforeBattleText1','_Route22RivalAfterBattleText1'),
 ('rivalCerulean','CERULEAN_CITY','RIVAL1',7,[(20,6),(21,6)],'_CeruleanCityRivalPreBattleText','_CeruleanCityRivalIWentToBillsText'),
 ('rivalSSAnne','SS_ANNE_2F','RIVAL2',1,[(36,8),(37,8)],'_SSAnne2FRivalText','_SSAnne2FRivalCutMasterText'),
 ('rivalTower','POKEMON_TOWER_2F','RIVAL2',4,[(15,5),(14,6)],'_PokemonTower2FRivalWhatBringsYouHereText','_PokemonTower2FRivalHowsYourDexText'),
 ('rivalSilph','SILPH_CO_7F','RIVAL2',7,[(3,2),(3,3)],'_SilphCo7FRivalText','_SilphCo7FRivalGoodLuckToYouText'),
 ('rivalRoute22Late','ROUTE_22','RIVAL2',10,[(29,4),(29,5)],'_Route22RivalBeforeBattleText2','_Route22RivalAfterBattleText2'),
 ('champion','CHAMPIONS_ROOM','RIVAL3',1,[], '_ChampionsRoomRivalIntroText','_ChampionsRoomRivalAfterBattleText')]:
 e['rivals'].append({'id':id,'map':map,'trainerClass':cls,'partyByStarter':{'CHARMANDER':start,'SQUIRTLE':start+1,'BULBASAUR':start+2},'trigger':coords,'intro':refs(pre) if pre in texts else [],'after':refs(post) if post in texts else [],'availableText':pref('_'+maps[map]['name'],'Rival')})
for map,cls,pre,end,after in [('LORELEIS_ROOM','LORELEI','_LoreleisRoomLoreleiBeforeBattleText','_LoreleisRoomLoreleiEndBattleText','_LoreleisRoomLoreleiAfterBattleText'),('BRUNOS_ROOM','BRUNO','_BrunoBeforeBattleText','_BrunoEndBattleText','_BrunoAfterBattleText'),('AGATHAS_ROOM','AGATHA','_AgathaBeforeBattleText','_AgathaEndBattleText','_AgathaAfterBattleText'),('LANCES_ROOM','LANCE','_LancesRoomLanceBeforeBattleText','_LancesRoomLanceEndBattleText','_LancesRoomLanceAfterBattleText')]:
 obj=next(o for o in maps[map]['objects'] if o.get('trainer',{}).get('class')==cls)
 e['league'].append({'map':map,'objectId':obj['objectId'],'trainerClass':cls,'party':1,'intro':refs(pre),'victory':refs(end,after)})
# Mart inventories, exact item prices, machine definitions and species compatibility.
for entry,body in re.findall(r'^(\w+)::([^:]*?)(?=^\w+::|\Z)',read('data/items/marts.asm'),re.M|re.S):
 match=re.search(r'script_mart\s+([^\n]+)',body)
 if not match:continue
 inventory=[x.strip() for x in match[1].split(',')]
 matching=[(m,o) for m in maps.values() for o in m['objects'] if pointers.get(o['textId'])==entry]
 for m,o in matching:
  if o['sprite']=='SPRITE_CLERK':e['marts'][o['objectId']]=inventory
for price,item in re.findall(r'bcd3\s+(\d+)\s*;\s*(\w+)',read('data/items/prices.asm')):e['items'][item]={'price':int(price)}
for prefix,macro in [('HM','add_hm'),('TM','add_tm')]:
 for i,move in enumerate(re.findall(r'^\s*'+macro+r'\s+(\w+)',read('constants/item_constants.asm'),re.M),1):e['machines'][prefix+'_'+move]={'number':i,'move':move,'reusable':prefix=='HM'}
tmPrices=[int(n)*1000 for n in re.findall(r'^\s*nybble (\d+)',read('data/items/tm_prices.asm'),re.M)]
for item,machine in e['machines'].items():e['items'][item]={'price':tmPrices[machine['number']-1] if item.startswith('TM_') and machine['number']<=len(tmPrices) else 0}
for file in (src/'data/pokemon/base_stats').glob('*.asm'):
 t=file.read_text();match=re.search(r'\bdb DEX_(\w+)',t)
 if not match:continue
 moves=re.search(r'tmhm ([\s\S]+?); end',t)
 if moves:e['machineCompatibility'][match[1]]=re.findall(r'\b[A-Z][A-Z_]+\b',moves[1])
e['field']['badgeRequirements']={'CUT':'CASCADE','FLY':'THUNDER','SURF':'SOUL','STRENGTH':'RAINBOW','FLASH':'BOULDER'}
e['field']['cutTreeBlockSwaps']=[{'from':num(x),'to':num(y)} for x,y in re.findall(r'db (\$\w+), (\$\w+)',read('data/tilesets/cut_tree_blocks.asm'))]

e['field']['silphDoorBlocks']={}
for m in maps.values():
 if not m['id'].startswith('SILPH_CO_'):continue
 t=read('scripts/'+m['name']+'.asm')
 # Actual callback block replacement coordinates, not the unused CardKeyTable data.
 e['field']['silphDoorBlocks'][m['id']]=[{'x':int(x),'y':int(y),'closedBlock':num(block),'openBlock':3 if m['id']=='SILPH_CO_11F' else 14} for block,y,x in re.findall(r'ld a, (\$\w+)\s*\n\s*ld \[wNewTileBlockID\], a\s*\n\s*lb bc, (\d+), (\d+)\s*\n\s*predef(?:_jump)? ReplaceTileBlock',t)]
# Puzzle coordinates are explicitly separated: blocks are 32px, cells are 16px.
f=e['field']
f['coordinateNotes']={'blockChanges':'x/y are 32px map block coordinates; update image, collision and tile IDs together.','hiddenInteractions':'x/y are the TARGET 16px tile in front of the player, not the player position.','spinPaths':'steps are in actual execution order, reversed from the original RLE byte list.'}
e['scenes']['oakSpeech']=refs('_OakSpeechText1','_OakSpeechText2A','_OakSpeechText2B','_IntroducePlayerText','_IntroduceRivalText','_OakSpeechText3')
# Hidden interactions supply target geometry, including the five Mansion switches.
f['hiddenInteractions']={}
hidden=read('data/events/hidden_events.asm'); current=None
for line in hidden.splitlines():
 match=re.search(r'hidden_events_for (\w+)',line)
 if match:current=match[1];continue
 match=re.search(r'hidden_event\s+(\d+),\s*(\d+),\s*(\w+),\s*(.+)',line)
 if match and current:
  x,y,handler,arg=match.groups();f['hiddenInteractions'].setdefault(current,[]).append({'x':int(x),'y':int(y),'handler':handler,'argument':arg.split(';')[0].strip()})
f['vermilionPuzzle']={'map':'VERMILION_GYM','barrier':{'x':2,'y':2,'closedBlock':0x24,'openBlock':5},'firstFlag':'EVENT_1ST_LOCK_OPENED','completeFlag':'EVENT_2ND_LOCK_OPENED','cans':[v for v in f['hiddenInteractions']['VERMILION_GYM'] if v['handler']=='GymTrashScript'],'text':{'empty':refs('_VermilionGymTrashText'),'first':refs('_VermilionGymTrashSuccessText1'),'complete':refs('_VermilionGymTrashSuccessText3'),'reset':refs('_VermilionGymTrashFailText')},'originalRngNote':'Original second-lock RNG has an underflow bug allowing can zero regardless of first can; wrong second choice resets first lock and chooses random & 0x0e.'}
trash=read('engine/events/hidden_events/vermilion_gym_trash.asm').split('GymTrashCans:')[1].split('VermilionGymTrashSuccessText1::')[0]
f['vermilionPuzzle']['secondLockTables']=[{'mask':int(ns[0]),'candidates':[int(n) for n in ns[1:1+int(ns[0])]]} for ns in [re.findall(r'\d+',line.split(';')[0]) for line in trash.splitlines() if re.match(r'\s*db ',line)]]
f['cinnabarQuiz']={'map':'CINNABAR_GYM','intro':refs('_CinnabarGymQuizIntroText'),'correct':refs('_CinnabarGymQuizCorrectText'),'incorrect':refs('_CinnabarGymQuizIncorrectText'),'gates':[]}
coords=re.findall(r'gym_gate_coord (\d+),\s*(\d+),\s*(\w+)',read('engine/events/hidden_events/cinnabar_gym_quiz.asm'))
for i,((x,y,block),interaction) in enumerate(zip(coords,[v for v in f['hiddenInteractions']['CINNABAR_GYM'] if v['handler']=='PrintCinnabarQuiz']),1):
 # YesNoChoice uses index0 for YES, index1 for NO. FALSE in the original is YES.
 f['cinnabarQuiz']['gates'].append({'index':i,'x':int(x),'y':int(y),'closedBlock':0x54 if block=='HORIZONTAL_GATE_BLOCK' else 0x5f,'openBlock':14,'flag':f'EVENT_CINNABAR_GYM_GATE{i}_UNLOCKED','target':{'x':interaction['x'],'y':interaction['y'],'facing':'up'},'answerYes':'FALSE' in interaction['argument'],'question':refs('_CinnabarQuizQuestionsText'+str(i)),'trainerObjectId':maps['CINNABAR_GYM']['objects'][i+1]['objectId']})
f['mansionSwitch']={'flag':'EVENT_MANSION_SWITCH_ON','text':{'prompt':refs('_PokemonMansion2FSwitchText'),'pressed':refs('_PokemonMansion2FSwitchPressedText'),'declined':refs('_PokemonMansion2FSwitchNotPressedText')},'maps':{}}
mansion={'POKEMON_MANSION_1F':[(12,6,14,45),(8,3,45,14),(10,8,45,14),(13,13,45,14)],'POKEMON_MANSION_2F':[(4,2,14,95),(9,4,84,14),(3,11,95,14)],'POKEMON_MANSION_3F':[(7,2,14,95),(7,5,95,14)],'POKEMON_MANSION_B1F':[(13,8,14,45),(6,11,14,95),(4,3,95,14),(8,8,84,14)]}
for map,changes in mansion.items():f['mansionSwitch']['maps'][map]={'blocks':[{'x':x,'y':y,'off':off,'on':on} for x,y,off,on in changes],'targets':[{'x':v['x'],'y':v['y'],'facing':'up'} for v in f['hiddenInteractions'][map] if 'Script_Switches' in v['handler']]}
f['eventBlockChanges']=[{'map':'ROCKET_HIDEOUT_B4F','x':12,'y':5,'closedBlock':45,'openBlock':14,'flag':'EVENT_ROCKET_HIDEOUT_4_DOOR_UNLOCKED','requiresDefeated':['ROCKETHIDEOUTB4F_ROCKET1','ROCKETHIDEOUTB4F_ROCKET2']},{'map':'GAME_CORNER','x':8,'y':2,'closedBlock':42,'openBlock':67,'flag':'EVENT_FOUND_ROCKET_HIDEOUT','interactionTextId':'TEXT_GAMECORNER_POSTER'}]
f['boulderSwitches']=[{'map':map,'x':x,'y':y,'flag':flag,'blockChange':{'x':bx,'y':by,'openBlock':tile}} for map,x,y,flag,bx,by,tile in [('VICTORY_ROAD_1F',17,13,'EVENT_VICTORY_ROAD_1_BOULDER_ON_SWITCH',4,6,29),('VICTORY_ROAD_2F',1,16,'EVENT_VICTORY_ROAD_2_BOULDER_ON_SWITCH1',3,4,21),('VICTORY_ROAD_2F',9,16,'EVENT_VICTORY_ROAD_2_BOULDER_ON_SWITCH2',11,7,29),('VICTORY_ROAD_3F',3,5,'EVENT_VICTORY_ROAD_3_BOULDER_ON_SWITCH1',3,5,29)]]
f['dungeonFalls']=[]
warpdata=read('data/maps/special_warps.asm'); warpkeys=re.findall(r'db (\w+),\s*(\d+)',warpdata.split('DungeonWarpList:')[1].split('MACRO fly_warp')[0]); destinations=re.findall(r'fly_warp (\w+),\s*(\d+),\s*(\d+)',warpdata.split('DungeonWarpData:')[1].split('MACRO special_warp_spec')[0]); fallDest={(map,int(index)):{'map':map,'x':int(x),'y':int(y)} for (map,index),(dest,x,y) in zip(warpkeys,destinations)}
for map,dest,coords in [('SEAFOAM_ISLANDS_1F','SEAFOAM_ISLANDS_B1F',[(17,6),(24,6)]),('SEAFOAM_ISLANDS_B1F','SEAFOAM_ISLANDS_B2F',[(18,6),(23,6)]),('SEAFOAM_ISLANDS_B2F','SEAFOAM_ISLANDS_B3F',[(19,6),(22,6)]),('SEAFOAM_ISLANDS_B3F','SEAFOAM_ISLANDS_B4F',[(3,16),(6,16)]),('VICTORY_ROAD_3F','VICTORY_ROAD_2F',[(23,15)]),('POKEMON_MANSION_3F','POKEMON_MANSION_1F',[(16,14),(17,14)])]:
 for i,(x,y) in enumerate(coords,1):f['dungeonFalls'].append({'map':map,'x':x,'y':y,'destination':fallDest[(dest,2 if map=='VICTORY_ROAD_3F' else i)]})
f['dungeonFalls'].append({'map':'POKEMON_MANSION_3F','x':19,'y':14,'destination':fallDest[('POKEMON_MANSION_2F',3)]})
f['boulderFalls']=[]
for level,(map,dest,coords) in enumerate([('SEAFOAM_ISLANDS_1F','SEAFOAM_ISLANDS_B1F',[(17,6),(24,6)]),('SEAFOAM_ISLANDS_B1F','SEAFOAM_ISLANDS_B2F',[(18,6),(23,6)]),('SEAFOAM_ISLANDS_B2F','SEAFOAM_ISLANDS_B3F',[(19,6),(22,6)]),('SEAFOAM_ISLANDS_B3F','SEAFOAM_ISLANDS_B4F',[(3,16),(6,16)])],1):
 for i,(x,y) in enumerate(coords,1):
  hide=map.replace('_','')+'_BOULDER'+str(i);show=dest.replace('_','')+'_BOULDER'+str(i+2 if level==3 else i)
  assert any(o['objectId']==hide for o in maps[map]['objects']),hide
  obj=next(o for o in maps[dest]['objects'] if o['objectId']==show)
  f['boulderFalls'].append({'map':map,'x':x,'y':y,'flag':f'EVENT_SEAFOAM{level}_BOULDER{i}_DOWN_HOLE','hide':hide,'show':show,'destination':{'map':dest,'x':obj['x'],'y':obj['y']}})
obj=next(o for o in maps['VICTORY_ROAD_2F']['objects'] if o['objectId']=='VICTORYROAD2F_BOULDER3')
f['boulderFalls'].append({'map':'VICTORY_ROAD_3F','x':23,'y':15,'flag':'EVENT_VICTORY_ROAD_3_BOULDER_ON_SWITCH2','hide':'VICTORYROAD3F_BOULDER4','show':obj['objectId'],'destination':{'map':'VICTORY_ROAD_2F','x':obj['x'],'y':obj['y']}})
f['spinPaths']={}
for map in ['VIRIDIAN_GYM','ROCKET_HIDEOUT_B2F','ROCKET_HIDEOUT_B3F']:
 source=read('scripts/'+maps[map]['name']+'.asm');paths=[]
 for x,y,label in re.findall(r'map_coord_movement\s+(\d+),\s*(\d+),\s*(\w+)',source):
  body=source.split(label+':',1)[1].split('db -1',1)[0]
  steps=[{'direction':direction.lower(),'count':int(count)} for direction,count in re.findall(r'db PAD_(UP|DOWN|LEFT|RIGHT),\s*(\d+)',body)]
  assert steps,label
  paths.append({'x':int(x),'y':int(y),'steps':steps[::-1]})
 f['spinPaths'][map]=paths
f['elevators']={}
for map in ['ROCKET_HIDEOUT_ELEVATOR','SILPH_CO_ELEVATOR','CELADON_MART_ELEVATOR']:
 source=read('scripts/'+maps[map]['name']+'.asm');match=re.search(r'^\w+WarpMaps:\s*([\s\S]+?)^\.End:',source,re.M)
 if match:
  f['elevators'][map]={'requires':['LIFT_KEY'] if map=='ROCKET_HIDEOUT_ELEVATOR' else [],'destinations':[{'map':dest,'targetWarp':int(warp)+1} for warp,dest in re.findall(r'db (\d+),\s*(\w+)',match[1])],'sourceWarpNumbers':'Original elevator table IDs are zero-based; targetWarp here converted to one-based world.warps IDs.'}
f['safariGame']={'map':'SAFARI_ZONE_GATE','admissionTriggers':[{'x':3,'y':2},{'x':4,'y':2}],'price':500,'balls':30,'initialSteps':502,'flag':'EVENT_IN_SAFARI_ZONE','gameOverFlag':'EVENT_SAFARI_GAME_OVER','returnWarp':{'map':'SAFARI_ZONE_GATE','targetWarp':4,'x':4,'y':0},'intro':refs('_SafariZoneGateSafariZoneWorker1Text','_SafariZoneGateSafariZoneWorker1WouldYouLikeToJoinText'),'paid':refs('_SafariZoneGateSafariZoneWorker1ThatllBe500PleaseText','_SafariZoneGateSafariZoneWorker1CallYouOnThePAText'),'notEnoughMoney':refs('_SafariZoneGateSafariZoneWorker1NotEnoughMoneyText'),'declined':refs('_SafariZoneGateSafariZoneWorker1PleaseComeAgainText'),'leavingEarly':refs('_SafariZoneGateSafariZoneWorker1LeavingEarlyText'),'leave':refs('_SafariZoneGateSafariZoneWorker1ReturnSafariBallsText'),'stay':refs('_SafariZoneGateSafariZoneWorker1GoodLuckText'),'timesUp':refs('_TimesUpText','_GameOverText'),'finished':refs('_SafariZoneGateSafariZoneWorker1GoodHaulComeAgainText')}
f['mapGates']=[{'map':'CINNABAR_ISLAND','x':18,'y':4,'requiresItems':['SECRET_KEY'],'blockedText':refs('_CinnabarIslandDoorIsLockedText'),'pushDirection':'down'},{'map':'VIRIDIAN_CITY','x':32,'y':8,'requiresBadges':['BOULDER','CASCADE','THUNDER','RAINBOW','SOUL','MARSH','VOLCANO'],'blockedText':refs('_ViridianCityGymLockedText'),'pushDirection':'down'},{'map':'VIRIDIAN_CITY','x':19,'y':9,'requiresFlags':['EVENT_GOT_POKEDEX'],'blockedText':refs('_ViridianCityOldManSleepyPrivatePropertyText'),'pushDirection':'down'},{'map':'VERMILION_CITY','x':18,'y':30,'facing':'down','requiresItems':['S_S_TICKET'],'blockedByFlags':['EVENT_SS_ANNE_LEFT'],'intro':refs('_VermilionCitySailor1WelcomeToSSAnneText','_VermilionCitySailor1DoYouHaveATicketText'),'allowedText':refs('_VermilionCitySailor1FlashedTicketText'),'blockedText':refs('_VermilionCitySailor1YouNeedATicketText'),'departedText':refs('_VermilionCitySailor1ShipSetSailText'),'pushDirection':'up'}]
f['resetFlagsOnMapEntry']={'CINNABAR_ISLAND':['EVENT_MANSION_SWITCH_ON'],'VICTORY_ROAD_2F':['EVENT_VICTORY_ROAD_1_BOULDER_ON_SWITCH']}
# Explicit pointers for original opening / menu text to avoid generic fallback strings.
e['coverage']={'gyms':len(e['gyms']),'questManifests':len(q),'rivalEncounters':len(e['rivals']),'textPointers':len(e['textPointers']),'objectVariantSets':len(e['objectTextVariants']),'marts':len(e['marts']),'machines':len(e['machines']),'supplementalTexts':len(e['texts']),'spinnerStarts':sum(len(v) for v in f['spinPaths'].values())}
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(e,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(e['coverage']))
