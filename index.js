// index.js  –  shop+item 対応版
import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, REST, Routes,
         SlashCommandBuilder, ActionRowBuilder, ModalBuilder,
         TextInputBuilder, TextInputStyle, PermissionFlagsBits } from 'discord.js';
import express from 'express';
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';

// ───── Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ───── Discord
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

const ROLE_PREFIX = r => `【${r}】`;
const ROLE_VALUES = {
  'SERF': 0, 'FREE MAN': 5000, 'LOW NOBLE': 25000,
  'HIGH NOBLE': 125000, 'GRAND DUKE': 250000,
  'KING': 375000, 'EMPEROR': 500000
};

// ───── 商品カタログ
const ITEMS = {
  'free_man':   { name: 'FREE MAN',   price: 10000, type: 'role'  },
  'low_noble':  { name: 'LOW NOBLE',  price: 50000, type: 'role'  },
  'high_noble': { name: 'HIGH NOBLE', price: 250000, type: 'role' },

  'shield':     { name: 'Shield',     price: 300,  type: 'consumable', effect: 'shield' },
  'scope':      { name: 'Scope',      price: 100,  type: 'consumable', effect: 'scope'  },
  'timeout':    { name: 'Timeout',    price: 10000,type: 'consumable', effect: 'timeout' },

  'rename_self':   { name: 'Rename Ticket (self)', price: 1000, type: 'consumable', effect: 'rename_self' },
  'rename_target_s': { name: 'Rename Ticket S', price: 10000, type: 'consumable', effect: 'rename_target', lock: 24*60 },
  'rename_target_a': { name: 'Rename Ticket A', price: 5000,  type: 'consumable', effect: 'rename_target', lock: 10*60 },
  'rename_target_b': { name: 'Rename Ticket B', price: 3500,  type: 'consumable', effect: 'rename_target', lock: 60 },
  'rename_target_c': { name: 'Rename Ticket C', price: 2000,  type: 'consumable', effect: 'rename_target', lock: 10 }
};

// ───── スラッシュコマンド
const commands = [
  new SlashCommandBuilder().setName('register').setDescription('ユーザー登録'),
  new SlashCommandBuilder().setName('profile').setDescription('自分のプロフィール'),
  new SlashCommandBuilder()                                      // 借金
    .setName('debt').setDescription('借金を借りる / 返す')
    .addSubcommand(sc => sc.setName('borrow').setDescription('借りる')
      .addIntegerOption(opt => opt.setName('amount').setDescription('金額').setRequired(true)))
    .addSubcommand(sc => sc.setName('repay').setDescription('返す')),
  new SlashCommandBuilder()                                      // ショップ
    .setName('shop').setDescription('商品一覧を表示'),
  new SlashCommandBuilder()                                      // 購入
    .setName('buy').setDescription('商品を購入')
    .addStringOption(opt =>
      opt.setName('item').setDescription('商品キー').setRequired(true)
        .addChoices(...Object.keys(ITEMS).map(k => ({ name: k, value: k })))),
  new SlashCommandBuilder()                                      // 使用
    .setName('use').setDescription('所持アイテムを使用')
    .addStringOption(opt =>
      opt.setName('item').setDescription('商品キー').setRequired(true)
        .addChoices(...Object.keys(ITEMS).filter(k => ITEMS[k].type === 'consumable')
          .map(k => ({ name: k, value: k }))))
    .addUserOption(opt =>
      opt.setName('target').setDescription('対象ユーザー（必要な場合）').setRequired(false))
];

async function deployCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log('✅ Slash commands deployed');
}

// ───── Supabase helpers
async function getProfile(id) {
  const { data } = await supabase.from('profiles').select('*').eq('user_id', id).single();
  return data;
}
async function upsertProfile(id, fields) {
  await supabase.from('profiles').upsert({ user_id: id, ...fields }, { onConflict: 'user_id' });
}
async function addInventory(id, item, qty = 1) {
  const { data } = await supabase.from('item_inventory').select('*')
    .eq('user_id', id).eq('item_name', item).single();
  const newQ = (data?.quantity || 0) + qty;
  await supabase.from('item_inventory')
    .upsert({ user_id: id, item_name: item, quantity: newQ });
}
async function useInventory(id, item) {
  const { data } = await supabase.from('item_inventory').select('*')
    .eq('user_id', id).eq('item_name', item).single();
  if (!data || data.quantity < 1) return false;
  await supabase.from('item_inventory')
    .update({ quantity: data.quantity - 1 })
    .eq('user_id', id).eq('item_name', item);
  return true;
}
async function listInventory(id) {
  const { data } = await supabase.from('item_inventory').select('*').eq('user_id', id);
  return data || [];
}

