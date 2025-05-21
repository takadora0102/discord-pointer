/**********************************************************************
 * Discord Point-Bot + Unit Warfare – FULL SOURCE  (2025-05-21)
 *  ‣ 旧アイテムショップ（scope / timeout / rename_*）完全復活
 *  ‣ 新アイテム（shield / tonic / elixir）
 *  ‣ /register /profile /shop /buy /use /hire /unit … すべて統合
 *  ‣ ユニット9種・枠システム・冒険・複数戦闘・疲労・損耗
 *  ‣ SERF への攻撃ブロック
 *********************************************************************/

import 'dotenv/config';
import express       from 'express';
import cron          from 'node-cron';
import {
  Client, GatewayIntentBits, Partials,
  REST, Routes, SlashCommandBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';

/* ───────── Supabase & Discord ───────── */
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const client = new Client({
  intents:[
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials:[Partials.GuildMember]
});

const ROLE_PREFIX = r => `【${r}】`;

/* ───────── アイテム ───────── */
const ITEMS = {
  shield:{name:'Shield',price:300,effect:'shield'},
  scope :{name:'Scope',price:100,effect:'scope'},
  timeout:{name:'Timeout',price:10000,effect:'timeout'},
  rename_self:{name:'Rename Self',price:1000,effect:'rename_self'},
  rename_target_s:{name:'Rename Target S',price:10000,effect:'rename_target',lock:24*60},
  rename_target_a:{name:'Rename Target A',price:5000,effect:'rename_target',lock:10*60},
  rename_target_b:{name:'Rename Target B',price:3500,effect:'rename_target',lock:60},
  rename_target_c:{name:'Rename Target C',price:2000,effect:'rename_target',lock:10},
  tonic:{name:'Tonic',price:800,effect:'tonic'},
  elixir:{name:'Elixir',price:3000,effect:'elixir'}
};

/* ───────── ユニットカタログ ───────── */
const CAT = [ // type,grade,cat,hire,maint,atk,def,pph
  ['Scout',      'C','adv', 1500, 150,   8,   6,  70],
  ['Pioneer',    'B','adv', 7000, 600,  22,  15, 250],
  ['Explorer',   'S','adv',20000,1200,  40,  25, 500],
  ['Raider',     'C','atk', 3000, 300,  35,  10,  50],
  ['Skirmisher', 'B','atk',12000, 900,  80,  22, 100],
  ['Berserker',  'S','atk',40000,2000, 150,  40, 125],
  ['Guard',      'C','def', 2500, 250,  15,  40,  35],
  ['Sentinel',   'B','def',10000, 700,  30, 100,  60],
  ['Paladin',    'S','def',35000,1800,  60, 180,  75]
];

/* ───────── ロール別 保有上限＆出撃枠 ───────── */
const LIM = {
  'SERF':       {adv:1, atk:0, def:0, field:1},
  'FREE MAN':   {adv:2, atk:1, def:1, field:2},
  'LOW NOBLE':  {adv:3, atk:2, def:2, field:3},
  'HIGH NOBLE': {adv:4, atk:3, def:3, field:4},
  'GRAND DUKE': {adv:6, atk:4, def:4, field:5},
  'KING':       {adv:8, atk:6, def:6, field:6},
  'EMPEROR':    {adv:10,atk:8, def:8, field:7}
};
const limitOf = m => LIM[
  Object.keys(LIM).reverse()
    .find(r => m.roles.cache.some(x=>x.name===r)) || 'SERF'
];
const weight = i => Math.pow(0.8,i);           // 1,0.8,0.64…

/* ───────── DB helpers ───────── */
const gP  = async id => (await sb.from('profiles').select('*').eq('user_id',id).single()).data;
const upP = (id,f)=> sb.from('profiles').upsert({user_id:id,...f},{onConflict:'user_id'});
const owned = async id => (await sb.from('unit_owned').select('*').eq('user_id',id)).data || [];
async function addInv(id,k,delta=1){ await sb.rpc('add_inventory',{uid:id,item_name:k,delta}); }
async function useInv(id,k){
  const d=(await sb.from('item_inventory').select('quantity').eq('user_id',id).eq('item_name',k).single()).data;
  if(!d||d.quantity<1) return false;
  await sb.from('item_inventory').update({quantity:d.quantity-1})
        .eq('user_id',id).eq('item_name',k);
  return true;
}

/* ───────── Slash-commands ───────── */
const cmds = [
  new SlashCommandBuilder().setName('register').setDescription('ユーザー登録'),
  new SlashCommandBuilder().setName('shop').setDescription('ショップ一覧'),
  new SlashCommandBuilder().setName('buy').setDescription('アイテム購入')
    .addStringOption(o=>o.setName('item').setDescription('キー').setRequired(true)
      .addChoices(...Object.keys(ITEMS).map(k=>({name:k,value:k})))),
  new SlashCommandBuilder().setName('use').setDescription('アイテム使用')
    .addStringOption(o=>o.setName('item').setDescription('キー').setRequired(true)
      .addChoices(...Object.keys(ITEMS).map(k=>({name:k,value:k})) ))
    .addUserOption(o=>o.setName('target').setDescription('ターゲット')),
  new SlashCommandBuilder().setName('hire').setDescription('ユニット雇用')
    .addStringOption(o=>o.setName('unit').setDescription('ユニット名').setRequired(true)),
  new SlashCommandBuilder().setName('unit').setDescription('ユニット操作')
    .addSubcommand(c=>c.setName('list').setDescription('一覧'))
    .addSubcommand(c=>c.setName('adventure').setDescription('冒険')
      .addStringOption(o=>o.setName('unit').setDescription('ユニット').setRequired(true))
      .addIntegerOption(o=>o.setName('hours').setDescription('1-8').setMinValue(1).setMaxValue(8).setRequired(true)))
    .addSubcommand(c=>c.setName('attack').setDescription('攻撃')
      .addStringOption(o=>o.setName('main').setDescription('主力').setRequired(true))
      .addUserOption(o=>o.setName('target').setDescription('相手').setRequired(true))
      .addStringOption(o=>o.setName('ally1').setDescription('サブ1'))
      .addStringOption(o=>o.setName('ally2').setDescription('サブ2'))),
  new SlashCommandBuilder().setName('profile').setDescription('自分のプロフィール')
];

await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN)
  .put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:cmds});
