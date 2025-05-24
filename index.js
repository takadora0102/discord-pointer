/**********************************************************************
 * index.js - Discord Point & Unit Warfare Bot (complete version)
 * Updated: 2025-05-24
 * Node.js ≥ 18, package.json →  "type": "module"
 *********************************************************************/

import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';

/* ========= 0. Env ========= */
const {
  DISCORD_TOKEN,
  DISCORD_CLIENT_ID,
  DISCORD_GUILD_ID,
  SUPABASE_URL,
  SUPABASE_KEY,
  PORT = 3000,
} = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing env vars');
  process.exit(1);
}

/* ========= 1. Clients ========= */
export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
  partials: [Partials.GuildMember, Partials.Channel],
});
export const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

/* ========= 2. Game constants ========= */
export const HIERARCHY = ['SLAVE','SERF','FREE MAN','LOW NOBLE','HIGH NOBLE','GRAND DUKE','KING','EMPEROR'];
export const ROLE_PREFIX = r => `【${r}】`;

/* 2.1 Roles for sale */
export const ROLES_FOR_SALE = [
  { name:'FREE MAN',   value:'role_FREE MAN',   price:10_000 },
  { name:'LOW NOBLE',  value:'role_LOW NOBLE',  price:50_000 },
  { name:'HIGH NOBLE', value:'role_HIGH NOBLE', price:250_000 },
];

/* 2.2 Items */
export const ITEMS = {
  shield          : { name:'Shield',          price:  300, effect:'shield',        rarity:'common' },
  scope           : { name:'Scope',           price:  100, effect:'scope',         rarity:'common' },
  tonic           : { name:'Tonic',           price:  800, effect:'tonic',         rarity:'uncommon' },
  rename_self     : { name:'Rename Self',     price:1_000, effect:'rename_self',   rarity:'uncommon' },
  rename_target_c : { name:'Rename Target C', price:2_000, effect:'rename_target', lock:10,  rarity:'uncommon' },
  rename_target_b : { name:'Rename Target B', price:3_500, effect:'rename_target', lock:20,  rarity:'rare' },
  rename_target_a : { name:'Rename Target A', price:5_000, effect:'rename_target', lock:30,  rarity:'epic' },
  rename_target_s : { name:'Rename Target S', price:10_000,effect:'rename_target', lock:60,  rarity:'epic' },
  elixir          : { name:'Elixir',          price:3_000, effect:'elixir',        rarity:'rare' },
  timeout         : { name:'Timeout',         price:10_000,effect:'timeout',       rarity:'epic' },
};

/* 2.3 Units [type, grade, category, cost, maint, atk, def, pph] */
export const CAT = [
  ['Scout',      'C','adv',  1_500, 150,   8,   6, 140],
  ['Pioneer',    'B','adv',  7_000, 600,  22,  15, 500],
  ['Explorer',   'S','adv', 20_000,1200,  40,  25,1000],
  ['Raider',     'C','atk',  3_000, 300,  35,  10, 100],
  ['Skirmisher', 'B','atk', 12_000, 900,  80,  22, 200],
  ['Berserker',  'S','atk', 40_000,2000, 150,  40, 250],
  ['Guard',      'C','def',  2_500, 250,  15,  40,  70],
  ['Sentinel',   'B','def', 10_000, 700,  30, 100, 120],
  ['Paladin',    'S','def', 35_000,1800,  60, 180, 150],
];

/* 2.4 Limitation per top-role */
export const LIM = {
  'SERF'      : { adv:1, atk:0, def:0, field:1 },
  'FREE MAN'  : { adv:2, atk:1, def:1, field:2 },
  'LOW NOBLE' : { adv:3, atk:2, def:2, field:3 },
  'HIGH NOBLE': { adv:4, atk:3, def:3, field:4 },
  'GRAND DUKE': { adv:6, atk:4, def:4, field:5 },
  'KING'      : { adv:8, atk:6, def:6, field:6 },
  'EMPEROR'   : { adv:10,atk:8, def:8, field:7 },
};
export const weight = i => Math.pow(0.8,i);

