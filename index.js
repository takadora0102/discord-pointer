const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const cooldowns = new Map();
const activeShields = new Map();

const commands = [
  new SlashCommandBuilder()
    .setName('buy')
    .setDescription('アイテムを購入します')
    .addStringOption(option => option.setName('item').setDescription('アイテムID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('use')
    .setDescription('アイテムを使用します')
    .addStringOption(option => option.setName('item').setDescription('アイテムID').setRequired(true))
    .addUserOption(option => option.setName('user').setDescription('対象ユーザー')),
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('アイテムショップの商品一覧を表示します')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('✅ Slashコマンド登録完了');
  } catch (err) {
    console.error(err);
  }
})();
client.on('interactionCreate', async interaction => {
  const now = Date.now();

  if (interaction.commandName === 'shop') {
    const items = [
      { id: 'rename_self', name: '📝 自分の名前変更', price: 1000 },
      { id: 'rename_target_s', name: '🎯 他人の名前変更(S) - 1h', price: 10000 },
      { id: 'rename_target_a', name: '🎯 他人の名前変更(A) - 30m', price: 5000 },
      { id: 'rename_target_b', name: '🎯 他人の名前変更(B) - 20m', price: 3500 },
      { id: 'rename_target_c', name: '🎯 他人の名前変更(C) - 10m', price: 2000 },
      { id: 'timeout_s', name: '⏱️ タイムアウト (5分)', price: 10000 },
      { id: 'shield', name: '🛡️ シールド (24時間)', price: 300 },
      { id: 'scope', name: '🔭 望遠鏡 (シールド確認)', price: 100 }
    ];
    const embed = {
      title: '🛍️ アイテムショップ',
      description: items.map(i => `${i.name}\nID: \`${i.id}\`｜価格: **${i.price}p**`).join('\n\n'),
      color: 0x00bfff
    };
    await interaction.reply({ embeds: [embed], ephemeral: true });
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
    const { data, error } = await supabase.from('points').select('point').eq('user_id', userId).single();
    if (!price || error || !data || data.point < price) {
      return interaction.reply({ content: '❌ 購入失敗：ポイント不足または無効なID', ephemeral: true });
    }
    await supabase.from('points').update({ point: data.point - price }).eq('user_id', userId);
    await supabase.from('item_logs').insert({
      user_id: userId,
      item: itemId,
      used_at: new Date().toISOString()
    });
    return interaction.reply({ content: `🛒 \`${itemId}\` を ${price}p で購入しました`, ephemeral: true });
  }
  if (interaction.commandName === 'use') {
    const itemId = interaction.options.getString('item');
    const targetUser = interaction.options.getUser('user');
    const now = Date.now();

    if (['rename_target_s', 'rename_target_a', 'rename_target_b', 'rename_target_c', 'timeout_s', 'scope', 'shield'].includes(itemId) && !targetUser) {
      return interaction.reply({ content: '❌ 対象ユーザーを指定してください。', ephemeral: true });
    }

    if (itemId === 'shield') {
      activeShields.set(interaction.user.id, now + 24 * 60 * 60 * 1000);
      await supabase.from('item_logs').insert({
        user_id: interaction.user.id,
        item: itemId,
        target_id: interaction.user.id,
        used_at: new Date().toISOString()
      });
      return interaction.reply({ content: '🛡️ シールドを使用しました（24時間）', ephemeral: true });
    }

    if (itemId === 'scope') {
      const shieldEnd = activeShields.get(targetUser.id);
      const isShielded = shieldEnd && shieldEnd > now;
      await supabase.from('item_logs').insert({
        user_id: interaction.user.id,
        item: itemId,
        target_id: targetUser.id,
        used_at: new Date().toISOString()
      });
      return interaction.reply({
        content: isShielded ? `🔭 ${targetUser.username} は現在🛡️シールド中です。` : `🔭 ${targetUser.username} は🛡️シールドを使用していません。`,
        ephemeral: true
      });
    }

    if (itemId.startsWith('rename_target_')) {
      const lockMin = { rename_target_s: 60, rename_target_a: 30, rename_target_b: 20, rename_target_c: 10 }[itemId];
      const shieldEnd = activeShields.get(targetUser.id);
      if (shieldEnd && shieldEnd > now) {
        return interaction.reply({ content: '🛡️ 相手はシールド中です。', ephemeral: true });
      }
      const cdKey = `${itemId}-${targetUser.id}`;
      if (cooldowns.get(cdKey) > now) {
        return interaction.reply({ content: '⏳ 対象ユーザーは現在クールタイム中です。', ephemeral: true });
      }
      cooldowns.set(cdKey, now + lockMin * 60000);
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(`rename_target_modal-${targetUser.id}`)
          .setTitle('相手の名前変更')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('nickname')
                .setLabel('新しいニックネーム')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(20)
                .setRequired(true)
            )
          )
      );
    }

    if (itemId === 'timeout_s') {
      const shieldEnd = activeShields.get(targetUser.id);
      if (shieldEnd && shieldEnd > now) {
        return interaction.reply({ content: '🛡️ 相手はシールド中です。', ephemeral: true });
      }
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(5 * 60 * 1000, 'アイテム使用によるタイムアウト');
      await supabase.from('item_logs').insert({
        user_id: interaction.user.id,
        item: itemId,
        target_id: targetUser.id,
        used_at: new Date().toISOString()
      });
      return interaction.reply({ content: `⏱️ ${targetUser.username} を5分間タイムアウトしました。`, ephemeral: true });
    }

    if (itemId === 'rename_self') {
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId('rename_self_modal')
          .setTitle('自分の名前変更')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('nickname')
                .setLabel('新しいニックネーム')
                .setStyle(TextInputStyle.Short)
                .setMaxLength(20)
                .setRequired(true)
            )
          )
      );
    }
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'rename_self_modal') {
      const newName = interaction.fields.getTextInputValue('nickname');
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.setNickname(newName);
      await supabase.from('item_logs').insert({
        user_id: interaction.user.id,
        item: 'rename_self',
        target_id: interaction.user.id,
        used_at: new Date().toISOString()
      });
      return interaction.reply({ content: `✅ 自分のニックネームを「${newName}」に変更しました。`, ephemeral: true });
    }

    if (interaction.customId.startsWith('rename_target_modal')) {
      const targetId = interaction.customId.split('-')[1];
      const newName = interaction.fields.getTextInputValue('nickname');
      const member = await interaction.guild.members.fetch(targetId);
      await member.setNickname(newName);
      await supabase.from('item_logs').insert({
        user_id: interaction.user.id,
        item: 'rename_target',
        target_id: targetId,
        used_at: new Date().toISOString()
      });
      return interaction.reply({ content: `✅ 対象ユーザーのニックネームを「${newName}」に変更しました。`, ephemeral: true });
    }
  }
});

client.once('ready', () => {
  console.log('Bot Ready');
});

client.login(process.env.DISCORD_TOKEN);
