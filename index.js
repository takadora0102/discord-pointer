// 機能：/shop item の表示・購入処理 ＋ /register, /profile 機能
// ※ Supabase連携済、データベース構造：points, item_logs 使用前提

const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, Events } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const itemData = [
  { id: 'rename_self', label: '🎭 名前変更（自分）', price: 1000 },
  { id: 'rename_target_s', label: '🎯 名前変更（他人S）', price: 10000 },
  { id: 'rename_target_a', label: '🎯 名前変更（他人A）', price: 5000 },
  { id: 'rename_target_b', label: '🎯 名前変更（他人B）', price: 3500 },
  { id: 'rename_target_c', label: '🎯 名前変更（他人C）', price: 2000 },
  { id: 'timeout_s', label: '🔨 タイムアウト（S）', price: 10000 },
  { id: 'shield', label: '🛡️ シールド', price: 300 },
  { id: 'scope', label: '🔭 望遠鏡', price: 100 }
];

client.once('ready', () => console.log('Bot Ready'));

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const member = await interaction.guild.members.fetch(userId);

    if (interaction.commandName === 'register') {
      const { data: existing } = await supabase.from('points').select('*').eq('user_id', userId).single();
      if (existing) return interaction.reply({ content: 'すでに登録済みです。', ephemeral: true });

      const role = interaction.guild.roles.cache.find(r => r.name === 'SERF');
      if (role) await member.roles.add(role);
      await member.setNickname(`【SERF】${member.user.username}`).catch(() => {});

      await supabase.from('points').insert({ user_id: userId, point: 1000 });
      return interaction.reply({ content: '登録完了！1000p 付与されました。', ephemeral: true });
    }

    if (interaction.commandName === 'profile') {
      const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
      if (!data) return interaction.reply({ content: '未登録です。/register を先に実行してください。', ephemeral: true });

      const shield = data.shield_until ? `🛡️ シールド有効 (${data.shield_until})` : 'なし';
      const locked = data.name_locked_until ? `⏳ 名前変更不可 (${data.name_locked_until})` : 'なし';

      return interaction.reply({
        content: `💰 所持ポイント: ${data.point}p\n${shield}\n${locked}`,
        ephemeral: true
      });
    }

    if (interaction.commandName === 'shop') {
      const sub = interaction.options.getSubcommand();
      if (sub !== 'item') return;

      if (!member.permissions.has('Administrator')) {
        return interaction.reply({ content: 'このコマンドは管理者のみ使用可能です。', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: false });
      const embed = new EmbedBuilder()
        .setTitle('🛍️ アイテムショップ')
        .setDescription('戦略アイテムを購入して、ポイントバトルを有利に進めよう！');

      itemData.forEach(item => {
        embed.addFields({ name: item.label, value: `価格: ${item.price}p`, inline: true });
      });

      const rows = [];
      for (let i = 0; i < itemData.length; i += 5) {
        rows.push(new ActionRowBuilder().addComponents(
          itemData.slice(i, i + 5).map(item =>
            new ButtonBuilder()
              .setCustomId(`item_${item.id}`)
              .setLabel(item.label)
              .setStyle(ButtonStyle.Secondary))));
      }

      await interaction.editReply({ embeds: [embed], components: rows });
    }
  }
});