/* 2.5 Economy */
export const MESSAGE_REWARD = { SLAVE:5,SERF:10,'FREE MAN':20,'LOW NOBLE':50,'HIGH NOBLE':100,'GRAND DUKE':200,KING:400,EMPEROR:500 };
export const DROP_RATE = { C:{common:0.1,uncommon:0.03,rare:0.01,epic:0.002},
                           B:{common:0.06,uncommon:0.05,rare:0.02,epic:0.005},
                           S:{common:0.03,uncommon:0.06,rare:0.03,epic:0.01} };
export const DEBT_MULTIPLIER = 3, DEBT_INTEREST = 1.1, DEBT_TERM_DAYS = 7;

/* ========= 3. Helpers ========= */
export const topRoleName = m=>HIERARCHY.slice().reverse().find(r=>m.roles.cache.some(x=>x.name===r))||'SERF';
export const limitOf     = m=>LIM[topRoleName(m)];

export async function gP(id){
  const { data } = await sb.from('profiles').select('*').eq('user_id',id).maybeSingle();
  return data;
}
export async function upP(id,obj){ await sb.from('profiles').upsert({ user_id:id, ...obj },{ onConflict:'user_id' }); }
export async function owned(id){ const { data } = await sb.from('unit_owned').select('*').eq('user_id',id); return data??[]; }
export async function addInv(id,item,delta=1){
  const { data:rec } = await sb.from('item_inventory').select('quantity').eq('user_id',id).eq('item_name',item).single();
  if(rec)
    await sb.from('item_inventory').update({ quantity:rec.quantity+delta }).eq('user_id',id).eq('item_name',item);
  else
    await sb.from('item_inventory').insert({ user_id:id,item_name:item,quantity:delta });
}
export async function useInv(id,item){
  const { data:rec } = await sb.from('item_inventory').select('quantity').eq('user_id',id).eq('item_name',item).single();
  if(!rec||rec.quantity<1) return false;
  await sb.from('item_inventory').update({ quantity:rec.quantity-1 }).eq('user_id',id).eq('item_name',item);
  return true;
}
const randDrop = grade=>{
  const rate=DROP_RATE[grade]; const r=Math.random(); let sum=0;
  for(const [rarity,p] of Object.entries(rate)){ sum+=p; if(r<sum){
      const pool=Object.entries(ITEMS).filter(([_,v])=>v.rarity===rarity).map(([k])=>k);
      return pool[Math.floor(Math.random()*pool.length)]||null;
  }}
  return null;
};
/* ========= 4. SlashCommands ========= */
const commands = [
  new SlashCommandBuilder().setName('register').setDescription('ユーザー登録（1000p & SERF）'),
  new SlashCommandBuilder().setName('shop').setDescription('ショップ一覧を表示'),
  new SlashCommandBuilder()
    .setName('buy').setDescription('ロール / アイテムを購入')
    .addStringOption(o=>o.setName('key').setDescription('購入キー').setRequired(true)
      .addChoices(
        ...ROLES_FOR_SALE.map(r=>({ name:`Role: ${r.name}`, value:r.value })),
        ...Object.keys(ITEMS).map(k=>({ name:ITEMS[k].name, value:k }))
      )),
  new SlashCommandBuilder()
    .setName('use').setDescription('アイテムを使用')
    .addStringOption(o=>o.setName('item').setDescription('アイテムキー').setRequired(true)
      .addChoices(...Object.keys(ITEMS).map(k=>({ name:ITEMS[k].name, value:k }))))
    .addUserOption(o=>o.setName('target').setDescription('対象ユーザー（必要時）')),
  new SlashCommandBuilder()
    .setName('hire').setDescription('ユニット雇用')
    .addStringOption(o=>o.setName('unit').setDescription('ユニット名').setRequired(true)
      .addChoices(...CAT.map(([t])=>({ name:t, value:t })))),
  new SlashCommandBuilder()
    .setName('unit').setDescription('ユニット操作')
    .addSubcommand(c=>c.setName('list').setDescription('所持ユニット一覧'))
    .addSubcommand(c=>c.setName('adventure').setDescription('冒険へ派遣')
      .addStringOption (o=>o.setName('unit_id').setAutocomplete(true).setRequired(true))
      .addIntegerOption(o=>o.setName('hours').setDescription('1–8').setMinValue(1).setMaxValue(8).setRequired(true)))
    .addSubcommand(c=>c.setName('attack').setDescription('攻撃')
      .addStringOption(o=>o.setName('main').setAutocomplete(true).setRequired(true))
      .addStringOption(o=>o.setName('ally1').setAutocomplete(true))
      .addStringOption(o=>o.setName('ally2').setAutocomplete(true))
      .addUserOption  (o=>o.setName('target').setDescription('攻撃先').setRequired(true))),
  new SlashCommandBuilder()
    .setName('defense').setDescription('防御編成')
    .addSubcommand(c=>c.setName('set').setDescription('設定')
      .addStringOption(o=>o.setName('unit1').setAutocomplete(true).setRequired(true))
      .addStringOption(o=>o.setName('unit2').setAutocomplete(true))
      .addStringOption(o=>o.setName('unit3').setAutocomplete(true)))
    .addSubcommand(c=>c.setName('view').setDescription('表示')),
  new SlashCommandBuilder()
    .setName('debt').setDescription('借金管理')
    .addSubcommand(s=>s.setName('borrow').setDescription('借りる')
      .addIntegerOption(o=>o.setName('amount').setRequired(true)))
    .addSubcommand(s=>s.setName('repay').setDescription('返す')),
  new SlashCommandBuilder().setName('profile').setDescription('プロフィール表示'),
];

