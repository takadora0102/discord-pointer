/**********************************************************************
 * Discord Point-Bot + Unit Warfare – FULL SOURCE  (2025-05-21)
 *  ◉ ロール販売（SHOP/BUTON）追加
 *  ◉ アイテム在庫管理を upsert 化 (addInv 修正)
 *  ◉ ユニット選択にオートコンプリート
 *  ◉ PROFILE に冒険中・疲労中タグ表示
 *  ◉ deferReply→editReply 二重返信ガード
 *  ◉ Global unhandledRejection ハンドラ
 *********************************************************************/

import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import {
  Client, GatewayIntentBits, Partials,
  REST, Routes, SlashCommandBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';

// ───────── Global Error Handler ─────────
process.on('unhandledRejection', reason => {
  console.error('Unhandled Rejection:', reason);
});

// ───────── Supabase & Discord Client ─────────
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

// ───────── 購入可能ロール ─────────
const ROLES_FOR_SALE = [
  { name: 'FREE MAN',   value: 'role_FREE MAN',  price: 10000  },
  { name: 'LOW NOBLE',  value: 'role_LOW NOBLE', price: 50000  },
  { name: 'HIGH NOBLE', value: 'role_HIGH NOBLE',price: 250000 }
];

// ───────── アイテム一覧 ─────────
const ITEMS = {
  shield:          { name:'Shield',          price:300,    effect:'shield' },
  scope:           { name:'Scope',           price:100,    effect:'scope' },
  timeout:         { name:'Timeout',         price:10000,  effect:'timeout' },
  rename_self:     { name:'Rename Self',     price:1000,   effect:'rename_self' },
  rename_target_s: { name:'Rename Target S', price:10000,  effect:'rename_target', lock:24*60 },
  rename_target_a: { name:'Rename Target A', price:5000,   effect:'rename_target', lock:10*60 },
  rename_target_b: { name:'Rename Target B', price:3500,   effect:'rename_target', lock:60   },
  rename_target_c: { name:'Rename Target C', price:2000,   effect:'rename_target', lock:10   },
  tonic:           { name:'Tonic',           price:800,    effect:'tonic' },
  elixir:          { name:'Elixir',          price:3000,   effect:'elixir' }
};

// ───────── ユニットカタログ ─────────
const CAT = [ // type,grade,cat,hire,maint,atk,def,pph
  ['Scout',      'C','adv',  1500,  150,   8,   6,  140 ],
  ['Pioneer',    'B','adv',  7000,  600,  22,  15,  500 ],
  ['Explorer',   'S','adv', 20000, 1200,  40,  25, 1000 ],
  ['Raider',     'C','atk',  3000,  300,  35,  10,  100 ],
  ['Skirmisher', 'B','atk', 12000,  900,  80,  22,  200 ],
  ['Berserker',  'S','atk', 40000, 2000, 150,  40,  250 ],
  ['Guard',      'C','def',  2500,  250,  15,  40,   70 ],
  ['Sentinel',   'B','def', 10000,  700,  30, 100,  120 ],
  ['Paladin',    'S','def', 35000, 1800,  60, 180,  150 ]
];

// ───────── ロール別 保有上限 & 出撃枠 ─────────
const LIM = {
  'SERF':       { adv:1,atk:0,def:0,field:1 },
  'FREE MAN':   { adv:2,atk:1,def:1,field:2 },
  'LOW NOBLE':  { adv:3,atk:2,def:2,field:3 },
  'HIGH NOBLE': { adv:4,atk:3,def:3,field:4 },
  'GRAND DUKE': { adv:6,atk:4,def:4,field:5 },
  'KING':       { adv:8,atk:6,def:6,field:6 },
  'EMPEROR':    { adv:10,atk:8,def:8,field:7 }
};
const limitOf = member => LIM[
  Object.keys(LIM).reverse()
    .find(r => member.roles.cache.some(x => x.name === r)) || 'SERF'
];
const weight = i => Math.pow(0.8, i); // 1,0.8,0.64…

// ───────── Supabase ヘルパ ─────────
const gP    = async id => (await sb.from('profiles').select('*').eq('user_id', id).single()).data;
const upP   = (id, f) => sb.from('profiles').upsert({ user_id:id, ...f }, { onConflict:'user_id' });
const owned = async id => (await sb.from('unit_owned').select('*').eq('user_id', id)).data || [];

// ■ 在庫追加を upsert で実装
async function addInv(id, key, delta = 1) {
  const { data, error } = await sb
    .from('item_inventory')
    .upsert(
      { user_id: id, item_name: key, quantity: delta },
      { onConflict: ['user_id','item_name'] }
    );
  if (error) console.error('addInv error:', error);
  else console.log('addInv success:', data);
}

// ■ 在庫使用チェック
async function useInv(id, key) {
  const rec = (await sb
    .from('item_inventory')
    .select('quantity')
    .eq('user_id', id)
    .eq('item_name', key)
    .single()
  ).data;
  if (!rec || rec.quantity < 1) return false;
  await sb
    .from('item_inventory')
    .update({ quantity: rec.quantity - 1 })
    .eq('user_id', id)
    .eq('item_name', key);
  return true;
}

// ───────── Slash コマンド定義 ─────────
const cmds = [
  new SlashCommandBuilder().setName('register').setDescription('ユーザー登録'),
  new SlashCommandBuilder().setName('shop').setDescription('ショップ一覧'),
  new SlashCommandBuilder().setName('buy').setDescription('購入')
    .addStringOption(o => o
      .setName('key')
      .setDescription('item または role のキー')
      .setRequired(true)
      .addChoices(
        ...Object.keys(ITEMS).map(k => ({ name:k, value:k })),
        ...ROLES_FOR_SALE.map(r => ({ name:`Role: ${r.name}`, value:r.value }))
      )
    ),
  new SlashCommandBuilder().setName('use').setDescription('アイテム使用')
    .addStringOption(o => o
      .setName('item')
      .setDescription('使用アイテムのキー')
      .setRequired(true)
      .addChoices(...Object.keys(ITEMS).map(k => ({ name:k, value:k })))
    )
    .addUserOption(o => o.setName('target').setDescription('対象ユーザー')),
  new SlashCommandBuilder().setName('hire').setDescription('ユニット雇用')
    .addStringOption(o => o
      .setName('unit')
      .setDescription('ユニット名')
      .setRequired(true)
      .addChoices(...CAT.map(([t]) => ({ name:t, value:t })))
    ),
  new SlashCommandBuilder().setName('unit').setDescription('ユニット操作')
    .addSubcommand(c => c.setName('list').setDescription('所持ユニット一覧'))
    .addSubcommand(c => c
      .setName('adventure')
      .setDescription('冒険に出す')
      .addStringOption(o => o
        .setName('unit_id')
        .setDescription('ユニット ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addIntegerOption(o => o
        .setName('hours')
        .setDescription('1–8h')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(8)
      )
    )
    .addSubcommand(c => c
      .setName('attack')
      .setDescription('攻撃する')
      .addStringOption(o => o
        .setName('main')
        .setDescription('主力ユニット ID')
        .setRequired(true)
        .setAutocomplete(true)
      )
      .addUserOption(o => o
        .setName('target')
        .setDescription('攻撃対象')
        .setRequired(true)
      )
      .addStringOption(o => o
        .setName('ally1')
        .setDescription('サブユニット ID 1')
        .setAutocomplete(true)
      )
      .addStringOption(o => o
        .setName('ally2')
        .setDescription('サブユニット ID 2')
        .setAutocomplete(true)
      )
    ),
  new SlashCommandBuilder().setName('profile').setDescription('プロフィール表示')
];

await new REST({ version:'10' })
  .setToken(process.env.DISCORD_TOKEN)
  .put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: cmds });
