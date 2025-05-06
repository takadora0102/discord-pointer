// DiscordポイントBOT 完全統合版
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
const express = require('express');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Message, Partials.Channel]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const rolesList = [
  { name: 'Freeman(自由民)', cost: 10000 },
  { name: 'LowerNoble(下級貴族)', cost: 50000 },
  { name: 'UpperNoble(上級貴族)', cost: 250000 }
];

const commands = [
  new SlashCommandBuilder().setName('register').setDescription('ユーザーを登録します'),
  new SlashCommandBuilder().setName('profile').setDescription('現在のポイント・借金・株を表示'),
  new SlashCommandBuilder().setName('borrow').setDescription('ポイントを借ります').addIntegerOption(opt => opt.setName('amount').setDescription('借金額').setRequired(true)),
  new SlashCommandBuilder().setName('repay').setDescription('借金を返済').addIntegerOption(opt => opt.setName('amount').setDescription('返済額').setRequired(true)),
  new SlashCommandBuilder().setName('addpoints').setDescription('ポイント付与').addUserOption(opt => opt.setName('user').setDescription('対象').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('ポイント').setRequired(true)),
  new SlashCommandBuilder().setName('shop').setDescription('ロールショップ表示'),
  new SlashCommandBuilder().setName('stock').setDescription('株を売買').addStringOption(opt => opt.setName('action').setDescription('売買').setRequired(true).addChoices({ name: '購入', value: 'buy' }, { name: '売却', value: 'sell' })).addStringOption(opt => opt.setName('name').setDescription('銘柄名').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('株数').setRequired(true)),
  new SlashCommandBuilder().setName('stockprice').setDescription('株価一覧を表示')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
})();

const app = express();
app.get('/', (_, res) => res.send('Bot is active'));
app.listen(10000);

client.on('ready', () => console.log('Bot Ready'));

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, options, user, guild } = interaction;

  const getUser = async () => (await supabase.from('users').select('*').eq('user_id', user.id).single()).data;
  const updateUser = async (values) => await supabase.from('users').update(values).eq('user_id', user.id);

  if (commandName === 'register') {
    const exists = await getUser();
    if (exists) return interaction.reply({ content: '登録済みです', ephemeral: true });
    await supabase.from('users').insert({ user_id: user.id, point: 0, debt: 0 });
    interaction.reply({ content: '登録完了', ephemeral: true });
  }

  if (commandName === 'profile') {
    const u = await getUser();
    const stocks = await supabase.from('user_stocks').select('*').eq('user_id', user.id);
    let stockText = '';
    if (stocks.data.length) {
      for (const s of stocks.data) {
        const price = (await supabase.from('stocks').select('price').eq('symbol', s.symbol).single()).data.price;
        stockText += `\n- ${s.symbol} (${s.amount}株 x ${price}p = ${s.amount * price}p)`;
      }
    } else stockText = '\nなし';
    interaction.reply({
      content: `\nポイント: ${u.point}p\n借金: ${u.debt}p\n\n**保有株**${stockText}`,
      ephemeral: true
    });
  }

  if (commandName === 'borrow') {
    const amount = options.getInteger('amount');
    const u = await getUser();
    const limit = u.point * 3;
    if (amount > limit) return interaction.reply({ content: '借金上限を超えています', ephemeral: true });
    const repay = Math.floor(amount * 1.1);
    await updateUser({ point: u.point + amount, debt: u.debt + repay });
    interaction.reply({ content: `${amount}p借りました（返済額: ${repay}p）`, ephemeral: true });
  }

  if (commandName === 'repay') {
    const amount = options.getInteger('amount');
    const u = await getUser();
    if (u.point < amount) return interaction.reply({ content: 'ポイント不足', ephemeral: true });
    const newDebt = Math.max(0, u.debt - amount);
    await updateUser({ point: u.point - amount, debt: newDebt });
    interaction.reply({ content: `${amount}p返済しました`, ephemeral: true });
  }

  if (commandName === 'addpoints') {
    const target = options.getUser('user');
    const amt = options.getInteger('amount');
    const u = await supabase.from('users').select('*').eq('user_id', target.id).single();
    if (!u.data) return interaction.reply({ content: '対象が未登録', ephemeral: true });
    await supabase.from('users').update({ point: u.data.point + amt }).eq('user_id', target.id);
    interaction.reply({ content: `${amt}p付与しました`, ephemeral: true });
  }

  if (commandName === 'shop') {
    const buttons = rolesList.map((r, i) => new ButtonBuilder().setCustomId(`buy_${r.name}`).setLabel(`${r.name}（${r.cost}p）`).setStyle(ButtonStyle.Primary));
    const row = new ActionRowBuilder().addComponents(...buttons);
    interaction.reply({ content: 'ロールショップ', components: [row], ephemeral: true });
  }

  if (commandName === 'stock') {
    const act = options.getString('action');
    const sym = options.getString('name');
    const num = options.getInteger('amount');
    const u = await getUser();
    const { data: stock } = await supabase.from('stocks').select('*').eq('name', sym).single();
    if (!stock) return interaction.reply({ content: '銘柄が存在しません', ephemeral: true });
    const total = stock.price * num;
    if (act === 'buy') {
      if (u.point < total) return interaction.reply({ content: 'ポイント不足', ephemeral: true });
      await updateUser({ point: u.point - total });
      const own = await supabase.from('user_stocks').select('*').eq('user_id', user.id).eq('symbol', stock.symbol).maybeSingle();
      if (own.data) {
        await supabase.from('user_stocks').update({ amount: own.data.amount + num }).eq('user_id', user.id).eq('symbol', stock.symbol);
      } else {
        await supabase.from('user_stocks').insert({ user_id: user.id, symbol: stock.symbol, amount: num });
      }
      interaction.reply({ content: `${sym}を${num}株購入しました`, ephemeral: true });
    }
    if (act === 'sell') {
      const own = await supabase.from('user_stocks').select('*').eq('user_id', user.id).eq('symbol', stock.symbol).single();
      if (!own.data || own.data.amount < num) return interaction.reply({ content: '株が足りません', ephemeral: true });
      await supabase.from('user_stocks').update({ amount: own.data.amount - num }).eq('user_id', user.id).eq('symbol', stock.symbol);
      await updateUser({ point: u.point + total });
      interaction.reply({ content: `${sym}を${num}株売却しました`, ephemeral: true });
    }
  }

  if (commandName === 'stockprice') {
    const { data: list } = await supabase.from('stocks').select('*');
    const text = list.map(s => `- ${s.name}: ${s.price}p`).join('\n');
    interaction.reply({ content: `📈 株価一覧:\n${text}`, ephemeral: true });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId.startsWith('buy_')) {
    const roleName = interaction.customId.split('buy_')[1];
    const roleData = rolesList.find(r => r.name === roleName);
    const u = await supabase.from('users').select('*').eq('user_id', interaction.user.id).single();
    if (u.data.point < roleData.cost) return interaction.reply({ content: 'ポイント不足', ephemeral: true });
    const role = interaction.guild.roles.cache.find(r => r.name === roleData.name);
    await interaction.member.roles.add(role);
    await supabase.from('users').update({ point: u.data.point - roleData.cost }).eq('user_id', interaction.user.id);
    interaction.reply({ content: `${roleData.name}を購入しました`, ephemeral: true });
  }
});

client.login(TOKEN);
