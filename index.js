const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
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

// ポイント保存
function loadPoints() {
  if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, '{}');
  return JSON.parse(fs.readFileSync(POINTS_FILE));
}

function savePoints(points) {
  fs.writeFileSync(POINTS_FILE, JSON.stringify(points, null, 2));
}

// メッセージログ保存
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

// スラッシュコマンド対応
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const points = loadPoints();
  const userId = interaction.user.id;

  if (interaction.commandName === 'register') {
    try {
      await interaction.deferReply({ ephemeral: true });

      if (points[userId]) {
        await interaction.editReply('すでに登録されています！');
        return;
      }

      const member = await interaction.guild.members.fetch(userId);
      const role = interaction.guild.roles.cache.find(r => r.name === 'Serf（農奴）');
      if (!role) {
        await interaction.editReply('「Serf（農奴）」ロールが見つかりません。サーバーにロール名が正確にあるか確認してください。');
        return;
      }

      await member.roles.add(role);
      await member.setNickname(`【農奴】${member.user.username}`);
      points[userId] = 1000;
      savePoints(points);

      await interaction.editReply('登録が完了しました！初期ポイント: 1000p');
    } catch (e) {
      console.error('登録時エラー:', e);
    }
  }

  if (interaction.commandName === 'profile') {
    try {
      await interaction.deferReply({ ephemeral: true });

      if (!points[userId]) {
        await interaction.editReply('まだ登録されていません。/register で登録してください。');
        return;
      }

      await interaction.editReply(`あなたの現在のポイントは ${points[userId]}p です。`);
    } catch (e) {
      console.error('プロフィール表示エラー:', e);
    }
  }
});

// メッセージ送信ポイント加算
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const points = loadPoints();
  const log = loadMessageLog();

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  if (!log[today]) log[today] = {};
  if (!log[today][userId]) log[today][userId] = 0;

  if (log[today][userId] >= 20) return;

  log[today][userId] += 1;

  if (!points[userId]) return; // 未登録者は無視

  points[userId] += 5;
  savePoints(points);
  saveMessageLog(log);
});

// コマンド登録
const commands = [
  new SlashCommandBuilder().setName('register').setDescription('農奴として登録します'),
  new SlashCommandBuilder().setName('profile').setDescription('現在のポイントを確認します')
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
