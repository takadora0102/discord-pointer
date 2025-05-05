const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes } = require('discord.js');
const fs = require('fs');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const POINTS_FILE = './points.json';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

function loadPoints() {
  if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, '{}');
  return JSON.parse(fs.readFileSync(POINTS_FILE));
}

function savePoints(points) {
  fs.writeFileSync(POINTS_FILE, JSON.stringify(points, null, 2));
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const points = loadPoints();
  const userId = interaction.user.id;

  if (interaction.commandName === 'register') {
    if (points[userId]) {
      await interaction.reply({ content: 'すでに登録されています！', ephemeral: true });
      return;
    }

    const member = await interaction.guild.members.fetch(userId);
    const role = interaction.guild.roles.cache.find(r => r.name === '農奴');
    if (!role) return interaction.reply('「農奴」ロールが見つかりません。');

    await member.roles.add(role);
    await member.setNickname(`【農奴】${member.user.username}`);
    points[userId] = 1000;
    savePoints(points);

    await interaction.reply({ content: '登録が完了しました！初期ポイント: 1000p', ephemeral: true });
  }

  if (interaction.commandName === 'profile') {
    if (!points[userId]) {
      await interaction.reply({ content: 'まだ登録されていません。/register で登録してください。', ephemeral: true });
      return;
    }
    await interaction.reply({ content: `あなたの現在のポイントは ${points[userId]}p です。`, ephemeral: true });
  }
});

// スラッシュコマンド登録
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
