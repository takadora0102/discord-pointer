/**********************************************************************
 * Discord Point-Bot – FULL index.js (2025-05-20 Rev.2)
 *  - rename_target 失敗時クラッシュ修正
 *  - メッセージ送信ポイント／ショップ／借金／自動返済 ほか
 *  ※ そのままコピペ → /src/index.js に上書きして OK
 *********************************************************************/

import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import cron from 'node-cron';

/* ───────── Supabase ───────── */
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

/* ───────── Discord Client ───────── */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.GuildMember]
});

const ROLE_PREFIX = r => `【${r}】`;

/* ロール売却額（借金返済用） */
const ROLE_VALUES = {
  SLAVE: 0, SERF: 0,
  'FREE MAN': 5000,
  'LOW NOBLE': 25000,
  'HIGH NOBLE': 125000,
  'GRAND DUKE': 250000,
  KING: 375000,
  EMPEROR: 500000
};

/* ───────── 商品カタログ ───────── */
const ITEMS = {
  /* ロール購入 */
  free_man:   { name: 'FREE MAN',   price:  10000,  type: 'role' },
  low_noble:  { name: 'LOW NOBLE',  price:  50000,  type: 'role' },
  high_noble: { name: 'HIGH NOBLE', price: 250000,  type: 'role' },

  /* アイテム */
  shield:          { name: 'Shield',          price:   300,   type: 'consumable', effect: 'shield' },
  scope:           { name: 'Scope',           price:   100,   type: 'consumable', effect: 'scope'  },
  timeout:         { name: 'Timeout',         price: 10000,   type: 'consumable', effect: 'timeout' },
  rename_self:     { name: 'Rename Self',     price:  1000,   type: 'consumable', effect: 'rename_self' },
  rename_target_s: { name: 'Rename Target S', price: 10000,   type: 'consumable', effect: 'rename_target', lock: 24*60 },
  rename_target_a: { name: 'Rename Target A', price:  5000,   type: 'consumable', effect: 'rename_target', lock: 10*60 },
  rename_target_b: { name: 'Rename Target B', price:  3500,   type: 'consumable', effect: 'rename_target', lock: 60 },
  rename_target_c: { name: 'Rename Target C', price:  2000,   type: 'consumable', effect: 'rename_target', lock: 10 }
};

/* ───────── Slash-commands ───────── */
const commands = [
  new SlashCommandBuilder().setName('register').setDescription('ユーザー登録'),
  new SlashCommandBuilder().setName('profile').setDescription('自分のプロフィール'),
  new SlashCommandBuilder().setName('debt').setDescription('借金を借りる / 返す')
    .addSubcommand(c=>c.setName('borrow').setDescription('借りる')
      .addIntegerOption(o=>o.setName('amount').setDescription('金額').setRequired(true)))
    .addSubcommand(c=>c.setName('repay').setDescription('返す')),
  new SlashCommandBuilder().setName('shop').setDescription('商品一覧を表示'),
  new SlashCommandBuilder().setName('buy').setDescription('商品を購入')
    .addStringOption(o=>o.setName('item').setDescription('商品キー').setRequired(true)
      .addChoices(...Object.keys(ITEMS).map(k=>({name:k,value:k})))),
  new SlashCommandBuilder().setName('use').setDescription('アイテムを使用')
    .addStringOption(o=>o.setName('item').setDescription('商品キー').setRequired(true)
      .addChoices(...Object.keys(ITEMS).filter(k=>ITEMS[k].type==='consumable')
        .map(k=>({name:k,value:k}))))
    .addUserOption(o=>o.setName('target').setDescription('対象ユーザー'))
];

/* ───────── Supabase Helpers ───────── */
const getProfile = async id =>
  (await sb.from('profiles').select('*').eq('user_id', id).single()).data;

const upsertProfile = (id, fields) =>
  sb.from('profiles').upsert({ user_id: id, ...fields }, { onConflict: 'user_id' });

const addInventory = (id, item, qty=1) =>
  sb.rpc('add_inventory', { uid:id, item_name:item, delta:qty });

const useInventory = async (id, item) => {
  const { data } = await sb.from('item_inventory')
    .select('quantity').eq('user_id', id).eq('item_name', item).single();
  if(!data||data.quantity<1) return false;
  await sb.from('item_inventory')
    .update({ quantity: data.quantity-1 })
    .eq('user_id', id).eq('item_name', item);
  return true;
};