/* ========= 5. Register ========= */
await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID,DISCORD_GUILD_ID),{ body:commands });

/* ========= 6. Autocomplete ========= */
client.on('interactionCreate', async itc=>{
  if(!itc.isAutocomplete()) return;
  const foc = itc.options.getFocused(true);
  const opts = (await owned(itc.user.id)).map(u=>({
    name:`#${u.id} ${u.type}(${u.grade})`, value:String(u.id)
  })).filter(o=>o.name.toLowerCase().includes(foc.value.toLowerCase())).slice(0,25);
  itc.respond(opts);
});
/* ========= 7. ModalSubmit (rename) ========= */
client.on('interactionCreate', async modal=>{
  if(!modal.isModalSubmit()) return;
  const [kind,key,tgt] = modal.customId.split(':');
  const nick = modal.fields.getTextInputValue('nick').slice(0,24);
  const pref = m=>m.displayName.match(/^【.*?】/)?.[0]||'';

  try{
    if(kind==='rename_self'){
      await modal.member.setNickname(`${pref(modal.member)}${nick}`).catch(()=>{});
      return modal.reply({ content:'✅ ニックネーム変更', ephemeral:true });
    }
    if(kind==='rename_target'){
      const lock = ITEMS[key].lock;
      const mem  = await modal.guild.members.fetch(tgt).catch(()=>null);
      if(!mem) return modal.reply({ content:'❌ ターゲット不明', ephemeral:true });
      const myRank  = HIERARCHY.indexOf(topRoleName(modal.member));
      const tgtRank = HIERARCHY.indexOf(topRoleName(mem));
      const success = tgtRank<=myRank || Math.random()<0.5;
      if(success){
        await mem.setNickname(`${pref(mem)}${nick}`).catch(()=>{});
        await upP(tgt,{ name_lock_until:new Date(Date.now()+lock*60_000).toISOString() });
        return modal.reply({ content:`✅ 成功（${lock}m ロック）`, ephemeral:true });
      }
      return modal.reply({ content:'❌ 失敗（上位ロール）', ephemeral:true });
    }
  }catch(e){ console.error('Modal error',e); modal.reply({ content:'❌ エラー',ephemeral:true}); }
});

