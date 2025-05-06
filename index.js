// === DiscordポイントBOT コンフリクト解消済みコード ===

const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Message, Partials.Channel]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const msgLogPath = './message_log.json';
function loadMessageLog() {
    if (!fs.existsSync(msgLogPath)) fs.writeFileSync(msgLogPath, JSON.stringify({}));
    return JSON.parse(fs.readFileSync(msgLogPath));
}
function saveMessageLog(data) {
    fs.writeFileSync(msgLogPath, JSON.stringify(data, null, 2));
}

function getToday() {
    return new Date().toISOString().slice(0, 10);
}

const rolesData = [
  { name: 'Freeman(自由民)', price: 10000, category: '民衆層', desc: '農奴より自由な民。' },
  { name: 'LesserNoble(下級貴族)', price: 50000, category: '貴族層', desc: '貴族階級の入り口。' },
  { name: 'HighNoble(上級貴族)', price: 250000, category: '貴族層', desc: '高貴な血統の証。' }
];

const commands = [
  new SlashCommandBuilder().setName('register').setDescription('ポイントシステムに登録します'),
  new SlashCommandBuilder().setName('profile').setDescription('現在のポイントと借金状況を確認します'),
  new SlashCommandBuilder().setName('borrow').setDescription('借金します').addIntegerOption(opt => opt.setName('amount').setDescription('借金額').setRequired(true)),
  new SlashCommandBuilder().setName('repay').setDescription('借金を返済します').addIntegerOption(opt => opt.setName('amount').setDescription('返済額').setRequired(true)),
  new SlashCommandBuilder().setName('addpoints').setDescription('ポイント付与').addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('付与ポイント').setRequired(true)),
  new SlashCommandBuilder().setName('shop').setDescription('統合ショップを表示')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('スラッシュコマンドを登録しました。');
  } catch (err) {
    console.error('コマンド登録エラー:', err);
  }
})();

const app = express();
app.get('/', (_, res) => res.send('Bot is running'));
app.listen(10000, () => console.log('Webサーバー起動 (PORT 10000)'));

// Supabase
async function loadPoints() {
  const { data, error } = await supabase.from('points').select('*');
  if (error) throw error;
  const map = {};
  data.forEach(entry => map[entry.user_id] = entry);
  return map;
}
async function savePoints(data) {
  const rows = Object.values(data);
  for (const row of rows) {
    if (!row.hasOwnProperty('debt')) row.debt = 0;
    if (!row.hasOwnProperty('due')) row.due = null;
    const { error } = await supabase.from('points').upsert(row);
    if (error) console.error('保存エラー:', error);
  }
}

