const { Client, GatewayIntentBits, Partials, ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const cooldowns = new Map();
const activeShields = new Map();

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const now = Date.now();

  if (interaction.commandName === 'use') {
    const itemId = interaction.options.getString('item');
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) return interaction.reply({ content: '❌ 対象ユーザーが指定されていません。', ephemeral: true });

    await supabase.from('item_logs').insert({
      user_id: interaction.user.id,
      target_id: targetUser.id,
      item: itemId,
      used_at: new Date().toISOString()
    });

    if (itemId === 'scope') {
      const shieldEnd = activeShields.get(targetUser.id);
      const isShielded = shieldEnd && shieldEnd > now;
      return interaction.reply({
        content: isShielded ? `🔭 ${targetUser.username} は現在シールド中です。` : `🔭 ${targetUser.username} はシールド未使用です。`,
        ephemeral: true
      });
    }
    if (itemId.startsWith('rename_target_')) {
      const lockMin = {
        rename_target_s: 60,
        rename_target_a: 30,
        rename_target_b: 20,
        rename_target_c: 10
      }[itemId] || 10;

      if (activeShields.get(targetUser.id) > now) {
        return interaction.reply({ content: '🛡️ 相手はシールド中です。', ephemeral: true });
      }

      const cdKey = `${itemId}-${targetUser.id}`;
      if (cooldowns.get(cdKey) > now) {
        return interaction.reply({ content: '⏳ クールタイム中です。', ephemeral: true });
      }

      cooldowns.set(cdKey, now + lockMin * 60000);

      return interaction.showModal(new ModalBuilder()
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
        ));
    }

    if (itemId === 'timeout_s') {
      if (activeShields.get(targetUser.id) > now) {
        return interaction.reply({ content: '🛡️ 相手はシールド中です。', ephemeral: true });
      }

      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(5 * 60 * 1000, 'タイムアウトアイテム使用');
      return interaction.reply({ content: `⏱️ ${targetUser.username} をタイムアウトしました。`, ephemeral: true });
    }
  }
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
      item: itemId,
      used_at: new Date().toISOString()
    });

    return interaction.reply({ content: `🛍️ ${itemId} を ${price}p で購入しました。`, ephemeral: true });
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'rename_self_modal') {
      const name = interaction.fields.getTextInputValue('nickname');
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.setNickname(name);
      return interaction.reply({ content: `✅ 名前を ${name} に変更しました。`, ephemeral: true });
    }

    if (interaction.customId.startsWith('rename_target_modal')) {
      const name = interaction.fields.getTextInputValue('nickname');
      const targetId = interaction.customId.split('-')[1];
      const member = await interaction.guild.members.fetch(targetId);
      await member.setNickname(name);
      return interaction.reply({ content: `✅ 相手の名前を ${name} に変更しました。`, ephemeral: true });
    }
  }
});
client.login(process.env.DISCORD_TOKEN);