const listInventory = async id =>
  (await sb.from('item_inventory').select('*').eq('user_id', id)).data||[];

/* ロール付与ポイント (role_payouts テーブルからロード) */
let payouts = {};
const loadPayouts = async ()=>{
  const { data } = await sb.from('role_payouts').select('*');
  payouts = {}; data?.forEach(r=>payouts[r.role_name]=r.payout);
};
await loadPayouts(); setInterval(loadPayouts,10*60*1000);

/* ───────── Utility ───────── */
const addRole = async (m,r)=>{
  const role=m.guild.roles.cache.find(x=>x.name===r);
  if(role) await m.roles.add(role).catch(()=>{});
};
const setPrefixedNick = async (m,r)=>{
  const base=m.displayName.replace(/^【.*?】/,'').slice(0,24);
  await m.setNickname(`${ROLE_PREFIX(r)}${base}`).catch(()=>{});
};
const highestRoleValue = m => m.roles.cache.reduce((v,r)=>Math.max(v,ROLE_VALUES[r.name]??0),0);
const highestPayout = m => m.roles.cache.reduce((v,r)=>Math.max(v,payouts[r.name]??0),0);

/* ───────── Deploy Commands ───────── */
const deploy = async ()=>{
  const rest = new REST({ version:'10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);
  await rest.put(route,{body:commands});
  console.log('✅ Slash commands deployed');
};

/* ───────── Interaction Handler ───────── */
client.on('interactionCreate', async i=>{
  if(!i.isChatInputCommand()) return;

  /* -------- /register -------- */
  if(i.commandName==='register'){
    if(await getProfile(i.user.id))
      return i.reply({ content:'❌ 既に登録済み', ephemeral:true });
    await upsertProfile(i.user.id,{ points:1000, debt:0 });
    await addRole(i.member,'SERF');
    await setPrefixedNick(i.member,'SERF');
    return i.reply({ content:'✅ 登録完了！1000p 付与', ephemeral:true });
  }

  /* -------- /profile -------- */
  if(i.commandName==='profile'){
    const p = await getProfile(i.user.id);
    if(!p) return i.reply({ content:'まず `/register`', ephemeral:true });
    const inv = await listInventory(i.user.id);
    const items = inv.length ? inv.map(v=>`${v.item_name}×${v.quantity}`).join('\n') : 'なし';
    const fields = [
      { name:'ポイント', value:`${p.points}p`, inline:true },
      { name:'借金', value:`${p.debt}p`, inline:true },
      { name:'アイテム', value:items, inline:false }
    ];
    if(p.shield_until && new Date(p.shield_until)>new Date()){
      const ms = new Date(p.shield_until) - Date.now();
      const h  = Math.floor(ms/3_600_000), m = Math.floor(ms%3_600_000/60_000);
      fields.push({ name:'🛡 Shield', value:`残り ${h}時間${m}分`, inline:true });
    }
    return i.reply({ embeds:[{ title:`${i.member.displayName} のプロフィール`, fields }], ephemeral:true });
  }

  /* -------- /debt -------- */
  if(i.commandName==='debt'){
    const p = await getProfile(i.user.id);
    if(!p) return i.reply({ content:'まず `/register`',ephemeral:true });

    if(i.options.getSubcommand()==='borrow'){
      if(p.debt>0) return i.reply({ content:'返済前に追加借入不可',ephemeral:true });
      const amt = i.options.getInteger('amount');
      const lim = p.points*3;
      if(amt<=0||amt>lim) return i.reply({ content:`借入上限 ${lim}p`,ephemeral:true });
      const repay = Math.ceil(amt*1.10);
      await upsertProfile(i.user.id,{
        points:p.points+amt,
        debt:repay,
        debt_due:new Date(Date.now()+7*24*60*60*1000).toISOString()
      });
      return i.reply({ content:`✅ ${amt}p 借入（返済額 ${repay}p / 7日後）`,ephemeral:true });
    }

    if(i.options.getSubcommand()==='repay'){
      if(p.debt===0) return i.reply({ content:'借金なし',ephemeral:true });
      if(p.points<p.debt) return i.reply({ content:'ポイント不足',ephemeral:true });
      await upsertProfile(i.user.id,{ points:p.points-p.debt, debt:0, debt_due:null });
      return i.reply({ content:'返済完了',ephemeral:true });
    }
  }

  /* -------- /shop -------- */
  if(i.commandName==='shop'){
    const desc = Object.entries(ITEMS).map(([k,v])=>`**${k}** – ${v.price}p`).join('\n');
    return i.reply({ embeds:[{title:'🏪 ショップ',description:desc}],ephemeral:true });
  }

  /* -------- /buy -------- */
  if(i.commandName==='buy'){
    await i.deferReply({ ephemeral:true });
    const key = i.options.getString('item');
    const item= ITEMS[key];
    if(!item) return i.editReply('存在しない商品');
    const p = await getProfile(i.user.id);
    if(!p) return i.editReply('まず `/register`');
    if(p.points<item.price) return i.editReply('ポイント不足');

    if(item.type==='role'){
      await addRole(i.member,item.name);
      await setPrefixedNick(i.member,item.name);
      await upsertProfile(i.user.id,{ points:p.points-item.price });
      return i.editReply(`✅ ${item.name} を購入`);
    }

    await addInventory(i.user.id,key,1);
    await upsertProfile(i.user.id,{ points:p.points-item.price });
    return i.editReply(`✅ ${item.name} を購入。在庫+1`);
  }

  /* -------- /use -------- */
  if(i.commandName==='use'){
    const key  = i.options.getString('item');
    const item = ITEMS[key];
    if(!item||item.type!=='consumable')
      return i.reply({ content:'使用不可',ephemeral:true });

    /* rename 系はモーダルを出すので defer しない */
    if(item.effect==='rename_self'||item.effect==='rename_target'){
      if(!await useInventory(i.user.id,key))
        return i.reply({ content:'在庫なし',ephemeral:true });
    }else{
      await i.deferReply({ephemeral:true});
      if(!await useInventory(i.user.id,key))
        return i.editReply('在庫なし');
    }

    const target = i.options.getUser('target');
    const guild  = await client.guilds.fetch(process.env.GUILD_ID);
    const targetMem = target ? await guild.members.fetch(target.id).catch(()=>null) : null;

    /* ----- shield ----- */
    if(item.effect==='shield'){
      const until=new Date(Date.now()+24*60*60*1000).toISOString();
      await upsertProfile(i.user.id,{ shield_until:until });
      return i.editReply('🛡 24h シールド展開');
    }

    /* ----- scope ----- */
    if(item.effect==='scope'){
      if(!targetMem) return i.editReply('対象必須');
      const tp=await getProfile(target.id);
      if(tp?.shield_until&&new Date(tp.shield_until)>new Date())
        return i.editReply('🟢 相手はシールド中');
      return i.editReply('⚪ シールドなし');
    }

    /* ----- timeout ----- */
    if(item.effect==='timeout'){
      if(!targetMem) return i.editReply('対象必須');
      const tp=await getProfile(target.id);
      if(tp?.shield_until&&new Date(tp.shield_until)>new Date())
        return i.editReply('相手はシールド中 → 無効');
      await targetMem.timeout(10*60*1000,`Timeout by ${i.user.tag}`).catch(()=>{});
      return i.editReply('⏱ 10分タイムアウト');
    }

    /* ----- rename_self ----- */
    if(item.effect==='rename_self'){
      const modal=new ModalBuilder()
        .setCustomId(`rename_self:${key}`)
        .setTitle('新しいニックネーム')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('nick')
              .setLabel('Nickname (24文字以内)')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(24)
              .setRequired(true)
          )
        );
      return i.showModal(modal);
    }

    /* ----- rename_target ----- */
    if(item.effect==='rename_target'){
      if(!targetMem)
        return i.reply({ content:'対象必須',ephemeral:true });

      /* 成功率判定（上位ロールなら 30%） */
      const myRank=highestRoleValue(i.member);
      const tarRank=highestRoleValue(targetMem);
      if(tarRank>myRank && Math.random()>=0.30){
        await sb.from('item_logs').insert({user_id:i.user.id,target_id:target.id,item_name:key,result:'fail'});
        return i.reply({ content:'❌ 失敗しました（30%成功率）',ephemeral:true });
      }

      /* シールド判定 */
      const tp=await getProfile(target.id);
      if(tp?.shield_until&&new Date(tp.shield_until)>new Date()){
        await sb.from('item_logs').insert({user_id:i.user.id,target_id:target.id,item_name:key,result:'fail'});
        return i.reply({ content:'相手はシールド中 → 無効',ephemeral:true });
      }

      const modal=new ModalBuilder()
        .setCustomId(`rename_target:${key}:${target.id}`)
        .setTitle('新しいニックネーム')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('nick')
              .setLabel('Nickname (24文字以内)')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(24)
              .setRequired(true)
          )
        );
      return i.showModal(modal);
    }

    return i.editReply('効果未実装');
  }
});

