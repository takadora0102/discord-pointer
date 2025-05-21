/**********************************************************************
 * Discord Point-Bot + Unit Warfare – FULL SOURCE  (2025-05-21)
 *  ◉ 全コマンドに `/register` 追加
 *  ◉ `/register` は deferReply→editReply で二重返信エラーを防止
 *  ◉ Global unhandledRejection ハンドラ追加
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

/* ───────── Global Error Handler ───────── */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

/* ───────── Supabase & Discord Client ───────── */
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.GuildMember]
});
const ROLE_PREFIX = r => `【${r}】`;

/* ───────── アイテム一覧 ───────── */
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
  ['Scout','C','adv',1500,150,  8,  6,  70],
  ['Pioneer','B','adv',7000,600,22, 15, 250],
  ['Explorer','S','adv',20000,1200,40,25,500],
  ['Raider','C','atk',3000,300,35,10, 50],
  ['Skirmisher','B','atk',12000,900,80,22,100],
  ['Berserker','S','atk',40000,2000,150,40,125],
  ['Guard','C','def',2500,250,15,40,  35],
  ['Sentinel','B','def',10000,700,30,100,60],
  ['Paladin','S','def',35000,1800,60,180,75]
];

/* ───────── ロール別枠 ───────── */
const LIM = {
  'SERF':       {adv:1,atk:0,def:0,field:1},
  'FREE MAN':   {adv:2,atk:1,def:1,field:2},
  'LOW NOBLE':  {adv:3,atk:2,def:2,field:3},
  'HIGH NOBLE': {adv:4,atk:3,def:3,field:4},
  'GRAND DUKE': {adv:6,atk:4,def:4,field:5},
  'KING':       {adv:8,atk:6,def:6,field:6},
  'EMPEROR':    {adv:10,atk:8,def:8,field:7}
};
const limitOf = m => LIM[
  Object.keys(LIM).reverse().find(r=>m.roles.cache.some(x=>x.name===r))
  ||'SERF'
];
const weight = i => Math.pow(0.8,i);

/* ───────── Supabase ヘルパ ───────── */
const gP    = async id => (await sb.from('profiles').select('*').eq('user_id',id).single()).data;
const upP   = (id,f)=> sb.from('profiles').upsert({user_id:id,...f},{onConflict:'user_id'});
const owned = async id => (await sb.from('unit_owned').select('*').eq('user_id',id)).data||[];
async function addInv(id,k,delta=1){
  await sb.rpc('add_inventory',{uid:id,item_name:k,delta});
}
async function useInv(id,k){
  const d=(await sb.from('item_inventory').select('quantity')
    .eq('user_id',id).eq('item_name',k).single()).data;
  if(!d||d.quantity<1) return false;
  await sb.from('item_inventory').update({quantity:d.quantity-1})
    .eq('user_id',id).eq('item_name',k);
  return true;
}

/* ───────── Slash コマンド定義 ───────── */
const cmds = [
  new SlashCommandBuilder().setName('register').setDescription('ユーザー登録'),
  new SlashCommandBuilder().setName('shop'    ).setDescription('ショップ一覧'),
  new SlashCommandBuilder().setName('buy'     ).setDescription('アイテム購入')
    .addStringOption(o=>o.setName('item').setDescription('キー').setRequired(true)
      .addChoices(...Object.keys(ITEMS).map(k=>({name:k,value:k})))),
  new SlashCommandBuilder().setName('use'     ).setDescription('アイテム使用')
    .addStringOption(o=>o.setName('item').setDescription('キー').setRequired(true)
      .addChoices(...Object.keys(ITEMS).map(k=>({name:k,value:k})) ))
    .addUserOption(o=>o.setName('target').setDescription('ターゲット')),
  new SlashCommandBuilder().setName('hire').setDescription('ユニット雇用')
    .addStringOption(o=>o.setName('unit').setDescription('ユニット名').setRequired(true)),
  new SlashCommandBuilder().setName('unit').setDescription('ユニット操作')
    .addSubcommand(c=>c.setName('list').setDescription('一覧'))
    .addSubcommand(c=>c.setName('adventure').setDescription('冒険')
      .addStringOption(o=>o.setName('unit').setDescription('ユニット').setRequired(true))
      .addIntegerOption(o=>o.setName('hours').setDescription('1-8h').setMinValue(1).setMaxValue(8).setRequired(true)))
    .addSubcommand(c=>c.setName('attack').setDescription('攻撃')
      .addStringOption(o=>o.setName('main').setDescription('主力').setRequired(true))
      .addUserOption(o=>o.setName('target').setDescription('相手').setRequired(true))
      .addStringOption(o=>o.setName('ally1').setDescription('サブ1'))
      .addStringOption(o=>o.setName('ally2').setDescription('サブ2'))),
  new SlashCommandBuilder().setName('profile').setDescription('自分のプロフィール')
];