/* ───────── Interaction handler ───────── */
client.on('interactionCreate', async i => {
  if(!i.isChatInputCommand()) return;

  /* ---------- /register ---------- */
  if(i.commandName==='register'){
    if(await gP(i.user.id))
      return i.reply({content:'✅ すでに登録済みです',ephemeral:true});

    await upP(i.user.id,{points:1000,debt:0});
    const serf=i.guild.roles.cache.find(r=>r.name==='SERF');
    if(serf) await i.member.roles.add(serf).catch(()=>{});
    const base=i.member.displayName.replace(/^【.*?】/,'').slice(0,24);
    await i.member.setNickname(`${ROLE_PREFIX('SERF')}${base}`).catch(()=>{});
    return i.reply({content:'🎉 登録完了！1000p 付与',ephemeral:true});
  }

  /* ---------- /shop ---------- */
  if(i.commandName==='shop'){
    const uLines = CAT.map(([t,g,c,h])=>`**${t}** (${g}/${c}) – ${h}p`).join('\n');
    const iLines = Object.entries(ITEMS).map(([k,v])=>`**${k}** – ${v.price}p`).join('\n');
    return i.reply({embeds:[{title:'🏪 SHOP',description:`__ユニット雇用__\n${uLines}\n\n__アイテム__\n${iLines}`}],ephemeral:true});
  }

  /* ---------- /buy ---------- */
  if(i.commandName==='buy'){
    const key=i.options.getString('item'); const item=ITEMS[key];
    if(!item) return i.reply({content:'❌ そんなアイテムはありません',ephemeral:true});
    const prof=await gP(i.user.id); if(prof.points<item.price)
      return i.reply({content:'ポイント不足',ephemeral:true});
    await addInv(i.user.id,key,1);
    await upP(i.user.id,{points:prof.points-item.price});
    return i.reply({content:`✅ ${item.name} を購入しました`,ephemeral:true});
  }

  /* ---------- /use ---------- */
  if(i.commandName==='use'){
    const key=i.options.getString('item'); const item=ITEMS[key];
    if(!item) return i.reply({content:'無し',ephemeral:true});
    const target=i.options.getUser('target');
    if(!await useInv(i.user.id,key))
      return i.reply({content:'在庫がありません',ephemeral:true});

    /* --- shield --- */
    if(item.effect==='shield'){
      await upP(i.user.id,{shield_until:new Date(Date.now()+24*60*60*1000).toISOString()});
      return i.reply({content:'🛡️ 24h シールド展開',ephemeral:true});
    }

    /* --- scope --- */
    if(item.effect==='scope'){
      if(!target) return i.reply({content:'ターゲット必須',ephemeral:true});
      const tp=await gP(target.id);
      const on=tp?.shield_until && new Date(tp.shield_until)>new Date();
      return i.reply({content:on?'🟢 シールド中':'⚪ シールドなし',ephemeral:true});
    }

    /* --- timeout --- */
    if(item.effect==='timeout'){
      if(!target) return i.reply({content:'ターゲット必須',ephemeral:true});
      const mem=await i.guild.members.fetch(target.id);
      await mem.timeout(10*60*1000,'Timeout Item');
      return i.reply({content:'⏱ 相手を 10m タイムアウトさせました',ephemeral:true});
    }

    /* --- tonic / elixir --- */
    if(item.effect==='tonic'){
      const list=await owned(i.user.id);
      const fatigued=list.find(u=>u.fatigue_until&&new Date(u.fatigue_until)>new Date());
      if(!fatigued) return i.reply({content:'疲労ユニット無し',ephemeral:true});
      await sb.from('unit_owned').update({fatigue_until:null}).eq('id',fatigued.id);
      return i.reply({content:`${fatigued.type} の疲労を回復`,ephemeral:true});
    }
    if(item.effect==='elixir'){
      await sb.from('unit_owned').update({fatigue_until:null}).eq('user_id',i.user.id);
      return i.reply({content:'全ユニットの疲労を回復しました',ephemeral:true});
    }

    /* --- rename_self --- */
    if(item.effect==='rename_self'){
      const modal=new ModalBuilder()
        .setCustomId(`rename_self:${key}`)
        .setTitle('新しいニックネーム')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('nick')
              .setLabel('Nickname (24文字以内)')
              .setMaxLength(24)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      return i.showModal(modal);
    }

    /* --- rename_target --- */
    if(item.effect==='rename_target'){
      if(!target) return i.reply({content:'ターゲット必須',ephemeral:true});
      const modal=new ModalBuilder()
        .setCustomId(`rename_target:${key}:${target.id}`)
        .setTitle('新しいニックネーム')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('nick')
              .setLabel('Nickname (24文字以内)')
              .setMaxLength(24)
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
          )
        );
      return i.showModal(modal);
    }

    return i.reply({content:'未対応アイテム',ephemeral:true});
  }

  /* ---------- /hire ---------- */
  if(i.commandName==='hire'){
    const name=i.options.getString('unit');
    const row=CAT.find(u=>u[0].toLowerCase()===name.toLowerCase());
    if(!row) return i.reply({content:'ユニット無し',ephemeral:true});
    const [type,grade,cat,hCost,mCost,atk,defv]=row;
    const lim=limitOf(i.member);
    const list=await owned(i.user.id);
    if(list.filter(u=>u.category===cat).length>=lim[cat])
      return i.reply({content:`${cat} 枠上限です`,ephemeral:true});
    const prof=await gP(i.user.id);
    if(prof.points<hCost) return i.reply({content:'ポイント不足',ephemeral:true});
    await sb.from('unit_owned').insert({
      user_id:i.user.id,type,grade,category:cat,atk,def:defv,maint_cost:mCost
    });
    await upP(i.user.id,{points:prof.points-hCost});
    return i.reply({content:`✅ ${type} 雇用完了`,ephemeral:true});
  }

  /* ---------- /unit list ---------- */
  if(i.commandName==='unit' && i.options.getSubcommand()==='list'){
    const list=await owned(i.user.id);
    const now=Date.now();
    const txt=list.map(u=>{
      const rest=u.fatigue_until&&new Date(u.fatigue_until)>now?
        `😴${Math.ceil((new Date(u.fatigue_until)-now)/60000)}m`:'';
      return `${u.type} (${u.grade}/${u.category}) ${rest}`;
    }).join('\n')||'無し';
    return i.reply({content:'```\n'+txt+'\n```',ephemeral:true});
  }
  /* ---------- /unit adventure ---------- */
  if(i.commandName==='unit' && i.options.getSubcommand()==='adventure'){
    const uName=i.options.getString('unit');
    const hours=i.options.getInteger('hours');
    const unit=(await sb.from('unit_owned').select('*').eq('user_id',i.user.id).eq('type',uName).single()).data;
    if(!unit) return i.reply({content:'ユニット無し',ephemeral:true});
    if(unit.fatigue_until && new Date(unit.fatigue_until)>new Date())
      return i.reply({content:'疲労中',ephemeral:true});
    const prof=await gP(i.user.id);
    if(prof.shield_until && new Date(prof.shield_until)>new Date())
      await upP(i.user.id,{shield_until:null});          // シールド解除
    const ends_at=new Date(Date.now()+hours*60*60*1000).toISOString();
    await sb.from('unit_tasks').insert({
      user_id:i.user.id,unit_id:unit.id,mode:'adv',hours,ends_at
    });
    return i.reply({content:`⏳ ${uName} を ${hours}h 冒険へ送りました`,ephemeral:true});
  }

  /* ---------- /unit attack ---------- */
  if(i.commandName==='unit' && i.options.getSubcommand()==='attack'){
    await i.deferReply({ephemeral:true});
    const main=i.options.getString('main');
    const target=i.options.getUser('target');
    const tMem=await i.guild.members.fetch(target.id);
    if(tMem.roles.cache.some(r=>r.name==='SERF'))
      return i.editReply('❌ SERF への攻撃は禁止されています');

    const ally=[i.options.getString('ally1'),i.options.getString('ally2')].filter(Boolean);
    const names=[main,...ally];
    const myField=limitOf(i.member).field;
    if(names.length>myField) return i.editReply(`出撃枠 ${myField} 超過`);
    const avail=(await owned(i.user.id)).filter(u=>!u.fatigue_until||new Date(u.fatigue_until)<new Date());
    const lineup=names.map(n=>avail.find(u=>u.type.toLowerCase()===n.toLowerCase())).filter(Boolean);
    if(lineup.length!==names.length) return i.editReply('ユニットが存在しないか疲労中です');

    const defUnits=(await owned(target.id))
      .filter(u=>!u.fatigue_until||new Date(u.fatigue_until)<new Date())
      .sort((a,b)=>b.def-a.def)
      .slice(0,limitOf(tMem).field);
    if(!defUnits.length) return i.editReply('相手に防御ユニットがいません');

    const sum=(arr,key)=>arr.reduce((s,u,idx)=>s+u[key]*weight(idx),0);
    const atk=sum(lineup,'atk'),def=sum(defUnits,'def'),roll=Math.floor(Math.random()*11)-5;
    const score=atk-def+roll, win=score>0;
    const rate=Math.min(Math.max(score/120,0.5),1.5);
    const victim=await gP(target.id); let steal=0;
    if(win) steal=Math.floor(victim.points*0.2*rate);
    await upP(target.id,{points:victim.points-steal});
    const me=await gP(i.user.id); await upP(i.user.id,{points:me.points+steal});
    return i.editReply(`SCORE ${score} → ${win?'勝利':'敗北'} / 奪取 ${steal}p`);
  }

  /* ---------- /profile ---------- */
  if(i.commandName==='profile'){
    const prof=await gP(i.user.id); if(!prof) return i.reply({content:'まず `/register`',ephemeral:true});
    const list=await owned(i.user.id); const now=Date.now();
    const units=list.map(u=>{
      const rest=u.fatigue_until&&new Date(u.fatigue_until)>now?
        `😴${Math.ceil((new Date(u.fatigue_until)-now)/60000)}m`:'';
      return `${u.type} (${u.grade}/${u.category}) 💀15% ${rest}`;
    }).join('\n')||'無し';
    return i.reply({embeds:[{
      title:`${i.member.displayName} – プロフィール`,
      description:`**ポイント:** ${prof.points}p\n\n__ユニット__\n${units}`
    }],ephemeral:true});
  }
});

