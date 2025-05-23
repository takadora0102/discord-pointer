/**********************************************************************
 * Discord Point-Bot + Unit Warfare – FINAL SOURCE
 * Part-1 : インポート / 定数定義 / Supabase ヘルパ
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
  ActionRowBuilder
} from 'discord.js';
import { createClient } from '@supabase/supabase-js';

/* ───────── Discord & Supabase 初期化 ───────── */
export const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.GuildMember]
});

/* ───────── 定数群 ───────── */
// ニックネーム接頭辞
export const ROLE_PREFIX = r => `【${r}】`;

// ロール販売情報
export const ROLES_FOR_SALE = [
  { name: 'FREE MAN',   value: 'role_FREE MAN',   price: 10000 },
  { name: 'LOW NOBLE',  value: 'role_LOW NOBLE',  price: 50000 },
  { name: 'HIGH NOBLE', value: 'role_HIGH NOBLE', price: 250000 }
];

// アイテム情報
export const ITEMS = {
  shield:          { name:'Shield',           price:300,   effect:'shield',        rarity:'common' },
  scope:           { name:'Scope',            price:100,   effect:'scope',         rarity:'common' },
  tonic:           { name:'Tonic',            price:800,   effect:'tonic',         rarity:'uncommon' },
  rename_self:     { name:'Rename Self',      price:1000,  effect:'rename_self',   rarity:'uncommon' },
  rename_target_c: { name:'Rename Target C',  price:2000,  effect:'rename_target', lock:10, rarity:'uncommon' },
  elixir:          { name:'Elixir',           price:3000,  effect:'elixir',        rarity:'rare' },
  rename_target_b: { name:'Rename Target B',  price:3500,  effect:'rename_target', lock:60, rarity:'rare' },
  rename_target_a: { name:'Rename Target A',  price:5000,  effect:'rename_target', lock:600, rarity:'epic' },
  timeout:         { name:'Timeout',          price:10000, effect:'timeout',       rarity:'epic' },
  rename_target_s: { name:'Rename Target S',  price:10000, effect:'rename_target', lock:1440, rarity:'epic' }
};

// ユニットカタログ [type, grade, category, cost, maint, atk, def, pph]
export const CAT = [
  ['Scout',     'C','adv',   1500,  150,   8,   6, 140],
  ['Pioneer',   'B','adv',   7000,  600,  22,  15, 500],
  ['Explorer',  'S','adv',  20000, 1200,  40,  25,1000],
  ['Raider',    'C','atk',   3000,  300,  35,  10, 100],
  ['Skirmisher','B','atk',  12000,  900,  80,  22, 200],
  ['Berserker', 'S','atk',  40000, 2000, 150,  40, 250],
  ['Guard',     'C','def',   2500,  250,  15,  40,  70],
  ['Sentinel',  'B','def',  10000,  700,  30, 100, 120],
  ['Paladin',   'S','def',  35000, 1800,  60, 180, 150]
];

// ロール別ユニット枠 & 出撃上限
export const LIM = {
  'SERF'      : { adv:1, atk:0, def:0, field:1 },
  'FREE MAN'  : { adv:2, atk:1, def:1, field:2 },
  'LOW NOBLE' : { adv:3, atk:2, def:2, field:3 },
  'HIGH NOBLE': { adv:4, atk:3, def:3, field:4 },
  'GRAND DUKE': { adv:6, atk:4, def:4, field:5 },
  'KING'      : { adv:8, atk:6, def:6, field:6 },
  'EMPEROR'   : { adv:10,atk:8, def:8, field:7 }
};
export const limitOf = member =>
  LIM[Object.keys(LIM).reverse()
    .find(r => member.roles.cache.some(x => x.name === r)) || 'SERF'
  ];
export const weight = i => Math.pow(0.8, i);

// メッセージ報酬 (2分CD)
export const MESSAGE_REWARD = {
  'SLAVE':5, 'SERF':10, 'FREE MAN':20, 'LOW NOBLE':50,
  'HIGH NOBLE':100, 'GRAND DUKE':200, 'KING':400, 'EMPEROR':500
};

// ドロップ率 (grade × rarity)
export const DROP_RATE = {
  C: { common:0.10, uncommon:0.03, rare:0.01, epic:0.002 },
  B: { common:0.06, uncommon:0.05, rare:0.02, epic:0.005 },
  S: { common:0.03, uncommon:0.06, rare:0.03, epic:0.01  }
};

// 借金定数
export const DEBT_MULTIPLIER = 3;
export const DEBT_INTEREST   = 1.10;
export const DEBT_TERM_DAYS  = 7;