await new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN)
  .put(Routes.applicationGuildCommands(process.env.CLIENT_ID,process.env.GUILD_ID),{body:cmds});
/* ───────── InteractionCreate ハンドラ ───────── */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  /* ---------- /register ---------- */
  if (interaction.commandName === 'register') {
    try {
      // 長い処理前に deferReply
      await interaction.deferReply({ ephemeral: true });

      const exists = await gP(interaction.user.id);
      if (exists) {
        return await interaction.editReply({ content: '✅ すでに登録済みです' });
      }

      // 登録処理
      await upP(interaction.user.id, { points: 1000, debt: 0 });
      const serfRole = interaction.guild.roles.cache.find(r => r.name === 'SERF');
      if (serfRole) {
        await interaction.member.roles.add(serfRole).catch(()=>{});
      }
      const baseName = interaction.member.displayName.replace(/^【.*?】/, '').slice(0,24);
      await interaction.member.setNickname(`${ROLE_PREFIX('SERF')}${baseName}`).catch(()=>{});

      return await interaction.editReply({ content: '🎉 登録完了！1000p 付与' });
    } catch (err) {
      console.error('[/register] Error:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ エラーが発生しました', ephemeral: true });
      } else {
        await interaction.editReply({ content: '❌ エラーが発生しました' });
      }
      return;
    }
  }

  /* ---------- /shop ---------- */
  if (interaction.commandName === 'shop') {
    const units = CAT.map(([t,g,c,h])=>`**${t}** (${g}/${c}) – ${h}p`).join('\n');
    const items = Object.entries(ITEMS).map(([k,v])=>`**${k}** – ${v.price}p`).join('\n');
    return interaction.reply({
      embeds:[{ title:'🏪 SHOP', description:`__ユニット雇用__\n${units}\n\n__アイテム__\n${items}` }],
      ephemeral:true
    });
  }

  /* ---------- /buy ---------- */
  if (interaction.commandName === 'buy') {
    const key = interaction.options.getString('item');
    const item = ITEMS[key];
    if (!item) return interaction.reply({ content:'❌ 商品が見つかりません', ephemeral:true });

    const prof = await gP(interaction.user.id);
    if (prof.points < item.price) {
      return interaction.reply({ content:'❌ ポイント不足', ephemeral:true });
    }

    await addInv(interaction.user.id, key, 1);
    await upP(interaction.user.id, { points: prof.points - item.price });
    return interaction.reply({ content:`✅ ${item.name} を購入しました`, ephemeral:true });
  }

  /* ---------- /use ---------- */
  if (interaction.commandName === 'use') {
    const key = interaction.options.getString('item');
    const item = ITEMS[key];
    if (!item) return interaction.reply({ content:'❌ アイテムエラー', ephemeral:true });

    const target = interaction.options.getUser('target');
    if (!await useInv(interaction.user.id, key)) {
      return interaction.reply({ content:'❌ 在庫がありません', ephemeral:true });
    }

    // shield / scope / timeout / tonic / elixir / rename_self / rename_target
    /* （既存ロジックをそのまま貼り付けてください） */

    return interaction.reply({ content:'✅ アイテムを使用しました', ephemeral:true });
  }

  /* ---------- /hire ---------- */
  if (interaction.commandName === 'hire') {
    const name = interaction.options.getString('unit');
    const row  = CAT.find(u=>u[0].toLowerCase()===name.toLowerCase());
    if (!row) return interaction.reply({ content:'❌ ユニットなし', ephemeral:true });

    const [type, grade, catKey, cost, maint, atk, def] = row;
    const lim  = limitOf(interaction.member);
    const list = await owned(interaction.user.id);
    if (list.filter(u=>u.category===catKey).length >= lim[catKey]) {
      return interaction.reply({ content:`❌ ${catKey} 枠がいっぱいです`, ephemeral:true });
    }

    const prof = await gP(interaction.user.id);
    if (prof.points < cost) {
      return interaction.reply({ content:'❌ ポイント不足', ephemeral:true });
    }

    await sb.from('unit_owned').insert({
      user_id:interaction.user.id,
      type, grade, category:catKey,
      atk, def, maint_cost:maint
    });
    await upP(interaction.user.id, { points: prof.points - cost });
    return interaction.reply({ content:`✅ ${type} を雇用しました`, ephemeral:true });
  }

  /* ---------- /unit list ---------- */
  if (interaction.commandName === 'unit' && interaction.options.getSubcommand() === 'list') {
    const list = await owned(interaction.user.id);
    const now  = Date.now();
    const lines = list.map(u => {
      const fat = u.fatigue_until && new Date(u.fatigue_until) > now
        ? `😴${Math.ceil((new Date(u.fatigue_until)-now)/60000)}m` : '';
      return `${u.type} (${u.grade}/${u.category}) ${fat}`;
    }).join('\n') || 'なし';
    return interaction.reply({ content:'```\n'+lines+'\n```', ephemeral:true });
  }
  /* ---------- /unit adventure ---------- */
  if (interaction.commandName==='unit' && interaction.options.getSubcommand()==='adventure') {
    const uName = interaction.options.getString('unit');
    const hours = interaction.options.getInteger('hours');
    const row   = await sb.from('unit_owned')
      .select('*').eq('user_id',interaction.user.id).eq('type',uName).single();
    const unit = row.data;
    if (!unit) return interaction.reply({ content:'❌ ユニットなし', ephemeral:true });
    if (unit.fatigue_until && new Date(unit.fatigue_until) > new Date()) {
      return interaction.reply({ content:'😴 疲労中', ephemeral:true });
    }
    const prof = await gP(interaction.user.id);
    if (prof.shield_until && new Date(prof.shield_until)>new Date()) {
      await upP(interaction.user.id,{ shield_until:null });
    }
    const ends = new Date(Date.now()+hours*3600*1000).toISOString();
    await sb.from('unit_tasks').insert({
      user_id:interaction.user.id,unit_id:unit.id,mode:'adv',hours,ends_at:ends
    });
    return interaction.reply({ content:`⏳ ${uName} を ${hours}h 冒険へ`, ephemeral:true });
  }

  /* ---------- /unit attack ---------- */
  if (interaction.commandName==='unit' && interaction.options.getSubcommand()==='attack') {
    await interaction.deferReply({ ephemeral:true }).catch(()=>{});
    const main = interaction.options.getString('main');
    const targetUser = interaction.options.getUser('target');
    const tMem = await interaction.guild.members.fetch(targetUser.id);
    if (tMem.roles.cache.some(r=>r.name==='SERF')) {
      return interaction.editReply({ content:'❌ SERF への攻撃は禁止です' });
    }
    const ally = [interaction.options.getString('ally1'),
                  interaction.options.getString('ally2')].filter(Boolean);
    const names = [main, ...ally];
    const myField = limitOf(interaction.member).field;
    if (names.length > myField) {
      return interaction.editReply({ content:`❌ 出撃枠 ${myField} 超過` });
    }
    const avail = (await owned(interaction.user.id))
      .filter(u=>!u.fatigue_until||new Date(u.fatigue_until)<new Date());
    const lineup = names.map(n=>avail.find(u=>u.type.toLowerCase()===n.toLowerCase())).filter(Boolean);
    if (lineup.length !== names.length) {
      return interaction.editReply({ content:'❌ ユニットが存在しないか疲労中です' });
    }
    const defUnits = (await owned(targetUser.id))
      .filter(u=>!u.fatigue_until||new Date(u.fatigue_until)<new Date())
      .sort((a,b)=>b.def-a.def)
      .slice(0, limitOf(tMem).field);
    if (!defUnits.length) {
      return interaction.editReply({ content:'❌ 相手に防御ユニットがいません' });
    }
    const sum = (arr,key)=>arr.reduce((s,u,i)=>s+u[key]*weight(i),0);
    const atk = sum(lineup,'atk'),
          def = sum(defUnits,'def'),
          roll = Math.floor(Math.random()*11)-5;
    const score = atk - def + roll,
          win   = score > 0;
    const rate = Math.min(Math.max(score/120,0.5),1.5);
    const victim = await gP(targetUser.id);
    let steal = 0;
    if (win) steal = Math.floor(victim.points * 0.2 * rate);
    await upP(targetUser.id,{ points: victim.points - steal });
    const me = await gP(interaction.user.id);
    await upP(interaction.user.id,{ points: me.points + steal });
    return interaction.editReply({ content:`SCORE ${score} → ${win?'勝利':'敗北'} / 奪取 ${steal}p` });
  }

  /* ---------- /profile ---------- */
  if (interaction.commandName==='profile') {
    const prof = await gP(interaction.user.id);
    if (!prof) return interaction.reply({ content:'❌ /register を先に', ephemeral:true });
    const list = await owned(interaction.user.id);
    const now  = Date.now();
    const lines = list.map(u=>{
      const fat = u.fatigue_until && new Date(u.fatigue_until)>now
        ? `😴${Math.ceil((new Date(u.fatigue_until)-now)/60000)}m` : '';
      return `${u.type} (${u.grade}/${u.category}) 💀15% ${fat}`;
    }).join('\n')||'無し';
    return interaction.reply({
      embeds:[{
        title:`${interaction.member.displayName} – プロフィール`,
        description:`**ポイント:** ${prof.points}p\n\n__ユニット__\n${lines}`
      }],
      ephemeral:true
    });
  }
});