client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const guild = interaction.guild;
    let pointsData = await loadPoints();
    const user = pointsData[userId];

    if (interaction.commandName === 'register') {
      await interaction.deferReply({ ephemeral: true });
      if (user) return interaction.editReply('すでに登録済みです');
      const member = await guild.members.fetch(userId);
      const role = guild.roles.cache.find(r => r.name === 'Serf(農奴)');
      await member.roles.add(role);
      await member.setNickname(`【農奴】${interaction.user.username}`);
      pointsData[userId] = { user_id: userId, point: 1000, debt: 0, due: null };
      await savePoints(pointsData);
      return interaction.editReply('登録完了！1000p付与されました。');
    }

    if (interaction.commandName === 'profile') {
      await interaction.deferReply({ ephemeral: true });
      if (!user) return interaction.editReply('未登録です');
      const debt = user.debt ?? 0;
      const due = user.due ?? 'なし';
      const point = user.point ?? 0;
      return interaction.editReply(`現在のポイント: ${point}p\n💸 借金残高: ${debt}p\n📅 返済期限: ${due}`);
    }

    if (interaction.commandName === 'borrow') {
      await interaction.deferReply({ ephemeral: true });
      const amount = interaction.options.getInteger('amount');
      if (!user) return interaction.editReply('未登録です');
      if (user.debt > 0) return interaction.editReply('返済が完了していません');
      const max = user.point * 3;
      if (amount <= 0 || amount > max) return interaction.editReply(`1〜${max}p で指定してください`);
      const debt = Math.floor(amount * 1.1);
      const due = new Date();
      due.setDate(due.getDate() + 7);
      user.point += amount;
      user.debt = debt;
      user.due = due.toISOString().slice(0, 10);
      await savePoints(pointsData);
      return interaction.editReply(`${amount}pを借金しました（返済額 ${debt}p, 返済期限 ${user.due}）`);
    }

    if (interaction.commandName === 'repay') {
      await interaction.deferReply({ ephemeral: true });
      const amount = interaction.options.getInteger('amount');
      if (!user || !user.debt) return interaction.editReply('返済対象がありません');
      if (amount <= 0 || amount > user.debt) return interaction.editReply(`1〜${user.debt}pで指定してください`);
      if (user.point < amount) return interaction.editReply('ポイントが足りません');
      user.point -= amount;
      user.debt -= amount;
      if (user.debt === 0) delete user.debt, delete user.due;
      await savePoints(pointsData);
      return interaction.editReply(`返済完了！残り借金: ${user.debt || 0}p`);
    }

    if (interaction.commandName === 'addpoints') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply('管理者専用コマンドです');
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const targetId = target.id;
      if (!pointsData[targetId]) pointsData[targetId] = { user_id: targetId, point: 0, debt: 0, due: null };
      pointsData[targetId].point += amount;
      await savePoints(pointsData);
      return interaction.reply(`${target.username} に ${amount}p 付与しました`);
    }

    if (interaction.commandName === 'shop') {
      await interaction.deferReply({ ephemeral: true });
      const rows = [];
      let content = '**🏪 ロールショップ一覧**\n\n';
      rolesData.forEach((item, i) => {
        content += `**${i + 1}. ${item.name}** (${item.price}p)\n${item.desc}\n\n`;
        if (!rows[Math.floor(i / 5)]) rows[Math.floor(i / 5)] = new ActionRowBuilder();
        rows[Math.floor(i / 5)].addComponents(new ButtonBuilder().setCustomId(`buy_${item.name}`).setLabel(`${i + 1}`).setStyle(ButtonStyle.Primary));
      });
      return interaction.editReply({ content, components: rows });
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const userId = interaction.user.id;
  let pointsData = await loadPoints();
  const user = pointsData[userId];
  if (!user) return interaction.reply({ content: '未登録です', ephemeral: true });

  const roleName = interaction.customId.replace('buy_', '');
  const roleInfo = rolesData.find(r => r.name === roleName);
  if (!roleInfo) return interaction.reply({ content: '商品が見つかりません', ephemeral: true });
  if (user.point < roleInfo.price) return interaction.reply({ content: 'ポイントが足りません', ephemeral: true });

  const member = await interaction.guild.members.fetch(userId);
  const role = interaction.guild.roles.cache.find(r => r.name === roleInfo.name);
  if (!role) return interaction.reply({ content: 'ロールが見つかりません', ephemeral: true });
  await member.roles.add(role);
  user.point -= roleInfo.price;
  await member.setNickname(`【${roleInfo.name.replace(/\(.*?\)/, '')}】${interaction.user.username}`);
  await savePoints(pointsData);
  return interaction.reply({ content: `${roleInfo.name} を購入しました`, ephemeral: true });
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const userId = message.author.id;
  const log = loadMessageLog();
  const pointsData = await loadPoints();
  const user = pointsData[userId];
  if (!user) return;
  const today = getToday();
  if (!log[userId]) log[userId] = {};
  if (!log[userId][today]) log[userId][today] = 0;
  if (log[userId][today] >= 20) return;
  log[userId][today]++;
  user.point += 5;
  await savePoints(pointsData);
  saveMessageLog(log);
});

client.login(TOKEN);