/* ========= 8. SlashCommand handler ========= */
client.on('interactionCreate', async itc=>{
  if(!itc.isChatInputCommand()) return;
  const cmd = itc.commandName;
  await itc.deferReply({ ephemeral:true });

  /* ----- /register ----- */
  if(cmd==='register'){
    if(await gP(itc.user.id)) return itc.editReply('✅ 既に登録済み');
    await upP(itc.user.id,{ points:1000, debt:0 });
    const serf=itc.guild.roles.cache.find(r=>r.name==='SERF');
    if(serf) await itc.member.roles.add(serf).catch(()=>{});
    const base=itc.member.displayName.replace(/^【.*?】/,'').slice(0,24);
    await itc.member.setNickname(`${ROLE_PREFIX('SERF')}${base}`).catch(()=>{});
    return itc.editReply('🎉 登録完了 (1000p)');
  }

  /* ----- /shop ----- */
  if(cmd==='shop'){
    const unit=CAT.map(([t,g,c,cost])=>`**${t}** (${g}/${c}) – ${cost}p`).join('\n');
    const role=ROLES_FOR_SALE.map(r=>`**Role: ${r.name}** – ${r.price}p`).join('\n');
    const item=Object.values(ITEMS).map(v=>`**${v.name}** – ${v.price}p`).join('\n');
    return itc.editReply({ embeds:[{ title:'🏪 SHOP', description:`__ユニット__\n${unit}\n\n__ロール__\n${role}\n\n__アイテム__\n${item}` }]});
  }

  /* ----- /buy ----- */
  if(cmd==='buy'){
    const key=itc.options.getString('key');
    /* ロール */
    if(key.startsWith('role_')){
      const info=ROLES_FOR_SALE.find(r=>r.value===key);
      const prof=await gP(itc.user.id);
      if(prof.points<info.price) return itc.editReply('❌ ポイント不足');
      const role=itc.guild.roles.cache.find(r=>r.name===info.name);
      if(role) await itc.member.roles.add(role).catch(()=>{});
      const base=itc.member.displayName.replace(/^【.*?】/,'');
      await itc.member.setNickname(`${ROLE_PREFIX(info.name)}${base}`).catch(()=>{});
      await upP(itc.user.id,{ points:prof.points-info.price });
      return itc.editReply(`✅ ${info.name} ロール購入`);
    }
    /* アイテム */
    const item=ITEMS[key]; if(!item) return itc.editReply('❌ 不正キー');
    const prof=await gP(itc.user.id);
    if(prof.points<item.price) return itc.editReply('❌ ポイント不足');
    await addInv(itc.user.id,key,1);
    await upP(itc.user.id,{ points:prof.points-item.price });
    return itc.editReply(`✅ ${item.name} 購入`);
  }

  /* ----- /use ----- */
  if(cmd==='use'){
    const key=itc.options.getString('item');
    const item=ITEMS[key]; if(!item) return itc.editReply('❌ 不正キー');
    const target=itc.options.getUser('target');
    if(!await useInv(itc.user.id,key)) return itc.editReply('❌ 在庫なし');

    if(item.effect==='shield'){
      await upP(itc.user.id,{ shield_until:new Date(Date.now()+864e5).toISOString() });
      return itc.editReply('🛡️ シールド 24h');
    }
    if(item.effect==='scope'){
      if(!target) return itc.editReply('❌ 対象必須');
      const tp=await gP(target.id);
      const on=tp?.shield_until && new Date(tp.shield_until)>new Date();
      return itc.editReply(on?'🟢 シールド中':'⚪ シールド無し');
    }
    if(item.effect==='timeout'){
      if(!target) return itc.editReply('❌ 対象必須');
      const tp=await gP(target.id);
      if(tp?.shield_until && new Date(tp.shield_until)>new Date())
        return itc.editReply('❌ 相手はシールド中');
      await (await itc.guild.members.fetch(target.id)).timeout(600_000,'Timeout item');
      return itc.editReply('⏱ 10分タイムアウト');
    }
    if(item.effect==='tonic'||item.effect==='elixir'){
      const list=await owned(itc.user.id);
      if(item.effect==='tonic'){
        const t=list.find(u=>u.fatigue_until && new Date(u.fatigue_until)>new Date());
        if(!t) return itc.editReply('😌 疲労ユニット無し');
        await sb.from('unit_owned').update({ fatigue_until:null }).eq('id',t.id);
        return itc.editReply(`✨ ${t.type} 疲労回復`);
      }
      await sb.from('unit_owned').update({ fatigue_until:null }).eq('user_id',itc.user.id);
      return itc.editReply('✨ 全ユニット疲労回復');
    }
    if(item.effect==='rename_self'){
      const modal=new ModalBuilder().setCustomId(`rename_self:${key}`).setTitle('新しいニックネーム')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('nick').setStyle(TextInputStyle.Short)
            .setLabel('24文字以内').setRequired(true).setMaxLength(24)
        ));
      return itc.showModal(modal);
    }
    if(item.effect==='rename_target'){
      if(!target) return itc.editReply('❌ 対象必須');
      const tp=await gP(target.id);
      if(tp?.shield_until && new Date(tp.shield_until)>new Date())
        return itc.editReply('❌ 相手はシールド中');
      if(tp?.name_lock_until && new Date(tp.name_lock_until)>new Date())
        return itc.editReply('❌ まだロック中');
      const modal=new ModalBuilder().setCustomId(`rename_target:${key}:${target.id}`).setTitle('新しいニックネーム')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('nick').setStyle(TextInputStyle.Short)
            .setLabel('24文字以内').setRequired(true).setMaxLength(24)
        ));
      return itc.showModal(modal);
    }
    return itc.editReply('❌ 未対応');
  }

  /* ----- /hire ----- */
  if(cmd==='hire'){
    const name=itc.options.getString('unit');
    const row=CAT.find(u=>u[0]===name); if(!row) return itc.editReply('❌ ユニット無し');
    const [type,grade,cat,cost,maint,atk,defv]=row;
    const lim=limitOf(itc.member);
    const cnt=(await owned(itc.user.id)).filter(u=>u.category===cat).length;
    if(cnt>=lim[cat]) return itc.editReply(`❌ ${cat} 上限`);
    const prof=await gP(itc.user.id);
    if(prof.points<cost) return itc.editReply('❌ ポイント不足');
    await sb.from('unit_owned').insert({ user_id:itc.user.id,type,grade,category:cat,atk,def:defv,maint_cost:maint });
    await upP(itc.user.id,{ points:prof.points-cost });
    return itc.editReply(`✅ ${type} 雇用`);
  }

  /* ----- /unit ----- */
  if(cmd==='unit'){
    const sub=itc.options.getSubcommand();
    /* list */
    if(sub==='list'){
      const list=await owned(itc.user.id);
      if(!list.length) return itc.editReply('ユニット無し');
      const now=Date.now();
      const rows=await Promise.all(list.map(async u=>{
        const { data:adv } = await sb.from('unit_tasks').select('*').eq('unit_id',u.id).eq('mode','adv').gt('ends_at',new Date().toISOString()).maybeSingle();
        const run=adv?'🏃‍♂️':'';
        const fat=u.fatigue_until&&new Date(u.fatigue_until)>now?`😴${Math.ceil((new Date(u.fatigue_until)-now)/60000)}m`:'';
        return `#${u.id} ${u.type}(${u.grade}) ${run}${fat}`;
      }));
      return itc.editReply('```\n'+rows.join('\n')+'\n```');
    }
    /* adventure */
    if(sub==='adventure'){
      const id=Number(itc.options.getString('unit_id'));
      const hours=itc.options.getInteger('hours');
      const unit=(await owned(itc.user.id)).find(u=>u.id===id);
      if(!unit) return itc.editReply('❌ 所持外ID');
      if(unit.fatigue_until && new Date(unit.fatigue_until)>new Date())
        return itc.editReply('❌ 疲労中');
      const lim=limitOf(itc.member);
      const { data:act } = await sb.from('unit_tasks').select('*').eq('user_id',itc.user.id).eq('mode','adv').gt('ends_at',new Date().toISOString());
      if(act.length>=lim.adv) return itc.editReply(`❌ 冒険上限(${lim.adv})`);
      const ends=new Date(Date.now()+hours*3600_000).toISOString();
      await sb.from('unit_tasks').insert({ user_id:itc.user.id,unit_id:id,mode:'adv',hours,ends_at:ends });
      return itc.editReply(`⏳ #${id} を ${hours}h 冒険`);
    }
    /* attack */
    if(sub==='attack'){
      const mainId=Number(itc.options.getString('main'));
      const allyIds=[itc.options.getString('ally1'),itc.options.getString('ally2')].filter(Boolean).map(Number);
      const ids=[mainId,...allyIds];
      const targetUser=itc.options.getUser('target');
      if(targetUser.id===itc.user.id) return itc.editReply('❌ 自分は攻撃不可');

      const myUnits=await owned(itc.user.id);
      const attackers=ids.map(id=>myUnits.find(u=>u.id===id)).filter(Boolean);
      if(!attackers.length) return itc.editReply('❌ 攻撃ユニット無し');
      if(new Set(attackers.map(u=>u.id)).size!==attackers.length) return itc.editReply('❌ ID重複');
      const lim=limitOf(itc.member);
      if(attackers.length>lim.field) return itc.editReply(`❌ 配置上限${lim.field}`);
      if(attackers.some(u=>u.fatigue_until && new Date(u.fatigue_until)>new Date()))
        return itc.editReply('❌ 疲労ユニット有');

      const targetProf=await gP(targetUser.id);
      if(!targetProf) return itc.editReply('❌ 相手未登録');
      if(targetProf.shield_until && new Date(targetProf.shield_until)>new Date())
        return itc.editReply('❌ シールド中');

      /* defenders */
      const { data:defRec } = await sb.from('defense_lineup').select('*').eq('user_id',targetUser.id).maybeSingle();
      const targetUnits=await owned(targetUser.id);
      let defenders=[];
      if(defRec?.unit_ids?.length)
        defenders=defRec.unit_ids.map(id=>targetUnits.find(u=>u.id.toString()===id.toString())).filter(Boolean);
      if(!defenders.length && targetUnits.length)
        defenders.push(targetUnits.reduce((a,b)=>a.def>b.def?a:b));

      const atkP=attackers.reduce((s,u,i)=>s+u.atk*weight(i),0)*(0.9+Math.random()*0.2);
      const defP=defenders.reduce((s,u)=>s+u.def,0)*(0.9+Math.random()*0.2);
      const win=atkP>defP;
      let loot=0;
      if(win){
        loot=Math.min(Math.floor((atkP-defP)/5),targetProf.points);
        if(loot>0){
          const me=await gP(itc.user.id);
          await upP(itc.user.id,{ points:me.points+loot });
          await upP(targetUser.id,{ points:targetProf.points-loot });
        }
      }
      /* fatigue */
      await sb.from('unit_owned').update({ fatigue_until:new Date(Date.now()+1800_000).toISOString() }).in('id',attackers.map(u=>u.id));
      /* drop */
      let dropTxt='';
      if(win){
        const dropKey=randDrop(attackers[0].grade);
        if(dropKey){ await addInv(itc.user.id,dropKey,1); dropTxt=`\n🎁 ドロップ: **${ITEMS[dropKey].name}**`; }
      }
      return itc.editReply(`${win?'🎖️ 勝利':'🛡️ 敗北'} (ATK ${atkP.toFixed(1)} / DEF ${defP.toFixed(1)})${win?`\n💰 ${loot}p 奪取`:''}${dropTxt}`);
    }
  }

  /* ----- /defense ----- */
  if(cmd==='defense'){
    const sub=itc.options.getSubcommand();
    if(sub==='set'){
      const picks=['unit1','unit2','unit3'].map(k=>itc.options.getString(k)).filter(Boolean).map(Number);
      const lim=limitOf(itc.member);
      if(picks.length>lim.field) return itc.editReply(`❌ 上限 ${lim.field}`);
      const mine=await owned(itc.user.id);
      if(!picks.every(id=>mine.some(u=>u.id===id))) return itc.editReply('❌ 未所持ID');
      await sb.from('defense_lineup').upsert({ user_id:itc.user.id,unit_ids:picks },{ onConflict:'user_id' });
      return itc.editReply(`🛡 防御設定: ${picks.map(id=>'#'+id).join(', ')}`);
    }
    if(sub==='view'){
      const { data } = await sb.from('defense_lineup').select('*').eq('user_id',itc.user.id).maybeSingle();
      return itc.editReply(`🛡 防御: ${data?.unit_ids?.map(id=>'#'+id).join(', ')||'未設定'}`);
    }
  }

  /* ----- /debt ----- */
  if(cmd==='debt'){
    const sub=itc.options.getSubcommand();
    const prof=await gP(itc.user.id);
    if(sub==='borrow'){
      if(prof.debt>0) return itc.editReply('❌ 既に借金有');
      const amt=itc.options.getInteger('amount');
      const max=prof.points*DEBT_MULTIPLIER;
      if(amt>max) return itc.editReply(`❌ 最大 ${max}p`);
      const repay=Math.floor(amt*DEBT_INTEREST);
      const by=new Date(Date.now()+DEBT_TERM_DAYS*864e5).toISOString();
      await sb.from('debt_logs').insert({ user_id:itc.user.id,amount:repay,repay_by:by,repaid:false });
      await upP(itc.user.id,{ points:prof.points+amt, debt:repay });
      return itc.editReply(`💰 ${amt}p 借入 (返済 ${repay}p)`);
    }
    if(sub==='repay'){
      if(prof.debt===0) return itc.editReply('✅ 借金無し');
      if(prof.points<prof.debt) return itc.editReply('❌ ポイント不足');
      await upP(itc.user.id,{ points:prof.points-prof.debt, debt:0 });
      await sb.from('debt_logs').update({ repaid:true }).eq('user_id',itc.user.id).eq('repaid',false);
      return itc.editReply('🎉 返済完了');
    }
  }

  /* ----- /profile ----- */
  if(cmd==='profile'){
    const prof=await gP(itc.user.id); if(!prof) return itc.editReply('❌ /register 先');
    const now=Date.now();
    const shield=prof.shield_until&&new Date(prof.shield_until)>now?`🛡️ ${Math.ceil((new Date(prof.shield_until)-now)/60000)}m`:'なし';
    const inv=(await sb.from('item_inventory').select('*').eq('user_id',itc.user.id)).data;
    const invTxt=inv.length?inv.map(r=>`${ITEMS[r.item_name].name}×${r.quantity}`).join('\n'):'なし';
    const units=await owned(itc.user.id);
    const unitLines=await Promise.all(units.map(async u=>{
      const { data:adv } = await sb.from('unit_tasks').select('*').eq('unit_id',u.id).eq('mode','adv').gt('ends_at',new Date().toISOString()).maybeSingle();
      const run=adv?'🏃‍♂️':'';
      const fat=u.fatigue_until&&new Date(u.fatigue_until)>now?`😴${Math.ceil((new Date(u.fatigue_until)-now)/60000)}m`:'';
      return `#${u.id} ${u.type}(${u.grade}) ${run}${fat}`;
    }));
    const { data:defRec } = await sb.from('defense_lineup').select('*').eq('user_id',itc.user.id).maybeSingle();
    const defTxt=defRec?.unit_ids?.map(id=>'#'+id).join(', ')||'未設定';
    return itc.editReply({ embeds:[{ title:`${itc.member.displayName} – PROFILE`, description:
      `**ポイント:** ${prof.points}p\n**借金:** ${prof.debt||0}p\n**シールド:** ${shield}\n\n`+
      `__アイテム__\n${invTxt}\n\n__ユニット__\n${unitLines.join('\n')||'なし'}\n\n__防御編成__\n${defTxt}` }]});
  }
});
/* ========= 9. Message reward ========= */
client.on('messageCreate', async msg=>{
  if(msg.author.bot||!msg.guild) return;
  const prof=await gP(msg.author.id); if(!prof) return;
  if(prof.last_message_at && Date.now()-new Date(prof.last_message_at) < 120_000) return;
  const reward=Math.max(...Object.entries(MESSAGE_REWARD)
    .filter(([r])=>msg.member.roles.cache.some(x=>x.name===r)).map(([,p])=>p),0);
  if(reward){
    await upP(msg.author.id,{ points:prof.points+reward, last_message_at:new Date().toISOString() });
  }
});