// ───── Utility
async function addRole(member, roleName) {
  const r = member.guild.roles.cache.find(x => x.name === roleName);
  if (r) await member.roles.add(r).catch(() => {});
}
async function setPrefixNick(mem, roleName) {
  const base = mem.displayName.replace(/^【.*?】/, '').slice(0, 24);
  await mem.setNickname(`${ROLE_PREFIX(roleName)}${base}`).catch(() => {});
}

// ───── Interaction handler
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  await i.deferReply({ ephemeral: true });

  // /register
  if (i.commandName === 'register') {
    if (await getProfile(i.user.id)) return i.editReply('❌ 登録済みです');
    await upsertProfile(i.user.id, { points: 1000, debt: 0 });
    await addRole(i.member, 'SERF');
    await setPrefixNick(i.member, 'SERF');
    return i.editReply('✅ 登録完了！ 1000p 付与');
  }

  // /profile
  if (i.commandName === 'profile') {
    const p = await getProfile(i.user.id);
    if (!p) return i.editReply('まず `/register`');
    const inv = await listInventory(i.user.id);
    const itemsStr = inv.length ? inv.map(v => `${v.item_name} ×${v.quantity}`).join('\n') : 'なし';
    const embed = {
      title: `${i.member.displayName} のプロフィール`,
      fields: [
        { name: 'ポイント', value: `${p.points}p`, inline: true },
        { name: '借金', value: `${p.debt}p`, inline: true },
        { name: 'アイテム', value: itemsStr, inline: false }
      ]
    };
    if (p.shield_until && new Date(p.shield_until) > new Date())
      embed.fields.push({ name: '🛡 Shield', value: '発動中', inline: true });
    return i.editReply({ embeds: [embed] });
  }

  // /debt
  if (i.commandName === 'debt') {
    const prof = await getProfile(i.user.id);
    if (!prof) return i.editReply('まず `/register`');
    if (i.options.getSubcommand() === 'borrow') {
      if (prof.debt > 0) return i.editReply('返済前に追加借入不可');
      const amt = i.options.getInteger('amount');
      const limit = prof.points * 3;
      if (amt <= 0 || amt > limit) return i.editReply(`借入上限は ${limit}p`);
      const repay = Math.ceil(amt * 1.10);
      await upsertProfile(i.user.id, {
        points: prof.points + amt, debt: repay,
        debt_due: new Date(Date.now() + 7*24*60*60*1000).toISOString()
      });
      return i.editReply(`✅ ${amt}p 借入。返済額 ${repay}p／7日`);
    }
    if (i.options.getSubcommand() === 'repay') {
      if (prof.debt === 0) return i.editReply('借金なし');
      if (prof.points < prof.debt) return i.editReply('ポイント不足');
      await upsertProfile(i.user.id, { points: prof.points - prof.debt, debt: 0, debt_due: null });
      return i.editReply('返済完了！');
    }
  }

  // /shop
  if (i.commandName === 'shop') {
    const embed = {
      title: '🏪 ショップ',
      description: Object.entries(ITEMS).map(([k, v]) => `**${k}** – ${v.price}p`).join('\n')
    };
    return i.editReply({ embeds: [embed] });
  }

  // /buy
  if (i.commandName === 'buy') {
    const key = i.options.getString('item');
    const item = ITEMS[key];
    if (!item) return i.editReply('存在しない商品');
    const prof = await getProfile(i.user.id);
    if (!prof) return i.editReply('まず `/register`');
    if (prof.points < item.price) return i.editReply('ポイント不足');

    // ロール商品
    if (item.type === 'role') {
      await addRole(i.member, item.name);
      await setPrefixNick(i.member, item.name);
      await upsertProfile(i.user.id, { points: prof.points - item.price });
      return i.editReply(`✅ ${item.name} を購入しました`);
    }

    // アイテム
    await addInventory(i.user.id, key, 1);
    await upsertProfile(i.user.id, { points: prof.points - item.price });
    return i.editReply(`✅ ${item.name} を購入。在庫+1`);
  }

  // /use
  if (i.commandName === 'use') {
    const key = i.options.getString('item');
    const item = ITEMS[key];
    if (!item || item.type !== 'consumable')
      return i.editReply('使用できないキー');
    const ok = await useInventory(i.user.id, key);
    if (!ok) return i.editReply('在庫がありません');

    // ----- 効果別処理 -----
    const target = i.options.getUser('target');
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const targetMember = target ? await guild.members.fetch(target.id).catch(()=>null) : null;

    // shield
    if (item.effect === 'shield') {
      const until = new Date(Date.now() + 24*60*60*1000);
      await upsertProfile(i.user.id, { shield_until: until.toISOString() });
      return i.editReply('🛡 シールドを張りました（24h）');
    }

    // scope
    if (item.effect === 'scope') {
      if (!targetMember) return i.editReply('対象が必要');
      const tp = await getProfile(target.id);
      if (tp?.shield_until && new Date(tp.shield_until) > new Date())
        return i.editReply('🟢 相手はシールド中です');
      return i.editReply('⚪ 相手はシールドなし');
    }

    // timeout
    if (item.effect === 'timeout') {
      if (!targetMember) return i.editReply('対象が必要');
      const tp = await getProfile(target.id);
      if (tp?.shield_until && new Date(tp.shield_until) > new Date())
        return i.editReply('相手はシールド中 → 無効');
      await targetMember.timeout(10*60*1000, `Timeout by ${i.user.tag}`).catch(()=>{});
      return i.editReply('⏱ 10分タイムアウトしました');
    }

    // rename_self
    if (item.effect === 'rename_self') {
      const modal = new ModalBuilder()
        .setCustomId(`rename_self:${key}`)
        .setTitle('新しいニックネーム')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('nick')
              .setLabel('Nickname')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(24)
              .setRequired(true)
          )
        );
      await i.showModal(modal);
      return;
    }

    // rename_target
    if (item.effect === 'rename_target') {
      if (!targetMember) return i.editReply('対象が必要');
      const tp = await getProfile(target.id);
      if (tp?.shield_until && new Date(tp.shield_until) > new Date())
        return i.editReply('相手はシールド中 → 無効 (在庫は戻りません)');
      const modal = new ModalBuilder()
        .setCustomId(`rename_target:${key}:${target.id}`)
        .setTitle('新しいニックネーム')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('nick')
              .setLabel('Nickname')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(24)
              .setRequired(true)
          )
        );
      await i.showModal(modal);
      return;
    }

    return i.editReply('使用処理なし');
  }
});