// ───────── Autocomplete ハンドラ ─────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isAutocomplete()) return;
  if (interaction.commandName !== 'unit') return;

  const sub = interaction.options.getSubcommand();
  if (sub === 'adventure' || sub === 'attack') {
    const focused = interaction.options.getFocused(true);
    const units = await owned(interaction.user.id);
    const choices = units.map(u => ({
      name: `#${u.id} ${u.type}(${u.grade})${u.fatigue_until && new Date(u.fatigue_until)>new Date()?' 😴':''}`,
      value: u.id.toString()
    }));
    const filtered = choices
      .filter(c => c.name.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25);
    return interaction.respond(filtered);
  }
});

// ───────── Slash コマンドハンドラ ─────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // /register
  if (interaction.commandName === 'register') {
    try {
      await interaction.deferReply({ ephemeral: true });
      const exists = await gP(interaction.user.id);
      if (exists) {
        return interaction.editReply({ content: '✅ すでに登録済みです' });
      }
      await upP(interaction.user.id, { points: 1000, debt: 0 });
      const role = interaction.guild.roles.cache.find(r => r.name === 'SERF');
      if (role) await interaction.member.roles.add(role).catch(()=>{});
      const base = interaction.member.displayName.replace(/^【.*?】/, '').slice(0,24);
      await interaction.member.setNickname(`${ROLE_PREFIX('SERF')}${base}`).catch(()=>{});
      return interaction.editReply({ content: '🎉 登録完了！1000p 付与' });
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

  // /shop
  if (interaction.commandName === 'shop') {
    const unitLines = CAT.map(([t,g,c,h])=>`**${t}** (${g}/${c}) – ${h}p`).join('\n');
    const roleLines = ROLES_FOR_SALE.map(r=>`**Role: ${r.name}** – ${r.price}p`).join('\n');
    const itemLines = Object.entries(ITEMS).map(([k,v])=>`**${k}** – ${v.price}p`).join('\n');
    return interaction.reply({
      embeds: [{
        title:'🏪 SHOP',
        description:
          `__ユニット雇用__\n${unitLines}\n\n`+
          `__ロール購入__\n${roleLines}\n\n`+
          `__アイテム__\n${itemLines}`
      }],
      ephemeral:true
    });
  }

  // /buy
  if (interaction.commandName === 'buy') {
    const key = interaction.options.getString('key');
    if (key.startsWith('role_')) {
      const roleInfo = ROLES_FOR_SALE.find(r=>r.value===key);
      const prof = await gP(interaction.user.id);
      if (prof.points < roleInfo.price) {
        return interaction.reply({ content: '❌ ポイント不足', ephemeral: true });
      }
      const role = interaction.guild.roles.cache.find(r=>r.name===roleInfo.name);
      if (!role) {
        return interaction.reply({ content: '❌ サーバーにロールがありません', ephemeral:true });
      }
      await interaction.member.roles.add(role).catch(()=>{});
      await upP(interaction.user.id, { points: prof.points - roleInfo.price });
      return interaction.reply({ content: `✅ ${roleInfo.name} ロールを取得しました`, ephemeral: true });
    }
    const item = ITEMS[key];
    if (!item) {
      return interaction.reply({ content: '❌ アイテム不存在', ephemeral: true });
    }
    const prof = await gP(interaction.user.id);
    if (prof.points < item.price) {
      return interaction.reply({ content: '❌ ポイント不足', ephemeral: true });
    }
    await addInv(interaction.user.id, key, 1);
    await upP(interaction.user.id, { points: prof.points - item.price });
    return interaction.reply({ content: `✅ ${item.name} を購入しました`, ephemeral: true });
  }
  /* ---------- /use ---------- */
  if (interaction.commandName === 'use') {
    const key = interaction.options.getString('item');
    const item = ITEMS[key];
    if (!item) {
      return interaction.reply({ content: '❌ アイテム不存在', ephemeral: true });
    }
    const target = interaction.options.getUser('target');

    // 在庫チェック＆削減
    if (!await useInv(interaction.user.id, key)) {
      return interaction.reply({ content: '❌ 在庫がありません', ephemeral: true });
    }

    // Shield
    if (item.effect === 'shield') {
      await upP(interaction.user.id, {
        shield_until: new Date(Date.now() + 24*60*60*1000).toISOString()
      });
      return interaction.reply({ content: '🛡️ 24h シールド展開', ephemeral: true });
    }

    // Scope
    if (item.effect === 'scope') {
      if (!target) return interaction.reply({ content: '❌ ターゲット必須', ephemeral: true });
      const tp = await gP(target.id);
      const on = tp?.shield_until && new Date(tp.shield_until) > new Date();
      return interaction.reply({ content: on ? '🟢 シールド中' : '⚪ シールドなし', ephemeral: true });
    }

    // Timeout
    if (item.effect === 'timeout') {
      if (!target) return interaction.reply({ content: '❌ ターゲット必須', ephemeral: true });
      const mem = await interaction.guild.members.fetch(target.id);
      await mem.timeout(10*60*1000, 'Timeout Item');
      return interaction.reply({ content: '⏱ 10分タイムアウト', ephemeral: true });
    }

    // Tonic
    if (item.effect === 'tonic') {
      const list = await owned(interaction.user.id);
      const fatigued = list.find(u => u.fatigue_until && new Date(u.fatigue_until) > new Date());
      if (!fatigued) return interaction.reply({ content: '😌 疲労ユニットなし', ephemeral: true });
      await sb.from('unit_owned').update({ fatigue_until: null }).eq('id', fatigued.id);
      return interaction.reply({ content: `✨ ${fatigued.type} の疲労を回復`, ephemeral: true });
    }

    // Elixir
    if (item.effect === 'elixir') {
      await sb.from('unit_owned').update({ fatigue_until: null })
        .eq('user_id', interaction.user.id);
      return interaction.reply({ content: '✨ 全ユニットの疲労を回復', ephemeral: true });
    }

    // Rename Self
    if (item.effect === 'rename_self') {
      const modal = new ModalBuilder()
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
      return interaction.showModal(modal);
    }

    // Rename Target
    if (item.effect === 'rename_target') {
      if (!target) return interaction.reply({ content: '❌ ターゲット必須', ephemeral: true });
      const modal = new ModalBuilder()
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
      return interaction.showModal(modal);
    }

    return interaction.reply({ content: '❌ 未対応アイテム', ephemeral: true });
  }

  /* ---------- /hire ---------- */
  if (interaction.commandName === 'hire') {
    const name = interaction.options.getString('unit');
    const row  = CAT.find(u => u[0] === name);
    if (!row) {
      return interaction.reply({ content: '❌ ユニットなし', ephemeral: true });
    }
    const [type, grade, catKey, cost, maint, atk, defv] = row;
    const lim = limitOf(interaction.member);
    const list = await owned(interaction.user.id);
    if (list.filter(u => u.category === catKey).length >= lim[catKey]) {
      return interaction.reply({ content: `❌ ${catKey} 枠上限`, ephemeral: true });
    }
    const prof = await gP(interaction.user.id);
    if (prof.points < cost) {
      return interaction.reply({ content: '❌ ポイント不足', ephemeral: true });
    }
    await sb.from('unit_owned').insert({
      user_id: interaction.user.id,
      type, grade, category: catKey,
      atk, def: defv, maint_cost: maint
    });
    await upP(interaction.user.id, { points: prof.points - cost });
    return interaction.reply({ content: `✅ ${type} を雇用しました`, ephemeral: true });
  }

  /* ---------- /unit list ---------- */
  if (interaction.commandName === 'unit' && interaction.options.getSubcommand() === 'list') {
    const list = await owned(interaction.user.id);
    const now  = Date.now();
    const lines = await Promise.all(list.map(async u => {
      const advRow = await sb.from('unit_tasks').select('*')
        .eq('unit_id', u.id).eq('mode', 'adv')
        .gt('ends_at', new Date().toISOString())
        .single();
      const inAdv = advRow.data ? '🏃‍♂️冒険中' : '';
      const fatigue = u.fatigue_until && new Date(u.fatigue_until) > now
        ? `😴${Math.ceil((new Date(u.fatigue_until) - now)/60000)}m` : '';
      return `#${u.id} ${u.type}(${u.grade}) ${inAdv} ${fatigue}`;
    }));
    const text = lines.length ? lines.join('\n') : 'なし';
    return interaction.reply({ content: '```\n' + text + '\n```', ephemeral: true });
  }

  /* ---------- /unit adventure ---------- */
  if (interaction.commandName === 'unit' && interaction.options.getSubcommand() === 'adventure') {
    await interaction.deferReply({ ephemeral: true });
    const unitId = parseInt(interaction.options.getString('unit_id'));
    const row    = await sb.from('unit_owned').select('*').eq('id', unitId).single();
    const u      = row.data;
    if (!u || u.user_id !== interaction.user.id) {
      return interaction.editReply({ content: '❌ 無効なユニットID' });
    }
    if (u.fatigue_until && new Date(u.fatigue_until) > new Date()) {
      return interaction.editReply({ content: '😴 疲労中です' });
    }
    const prof = await gP(interaction.user.id);
    if (prof.shield_until && new Date(prof.shield_until) > new Date()) {
      await upP(interaction.user.id, { shield_until: null });
    }
    const hours = interaction.options.getInteger('hours');
    const ends  = new Date(Date.now() + hours * 3600 * 1000).toISOString();
    await sb.from('unit_tasks').insert({
      user_id: interaction.user.id,
      unit_id: unitId,
      mode: 'adv',
      hours,
      ends_at: ends
    });
    return interaction.editReply({ content: `⏳ #${unitId} を ${hours}h 冒険へ` });
  }

  /* ---------- /unit attack ---------- */
  if (interaction.commandName === 'unit' && interaction.options.getSubcommand() === 'attack') {
    await interaction.deferReply({ ephemeral: true });
    const mainId = parseInt(interaction.options.getString('main'));
    const ally1  = interaction.options.getString('ally1');
    const ally2  = interaction.options.getString('ally2');
    const picks  = [mainId]
                    .concat([ally1, ally2].filter(Boolean).map(x => parseInt(x)));
    const field  = limitOf(interaction.member).field;
    if (picks.length > field) {
      return interaction.editReply({ content: `❌ 出撃枠 ${field} 超過` });
    }
    // SERFブロック
    const targetUser = interaction.options.getUser('target');
    const tMem = await interaction.guild.members.fetch(targetUser.id);
    if (tMem.roles.cache.some(r => r.name === 'SERF')) {
      return interaction.editReply({ content: '❌ SERF への攻撃は禁止です' });
    }
    // アタッカー取得
    const avail = (await owned(interaction.user.id))
      .filter(u => !u.fatigue_until || new Date(u.fatigue_until) < new Date());
    const lineup = avail.filter(u => picks.includes(u.id));
    if (lineup.length !== picks.length) {
      return interaction.editReply({ content: '❌ ユニットが存在しないか疲労中です' });
    }
    // ディフェンダー
    const defAvail = (await owned(targetUser.id))
      .filter(u => !u.fatigue_until || new Date(u.fatigue_until) < new Date())
      .sort((a,b) => b.def - a.def)
      .slice(0, limitOf(tMem).field);
    if (!defAvail.length) {
      return interaction.editReply({ content: '❌ 相手に防御ユニットがいません' });
    }
    // 戦闘計算
    const sum = (arr,key) => arr.reduce((s,u,i)=>s+u[key]*weight(i),0);
    const atk   = sum(lineup,'atk');
    const def   = sum(defAvail,'def');
    const roll  = Math.floor(Math.random()*11) - 5;
    const score = atk - def + roll;
    const win   = score > 0;
    const rate  = Math.min(Math.max(score/120,0.5),1.5);
    const victim= await gP(targetUser.id);
    let steal = 0;
    if (win) steal = Math.floor(victim.points * 0.2 * rate);
    await upP(targetUser.id, { points: victim.points - steal });
    const me = await gP(interaction.user.id);
    await upP(interaction.user.id, { points: me.points + steal });
    return interaction.editReply({
      content: `SCORE ${Math.round(score)} → ${win ? '勝利' : '敗北'} / 奪取 ${steal}p`
    });
  }

  /* ---------- /profile ---------- */
  if (interaction.commandName === 'profile') {
    const prof = await gP(interaction.user.id);
    if (!prof) {
      return interaction.reply({ content: '❌ /register を先に', ephemeral: true });
    }
    const list = await owned(interaction.user.id);
    const now  = Date.now();
    const lines = await Promise.all(list.map(async u => {
      const advRow = await sb.from('unit_tasks').select('*')
        .eq('unit_id', u.id).eq('mode','adv')
        .gt('ends_at', new Date().toISOString())
        .single();
      const inAdv = advRow.data ? '🏃‍♂️冒険中' : '';
      const fatigue = u.fatigue_until && new Date(u.fatigue_until) > now
        ? `😴${Math.ceil((new Date(u.fatigue_until) - now)/60000)}m` : '';
      return `#${u.id} ${u.type}(${u.grade}) ${inAdv} 💀15% ${fatigue}`;
    }));
    const desc = `**ポイント:** ${prof.points}p\n\n__ユニット__\n` +
      (lines.length ? lines.join('\n') : 'なし');
    return interaction.reply({
      embeds: [{ title: `${interaction.member.displayName} – プロフィール`, description: desc }],
      ephemeral: true
    });
  }
});