/* ---------- Modal submit (rename) ---------- */
client.on('interactionCreate',async i=>{
  if(!i.isModalSubmit()) return;
  const [kind,key,tgt] = i.customId.split(':');
  const nickBody = i.fields.getTextInputValue('nick').slice(0,24);
  const withPrefix = m=>{
    const p=m.displayName.match(/^【.*?】/)?.[0]||'';
    return `${p}${nickBody}`;
  };
  if(kind==='rename_self'){
    await i.member.setNickname(withPrefix(i.member)).catch(()=>{});
    return i.reply({content:'✅ ニックネーム変更',ephemeral:true});
  }
  if(kind==='rename_target'){
    const lock=ITEMS[key].lock;
    const mem=await i.guild.members.fetch(tgt).catch(()=>null);
    if(mem) await mem.setNickname(withPrefix(mem)).catch(()=>{});
    await upP(tgt,{name_lock_until:new Date(Date.now()+lock*60*1000).toISOString()});
    return i.reply({content:`✅ 変更完了（${lock}m ロック）`,ephemeral:true});
  }
});

/* ---------- cron (5 min): 冒険解決 & 疲労解除 ---------- */
cron.schedule('*/5 * * * *',async()=>{
  await sb.from('unit_owned').update({fatigue_until:null}).lte('fatigue_until',new Date().toISOString());
  const now=new Date().toISOString();
  const {data}=await sb.from('unit_tasks').select('*').eq('mode','adv').lte('ends_at',now);
  for(const t of data){
    const u=(await sb.from('unit_owned').select('*').eq('id',t.unit_id).single()).data;
    if(!u) continue;
    const gain=CAT.find(c=>c[0]===u.type)[7]*t.hours;
    const prof=await gP(t.user_id);
    await upP(t.user_id,{points:prof.points+gain});
    await sb.from('unit_tasks').delete().eq('id',t.id);
    await sb.from('unit_owned')
      .update({fatigue_until:new Date(Date.now()+15*60*1000).toISOString()})
      .eq('id',u.id);
  }
});

/* ---------- Express keep-alive & start ---------- */
express().get('/',(_,res)=>res.send('alive')).listen(process.env.PORT||3000);
client.login(process.env.DISCORD_TOKEN);
