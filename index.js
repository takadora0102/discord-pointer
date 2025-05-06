// === DiscordポイントBOT完全統合版 index.js ===

const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel],
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const rolesOrder = ["Serf(農奴)", "Freeman(自由民)", "LowerNoble(下級貴族)", "UpperNoble(上級貴族)"];
const rolePrices = { "Freeman(自由民)": 10000, "LowerNoble(下級貴族)": 50000, "UpperNoble(上級貴族)": 250000 };
const stockNames = ["日本サイテクス", "カゼキ電機", "創世建設", "アオト薬品", "ノバ銀行"];
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

const commands = [
  new SlashCommandBuilder().setName('register').setDescription('ポイントシステムに登録'),
  new SlashCommandBuilder().setName('profile').setDescription('現在のポイント・借金・株情報表示'),
  new SlashCommandBuilder().setName('borrow').setDescription('借金').addIntegerOption(opt => opt.setName('amount').setDescription('借金額').setRequired(true)),
  new SlashCommandBuilder().setName('repay').setDescription('借金返済').addIntegerOption(opt => opt.setName('amount').setDescription('返済額').setRequired(true)),
  new SlashCommandBuilder().setName('addpoints').setDescription('ユーザーにポイント付与').addUserOption(opt => opt.setName('user').setDescription('対象').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('付与p').setRequired(true)),
  new SlashCommandBuilder().setName('shop').setDescription('ロール購入ショップを表示'),
  new SlashCommandBuilder().setName('stock').setDescription('株を売買').addStringOption(opt => opt.setName('action').setDescription('売買').setRequired(true).addChoices({ name: '買う', value: 'buy' }, { name: '売る', value: 'sell' })).addStringOption(opt => opt.setName('name').setDescription('銘柄名').setRequired(true).addChoices(...stockNames.map(name => ({ name, value: name })))).addIntegerOption(opt => opt.setName('amount').setDescription('株数').setRequired(true)),
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
    if (!row.hasOwnProperty('stocks')) row.stocks = {};
    const { error } = await supabase.from('points').upsert(row);
    if (error) console.error('保存エラー:', error);
  }
}

async function loadStocks() {
  const { data, error } = await supabase.from('stocks').select('*');
  if (error) throw error;
  const prices = {};
  data.forEach(stock => prices[stock.name] = stock.price);
  return prices;
}

function createRoleButtons() {
  const buttons = Object.keys(rolePrices).map((role, i) => new ButtonBuilder().setCustomId(`buy_${role}`).setLabel(`${i + 1}`).setStyle(ButtonStyle.Primary));
  return [new ActionRowBuilder().addComponents(buttons)];
}