// ───────── Model Submit (rename) ─────────
client.on('interactionCreate', async i => {
  if (!i.isModalSubmit()) return;
  const [kind, key, tgt] = i.customId.split(':');
  const nickBody = i.fields.getTextInputValue('nick').slice(0,24);
  const prefix = member => member.displayName.match(/^【.*?】/)?.[0]||'';
  if (kind === 'rename_self') {
    await i.member.setNickname(`${prefix(i.member)}${nickBody}`).catch(()=>{});
    return i.reply({ content: '✅ ニックネーム変更', ephemeral: true });
  }
  if (kind === 'rename_target') {
    const lock = ITEMS[key].lock;
    const mem = await i.guild.members.fetch(tgt).catch(()=>null);
    if (mem) await mem.setNickname(`${prefix(mem)}${nickBody}`).catch(()=>{});
    await upP(tgt, { name_lock_until: new Date(Date.now()+lock*60000).toISOString() });
    return i.reply({ content: `✅ 変更完了（${lock}m ロック）`, ephemeral: true });
  }
});

// ───────── cron: 冒険解決 & 疲労解除 ─────────
cron.schedule('*/5 * * * *', async () => {
  // 疲労解除
  await sb.from('unit_owned').update({ fatigue_until: null })
    .lte('fatigue_until', new Date().toISOString());
  // 冒険解決
  const now = new Date().toISOString();
  const { data } = await sb.from('unit_tasks').select('*')
    .eq('mode','adv').lte('ends_at', now);
  for (const t of data) {
    const row = await sb.from('unit_owned').select('*').eq('id', t.unit_id).single();
    const u   = row.data; if (!u) continue;
    const gain = CAT.find(c=>c[0]===u.type)[7] * t.hours;
    const prof = await gP(t.user_id);
    await upP(t.user_id, { points: prof.points + gain });
    await sb.from('unit_tasks').delete().eq('id', t.id);
    await sb.from('unit_owned')
      .update({ fatigue_until: new Date(Date.now()+15*60000).toISOString() })
      .eq('id', u.id);
  }
});

// ───────── Express keep-alive & Login ─────────
express().get('/', (_, res) => res.send('alive')).listen(process.env.PORT||3000);
client.login(process.env.DISCORD_TOKEN);