/* ───────── Supabase ヘルパ ───────── */
export async function gP(user_id) {
  try {
    const { data, error } = await sb
      .from('profiles')
      .select('*')
      .eq('user_id', user_id)
      .single();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[gP] error', err);
    return null;
  }
}

export async function upP(user_id, obj) {
  try {
    const { data, error } = await sb
      .from('profiles')
      .upsert({ user_id, ...obj }, { onConflict: 'user_id' });
    if (error) throw error;
    return data;
  } catch (err) {
    console.error('[upP] error', err);
    return null;
  }
}

export async function owned(user_id) {
  try {
    const { data, error } = await sb
      .from('unit_owned')
      .select('*')
      .eq('user_id', user_id);
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[owned] error', err);
    return [];
  }
}

export async function addInv(user_id, item_name, delta = 1) {
  try {
    // 在庫取得
    const { data: rec, error: selErr } = await sb
      .from('item_inventory')
      .select('quantity')
      .eq('user_id', user_id)
      .eq('item_name', item_name)
      .single();
    if (selErr) throw selErr;

    if (!rec) {
      // 新規登録
      const { error: insErr } = await sb
        .from('item_inventory')
        .insert({ user_id, item_name, quantity: delta });
      if (insErr) throw insErr;
    } else {
      // 加算更新
      const { error: updErr } = await sb
        .from('item_inventory')
        .update({ quantity: rec.quantity + delta })
        .eq('user_id', user_id)
        .eq('item_name', item_name);
      if (updErr) throw updErr;
    }
  } catch (err) {
    console.error('[addInv] error', err);
  }
}

export async function useInv(user_id, item_name) {
  try {
    const { data: rec, error: selErr } = await sb
      .from('item_inventory')
      .select('quantity')
      .eq('user_id', user_id)
      .eq('item_name', item_name)
      .single();
    if (selErr) throw selErr;
    if (!rec || rec.quantity < 1) return false;

    const { error: updErr } = await sb
      .from('item_inventory')
      .update({ quantity: rec.quantity - 1 })
      .eq('user_id', user_id)
      .eq('item_name', item_name);
    if (updErr) throw updErr;

    return true;
  } catch (err) {
    console.error('[useInv] error', err);
    return false;
  }
}
/**********************************************************************
 * Part-2 : Slash コマンド定義 / Guild 登録 / Autocomplete
 *********************************************************************/
import { client, sb, CAT, ITEMS, ROLES_FOR_SALE, gP, owned, upP } from './index.js'; // 単一ファイル版
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

/* ───────── Slash コマンド定義 ───────── */
const cmds = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('ユーザー登録（1000p & SERF ロール付与）'),

  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('ショップ一覧を表示'),

  new SlashCommandBuilder()
    .setName('buy')
    .setDescription('ロール / アイテムを購入')
    .addStringOption(o =>
      o.setName('key')
       .setDescription('購入キー')
       .setRequired(true)
       .addChoices(
         ...Object.keys(ITEMS).map(k => ({ name: k, value: k })),
         ...ROLES_FOR_SALE.map(r => ({ name: `Role: ${r.name}`, value: r.value }))
       )
    ),

  new SlashCommandBuilder()
    .setName('use')
    .setDescription('アイテムを使用')
    .addStringOption(o =>
      o.setName('item')
       .setDescription('アイテムキー')
       .setRequired(true)
       .addChoices(...Object.keys(ITEMS).map(k => ({ name: k, value: k }))))
    .addUserOption(o =>
      o.setName('target')
       .setDescription('対象ユーザー（必要時）')),

  new SlashCommandBuilder()
    .setName('hire')
    .setDescription('ユニットを雇用')
    .addStringOption(o =>
      o.setName('unit')
       .setDescription('ユニット名')
       .setRequired(true)
       .addChoices(...CAT.map(([t]) => ({ name: t, value: t })) )),

  new SlashCommandBuilder()
    .setName('unit')
    .setDescription('ユニット操作')
    .addSubcommand(c => c.setName('list').setDescription('所持ユニット一覧'))
    .addSubcommand(c =>
      c.setName('adventure')
       .setDescription('ユニットを冒険に出す')
       .addStringOption(o =>
         o.setName('unit_id')
          .setDescription('ユニットID')
          .setRequired(true)
          .setAutocomplete(true))
       .addIntegerOption(o =>
         o.setName('hours')
          .setDescription('1–8時間')
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(8)))
    .addSubcommand(c =>
      c.setName('attack')
       .setDescription('他ユーザーを攻撃')
       .addStringOption(o =>
         o.setName('main')
          .setDescription('主力ユニットID')
          .setRequired(true)
          .setAutocomplete(true))
       .addUserOption(o =>
         o.setName('target')
          .setDescription('攻撃対象')
          .setRequired(true))
       .addStringOption(o =>
         o.setName('ally1')
          .setDescription('サブユニットID1')
          .setAutocomplete(true))
       .addStringOption(o =>
         o.setName('ally2')
          .setDescription('サブユニットID2')
          .setAutocomplete(true))),

  new SlashCommandBuilder()
    .setName('defense')
    .setDescription('防御編成を設定/表示')
    .addSubcommand(c =>
      c.setName('set')
       .setDescription('防御ユニットを設定')
       .addStringOption(o =>
         o.setName('unit1')
          .setDescription('ユニットID1')
          .setRequired(true)
          .setAutocomplete(true))
       .addStringOption(o =>
         o.setName('unit2')
          .setDescription('ユニットID2')
          .setAutocomplete(true))
       .addStringOption(o =>
         o.setName('unit3')
          .setDescription('ユニットID3')
          .setAutocomplete(true)))
    .addSubcommand(c =>
      c.setName('view')
       .setDescription('防御編成を表示')),

  new SlashCommandBuilder()
    .setName('debt')
    .setDescription('借金を借りる／返す')
    .addSubcommand(s =>
      s.setName('borrow')
       .setDescription('借金を借りる')
       .addIntegerOption(o =>
         o.setName('amount')
          .setDescription('借りる金額')
          .setRequired(true)))
    .addSubcommand(s =>
      s.setName('repay')
       .setDescription('借金を返す')),

  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('プロフィールを表示')
];

