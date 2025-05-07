const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const roleSettings = {
  'slave': { point: 1, limit: 20 },
  'serf': { point: 5, limit: 20 },
  'Freeman': { point: 10, limit: 30 },
  'low noble': { point: 20, limit: 40 },
  'high noble': { point: 30, limit: 50 },
  'Queen': { point: 50, limit: Infinity },
  'king': { point: 50, limit: Infinity },
  'Emperor': { point: 50, limit: Infinity }
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log('Bot Ready');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const member = await message.guild.members.fetch(userId);
  const roles = member.roles.cache.map(r => r.name);
  const matchedRole = roles.find(role => roleSettings[role]);
  if (!matchedRole) return;

  const { point, limit } = roleSettings[matchedRole];
  const today = new Date().toISOString().split('T')[0];

  const { data: logData, error: logError } = await supabase
    .from('message_log')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

  let count = logData?.count || 0;
  let lastTimestamp = logData?.updated_at ? new Date(logData.updated_at).getTime() : 0;

  if (count >= limit) return;
  if (Date.now() - lastTimestamp < 60000) return;

  const { data: pointData } = await supabase
    .from('points')
    .select('*')
    .eq('user_id', userId)
    .single();

  const newPoint = (pointData?.point || 0) + point;
  if (!pointData) {
    await supabase.from('points').insert({
      user_id: userId,
      point: newPoint,
      debt: 0,
      due: null
    });
  } else {
    await supabase.from('points').update({ point: newPoint }).eq('user_id', userId);
  }

  if (!logData) {
    await supabase.from('message_log').insert({
      user_id: userId,
      date: today,
      count: 1
    });
  } else {
    await supabase
      .from('message_log')
      .update({ count: count + 1 })
      .eq('user_id', userId)
      .eq('date', today);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  if (interaction.commandName === 'register') {
    // 登録済みか確認
    const { data: existing, error } = await supabase
      .from('points')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    if (existing) {
      await interaction.reply({ content: '既に登録されています。再登録はできません。', ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(userId);
    const roleName = 'serf';
    const role = interaction.guild.roles.cache.find(r => r.name === roleName);
    if (role) await member.roles.add(role);

    // ニックネームの設定
    const originalName = member.nickname || member.user.username;
    const newNickname = `【${roleName}】${originalName}`;
    await member.setNickname(newNickname).catch(console.error);

    // 初回登録
    await supabase.from('points').insert({
      user_id: userId,
      point: 1000,
      debt: 0,
      due: null
    });

    await interaction.reply({ content: '登録完了！初期ポイント1000pとserfロール、ニックネームを付与しました。', ephemeral: true });

  } else if (interaction.commandName === 'profile') {
    const { data, error } = await supabase
      .from('points')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      await interaction.reply({ content: '登録されていません。/registerを実行してください。', ephemeral: true });
    } else {
      await interaction.reply({
        content: `所持ポイント: ${data.point}p\n借金: ${data.debt}p\n返済期限: ${data.due || 'なし'}`,
        ephemeral: true
      });
    }
  }
});

const commands = [
  new SlashCommandBuilder().setName('register').setDescription('ユーザー登録を行います'),
  new SlashCommandBuilder().setName('profile').setDescription('現在のポイントを確認します')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Slash commands registered');
    client.login(TOKEN);
  } catch (err) {
    console.error(err);
  }
})();

const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord BOT is running\n');
}).listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});