cron.schedule('0 * * * *', async () => {
  const { data, error } = await supabase.from('stocks').select('*');
  if (error) return console.error('株価取得エラー:', error);
  const updates = data.map(stock => {
    let fluct = Math.floor(Math.random() * 41) - 20; // -20〜20
    return { ...stock, price: Math.max(stock.price + fluct, 1) };
  });
  for (const u of updates) await supabase.from('stocks').upsert(u);
  console.log('株価を更新しました');
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
  const userId = interaction.user.id;
  const guild = interaction.guild;
  const member = await guild.members.fetch(userId);
  let pointsData = await loadPoints();
  let stockPrices = await loadStocks();

  if (interaction.isChatInputCommand()) {
    const name = interaction.commandName;
    if (name === 'register') {
      await interaction.deferReply({ ephemeral: true });
      if (pointsData[userId]) return interaction.editReply('すでに登録済みです');
      const role = guild.roles.cache.find(r => r.name === 'Serf(農奴)');
      await member.roles.add(role);
      await member.setNickname(`【農奴】${interaction.user.username}`);
      pointsData[userId] = { user_id: userId, point: 1000, debt: 0, due: null, stocks: {} };
      await savePoints(pointsData);
      return interaction.editReply('登録完了！1000p付与されました');

    } else if (name === 'profile') {
      await interaction.deferReply({ ephemeral: true });
      const u = pointsData[userId];
      if (!u) return interaction.editReply('未登録です');
      let msg = `現在のポイント: ${u.point}p\n💸 借金残高: ${u.debt || 0}p\n📅 返済期限: ${u.due || 'なし'}`;
      if (u.stocks && Object.keys(u.stocks).length > 0) {
        msg += '\n📈 保有株:\n';
        for (const [stock, amount] of Object.entries(u.stocks)) {
          const price = stockPrices[stock] || 0;
          msg += `・${stock}：${amount}株（${price}p × ${amount} = ${price * amount}p）\n`;
        }
      }
      return interaction.editReply(msg);

    } else if (name === 'borrow') {
      await interaction.deferReply({ ephemeral: true });
      const amount = interaction.options.getInteger('amount');
      const u = pointsData[userId];
      if (!u) return interaction.editReply('未登録です');
      if (u.debt > 0) return interaction.editReply('返済中の借金があります');
      const max = u.point * 3;
      if (amount <= 0 || amount > max) return interaction.editReply(`1〜${max}p で指定してください`);
      const debt = Math.floor(amount * 1.1);
      const due = new Date();
      due.setDate(due.getDate() + 7);
      u.point += amount;
      u.debt = debt;
      u.due = due.toISOString().slice(0, 10);
      await savePoints(pointsData);
      return interaction.editReply(`${amount}p を借りました（返済額 ${debt}p, 期限 ${u.due}）`);

    } else if (name === 'repay') {
      await interaction.deferReply({ ephemeral: true });
      const amount = interaction.options.getInteger('amount');
      const u = pointsData[userId];
      if (!u || !u.debt) return interaction.editReply('借金がありません');
      if (amount <= 0 || amount > u.debt || u.point < amount) return interaction.editReply('金額不正またはポイント不足');
      u.point -= amount;
      u.debt -= amount;
      if (u.debt === 0) delete u.debt, delete u.due;
      await savePoints(pointsData);
      return interaction.editReply(`返済完了！残りの借金: ${u.debt || 0}p`);

    } else if (name === 'addpoints') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return interaction.reply('権限がありません');
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const id = target.id;
      if (!pointsData[id]) pointsData[id] = { user_id: id, point: 0, debt: 0, due: null, stocks: {} };
      pointsData[id].point += amount;
      await savePoints(pointsData);
      return interaction.reply(`${target.username} に ${amount}p 付与しました`);

    } else if (name === 'shop') {
      await interaction.deferReply({ ephemeral: true });
      const msg = `\n《 ロールショップ 》\n\n■ 民衆層\n① Freeman(自由民)：10000p\n　→ 村人としての自由を獲得\n\n■ 貴族層\n② LowerNoble(下級貴族)：50000p\n　→ 地方領主\n③ UpperNoble(上級貴族)：250000p\n　→ 中央貴族の一角`;
      const buttons = createRoleButtons();
      return interaction.editReply({ content: msg, components: buttons });

    } else if (name === 'stock') {
      await interaction.deferReply({ ephemeral: true });
      const action = interaction.options.getString('action');
      const stock = interaction.options.getString('name');
      const amount = interaction.options.getInteger('amount');
      const u = pointsData[userId];
      if (!u) return interaction.editReply('未登録です');
      const price = stockPrices[stock];
      if (!price) return interaction.editReply('存在しない銘柄です');

      if (action === 'buy') {
        const cost = price * amount;
        if (u.point < cost) return interaction.editReply('ポイント不足');
        u.point -= cost;
        if (!u.stocks) u.stocks = {};
        u.stocks[stock] = (u.stocks[stock] || 0) + amount;
        await savePoints(pointsData);
        return interaction.editReply(`${stock} を ${amount}株購入しました（${cost}p）`);
      } else {
        if (!u.stocks || !u.stocks[stock] || u.stocks[stock] < amount) return interaction.editReply('保有株不足');
        const gain = price * amount;
        u.stocks[stock] -= amount;
        if (u.stocks[stock] === 0) delete u.stocks[stock];
        u.point += gain;
        await savePoints(pointsData);
        return interaction.editReply(`${stock} を ${amount}株売却しました（${gain}p）`);
      }
    }
  }

  if (interaction.isButton()) {
    await interaction.deferReply({ ephemeral: true });
    const id = interaction.customId;
    if (!id.startsWith('buy_')) return;
    const roleName = id.replace('buy_', '');
    const u = pointsData[userId];
    if (!u) return interaction.editReply('未登録です');
    if (u.point < rolePrices[roleName]) return interaction.editReply('ポイント不足');
    const currentIndex = rolesOrder.findIndex(r => member.roles.cache.some(role => role.name === r));
    const targetIndex = rolesOrder.indexOf(roleName);
    if (targetIndex !== currentIndex + 1) return interaction.editReply('前提ロールを取得してください');
    const role = guild.roles.cache.find(r => r.name === roleName);
    await member.roles.add(role);
    await member.setNickname(`【${role.name}】${interaction.user.username}`);
    u.point -= rolePrices[roleName];
    await savePoints(pointsData);
    return interaction.editReply(`${roleName} を購入しました！`);
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const userId = message.author.id;
  const log = loadMessageLog();
  const pointsData = await loadPoints();
  const u = pointsData[userId];
  if (!u) return;
  const today = getToday();
  if (!log[userId]) log[userId] = {};
  if (!log[userId][today]) log[userId][today] = 0;
  if (log[userId][today] >= 20) return;
  log[userId][today]++;
  u.point += 5;
  await savePoints(pointsData);
  saveMessageLog(log);
});

client.login(TOKEN);
