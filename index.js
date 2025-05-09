// 修正版：Interaction has already been acknowledged エラー回避済み

const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, StringSelectMenuBuilder,
  ActionRowBuilder, ModalBuilder, TextInputBuilder, Events
} = require('discord.js');
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
  { id: 'rename_self', label: '🎭 名前変更（自分）', description: '名前を変更できます（1000p）', price: 1000 },
  { id: 'shield', label: '🛡️ シールド', description: '24時間守ります（300p）', price: 300 },
  { id: 'scope', label: '🔭 望遠鏡', description: '相手のシールド状態を確認（100p）', price: 100 }
];

client.once('ready', () => {
  console.log('Bot Ready');
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'shop') {
      await interaction.deferReply();
      const embed = new EmbedBuilder()
        .setTitle('🛍️ アイテムショップ')
        .setDescription('購入するアイテムを選んでください。');

      const menu = new StringSelectMenuBuilder()
        .setCustomId('shop_menu')
        .setPlaceholder('アイテムを選択')
        .addOptions(
          itemData.map(item => ({
            label: item.label,
            description: item.description,
            value: item.id
          }))
        );

      const row = new ActionRowBuilder().addComponents(menu);
      await interaction.editReply({ embeds: [embed], components: [row] });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'shop_menu') {
      const userId = interaction.user.id;
      const selectedItemId = interaction.values[0];
      const item = itemData.find(i => i.id === selectedItemId);

      if (!item) return interaction.reply({ content: '無効なアイテムです。', ephemeral: true });

      const { data: user } = await supabase.from('points').select('*').eq('user_id', userId).single();
      if (!user || user.point < item.price) {
        return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });
      }

      if (item.id === 'rename_self') {
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

      if (item.id === 'shield') {
        const now = new Date();
        const until = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        if (user.shield_until && new Date(user.shield_until) > now) {
          return interaction.reply({ content: 'すでにシールド中です。', ephemeral: true });
        }

        await supabase.from('points').update({
          point: user.point - item.price,
          shield_until: until.toISOString()
        }).eq('user_id', userId);

        return interaction.reply({ content: '🛡️ シールドを展開しました！', ephemeral: true });
      }

      if (item.id === 'scope') {
        const modal = new ModalBuilder()
          .setCustomId('modal_scope')
          .setTitle('🔭 シールド確認')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('target_id')
                .setLabel('対象ユーザーのIDを入力')
                .setStyle(1)
                .setRequired(true)
            )
          );
        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      const userId = interaction.user.id;

      if (interaction.customId === 'modal_rename_self') {
        await interaction.deferReply({ ephemeral: true });

        const newName = interaction.fields.getTextInputValue('new_name');
        const member = await interaction.guild.members.fetch(userId);
        const newNick = `【${member.displayName.split('】')[0].replace('【', '')}】${newName}`;

        await member.setNickname(newNick).catch(() => {});
        const { data: user } = await supabase.from('points').select('*').eq('user_id', userId).single();

        await supabase.from('points').update({ point: user.point - 1000 }).eq('user_id', userId);

        return interaction.editReply({ content: `✅ 名前を「${newNick}」に変更しました。` });
      }

      if (interaction.customId === 'modal_scope') {
        await interaction.deferReply({ ephemeral: true });

        const targetId = interaction.fields.getTextInputValue('target_id');
        const { data: target } = await supabase.from('points').select('*').eq('user_id', targetId).single();
        const now = new Date();
        const shielded = target && target.shield_until && new Date(target.shield_until) > now;

        await supabase.from('points').update({ point: supabase.literal('point - 100') }).eq('user_id', userId);

        return interaction.editReply({
          content: shielded ? '🔭 相手は現在シールド中です。' : '🔭 相手はシールドを使っていません。'
        });
      }
    }
  } catch (err) {
    console.error('💥 インタラクション処理中にエラー:', err);
  }
});

const commands = [
  new SlashCommandBuilder().setName('shop').setDescription('ショップを開く')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    await client.login(TOKEN);
  } catch (err) {
    console.error('💥 起動時のエラー:', err);
  }
})();