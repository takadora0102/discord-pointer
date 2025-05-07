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
    .from('message_log')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .single();

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
    await supabase.from('message_log').insert({ user_id: userId, date: today, count: 1 });
  } else {
    await supabase.from('message_log').update({ count: count + 1 }).eq('user_id', userId).eq('date', today);
  }
});

async function updateNickname(member, roleName) {
  const base = member.user.username;
  const newNick = `【${roleName}】${base}`;
  await member.setNickname(newNick).catch(console.error);
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;

  await autoRepay(userId, interaction.guild);

  if (interaction.commandName === 'register') {
    const { data: existing } = await supabase.from('points').select('user_id').eq('user_id', userId).single();
    if (existing) return interaction.reply({ content: '既に登録されています。', ephemeral: true });

    const member = await interaction.guild.members.fetch(userId);
    const role = interaction.guild.roles.cache.find(r => r.name === 'serf');
    if (role) await member.roles.add(role);
    await updateNickname(member, 'serf');

    await supabase.from('points').insert({
      user_id: userId,
      point: 1000,
      debt: 0,
      due: null
    });

    await interaction.reply({ content: '登録完了！1000pを付与しました。', ephemeral: true });
  } else if (interaction.commandName === 'profile') {
    const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!data) return interaction.reply({ content: '登録されていません。', ephemeral: true });

    const debtText = data.debt ? `${data.debt}p` : 'なし';
    const dueText = data.due ? data.due : 'なし';

    await interaction.reply({
      content: `所持ポイント: ${data.point}p\n借金: ${debtText}\n返済期限: ${dueText}`,
      ephemeral: true
    });

  } else if (interaction.commandName === 'debt') {
    const action = interaction.options.getString('action');
    const amount = interaction.options.getInteger('amount');
    const member = await interaction.guild.members.fetch(userId);

    const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!data) return interaction.reply({ content: '登録されていません。', ephemeral: true });

    if (action === 'borrow') {
      if (data.debt > 0) return interaction.reply({ content: 'すでに借金があります。', ephemeral: true });
      if (amount > data.point * 3) return interaction.reply({ content: '所持ポイントの3倍を超えています。', ephemeral: true });

      const dueDate = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      await supabase.from('points').update({
        debt: amount,
        due: dueDate,
        point: data.point + amount
      }).eq('user_id', userId);

      await interaction.reply({ content: `${amount}p を借りました。返済期限は ${dueDate} です。`, ephemeral: true });

    } else if (action === 'repay') {
      if (data.debt <= 0) return interaction.reply({ content: '借金がありません。', ephemeral: true });
      const required = Math.ceil(data.debt * 1.1);
      if (amount < required) return interaction.reply({ content: `返済額が不足しています（最低 ${required}p 必要）。`, ephemeral: true });
      if (amount > data.point) return interaction.reply({ content: '所持ポイントが足りません。', ephemeral: true });

      await supabase.from('points').update({
        point: data.point - amount,
        debt: 0,
        due: null
      }).eq('user_id', userId);

      await interaction.reply({ content: `借金を返済しました（支払額: ${amount}p）`, ephemeral: true });
    }
  }
});
async function autoRepay(userId, guild) {
  const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
  if (!data || data.debt === 0 || !data.due) return;

  const dueDate = new Date(data.due);
  const today = new Date();
  if (today < dueDate) return;

  const repayAmount = Math.ceil(data.debt * 1.1);
  let point = data.point - repayAmount;
  const member = await guild.members.fetch(userId);
  const userRoles = member.roles.cache.map(r => r.name);

  const owned = userRoles.filter(role => roleSettings[role] && role !== 'slave');
  owned.sort((a, b) => roleSettings[b].price - roleSettings[a].price);

  let removedRoles = [];
  while (point < 0 && owned.length > 0) {
    const roleName = owned.shift();
    const role = guild.roles.cache.find(r => r.name === roleName);
    if (!role) continue;

    point += Math.floor(roleSettings[roleName].price / 2);
    await member.roles.remove(role);
    removedRoles.push(roleName);
  }

  let finalRole = 'slave';
  if (point >= 0 && owned.length > 0) finalRole = owned[owned.length - 1];

  const newRole = guild.roles.cache.find(r => r.name === finalRole);
  if (newRole) await member.roles.add(newRole);
  await updateNickname(member, finalRole);

  await supabase.from('points').update({
    point: Math.max(0, point),
    debt: 0,
    due: null
  }).eq('user_id', userId);
}
const PORT = process.env.PORT || 3000;
http.createServer(async (req, res) => {
  if (req.url === '/repay-check') {
    const { data: users } = await supabase.from('points').select('user_id');
    const guild = await client.guilds.fetch(GUILD_ID);

    for (const u of users) {
      await autoRepay(u.user_id, guild);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Auto repayment check completed.\n');
  } else {
    res.writeHead(200);
    res.end('Discord BOT is running\n');
  }
}).listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});
const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('初回登録を行います'),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('所持ポイントと借金状況を確認します'),
  new SlashCommandBuilder()
    .setName('debt')
    .setDescription('借金または返済をします')
    .addStringOption(opt =>
      opt.setName('action').setDescription('借りる or 返す').setRequired(true)
        .addChoices(
          { name: '借りる', value: 'borrow' },
          { name: '返す', value: 'repay' }
        ))
    .addIntegerOption(opt =>
      opt.setName('amount').setDescription('金額').setRequired(true))
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
