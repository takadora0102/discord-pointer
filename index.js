const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, Events } = require('discord.js');
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
  { id: 'rename_target_s', label: '🎯 名前変更（他人S）', price: 10000, lockMin: 60 },
  { id: 'rename_target_a', label: '🎯 名前変更（他人A）', price: 5000, lockMin: 30 },
  { id: 'rename_target_b', label: '🎯 名前変更（他人B）', price: 3500, lockMin: 20 },
  { id: 'rename_target_c', label: '🎯 名前変更（他人C）', price: 2000, lockMin: 10 },
  { id: 'timeout_s', label: '🔨 タイムアウト（S）', price: 10000 },
  { id: 'shield', label: '🛡️ シールド', price: 300 },
  { id: 'scope', label: '🔭 望遠鏡', price: 100 }
];

client.once('ready', () => console.log('Bot Ready'));
client.on(Events.InteractionCreate, async interaction => {
  const userId = interaction.user.id;
  const member = await interaction.guild.members.fetch(userId);

  // /register
  if (interaction.isChatInputCommand() && interaction.commandName === 'register') {
    await interaction.deferReply({ ephemeral: true });

    const { data: existing } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (existing) return interaction.editReply({ content: 'すでに登録済みです。' });

    const role = interaction.guild.roles.cache.find(r => r.name === 'SERF');
    if (role) await member.roles.add(role);
    await member.setNickname(`【SERF】${member.user.username}`).catch(() => {});

    await supabase.from('points').insert({ user_id: userId, point: 1000 });
    return interaction.editReply({ content: '登録完了！1000p 付与されました。' });
  }

  // /profile
  if (interaction.isChatInputCommand() && interaction.commandName === 'profile') {
    await interaction.deferReply({ ephemeral: true });

    const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!data) return interaction.editReply({ content: '未登録です。/register を先に実行してください。' });

    const shield = data.shield_until ? `🛡️ シールド有効 (${data.shield_until})` : 'なし';
    const locked = data.name_locked_until ? `⏳ 名前変更不可 (${data.name_locked_until})` : 'なし';

    return interaction.editReply({
      content: `💰 所持ポイント: ${data.point}p\n${shield}\n${locked}`
    });
  }

  // /shop item
  if (interaction.isChatInputCommand() && interaction.commandName === 'shop') {
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
            .setStyle(ButtonStyle.Secondary))
      ));
    }

    await interaction.editReply({ embeds: [embed], components: rows });
  }

  // ボタン処理（defer不要：ボタンは即時反応）
  if (interaction.isButton() && interaction.customId.startsWith('item_')) {
    const itemId = interaction.customId.replace('item_', '');
    const item = itemData.find(i => i.id === itemId);
    if (!item) return interaction.reply({ content: '無効なアイテムです。', ephemeral: true });

    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!userData || userData.point < item.price) {
      return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });
    }
    // 🎭 名前変更（自分）
    if (itemId === 'rename_self') {
      const modal = new ModalBuilder()
        .setCustomId('modal_rename_self')
        .setTitle('名前変更（自分）')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('new_name')
              .setLabel('新しい名前を入力')
              .setStyle(1)
              .setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    // 🛡️ シールド
    if (itemId === 'shield') {
      const now = new Date();
      const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      if (userData.shield_until && new Date(userData.shield_until) > now) {
        return interaction.reply({ content: 'すでにシールド中です。', ephemeral: true });
      }

      await supabase.from('points').update({
        point: userData.point - item.price,
        shield_until: until.toISOString()
      }).eq('user_id', userId);

      await supabase.from('item_logs').insert({ user_id, target_id: userId, item_name: 'shield', result: 'success' });

      return interaction.reply({ content: '🛡️ シールドを展開しました。', ephemeral: true });
    }

    // 🔭 scope（シールド確認）
    if (itemId === 'scope') {
      const modal = new ModalBuilder()
        .setCustomId('modal_scope')
        .setTitle('🔭 シールド確認')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('target_id')
              .setLabel('対象ユーザーのID')
              .setStyle(1)
              .setRequired(true)
          )
        );
      return interaction.showModal(modal);
    }

    // 🎯 他人名変更・🔨タイムアウト（対象指定）
    if (itemId.startsWith('rename_target') || itemId === 'timeout_s') {
      const modal = new ModalBuilder()
        .setCustomId(`modal_${itemId}`)
        .setTitle('対象ユーザーを指定')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('target_id')
              .setLabel('対象ユーザーのID')
              .setStyle(1)
              .setRequired(true)
          ),
          ...(itemId !== 'timeout_s' ? [new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('new_name')
              .setLabel('新しい名前')
              .setStyle(1)
              .setRequired(true)
          )] : [])
        );
      return interaction.showModal(modal);
    }
  } // ← ボタン処理ここまで
  // 🎭 モーダル：rename_self
  if (interaction.isModalSubmit() && interaction.customId === 'modal_rename_self') {
    await interaction.deferReply({ ephemeral: true });

    const newName = interaction.fields.getTextInputValue('new_name');
    const member = await interaction.guild.members.fetch(userId);
    const updatedNick = `【${member.displayName.split('】')[0].replace('【', '')}】${newName}`;
    await member.setNickname(updatedNick).catch(() => {});

    const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
    await supabase.from('points').update({ point: data.point - 1000 }).eq('user_id', userId);
    await supabase.from('item_logs').insert({ user_id, target_id: userId, item_name: 'rename_self', result: 'success' });

    return interaction.editReply({ content: `✅ 名前を「${updatedNick}」に変更しました。` });
  }

  // 🔭 scope モーダル
  if (interaction.isModalSubmit() && interaction.customId === 'modal_scope') {
    await interaction.deferReply({ ephemeral: true });

    const targetId = interaction.fields.getTextInputValue('target_id');
    const { data: targetData } = await supabase.from('points').select('*').eq('user_id', targetId).single();
    const now = new Date();
    const shielded = targetData && targetData.shield_until && new Date(targetData.shield_until) > now;

    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (userData.point < 100) return interaction.editReply({ content: 'ポイントが不足しています。' });

    await supabase.from('points').update({ point: userData.point - 100 }).eq('user_id', userId);
    await supabase.from('item_logs').insert({ user_id, target_id: targetId, item_name: 'scope', result: 'success' });

    return interaction.editReply({
      content: shielded ? '🔭 このユーザーは現在シールド中です。' : '🔭 このユーザーはシールドを使っていません。'
    });
  }

  // 🎯 / 🔨 モーダル：他人名変更・タイムアウト
  if (interaction.isModalSubmit() && (interaction.customId.startsWith('modal_rename_target') || interaction.customId === 'modal_timeout_s')) {
    await interaction.deferReply({ ephemeral: true });

    const targetId = interaction.fields.getTextInputValue('target_id');
    const newName = interaction.fields.getTextInputValue('new_name'); // タイムアウトは存在しないがundefinedでもOK
    const target = await interaction.guild.members.fetch(targetId);
    const attacker = await interaction.guild.members.fetch(userId);
    const attackerHighest = attacker.roles.highest.position;
    const targetHighest = target.roles.highest.position;
    const success = attackerHighest >= targetHighest || Math.random() < 0.5;

    const now = new Date();
    const itemId = interaction.customId.replace('modal_', '');
    const item = itemData.find(i => i.id === itemId);

    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (userData.point < item.price) return interaction.editReply({ content: 'ポイントが不足しています。' });

    const { data: targetData } = await supabase.from('points').select('*').eq('user_id', targetId).single();
    if (targetData && targetData.shield_until && new Date(targetData.shield_until) > now) {
      return interaction.editReply({ content: '相手がシールド中のため使用できません。' });
    }

    let result = 'fail';
    if (success) {
      if (itemId.startsWith('rename_target')) {
        const updatedNick = `【${target.displayName.split('】')[0].replace('【', '')}】${newName}`;
        const until = new Date(now.getTime() + item.lockMin * 60000);
        await target.setNickname(updatedNick).catch(() => {});
        await supabase.from('points').update({ name_locked_until: until.toISOString() }).eq('user_id', targetId);
      } else if (itemId === 'timeout_s') {
        await target.timeout(5 * 60 * 1000).catch(() => {});
      }
      result = 'success';
    }

    await supabase.from('points').update({ point: userData.point - item.price }).eq('user_id', userId);
    await supabase.from('item_logs').insert({ user_id, target_id: targetId, item_name: itemId, result });

    return interaction.editReply({
      content: success ? '✅ 成功！相手に効果を適用しました。' : '❌ 失敗！ポイントは消費されました。'
    });
  }
});
const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('ユーザー登録（初期ポイントとロール配布）'),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('自分の所持ポイントや状態を確認する'),
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('ショップを表示')
    .addSubcommand(sub => sub.setName('item').setDescription('アイテムショップ'))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    await client.login(TOKEN);
  } catch (e) {
    console.error(e);
  }
})();