/* ───────── Guild コマンド登録 ───────── */
await new REST({ version: '10' })
  .setToken(process.env.DISCORD_TOKEN)
  .put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: cmds }
  );

/* ───────── Autocomplete ハンドラ ───────── */
client.on('interactionCreate', async interaction => {
  if (!interaction.isAutocomplete()) return;

  const focused = interaction.options.getFocused(true);
  const units   = await owned(interaction.user.id);

  const choices = units.map(u => ({
    name : `#${u.id} ${u.type}(${u.grade})`,
    value: u.id.toString()
  }));
  const filtered = choices
    .filter(c => c.name.toLowerCase().includes(focused.value.toLowerCase()))
    .slice(0, 25);

  return interaction.respond(filtered);
});
/**********************************************************************
 * Part-3 : /register, /shop, /buy, /use, /hire,
 *          /defense, /debt, /unit attack
 *********************************************************************/
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  /* ===== /register ===== */
  if (interaction.commandName === 'register') {
    await interaction.deferReply({ ephemeral: true });
    if (await gP(interaction.user.id))
      return interaction.editReply('✅ 既に登録済みです');

    await upP(interaction.user.id, { points: 1000, debt: 0 });
    const serfRole = interaction.guild.roles.cache.find(r => r.name === 'SERF');
    if (serfRole) await interaction.member.roles.add(serfRole).catch(() => {});
    const base = interaction.member.displayName.replace(/^【.*?】/, '').slice(0, 24);
    await interaction.member.setNickname(`${ROLE_PREFIX('SERF')}${base}`).catch(() => {});
    return interaction.editReply('🎉 登録完了！1000p 付与');
  }

  /* ===== /shop ===== */
  if (interaction.commandName === 'shop') {
    const unitLines = CAT.map(([t, g, c, h]) => `**${t}** (${g}/${c}) – ${h}p`).join('\n');
    const roleLines = ROLES_FOR_SALE.map(r => `**Role: ${r.name}** – ${r.price}p`).join('\n');
    const itemLines = Object.entries(ITEMS).map(([k, v]) => `**${k}** – ${v.price}p`).join('\n');
    return interaction.reply({
      embeds: [{
        title: '🏪 SHOP',
        description:
          `__ユニット雇用__\n${unitLines}\n\n` +
          `__ロール購入__\n${roleLines}\n\n` +
          `__アイテム__\n${itemLines}`
      }],
      ephemeral: true
    });
  }

  /* ===== /buy ===== */
  if (interaction.commandName === 'buy') {
    const key = interaction.options.getString('key');
    // ロール購入
    if (key.startsWith('role_')) {
      const info = ROLES_FOR_SALE.find(r => r.value === key);
      const prof = await gP(interaction.user.id);
      if (prof.points < info.price)
        return interaction.reply({ content: '❌ ポイント不足', ephemeral: true });
      const roleObj = interaction.guild.roles.cache.find(r => r.name === info.name);
      if (roleObj) await interaction.member.roles.add(roleObj).catch(() => {});
      const base = interaction.member.displayName.replace(/^【.*?】/, '');
      await interaction.member.setNickname(`${ROLE_PREFIX(info.name)}${base}`).catch(() => {});
      await upP(interaction.user.id, { points: prof.points - info.price });
      return interaction.reply({ content: `✅ ${info.name} ロール取得`, ephemeral: true });
    }
    // アイテム購入
    const item = ITEMS[key];
    if (!item)
      return interaction.reply({ content: '❌ 不正なアイテムキー', ephemeral: true });
    const prof = await gP(interaction.user.id);
    if (prof.points < item.price)
      return interaction.reply({ content: '❌ ポイント不足', ephemeral: true });
    await addInv(interaction.user.id, key, 1);
    await upP(interaction.user.id, { points: prof.points - item.price });
    return interaction.reply({ content: `✅ ${item.name} 購入`, ephemeral: true });
  }

  /* ===== /use ===== */
  if (interaction.commandName === 'use') {
    const key = interaction.options.getString('item');
    const item = ITEMS[key];
    if (!item)
      return interaction.reply({ content: '❌ 不正なアイテムキー', ephemeral: true });
    const target = interaction.options.getUser('target');
    if (!await useInv(interaction.user.id, key))
      return interaction.reply({ content: '❌ 在庫なし', ephemeral: true });

    switch (item.effect) {
      case 'shield':
        await upP(interaction.user.id, { shield_until: new Date(Date.now() + 864e5).toISOString() });
        return interaction.reply({ content: '🛡️ 24h シールド展開', ephemeral: true });

      case 'scope':
        if (!target)
          return interaction.reply({ content: '❌ ターゲット指定必須', ephemeral: true });
        const tp = await gP(target.id);
        const on = tp?.shield_until && new Date(tp.shield_until) > new Date();
        return interaction.reply({ content: on ? '🟢 シールド中' : '⚪ シールドなし', ephemeral: true });

      case 'timeout':
        if (!target)
          return interaction.reply({ content: '❌ ターゲット指定必須', ephemeral: true });
        const mem = await interaction.guild.members.fetch(target.id);
        const tp2 = await gP(target.id);
        if (tp2?.shield_until && new Date(tp2.shield_until) > new Date())
          return interaction.reply({ content: '❌ 相手はシールド中でタイムアウト不可', ephemeral: true });
        await mem.timeout(600000, 'Timeout item');
        return interaction.reply({ content: '⏱ 10分間タイムアウト', ephemeral: true });

      case 'tonic': {
        const list = await owned(interaction.user.id);
        const fat = list.find(u => u.fatigue_until && new Date(u.fatigue_until) > new Date());
        if (!fat)
          return interaction.reply({ content: '😌 疲労中ユニットなし', ephemeral: true });
        await sb.from('unit_owned').update({ fatigue_until: null }).eq('id', fat.id);
        return interaction.reply({ content: `✨ ${fat.type} の疲労回復`, ephemeral: true });
      }

      case 'elixir':
        await sb.from('unit_owned').update({ fatigue_until: null }).eq('user_id', interaction.user.id);
        return interaction.reply({ content: '✨ 全ユニット疲労回復', ephemeral: true });

      case 'rename_self': {
        const modal = new ModalBuilder()
          .setCustomId(`rename_self:${key}`)
          .setTitle('新しいニックネーム')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('nick')
                .setLabel('24文字以内')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(24)
            )
          );
        return interaction.showModal(modal);
      }

      case 'rename_target':
        if (!target)
          return interaction.reply({ content: '❌ ターゲット指定必須', ephemeral: true });
        const tp3 = await gP(target.id);
        if (tp3?.shield_until && new Date(tp3.shield_until) > new Date())
          return interaction.reply({ content: '❌ 相手はシールド中でリネーム不可', ephemeral: true });
        if (tp3?.name_lock_until && new Date(tp3.name_lock_until) > new Date())
          return interaction.reply({ content: '❌ まだ変更できません', ephemeral: true });
        {
          const modal = new ModalBuilder()
            .setCustomId(`rename_target:${key}:${target.id}`)
            .setTitle('新しいニックネーム')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('nick')
                  .setLabel('24文字以内')
                  .setStyle(TextInputStyle.Short)
                  .setRequired(true)
                  .setMaxLength(24)
              )
            );
          return interaction.showModal(modal);
        }

      default:
        return interaction.reply({ content: '❌ 未対応アイテム', ephemeral: true });
    }
  }

  /* ===== /hire ===== */
  if (interaction.commandName === 'hire') {
    await interaction.deferReply({ ephemeral: true });
    const name = interaction.options.getString('unit');
    const row = CAT.find(u => u[0] === name);
    if (!row) return interaction.editReply('❌ ユニットなし');
    const [type, grade, cat, cost, maint, atk, defv] = row;
    const lim = limitOf(interaction.member);
    const list = await owned(interaction.user.id);
    if (list.filter(u => u.category === cat).length >= lim[cat])
      return interaction.editReply(`❌ ${cat} 枠上限`);
    const prof = await gP(interaction.user.id);
    if (prof.points < cost) return interaction.editReply('❌ ポイント不足');
    await sb.from('unit_owned').insert({
      user_id: interaction.user.id,
      type, grade, category: cat,
      atk, def: defv, maint_cost: maint
    });
    await upP(interaction.user.id, { points: prof.points - cost });
    return interaction.editReply(`✅ ${type} 雇用完了`);
  }

  /* ===== /defense ===== */
  if (interaction.commandName === 'defense') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'set') {
      await interaction.deferReply({ ephemeral: true });
      const picks = [
        interaction.options.getString('unit1'),
        interaction.options.getString('unit2'),
        interaction.options.getString('unit3')
      ].filter(Boolean);
      const field = limitOf(interaction.member).field;
      if (picks.length > field)
        return interaction.editReply(`❌ 最大 ${field}体まで`);
      const mine = await owned(interaction.user.id);
      if (!picks.every(id => mine.some(u => u.id.toString() === id)))
        return interaction.editReply('❌ 所持していないユニットが含まれています');
      await sb.from('defense_lineup')
        .upsert({ user_id: interaction.user.id, unit_ids: picks }, { onConflict: 'user_id' });
      return interaction.editReply(`🛡 防御編成設定: ${picks.map(id => `#${id}`).join(', ')}`);
    }
    if (sub === 'view') {
      const rec = (await sb.from('defense_lineup')
        .select('*').eq('user_id', interaction.user.id).single()).data;
      const txt = rec?.unit_ids?.map(id => `#${id}`).join(', ') || '未設定';
      return interaction.reply({ content: `🛡 防御編成: ${txt}`, ephemeral: true });
    }
  }

  /* ===== /debt ===== */
  if (interaction.commandName === 'debt') {
    const sub = interaction.options.getSubcommand();
    const prof = await gP(interaction.user.id);
    if (interaction.member.roles.cache.some(r => r.name === 'SLAVE'))
      return interaction.reply({ content: '❌ SLAVE は借金不可', ephemeral: true });
    if (sub === 'borrow') {
      const amt = interaction.options.getInteger('amount');
      if (prof.debt > 0)
        return interaction.reply({ content: '❌ 既に借金があります', ephemeral: true });
      const max = prof.points * DEBT_MULTIPLIER;
      if (amt > max)
        return interaction.reply({ content: `❌ 最大 ${max}p まで`, ephemeral: true });
      const repay = Math.floor(amt * DEBT_INTEREST);
      const by = new Date(Date.now() + DEBT_TERM_DAYS * 864e5).toISOString();
      await sb.from('debt_logs').insert({ user_id: interaction.user.id, amount: repay, repay_by: by });
      await upP(interaction.user.id, { points: prof.points + amt, debt: repay });
      return interaction.reply({ content: `💰 ${amt}p 借りました（返済 ${repay}p）`, ephemeral: true });
    }
    if (sub === 'repay') {
      if (prof.debt === 0) return interaction.reply({ content: '✅ 借金なし', ephemeral: true });
      if (prof.points < prof.debt) return interaction.reply({ content: '❌ ポイント不足', ephemeral: true });
      await sb.from('debt_logs').update({ repaid: true })
        .eq('user_id', interaction.user.id).eq('repaid', false);
      await upP(interaction.user.id, { points: prof.points - prof.debt, debt: 0 });
      return interaction.reply({ content: '🎉 返済完了', ephemeral: true });
    }
  }

  /* ===== /unit attack ===== */
  if (interaction.commandName === 'unit' &&
      interaction.options.getSubcommand() === 'attack') {
    await interaction.deferReply({ ephemeral: true });

    // ユーザー指定または自動編成
    const main = interaction.options.getString('main');
    const ally1 = interaction.options.getString('ally1');
    const ally2 = interaction.options.getString('ally2');
    const picks = [main, ally1, ally2].filter(Boolean);
    const field = limitOf(interaction.member).field;
    if (picks.length > field)
      return interaction.editReply(`❌ 最大 ${field}体まで`);

    // ターゲット取得＆SERF/シールドチェック
    const targetUser = interaction.options.getUser('target');
    const tMem = await interaction.guild.members.fetch(targetUser.id);
    const tProf = await gP(targetUser.id);
    if (tMem.roles.cache.some(r => r.name === 'SERF') ||
        (tProf.shield_until && new Date(tProf.shield_until) > new Date())) {
      return interaction.editReply('❌ ターゲットは攻撃不可');
    }

    // 所持＆疲労チェック済みユニット
    const myUnits = (await owned(interaction.user.id))
      .filter(u => !u.fatigue_until || new Date(u.fatigue_until) < new Date());

    // 編成：指定がなければ攻撃特化ユニットから自動選出
    let lineupUnits;
    if (picks.length) {
      lineupUnits = picks
        .map(id => myUnits.find(u => u.id.toString() === id))
        .filter(Boolean);
    } else {
      lineupUnits = myUnits
        .filter(u => u.category === 'atk')
        .sort((a, b) => b.atk - a.atk)
        .slice(0, field);
    }
    if (!lineupUnits.length)
      return interaction.editReply('❌ 利用可能な攻撃ユニットがありません');

    // 防御編成取得 or 自動選出
    const defRec = (await sb.from('defense_lineup')
      .select('*').eq('user_id', targetUser.id).single()).data;
    let defUnits = [];
    if (defRec?.unit_ids?.length) {
      const allDef = await owned(targetUser.id);
      defUnits = defRec.unit_ids
        .map(id => allDef.find(u => u.id.toString() === id))
        .filter(u => u && (!u.fatigue_until || new Date(u.fatigue_until) < new Date()));
    }
    if (!defUnits.length) {
      defUnits = (await owned(targetUser.id))
        .filter(u => !u.fatigue_until || new Date(u.fatigue_until) < new Date())
        .sort((a, b) => b.def - a.def)
        .slice(0, field);
    }

    // 成功率制御: 上位ロール相手なら30%
    const hierarchy = ['SLAVE','SERF','FREE MAN','LOW NOBLE','HIGH NOBLE','GRAND DUKE','KING','EMPEROR'];
    const myRank = hierarchy.findIndex(r => interaction.member.roles.cache.some(x => x.name === r));
    const tgtRank = hierarchy.findIndex(r => tMem.roles.cache.some(x => x.name === r));
    const successRate = myRank < tgtRank ? 0.3 : 1.0;
    if (Math.random() > successRate) {
      return interaction.editReply(`❌ 攻撃に失敗しました（成功率 ${Math.round(successRate*100)}%）`);
    }

    // 戦闘計算
    const sum = (arr, key) => arr.reduce((s, u, i) => s + u[key] * weight(i), 0);
    const atkValue = sum(lineupUnits, 'atk');
    const defValue = sum(defUnits, 'def');
    const roll = Math.floor(Math.random() * 11) - 5;
    const score = atkValue - defValue + roll;
    const win = score > 0;

    // ポイント奪取
    const targetProf2 = await gP(targetUser.id);
    const baseSteal = 0.3;
    const steal = win
      ? Math.floor(targetProf2.points * baseSteal * (score / 100 + 1))
      : 0;
    await upP(targetUser.id, { points: targetProf2.points - steal });
    const myProf2 = await gP(interaction.user.id);
    await upP(interaction.user.id, { points: myProf2.points + steal });

    // アイテムドロップ
    const drops = [];
    if (win) {
      for (const u of defUnits) {
        for (const [rar, pBase] of Object.entries(DROP_RATE[u.grade])) {
          if (Math.random() < pBase) {
            const candidates = Object.entries(ITEMS)
              .filter(([k, v]) => v.rarity === rar)
              .map(([k]) => k);
            const itemKey = candidates[Math.floor(Math.random() * candidates.length)];
            await addInv(interaction.user.id, itemKey, 1);
            drops.push(itemKey);
          }
        }
      }
    }

    // 結果返却
    return interaction.editReply(
      `SCORE: ${Math.round(score)} → ${win ? '勝利' : '敗北'}\n` +
      `💰 奪取: ${steal}p\n` +
      (drops.length
        ? `🎁 ドロップ: ${[...new Set(drops)].join(', ')}`
        : '🎁 ドロップなし')
    );
  }
});
/**********************************************************************
 * Part-4 : /unit list, /unit adventure, /profile,
 *          ModalSubmit, message reward,
 *          cron jobs (adventure, debt repay, maintenance),
 *          guildMemberUpdate, keep-alive & login
 *********************************************************************/

