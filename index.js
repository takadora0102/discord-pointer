// === DiscordポイントBOT メインコード 全機能統合・不具合修正版（株対応） ===

const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const express = require('express');
const cron = require('node-cron');
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

const commands = [
    new SlashCommandBuilder().setName('register').setDescription('ポイントシステムに登録します'),
    new SlashCommandBuilder().setName('profile').setDescription('現在のポイントと借金状況を確認します'),
    new SlashCommandBuilder().setName('borrow').setDescription('借金します').addIntegerOption(opt => opt.setName('amount').setDescription('借金額').setRequired(true)),
    new SlashCommandBuilder().setName('repay').setDescription('借金を返済します').addIntegerOption(opt => opt.setName('amount').setDescription('返済額').setRequired(true)),
    new SlashCommandBuilder().setName('addpoints').setDescription('ユーザーにポイントを付与').addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('付与ポイント').setRequired(true)),
    new SlashCommandBuilder().setName('stock').setDescription('現在の株価を確認します')
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
        const { error } = await supabase.from('points').upsert(row);
        if (error) console.error('保存エラー:', error);
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const userId = interaction.user.id;
    const pointsData = await loadPoints();

    if (interaction.commandName === 'register') {
        await interaction.deferReply({ ephemeral: true });
        if (pointsData[userId]) return await interaction.editReply('すでに登録済みです');
        pointsData[userId] = { user_id: userId, point: 1000, debt: 0, due: null };
        await savePoints(pointsData);
        await interaction.editReply('登録完了！1000p付与されました。');

    } else if (interaction.commandName === 'profile') {
        await interaction.deferReply({ ephemeral: true });
        const user = pointsData[userId];
        if (!user) return await interaction.editReply('未登録です');
        const debt = user.debt || 0;
        const due = user.due || 'なし';
        const point = user.point ?? 0;
        await interaction.editReply(`現在のポイント: ${point}p\n💸 借金残高: ${debt}p\n📅 返済期限: ${due}`);

    } else if (interaction.commandName === 'borrow') {
        await interaction.deferReply({ ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        const user = pointsData[userId];
        if (!user) return await interaction.editReply('未登録です');
        if (user.debt > 0) return await interaction.editReply('借金返済中です');
        const max = user.point * 3;
        if (amount <= 0 || amount > max) return await interaction.editReply(`1〜${max}p で指定してください`);
        const debt = Math.floor(amount * 1.1);
        const due = new Date();
        due.setDate(due.getDate() + 7);
        user.point += amount;
        user.debt = debt;
        user.due = due.toISOString().slice(0, 10);
        await savePoints(pointsData);
        await interaction.editReply(`${amount}pを借金しました（返済額 ${debt}p, 返済期限 ${user.due}）`);

    } else if (interaction.commandName === 'repay') {
        await interaction.deferReply({ ephemeral: true });
        const amount = interaction.options.getInteger('amount');
        const user = pointsData[userId];
        if (!user) return await interaction.editReply('未登録です');
        if (!user.debt) return await interaction.editReply('借金がありません');
        if (amount <= 0 || amount > user.debt) return await interaction.editReply(`1〜${user.debt}pで指定してください`);
        if (user.point < amount) return await interaction.editReply('ポイント不足');
        user.point -= amount;
        user.debt -= amount;
        if (user.debt === 0) delete user.debt, delete user.due;
        await savePoints(pointsData);
        await interaction.editReply(`返済完了！残りの借金: ${user.debt || 0}p`);

    } else if (interaction.commandName === 'addpoints') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return await interaction.reply('権限がありません');
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const targetId = target.id;
        if (!pointsData[targetId]) pointsData[targetId] = { user_id: targetId, point: 0, debt: 0, due: null };
        pointsData[targetId].point += amount;
        await savePoints(pointsData);
        await interaction.reply(`${target.username} に ${amount}p 付与しました`);

    } else if (interaction.commandName === 'stock') {
        const { data, error } = await supabase.from('stocks').select('*');
        if (error) return await interaction.reply('株価の取得に失敗しました');
        const content = data.map(s => `📈 ${s.name}: ${s.price}p`).join('\n');
        await interaction.reply({ content, ephemeral: true });
    }
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

cron.schedule('0 * * * *', async () => {
    const { data, error } = await supabase.from('stocks').select('*');
    if (error || !data) return;
    for (const stock of data) {
        const fluctuation = Math.floor(Math.random() * 41) - 20;
        stock.price = Math.max(1, stock.price + fluctuation);
        await supabase.from('stocks').upsert(stock);
    }
    console.log('株価を更新しました');
});

client.login(TOKEN);
