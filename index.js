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
  'SLAVE': { price: 0, payout: 1, limit: 20 },
  'SERF': { price: 0, payout: 5, limit: 20 },
  'FREEMAN': { price: 10000, payout: 10, limit: 30 },
  'LOW NOBLE': { price: 50000, payout: 20, limit: 40 },
  'HIGH NOBLE': { price: 250000, payout: 30, limit: 50 },
  'GRAND DUKE': { price: 500000, payout: 50, limit: Infinity },
  'KING': { price: 500000, payout: 50, limit: Infinity },
  'EMPEROR': { price: 1000000, payout: 50, limit: Infinity }
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
  const roles = member.roles.cache.map(r => r.name.toUpperCase());
  const matchedRole = roles.find(role => roleSettings[role]);
  if (!matchedRole) return;

  const roleKey = matchedRole;
  const { payout, limit } = roleSettings[roleKey];
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
    if (error) console.error('[log insert error]', error);
  } else {
    const { error } = await supabase.from('message_logs')
      .update({ count: count + 1 })
      .eq('user_id', userId)
      .eq('date', today);
    if (error) console.error('[log update error]', error);
  }
});
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const member = await interaction.guild.members.fetch(userId);

  await interaction.deferReply({ ephemeral: true });

  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();

  const updateNickname = async (roleName) => {
    const newNick = `【${roleName}】${member.user.username}`;
    await member.setNickname(newNick).catch(console.error);
  };

  const changeRole = async (newRoleName) => {
    const currentRoles = member.roles.cache;
    for (const role of currentRoles.values()) {
      if (roleSettings[role.name.toUpperCase()]) {
        await member.roles.remove(role).catch(console.error);
      }
    }
    const newRole = interaction.guild.roles.cache.find(r => r.name === newRoleName);
    if (newRole) await member.roles.add(newRole).catch(console.error);
    await updateNickname(newRoleName);
  };

  if (interaction.commandName === 'register') {
    if (userData) return interaction.editReply({ content: '既に登録されています。' });
    await changeRole('SERF');
    await supabase.from('points').insert({ user_id: userId, point: 1000, debt: 0, due: null });
    return interaction.editReply({ content: '登録完了！1000pを付与しました。' });
  }

  if (interaction.commandName === 'profile') {
    if (!userData) return interaction.editReply({ content: '登録されていません。' });
    const debtTotal = userData.debt ? Math.ceil(userData.debt * 1.1) : 0;
    return interaction.editReply({
      content: `所持ポイント: ${userData.point}p\n借金（返済総額）: ${debtTotal || 'なし'}p\n返済期限: ${userData.due || 'なし'}`
    });
  }

  if (interaction.commandName === 'debt') {
    const action = interaction.options.getString('action');
    const amount = interaction.options.getInteger('amount');
    const now = new Date();
    const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    if (!userData) return interaction.editReply({ content: '登録されていません。' });

    if (action === 'borrow') {
      if (userData.debt) return interaction.editReply({ content: 'すでに借金があります。返済してから借りてください。' });
      const max = userData.point * 3;
      if (amount > max) return interaction.editReply({ content: `借金は所持ポイントの3倍までです（最大: ${max}p）` });

      await supabase.from('points')
        .update({ debt: amount, due: dueDate, point: userData.point + amount })
        .eq('user_id', userId);

      return interaction.editReply({ content: `${amount}p を借りました（返済総額: ${Math.ceil(amount * 1.1)}p）` });
    }

    if (action === 'repay') {
      if (!userData.debt) return interaction.editReply({ content: '借金はありません。' });

      const totalDebt = Math.ceil(userData.debt * 1.1);
      if (amount < totalDebt) return interaction.editReply({ content: `返済額が不足しています（必要: ${totalDebt}p）` });
      const remaining = userData.point - amount;

      await supabase.from('points')
        .update({ point: remaining, debt: 0, due: null })
        .eq('user_id', userId);

      return interaction.editReply({ content: `借金を返済しました。残りポイント: ${remaining}p` });
    }
  }
});
async function processAutoRepayment(guild) {
  const today = new Date().toISOString().split('T')[0];
  const { data: users } = await supabase
    .from('points')
    .select('*')
    .lt('due', today)
    .neq('debt', 0);

  if (!users || users.length === 0) return;

  for (const user of users) {
    const member = await guild.members.fetch(user.user_id).catch(() => null);
    if (!member) continue;

    const totalDebt = Math.ceil(user.debt * 1.1);
    let point = user.point;

    if (point >= totalDebt) {
      await supabase.from('points')
        .update({ point: point - totalDebt, debt: 0, due: null })
        .eq('user_id', user.user_id);
      continue;
    }

    let newPoint = point;
    let roles = member.roles.cache.map(r => r.name.toUpperCase());
    let sold = false;

    const sortedRoles = Object.entries(roleSettings)
      .filter(([r]) => roles.includes(r))
      .sort((a, b) => b[1].price - a[1].price);

    for (const [roleName, info] of sortedRoles) {
      if (info.price === 0) continue;
      await member.roles.remove(member.roles.cache.find(r => r.name.toUpperCase() === roleName));
      newPoint += Math.floor(info.price / 2);
      sold = true;

      const lowerRole = Object.entries(roleSettings)
        .filter(([r, s]) => s.price < info.price)
        .sort((a, b) => b[1].price - a[1].price)[0];

      if (lowerRole) {
        const newRoleObj = guild.roles.cache.find(r => r.name === lowerRole[0]);
        if (newRoleObj) await member.roles.add(newRoleObj);
        const newNick = `【${lowerRole[0]}】${member.user.username}`;
        await member.setNickname(newNick).catch(console.error);
      }
      break;
    }

    if (newPoint >= totalDebt) {
      await supabase.from('points')
        .update({ point: newPoint - totalDebt, debt: 0, due: null })
        .eq('user_id', user.user_id);
    } else {
      const slaveRole = guild.roles.cache.find(r => r.name === 'SLAVE');
      if (slaveRole) await member.roles.add(slaveRole);
      await member.setNickname(`【SLAVE】${member.user.username}`).catch(console.error);
      await supabase.from('points')
        .update({ point: 0, debt: 0, due: null })
        .eq('user_id', user.user_id);
    }
  }
}
const commands = [
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('初回登録を行います'),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('所持ポイントと借金状況を確認します'),
  new SlashCommandBuilder()
    .setName('debt')
    .setDescription('借金または返済を行います')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('借りるか返すか')
        .setRequired(true)
        .addChoices(
          { name: '借りる', value: 'borrow' },
          { name: '返す', value: 'repay' }
        ))
    .addIntegerOption(option =>
      option.setName('amount')
        .setDescription('金額（ポイント）')
        .setRequired(true))
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

http.createServer((req, res) => {
  if (req.url === '/repay-check') {
    processAutoRepayment(client.guilds.cache.get(GUILD_ID));
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Auto repayment check executed.');
  } else {
    res.writeHead(200);
    res.end('Bot is alive.');
  }
}).listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});