import { client, sb, CAT, ITEMS, gP, upP, owned, addInv, limitOf, weight, MESSAGE_REWARD, DROP_RATE } from './index.js';

// ===== /unit list =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'unit' && interaction.options.getSubcommand() === 'list') {
    const list = await owned(interaction.user.id);
    const now = Date.now();
    const lines = await Promise.all(list.map(async u => {
      const adv = await sb.from('unit_tasks')
        .select()
        .eq('unit_id', u.id)
        .eq('mode', 'adv')
        .gt('ends_at', new Date().toISOString())
        .single();
      const tag = adv.data ? '🏃‍♂️' : '';
      const fat = u.fatigue_until && new Date(u.fatigue_until) > now
        ? `😴${Math.ceil((new Date(u.fatigue_until) - now) / 60000)}m`
        : '';
      return `#${u.id} ${u.type}(${u.grade}) ${tag}${fat}`;
    }));
    return interaction.reply({
      content: lines.length ? '```\n' + lines.join('\n') + '\n```' : 'ユニットなし',
      ephemeral: true
    });
  }
});

// ===== /unit adventure =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'unit' && interaction.options.getSubcommand() === 'adventure') {
    await interaction.deferReply({ ephemeral: true });
    const unitId = parseInt(interaction.options.getString('unit_id'));
    const hours  = interaction.options.getInteger('hours');
    const { data: u } = await sb.from('unit_owned').select().eq('id', unitId).single();
    if (!u || u.user_id !== interaction.user.id)
      return interaction.editReply('❌ 所持していないユニットID');
    if (u.fatigue_until && new Date(u.fatigue_until) > new Date())
      return interaction.editReply('😴 そのユニットは疲労中です');
    const prof = await gP(interaction.user.id);
    if (prof.shield_until && new Date(prof.shield_until) > new Date())
      await upP(interaction.user.id, { shield_until: null });
    const ends = new Date(Date.now() + hours * 3600000).toISOString();
    await sb.from('unit_tasks').insert({
      user_id: interaction.user.id,
      unit_id,
      mode: 'adv',
      hours,
      ends_at: ends
    });
    return interaction.editReply(`⏳ #${unitId} を ${hours}h 冒険へ送りました`);
  }
});

