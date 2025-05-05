const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
const express = require('express');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const POINTS_FILE = './points.json';
const MESSAGE_LOG_FILE = './message_log.json';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

function loadPoints() {
  if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, '{}');
  return JSON.parse(fs.readFileSync(POINTS_FILE));
}
function savePoints(points) {
  fs.writeFileSync(POINTS_FILE, JSON.stringify(points, null, 2));
}
function loadMessageLog() {
  if (!fs.existsSync(MESSAGE_LOG_FILE)) fs.writeFileSync(MESSAGE_LOG_FILE, '{}');
  return JSON.parse(fs.readFileSync(MESSAGE_LOG_FILE));
}
function saveMessageLog(log) {
  fs.writeFileSync(MESSAGE_LOG_FILE, JSON.stringify(log, null, 2));
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const points = loadPoints();
  const userId = interaction.user.id;
  const now = new Date();

  if (interaction.commandName === 'register') {
    try {
      await interaction.deferReply({ ephemeral: true });

      if (points[userId]) {
        await interaction.editReply('すでに登録されています！');
        return;
      }

      const member = await interaction.guild.members.fetch(userId);
      const role = interaction.guild.roles.cache.find(r => r.name === 'Serf(農奴)');
      if (!role) {
        await interaction.editReply('「Serf(農奴)」ロールが見つかりません。');
        return;
      }

      await member.roles.add(role);
      await member.setNickname(`【農奴】${member.user.username}`);
      points[userId] = { points: 1000 };
      savePoints(points);

      await interaction.editReply('登録が完了しました！初期ポイント: 1000p');
    } catch (e) {
      console.error('登録時エラー:', e);
    }
  }

  if (interaction.commandName === 'profile') {
    await interaction.deferReply({ ephemeral: true });

    if (!points[userId]) {
      await interaction.editReply('まだ登録されていません。/register で登録してください。');
      return;
    }

    const userData = points[userId];
    let reply = `現在のポイント: ${userData.points}p`;

    if (userData.debt) {
      reply += `\n💸 借金残高: ${userData.debt.total}p\n📅 返済期限: ${userData.debt.due}`;
    }

    await interaction.editReply(reply);
  }

  if (interaction.commandName === 'borrow') {
    await interaction.deferReply({ ephemeral: true });

    const amount = interaction.options.getInteger('amount');
    if (!points[userId]) {
      await interaction.editReply('まず /register で登録してください。');
      return;
    }

    const userData = points[userId];
    if (userData.debt) {
      await interaction.editReply('借金があります。返済が完了するまで再度借りられません。');
      return;
    }

    const max = userData.points * 3;
    if (amount > max) {
      await interaction.editReply(`借金上限は現在のポイントの3倍 (${max}p) までです。`);
      return;
    }

    const totalWithInterest = Math.ceil(amount * 1.1);
    const dueDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    userData.points += amount;
    userData.debt = {
      total: totalWithInterest,
      due: dueDate,
    };

    savePoints(points);
    await interaction.editReply(`💰 ${amount}p を借りました（返済額: ${totalWithInterest}p、期限: ${dueDate}）`);
  }

  if (interaction.commandName === 'repay') {
    await interaction.deferReply({ ephemeral: true });

    const amount = interaction.options.getInteger('amount');
    if (!points[userId] || !points[userId].debt) {
      await interaction.editReply('現在借金はありません。');
      return;
    }

    const userData = points[userId];
    if (userData.points < amount) {
      await interaction.editReply('ポイントが足りません。');
      return;
    }

    userData.points -= amount;
    userData.debt.total -= amount;

    if (userData.debt.total <= 0) {
      delete userData.debt;
      await interaction.editReply(`💸 借金を完済しました！`);
    } else {
      await interaction.editReply(`💸 残りの借金: ${userData.debt.total}p`);
    }

    savePoints(points);
  }
});

// メッセージ送信でポイント加算
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const points = loadPoints();
  const log = loadMessageLog();

  const today = new Date().toISOString().split('T')[0];
  if (!log[today]) log[today] = {};
  if (!log[today][userId]) log[today][userId] = 0;

  if (log[today][userId] >= 20) return;

  log[today][userId] += 1;

  if (!points[userId]) return;

  if (typeof points[userId] === 'number') {
    points[userId] = { points: points[userId] };
  }

  points[userId].points += 5;
  savePoints(points);
  saveMessageLog(log);
});

// スラッシュコマンド登録
const commands = [
  new SlashCommandBuilder().setName('register').setDescription('農奴として登録します'),
  new SlashCommandBuilder().setName('profile').setDescription('現在のポイントと借金を確認します'),
  new SlashCommandBuilder()
    .setName('borrow')
    .setDescription('ポイントを借ります（利息10%、所持ポイントの3倍まで）')
    .addIntegerOption(opt => opt.setName('amount').setDescription('借りたいポイント').setRequired(true)),
  new SlashCommandBuilder()
    .setName('repay')
    .setDescription('借金を返済します')
    .addIntegerOption(opt => opt.setName('amount').setDescription('返済するポイント').setRequired(true)),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('スラッシュコマンドを登録しました。');
  } catch (error) {
    console.error(error);
  }
})();

client.login(TOKEN);

// Render対策のExpressサーバー
const app = express();
app.get('/', (req, res) => res.send('Discord BOT is running.'));
app.listen(process.env.PORT || 3000);