const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('ユーザー登録（初期ポイントとロール付与）'),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('自分の所持ポイントやステータスを確認'),
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('ショップを表示')
    .addSubcommand(sub => sub.setName('item').setDescription('アイテムショップを表示'))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    await client.login(TOKEN);
  } catch (e) {
    console.error(e);
  }
})();
if (interaction.isButton() && interaction.customId.startsWith('item_')) {
  const userId = interaction.user.id;
  const itemId = interaction.customId.replace('item_', '');
  const item = itemData.find(i => i.id === itemId);
  if (!item) return interaction.reply({ content: '無効なアイテムです。', ephemeral: true });

  const member = await interaction.guild.members.fetch(userId);
  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
  if (!userData || userData.point < item.price) {
    return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });
  }

  // 使用前に特殊ケース（シールドなど）確認（後で詳細分岐）
  if (['rename_self', 'shield', 'scope'].includes(itemId)) {
    // 即時使用系（第3部で実装）
    return interaction.reply({ content: 'このアイテムは後で使用処理を追加します。', ephemeral: true });
  }

  // 名前変更 or タイムアウトなど対象ユーザーが必要な場合、モーダル表示予定
  return interaction.reply({ content: 'このアイテムは対象ユーザーが必要です。後でモーダル実装します。', ephemeral: true });
}
if (itemId === 'rename_self') {
  const modal = new ModalBuilder()
    .setCustomId('modal_rename_self')
    .setTitle('名前変更（自分）');

  const nameInput = new TextInputBuilder()
    .setCustomId('new_name')
    .setLabel('新しい名前を入力')
    .setStyle(1) // Short
    .setRequired(true)
    .setMaxLength(32);

  const row = new ActionRowBuilder().addComponents(nameInput);
  modal.addComponents(row);
  return interaction.showModal(modal);
}
if (interaction.isModalSubmit() && interaction.customId === 'modal_rename_self') {
  const userId = interaction.user.id;
  const newName = interaction.fields.getTextInputValue('new_name');
  const member = await interaction.guild.members.fetch(userId);

  const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
  if (!data || data.point < 1000) {
    return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });
  }

  // ポイント減算、ニックネーム変更、ログ記録
  const updatedNick = `【${member.displayName.split('】')[0].replace('【', '')}】${newName}`;
  await member.setNickname(updatedNick).catch(() => {});
  await supabase.from('points').update({ point: data.point - 1000 }).eq('user_id', userId);
  await supabase.from('item_logs').insert({
    user_id,
    target_id: userId,
    item_name: 'rename_self',
    result: 'success'
  });

  return interaction.reply({ content: `名前を「${updatedNick}」に変更しました！`, ephemeral: true });
}
if (itemId === 'shield') {
  const now = new Date();
  const shieldUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24時間

  // すでにシールド中かチェック
  if (userData.shield_until && new Date(userData.shield_until) > now) {
    return interaction.reply({ content: 'すでにシールドを展開しています。', ephemeral: true });
  }

  // ポイント減算＋シールド有効化
  await supabase.from('points')
    .update({ point: userData.point - item.price, shield_until: shieldUntil.toISOString() })
    .eq('user_id', userId);

  await supabase.from('item_logs').insert({
    user_id: userId,
    target_id: userId,
    item_name: 'shield',
    result: 'success'
  });

  return interaction.reply({
    content: `🛡️ シールドを展開しました！\n${shieldUntil.toLocaleString()}まで有効です。`,
    ephemeral: true
  });
}
if (itemId === 'scope') {
  const modal = new ModalBuilder()
    .setCustomId('modal_scope')
    .setTitle('🔭 シールド状態確認');

  const targetInput = new TextInputBuilder()
    .setCustomId('target_id')
    .setLabel('対象ユーザーのIDを入力')
    .setStyle(1) // Short
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(targetInput));
  return interaction.showModal(modal);
}
if (interaction.isModalSubmit() && interaction.customId === 'modal_scope') {
  const userId = interaction.user.id;
  const targetId = interaction.fields.getTextInputValue('target_id');

  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
  if (!userData || userData.point < 100) {
    return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });
  }

  const { data: targetData } = await supabase.from('points').select('*').eq('user_id', targetId).single();
  if (!targetData) {
    return interaction.reply({ content: '対象ユーザーが見つかりません。', ephemeral: true });
  }

  // ポイント消費
  await supabase.from('points').update({ point: userData.point - 100 }).eq('user_id', userId);
  await supabase.from('item_logs').insert({
    user_id,
    target_id: targetId,
    item_name: 'scope',
    result: 'success'
  });

  // シールド判定
  const isShielded = targetData.shield_until && new Date(targetData.shield_until) > new Date();
  return interaction.reply({
    content: isShielded
      ? '🔭 このユーザーは現在シールド中です。'
      : '🔭 このユーザーは現在シールドを使用していません。',
    ephemeral: true
  });
}
if (itemId.startsWith('rename_target')) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_${itemId}`)
    .setTitle('🎯 他人の名前変更');

  const targetInput = new TextInputBuilder()
    .setCustomId('target_id')
    .setLabel('対象ユーザーのIDを入力')
    .setStyle(1)
    .setRequired(true);

  const nameInput = new TextInputBuilder()
    .setCustomId('new_name')
    .setLabel('変更後の名前を入力')
    .setStyle(1)
    .setRequired(true)
    .setMaxLength(32);

  modal.addComponents(
    new ActionRowBuilder().addComponents(targetInput),
    new ActionRowBuilder().addComponents(nameInput)
  );
  return interaction.showModal(modal);
}
if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_rename_target')) {
  const userId = interaction.user.id;
  const targetId = interaction.fields.getTextInputValue('target_id');
  const newName = interaction.fields.getTextInputValue('new_name');
  const itemId = interaction.customId.replace('modal_', '');

  const lockMinutes = itemId.endsWith('s') ? 60 : itemId.endsWith('a') ? 30 : itemId.endsWith('b') ? 20 : 10;

  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
  const { data: targetData } = await supabase.from('points').select('*').eq('user_id', targetId).single();

  if (!userData || !targetData) return interaction.reply({ content: '対象ユーザーが存在しません。', ephemeral: true });
  if (userData.point < itemData.find(i => i.id === itemId).price) {
    return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });
  }

  // シールドチェック
  const now = new Date();
  if (targetData.shield_until && new Date(targetData.shield_until) > now) {
    return interaction.reply({ content: '対象ユーザーは現在シールド中のため操作できません。', ephemeral: true });
  }

  const guild = interaction.guild;
  const attacker = await guild.members.fetch(userId);
  const target = await guild.members.fetch(targetId);

  // 成功率判定
  const attackerHighest = attacker.roles.highest.position;
  const targetHighest = target.roles.highest.position;
  const success = attackerHighest >= targetHighest || Math.random() < 0.5;

  if (success) {
    const lockedUntil = new Date(now.getTime() + lockMinutes * 60 * 1000);
    const updatedNick = `【${target.displayName.split('】')[0].replace('【', '')}】${newName}`;
    await target.setNickname(updatedNick).catch(() => {});
    await supabase.from('points')
      .update({
        point: userData.point - itemData.find(i => i.id === itemId).price,
        name_locked_until: lockedUntil.toISOString()
      })
      .eq('user_id', targetId);
    await supabase.from('points')
      .update({ point: userData.point - itemData.find(i => i.id === itemId).price })
      .eq('user_id', userId);
    await supabase.from('item_logs').insert({
      user_id,
      target_id: targetId,
      item_name: itemId,
      result: 'success'
    });
    return interaction.reply({ content: `🎯 名前変更成功！新しい名前は「${updatedNick}」です`, ephemeral: true });
  } else {
    await supabase.from('item_logs').insert({
      user_id,
      target_id: targetId,
      item_name: itemId,
      result: 'fail'
    });
    return interaction.reply({ content: '🎯 失敗！ポイントだけ失われました…', ephemeral: true });
  }
}
if (itemId === 'timeout_s') {
  const modal = new ModalBuilder()
    .setCustomId('modal_timeout_s')
    .setTitle('🔨 タイムアウト使用');

  const targetInput = new TextInputBuilder()
    .setCustomId('target_id')
    .setLabel('対象ユーザーのIDを入力')
    .setStyle(1)
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(targetInput));
  return interaction.showModal(modal);
}
if (interaction.isModalSubmit() && interaction.customId === 'modal_timeout_s') {
  const userId = interaction.user.id;
  const targetId = interaction.fields.getTextInputValue('target_id');

  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
  const { data: targetData } = await supabase.from('points').select('*').eq('user_id', targetId).single();

  if (!userData || !targetData) return interaction.reply({ content: '対象ユーザーが見つかりません。', ephemeral: true });
  if (userData.point < 10000) return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });

  const now = new Date();
  if (targetData.shield_until && new Date(targetData.shield_until) > now) {
    return interaction.reply({ content: '対象はシールド中のためタイムアウトできません。', ephemeral: true });
  }

  const guild = interaction.guild;
  const attacker = await guild.members.fetch(userId);
  const target = await guild.members.fetch(targetId);

  const attackerHighest = attacker.roles.highest.position;
  const targetHighest = target.roles.highest.position;
  const success = attackerHighest >= targetHighest || Math.random() < 0.5;

  if (success) {
    const timeoutMs = 5 * 60 * 1000;
    await target.timeout(timeoutMs).catch(() => {});
    await supabase.from('points').update({ point: userData.point - 10000 }).eq('user_id', userId);
    await supabase.from('item_logs').insert({
      user_id,
      target_id: targetId,
      item_name: 'timeout_s',
      result: 'success'
    });
    return interaction.reply({ content: `🔨 ${target.displayName} を 5分間タイムアウトしました！`, ephemeral: true });
  } else {
    await supabase.from('points').update({ point: userData.point - 10000 }).eq('user_id', userId);
    await supabase.from('item_logs').insert({
      user_id,
      target_id: targetId,
      item_name: 'timeout_s',
      result: 'fail'
    });
    return interaction.reply({ content: '🔨 失敗しました…（上位ロールのため防がれた可能性）', ephemeral: true });
  }
}