// ===== /profile =====
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'profile') {
    await interaction.deferReply({ ephemeral: true });
    const prof = await gP(interaction.user.id);
    if (!prof) return interaction.editReply('❌ /register を先に');

    const now = Date.now();
    const shieldTxt = prof.shield_until && new Date(prof.shield_until) > now
      ? `🛡️ ${Math.ceil((new Date(prof.shield_until) - now) / 60000)}m`
      : 'なし';

    const inv = (await sb.from('item_inventory')
      .select()
      .eq('user_id', interaction.user.id)
    ).data || [];
    const invText = inv.length
      ? inv.map(i => `${i.item_name}×${i.quantity}`).join('\n')
      : 'なし';

    const list = await owned(interaction.user.id);
    const unitLines = await Promise.all(list.map(async u => {
      const adv = await sb.from('unit_tasks')
        .select()
        .eq('unit_id', u.id)
        .eq('mode', 'adv')
        .gt('ends_at', new Date().toISOString())
        .single();
      const tag = adv.data ? '🏃‍♂️' : '';
      const fat = u.fatigue_until && new Date(u.fatigue_until) > now
        ? `😴${Math.ceil((new Date(u.fatigue_until) - now) / 60000)}m`
        : '';
      return `#${u.id} ${u.type}(${u.grade}) ${tag}${fat}`;
    }));

    const { data: defRec } = await sb.from('defense_lineup')
      .select()
      .eq('user_id', interaction.user.id)
      .single();
    const defText = defRec?.unit_ids?.map(id => `#${id}`).join(', ') || '未設定';

    return interaction.editReply({
      embeds: [{
        title: `${interaction.member.displayName} – PROFILE`,
        description:
          `**ポイント:** ${prof.points}p\n` +
          `**借金:**   ${prof.debt || 0}p\n` +
          `**シールド:** ${shieldTxt}\n\n` +
          `__所持アイテム__\n${invText}\n\n` +
          `__ユニット__\n${unitLines.join('\n') || 'なし'}\n\n` +
          `__防御編成__\n${defText}`
      }]
    });
  }
});