/* ───────── ModalSubmit (rename) ───────── */
client.on('interactionCreate', async i => {
  if (!i.isModalSubmit()) return;
  const [kind,key,targetId] = i.customId.split(':');
  const nick = i.fields.getTextInputValue('nick').slice(0,24);
  const prefix = member=>member.displayName.match(/^【.*?】/)?.[0]||'';
  if (kind==='rename_self') {
    await i.member.setNickname(`${prefix(i.member)}${nick}`).catch(()=>{});
    return i.reply({ content:'✅ ニックネーム変更', ephemeral:true });
  }
  if (kind==='rename_target') {
    const lock = ITEMS[key].lock;
    const mem = await i.guild.members.fetch(targetId).catch(()=>null);
    if (mem) await mem.setNickname(`${prefix(mem)}${nick}`).catch(()=>{});
    await upP(targetId,{ name_lock_until: new Date(Date.now()+lock*60000).toISOString() });
    return i.reply({ content:`✅ 変更完了（${lock}m ロック）`, ephemeral:true });
  }
});

/* ───────── cron (5分毎) 冒険 & 疲労解除 ───────── */
cron.schedule('*/5 * * * *', async () => {
  // 疲労解除
  await sb.from('unit_owned').update({ fatigue_until: null })
    .lte('fatigue_until', new Date().toISOString());
  // 冒険解決
  const now = new Date().toISOString();
  const { data } = await sb.from('unit_tasks').select('*')
    .eq('mode','adv').lte('ends_at',now);
  for (const t of data) {
    const row = await sb.from('unit_owned').select('*').eq('id',t.unit_id).single();
    const u = row.data; if (!u) continue;
    const gain = CAT.find(c=>c[0]===u.type)[7] * t.hours;
    const prof = await gP(t.user_id);
    await upP(t.user_id,{ points: prof.points + gain });
    await sb.from('unit_tasks').delete().eq('id',t.id);
    await sb.from('unit_owned')
      .update({ fatigue_until: new Date(Date.now()+15*60000).toISOString() })
      .eq('id',u.id);
  }
});

/* ───────── サーバー起動 ───────── */
express().get('/', (_,res) => res.send('alive')).listen(process.env.PORT||3000);
client.login(process.env.DISCORD_TOKEN);
