// 必要なインポートと初期設定
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, SelectMenuBuilder } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const cooldowns = new Map();
const activeShields = new Map();

client.once('ready', () => {
  console.log('Bot Ready');
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'buy') {
    const itemId = interaction.options.getString('item');
    const userId = interaction.user.id;
    const itemPrices = {
      rename_self: 1000,
      rename_target_s: 10000,
      rename_target_a: 5000,
      rename_target_b: 3500,
      rename_target_c: 2000,
      timeout_s: 10000,
      shield: 300,
      scope: 100
    };
    const price = itemPrices[itemId];
    if (!price) {
      return interaction.reply({ content: '❌ 無効なアイテムIDです。', ephemeral: true });
    }

    const { data, error } = await supabase
      .from('points')
      .select('point')
      .eq('user_id', userId)
      .single();

    if (error || !data || data.point < price) {
      return interaction.reply({ content: '❌ ポイントが不足しています。', ephemeral: true });
    }

    await supabase
      .from('points')
      .update({ point: data.point - price })
      .eq('user_id', userId);

    await supabase.from('item_logs').insert({
      user_id: userId,
      target_id: null,
      item_name: itemId,
      result: 'purchased',
      used_at: new Date().toISOString()
    });

    return interaction.reply({ content: `🛍️ ${itemId} を ${price}p で購入しました。`, ephemeral: true });
  }

  if (interaction.commandName === 'use') {
    const itemId = interaction.options.getString('item');
    const targetUser = interaction.options.getUser('user');
    const userId = interaction.user.id;
    const now = Date.now();
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ 対象ユーザーが見つかりません。', ephemeral: true });

    const shieldEnd = activeShields.get(targetUser.id);
    const isShielded = shieldEnd && shieldEnd > now;

    if (itemId === 'scope') {
      await supabase.from('item_logs').insert({
        user_id: userId,
        target_id: targetUser.id,
        item_name: itemId,
        result: isShielded ? 'shielded' : 'not_shielded',
        used_at: new Date().toISOString()
      });

      return interaction.reply({
        content: isShielded ? `🔭 ${targetUser.username} は現在シールド中です。` : `🔭 ${targetUser.username} はシールド未使用です。`,
        ephemeral: true
      });
    }

    if (['rename_target_s', 'rename_target_a', 'rename_target_b', 'rename_target_c'].includes(itemId)) {
      if (isShielded) {
        return interaction.reply({ content: '🛡️ 相手は現在シールド中です。', ephemeral: true });
      }

      const lockMin = { rename_target_s: 60, rename_target_a: 30, rename_target_b: 20, rename_target_c: 10 }[itemId];

      const cdKey = `${itemId}-${targetUser.id}`;
      if (cooldowns.get(cdKey) > now) {
        return interaction.reply({ content: '⏳ クールタイム中です。', ephemeral: true });
      }

      cooldowns.set(cdKey, now + lockMin * 60000);

      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`rename_target_modal-${targetUser.id}`)
          .setTitle('相手の新しいニックネーム')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('nickname')
                .setLabel('新しいニックネーム')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(10)
                .setRequired(true)
            )
          )
      );
    }
    if (itemId === 'timeout_s') {
      if (isShielded) {
        return interaction.reply({ content: '🛡️ 相手は現在シールド中です。', ephemeral: true });
      }

      await member.timeout(5 * 60 * 1000, 'タイムアウトアイテム使用');

      await supabase.from('item_logs').insert({
        user_id: userId,
        target_id: targetUser.id,
        item_name: itemId,
        result: 'used',
        used_at: new Date().toISOString()
      });

      return interaction.reply({ content: `⏱️ ${targetUser.username} をタイムアウトしました。`, ephemeral: true });
    }

    if (itemId === 'shield') {
      activeShields.set(userId, now + 24 * 60 * 60 * 1000); // 24時間

      await supabase.from('item_logs').insert({
        user_id: userId,
        target_id: null,
        item_name: itemId,
        result: 'used',
        used_at: new Date().toISOString()
      });

      return interaction.reply({ content: '🛡️ シールドを使用しました（24時間有効）', ephemeral: true });
    }

    if (itemId === 'rename_self') {
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId('rename_self_modal')
          .setTitle('自分の新しいニックネーム')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('nickname')
                .setLabel('新しいニックネーム')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(10)
                .setRequired(true)
            )
          )
      );
    }
  }

  if (interaction.isModalSubmit()) {
    const now = Date.now();
    if (interaction.customId === 'rename_self_modal') {
      const name = interaction.fields.getTextInputValue('nickname');
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.setNickname(name);

      await supabase.from('item_logs').insert({
        user_id: interaction.user.id,
        target_id: null,
        item_name: 'rename_self',
        result: 'used',
        used_at: new Date().toISOString()
      });

      return interaction.reply({ content: `✅ 名前を ${name} に変更しました。`, ephemeral: true });
    }

    if (interaction.customId.startsWith('rename_target_modal')) {
      const name = interaction.fields.getTextInputValue('nickname');
      const targetId = interaction.customId.split('-')[1];
      const member = await interaction.guild.members.fetch(targetId);
      await member.setNickname(name);

      await supabase.from('item_logs').insert({
        user_id: interaction.user.id,
        target_id: targetId,
        item_name: 'rename_target_custom',
        result: 'used',
        used_at: new Date().toISOString()
      });

      return interaction.reply({ content: `✅ 相手の名前を ${name} に変更しました。`, ephemeral: true });
    }
  }
});