// ===== ModalSubmit (rename) =====
client.on('interactionCreate', async modal => {
  if (!modal.isModalSubmit()) return;
  const [kind, key, tgt] = modal.customId.split(':');
  const nick = modal.fields.getTextInputValue('nick').slice(0, 24);
  const pref = m => m.displayName.match(/^【.*?】/)?.[0] || '';

  if (kind === 'rename_self') {
    await modal.member.setNickname(`${pref(modal.member)}${nick}`).catch(() => {});
    return modal.reply({ content: '✅ ニックネーム変更', ephemeral: true });
  }
  if (kind === 'rename_target') {
    const lock = ITEMS[key].lock;
    const mem  = await modal.guild.members.fetch(tgt).catch(() => null);
    if (mem) await mem.setNickname(`${pref(mem)}${nick}`).catch(() => {});
    await upP(tgt, { name_lock_until: new Date(Date.now() + lock * 60000).toISOString() });
    return modal.reply({ content: `✅ 変更完了（${lock}m ロック）`, ephemeral: true });
  }
});

// ===== メッセージ送信報酬 (2分CD) =====
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  const prof = await gP(msg.author.id);
  const now  = Date.now();
  if (prof.last_message_at && now - new Date(prof.last_message_at).getTime() < 120000) return;
  const reward = Math.max(...Object.entries(MESSAGE_REWARD)
    .filter(([role]) => msg.member.roles.cache.some(r => r.name === role))
    .map(([, p]) => p), 0);
  if (reward) {
    await upP(msg.author.id, {
      points: prof.points + reward,
      last_message_at: new Date().toISOString()
    });
  }
});

