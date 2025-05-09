// 軽量＆安定化：アイテムショップ構成（ロールショップ構造ベース）

const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } = require('discord.js');
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

const items = {
  rename_self: { name: '名前変更（自分）', price: 1000 },
  shield: { name: 'シールド', price: 300 },
  scope: { name: '望遠鏡', price: 100 }
};

client.once('ready', () => console.log('Bot Ready'));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;

  if (interaction.commandName === 'shop') {
    await interaction.deferReply({ ephemeral: true });
    const shopText = Object.entries(items).map(([key, item]) => `/${"buy"} item:${key} → ${item.name}（${item.price}p）`).join('\n');
    return interaction.editReply(`🛍️ アイテムショップ一覧\n\n${shopText}`);
  }

  if (interaction.commandName === 'buy') {
    await interaction.deferReply({ ephemeral: true });

    const itemId = interaction.options.getString('item');
    const item = items[itemId];
    if (!item) return interaction.editReply('❌ 無効なアイテムです。');

    const { data: userData, error } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (error || !userData) return interaction.editReply('❌ ユーザーが未登録です。');
    if (userData.point < item.price) return interaction.editReply('❌ ポイントが不足しています。');

    const newPoint = userData.point - item.price;
    const { error: updateError } = await supabase.from('points').update({ point: newPoint }).eq('user_id', userId);
    if (updateError) return interaction.editReply('❌ 購入処理に失敗しました。');

    return interaction.editReply(`✅ ${item.name} を購入しました！残り: ${newPoint}p`);
  }
});

const commands = [
  new SlashCommandBuilder().setName('shop').setDescription('ショップを表示'),
  new SlashCommandBuilder().setName('buy')
    .setDescription('アイテムを購入')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('購入するアイテムを選択')
        .setRequired(true)
        .addChoices(
          { name: '名前変更（自分）', value: 'rename_self' },
          { name: 'シールド', value: 'shield' },
          { name: '望遠鏡', value: 'scope' }
        )
    )
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