/* ========= 10. Cron 5min ========= */
cron.schedule('*/5 * * * *', async()=>{
  try{
    const nowIso=new Date().toISOString();

    /* 冒険完了 */
    const { data:tasks } = await sb.from('unit_tasks').select('*').eq('mode','adv').lte('ends_at',nowIso);
    for(const t of tasks){
      const { data:u } = await sb.from('unit_owned').select('*').eq('id',t.unit_id).single();
      if(!u) continue;
      const pph=CAT.find(c=>c[0]===u.type)[7];
      const gain=pph*t.hours;
      const p=await gP(t.user_id);
      await upP(t.user_id,{ points:p.points+gain });
      await sb.from('unit_tasks').delete().eq('id',t.id);
      await sb.from('unit_owned').update({ fatigue_until:new Date(Date.now()+900_000).toISOString() }).eq('id',u.id);
    }

    /* 疲労解除 */
    await sb.from('unit_owned').update({ fatigue_until:null }).lte('fatigue_until',nowIso);

    /* 借金自動返済 */
    const { data:dues } = await sb.from('debt_logs').select('*').eq('repaid',false).lte('repay_by',nowIso);
    const guild=client.guilds.cache.get(DISCORD_GUILD_ID);
    for(const d of dues){
      const p=await gP(d.user_id);
      if(p.points>=p.debt){
        await upP(d.user_id,{ points:p.points-p.debt, debt:0 });
        await sb.from('debt_logs').update({ repaid:true }).eq('id',d.id);
        continue;
      }
      let lack=d.debt-p.points;
      await upP(d.user_id,{ points:0 });
      const mem=guild?await guild.members.fetch(d.user_id).catch(()=>null):null;
      for(const roleName of HIERARCHY.slice().reverse()){
        if(lack<=0||!mem) break;
        if(['SLAVE','SERF'].includes(roleName)) continue;
        if(mem.roles.cache.some(x=>x.name===roleName)){
          const sale=(ROLES_FOR_SALE.find(r=>r.name===roleName)?.price||0)/2;
          await mem.roles.remove(mem.roles.cache.find(r=>r.name===roleName)).catch(()=>{});
          lack-=sale;
        }
      }
      if(lack>0 && mem){
        const slave=mem.roles.cache.find(r=>r.name==='SLAVE')||mem.guild.roles.cache.find(r=>r.name==='SLAVE');
        if(slave) await mem.roles.add(slave).catch(()=>{});
      }
      await upP(d.user_id,{ points:lack>0?0:-lack, debt:lack>0?lack:0 });
      await sb.from('debt_logs').update({ repaid:lack<=0 }).eq('id',d.id);
    }
  }catch(e){ console.error('Cron5',e); }
},{ timezone:'Asia/Tokyo' });

/* ========= 11. Cron daily 04:00 ========= */
cron.schedule('0 4 * * *', async()=>{
  try{
    const { data:users } = await sb.from('profiles').select('user_id,points');
    for(const u of users){
      const list=await owned(u.user_id);
      const maint=list.reduce((s,x)=>s+(x.maint_cost||0),0);
      if(maint) await upP(u.user_id,{ points:u.points-maint });
    }
  }catch(e){ console.error('Cron daily',e); }
},{ timezone:'Asia/Tokyo' });

/* ========= 12. Nickname prefix maintenance ========= */
client.on('guildMemberUpdate', async(o,n)=>{
  const bef=topRoleName(o), aft=topRoleName(n);
  if(bef!==aft){
    const base=n.displayName.replace(/^【.*?】/,'');
    await n.setNickname(`${ROLE_PREFIX(aft)}${base}`.slice(0,32)).catch(()=>{});
  }
});

/* ========= 13. Express keep-alive & Login ========= */
express().get('/',(_,res)=>res.send('alive')).listen(PORT,()=>console.log(`Web on :${PORT}`));
client.once('ready',()=>console.log(`Logged in as ${client.user.tag}`));
client.login(DISCORD_TOKEN).catch(console.error);