// ===== cron: 冒険＆疲労・借金自動返済 (5分毎) =====
cron.schedule('*/5 * * * *', async () => {
  // 疲労解除
  await sb.from('unit_owned').update({ fatigue_until: null })
    .lte('fatigue_until', new Date().toISOString());

  // 冒険完了
  const nowIso = new Date().toISOString();
  const { data: tasks } = await sb.from('unit_tasks')
    .select()
    .eq('mode', 'adv')
    .lte('ends_at', nowIso);
  for (const t of tasks) {
    const { data: u } = await sb.from('unit_owned').select().eq('id', t.unit_id).single();
    if (!u) continue;
    const pph  = CAT.find(c => c[0] === u.type)[7];
    const gain = pph * t.hours;
    const prof = await gP(t.user_id);
    await upP(t.user_id, { points: prof.points + gain });
    await sb.from('unit_tasks').delete().eq('id', t.id);
    await sb.from('unit_owned')
      .update({ fatigue_until: new Date(Date.now() + 900000).toISOString() })
      .eq('id', u.id);
  }

  // 借金自動返済
  const { data: due } = await sb.from('debt_logs')
    .select()
    .eq('repaid', false)
    .lte('repay_by', new Date().toISOString());
  for (const d of due) {
    const prof = await gP(d.user_id);
    if (prof.points >= prof.debt) {
      await upP(d.user_id, { points: prof.points - prof.debt, debt: 0 });
      await sb.from('debt_logs').update({ repaid: true }).eq('id', d.id);
    } else {
      let lack = d.amount - prof.points;
      await upP(d.user_id, { points: 0 });
      const roles = ['EMPEROR','KING','GRAND DUKE','HIGH NOBLE','LOW NOBLE','FREE MAN'];
      const priceMap = {
        'FREE MAN':5000,'LOW NOBLE':25000,'HIGH NOBLE':125000,
        'GRAND DUKE':250000,'KING':375000,'EMPEROR':500000
      };
      const mem = await client.guilds.cache.first().members.fetch(d.user_id).catch(()=>null);
      for (const r of roles) {
        if (lack <= 0) break;
        if (mem.roles.cache.some(x => x.name === r)) {
          const roleObj = mem.guild.roles.cache.find(x => x.name === r);
          await mem.roles.remove(roleObj).catch(() => {});
          lack -= priceMap[r];
        }
      }
      await upP(d.user_id, { debt: lack>0?lack:0, points: lack>0?0:-lack });
      if (lack > 0 && mem) {
        const slave = mem.guild.roles.cache.find(x=>x.name==='SLAVE');
        if (slave) await mem.roles.add(slave).catch(()=>{});
      }
      await sb.from('debt_logs').update({ repaid: lack<=0 }).eq('id', d.id);
    }
  }
});

// ===== cron: 維持費徴収 (日次 UTC19≒JST04) =====
cron.schedule('0 19 * * *', async () => {
  const { data: users } = await sb.from('profiles').select('user_id,points');
  for (const u of users) {
    const list = await owned(u.user_id);
    const total = list.reduce((sum, x) => sum + x.maint_cost, 0);
    if (total > 0) await upP(u.user_id, { points: u.points - total });
  }
});

// ===== guildMemberUpdate: ニックネーム自動更新 =====
client.on('guildMemberUpdate', async (oldM, newM) => {
  const highest = roles => Object.keys(LIM).find(r => roles.some(x=>x.name===r)) || 'SERF';
  const before = ROLE_PREFIX(highest(oldM.roles.cache.map(r=>r)));
  const after  = ROLE_PREFIX(highest(newM.roles.cache.map(r=>r)));
  if (before !== after) {
    const base = newM.displayName.replace(/^【.*?】/, '');
    await newM.setNickname(`${after}${base}`).catch(()=>{});
  }
});

// ===== Keep-alive & Login =====
express().get('/', (_, res) => res.send('alive')).listen(process.env.PORT || 3000);
client.login(process.env.DISCORD_TOKEN);