// ───── モーダル Submit
client.on('interactionCreate', async (i) => {
  if (!i.isModalSubmit()) return;
  const [type, key, targetId] = i.customId.split(':');
  const newNick = i.fields.getTextInputValue('nick').slice(0, 24);

  if (type === 'rename_self') {
    await i.member.setNickname(newNick).catch(()=>{});
    await i.reply({ content: '✅ ニックネームを変更しました', ephemeral: true });
  }

  if (type === 'rename_target') {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const mem = await guild.members.fetch(targetId).catch(()=>null);
    if (mem) await mem.setNickname(newNick).catch(()=>{});
    // name_lock_until
    const lockMin = ITEMS[key].lock;
    const until = new Date(Date.now() + lockMin*60*1000).toISOString();
    await upsertProfile(targetId, { name_lock_until: until });
    await i.reply({ content: '✅ 対象の名前を変更しました', ephemeral: true });
  }
});

// ───── 名前ロック中は変更拒否
client.on('guildMemberUpdate', async (_, newM) => {
  const p = await getProfile(newM.id);
  if (!p || !p.name_lock_until) return;
  if (new Date(p.name_lock_until) < new Date()) {
    await upsertProfile(newM.id, { name_lock_until: null });
    return;
  }
  // ニックネーム外部変更を検知 → 差し戻し
  // （簡易実装: 何か変わったら prefix 付きで戻す）
  const pref = newM.displayName.match(/^【.*?】/)?.[0] || '';
  if (!pref) return;
  const base = newM.displayName.replace(/^【.*?】/, '');
  await newM.setNickname(`${pref}${base}`).catch(()=>{});
});

// ───── 7日後自動返済 cron（変更なし）
cron.schedule('0 * * * *', async () => {
  const { data: debtors } = await supabase
    .from('profiles').select('*')
    .gt('debt', 0).lte('debt_due', new Date().toISOString());

  for (const p of debtors) {
    let remaining = p.debt;
    let pts = p.points;
    remaining -= pts;
    pts = Math.max(0, pts - p.debt);

    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const mem = await guild.members.fetch(p.user_id).catch(()=>null);
    if (mem) {
      const sellable = mem.roles.cache
        .filter(r => ROLE_VALUES[r.name] !== undefined && r.name !== 'SLAVE')
        .sort((a,b)=>ROLE_VALUES[a.name]-ROLE_VALUES[b.name]);
      for (const r of sellable.values()) {
        if (remaining <= 0) break;
        remaining -= ROLE_VALUES[r.name];
        await mem.roles.remove(r).catch(()=>{});
      }
      if (remaining > 0) {
        await addRole(mem, 'SLAVE');
        await setPrefixNick(mem, 'SLAVE');
        pts = -remaining; remaining = 0;
      }
    }
    await upsertProfile(p.user_id, { points: pts, debt: remaining,
      debt_due: remaining ? new Date().toISOString() : null });
  }
});

// ───── Express keep-alive
express().get('/',(_,res)=>res.send('alive'))
  .listen(process.env.PORT||3000, ()=>console.log('HTTP up'));

// ───── start
deployCommands().then(()=>client.login(process.env.DISCORD_TOKEN));