/* ───────── Modal Submit ───────── */
client.on('interactionCreate',async i=>{
  if(!i.isModalSubmit())return;
  const [type,key,targetId]=i.customId.split(':');
  const nick=i.fields.getTextInputValue('nick').slice(0,24);

  if(type==='rename_self'){
    await i.member.setNickname(nick).catch(()=>{});
    return i.reply({ content:'✅ ニックネーム変更',ephemeral:true });
  }

  if(type==='rename_target'){
    const lockMin=ITEMS[key].lock;
    const guild=await client.guilds.fetch(process.env.GUILD_ID);
    const mem=await guild.members.fetch(targetId).catch(()=>null);
    if(mem) await mem.setNickname(nick).catch(()=>{});
    await upsertProfile(targetId,{ name_lock_until:new Date(Date.now()+lockMin*60*1000).toISOString() });
    await sb.from('item_logs').insert({user_id:i.user.id,target_id:targetId,item_name:key,result:'success'});
    return i.reply({ content:`✅ 変更しました（${lockMin}分ロック）`,ephemeral:true });
  }
});

/* ───────── guildMemberUpdate ───────── */
client.on('guildMemberUpdate',async(_,newM)=>{
  const p=await getProfile(newM.id);
  if(p?.name_lock_until && new Date(p.name_lock_until)>new Date()){
    const pref=newM.displayName.match(/^【.*?】/)?.[0]||'';
    const base=newM.displayName.replace(/^【.*?】/,'');
    await newM.setNickname(`${pref}${base}`).catch(()=>{});
  }
});

