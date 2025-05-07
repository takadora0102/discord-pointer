const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const http = require('http');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const roleSettings = {
  'slave': { price: 0, payout: 1, limit: 20 },
  'serf': { price: 0, payout: 5, limit: 20 },
  'Freeman': { price: 10000, payout: 10, limit: 30 },
  'low noble': { price: 50000, payout: 20, limit: 40 },
  'high noble': { price: 250000, payout: 30, limit: 50 },
  'Queen': { price: 500000, payout: 50, limit: Infinity },
  'king': { price: 500000, payout: 50, limit: Infinity },
  'Emperor': { price: 1000000, payout: 50, limit: Infinity }
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

  const { payout, limit } = roleSettings[matchedRole];
  const today = new Date().toISOString().split('T')[0];

  const { data: logData } = await supabase
    .from('message_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();

  let count = logData?.count || 0;
  let lastTimestamp = logData?.updated_at ? new Date(logData.updated_at).getTime() : 0;
  if (count >= limit || Date.now() - lastTimestamp < 60000) return;

  const { data: pointData } = await supabase
    .from('points')
    .select('*')
    .eq('user_id', userId)
    .single();

  const newPoint = (pointData?.point || 0) + payout;
  if (!pointData) {
    await supabase.from('points').insert({ user_id: userId, point: newPoint, debt: 0, due: null });
  } else {
    await supabase.from('points').update({ point: newPoint }).eq('user_id', userId);
  }

  if (!logData) {
    const { error } = await supabase.from('message_logs').insert({ user_id: userId, date: today, count: 1 });
    if (error) console.error('insert error:', error);
  } else {
    const { error } = await supabase.from('message_logs')
      .update({ count: count + 1 })
      .eq('user_id', userId)
      .eq('date', today);
    if (error) console.error('update error:', error);
  }
});
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;

  await interaction.deferReply({ ephemeral: true });

  const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();

  if (interaction.commandName === 'register') {
    if (data) {
      return interaction.editReply({ content: '既に登録されています。' });
    }

    const member = await interaction.guild.members.fetch(userId);
    const role = interaction.guild.roles.cache.find(r => r.name === 'serf');
    if (role) await member.roles.add(role);

    const newNick = `【serf】${member.user.username}`;
    await member.setNickname(newNick).catch(console.error);

    await supabase.from('points').insert({
      user_id: userId,
      point: 1000,
      debt: 0,
      due: null
    });

    return interaction.editReply({ content: '登録完了！1000pを付与しました。' });
  }

  if (interaction.commandName === 'profile') {
    if (!data) {
      return interaction.editReply({ content: '登録されていません。' });
    }

    const debtText = data.debt ? `${Math.ceil(data.debt * 1.1)}p` : 'なし';
    const dueText = data.due ? data.due : 'なし';

    return interaction.editReply({
      content: `所持ポイント: ${data.point}p\n借金（返済総額）: ${debtText}\n返済期限: ${dueText}`
    });
  }
});
const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('初回登録を行います'),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('所持ポイントと借金状況を確認します')
].map(cmd => cmd.toJSON());

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
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is alive!');
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});