/* ───────── 自動返済 (毎時) ───────── */
cron.schedule('0 * * * *',async()=>{
  const { data } = await sb.from('profiles')
    .select('*').gt('debt',0).lte('debt_due',new Date().toISOString());
  const guild=await client.guilds.fetch(process.env.GUILD_ID);
  for(const p of data){
    let remaining=p.debt, pts=p.points;
    remaining -= pts; pts=Math.max(0,pts-p.debt);

    const mem=await guild.members.fetch(p.user_id).catch(()=>null);
    if(mem){
      const sellable=mem.roles.cache
        .filter(r=>ROLE_VALUES[r.name]!==undefined && r.name!=='SLAVE')
        .sort((a,b)=>ROLE_VALUES[a.name]-ROLE_VALUES[b.name]);
      for(const r of sellable.values()){
        if(remaining<=0) break;
        remaining -= ROLE_VALUES[r.name];
        await mem.roles.remove(r).catch(()=>{});
      }
      if(remaining>0){
        await addRole(mem,'SLAVE');
        await setPrefixedNick(mem,'SLAVE');
        pts=-remaining; remaining=0;
      }
    }
    await upsertProfile(p.user_id,{ points:pts, debt:remaining, debt_due:remaining?new Date().toISOString():null });
  }
});

/* ───────── messageCreate → ポイント付与 ───────── */
client.on('messageCreate',async msg=>{
  if(msg.author.bot||!msg.guild) return;

  const prof=await getProfile(msg.author.id);
  if(!prof) return;

  /* クールダウン 2 min */
  if(prof.last_award_at && Date.now()-new Date(prof.last_award_at)<120_000) return;

  const payout = highestPayout(msg.member);
  if(payout===0) return;

  await upsertProfile(msg.author.id,{
    points:prof.points+payout,
    last_award_at:new Date().toISOString()
  });

  /* ログ (任意) */
  try {
    await sb.from('message_awards').insert({
      user_id: msg.author.id,
      message_id: msg.id,
      payout
    });
  } catch (_) { /* ignore logging errors */ }
});

/* ───────── Express keep-alive ───────── */
express().get('/',(_,res)=>res.send('alive')).listen(process.env.PORT||3000,()=>console.log('HTTP up'));

/* ───────── Start ───────── */
deploy().then(()=>client.login(process.env.DISCORD_TOKEN));
