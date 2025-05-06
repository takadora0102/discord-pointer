// === DiscordポイントBOTメインコード 全機能統合・株式機能付き ===

const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
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
    new SlashCommandBuilder().setName('profile').setDescription('現在のポイントと借金状況・株式保有状況を確認します'),
    new SlashCommandBuilder().setName('borrow').setDescription('借金します').addIntegerOption(opt => opt.setName('amount').setDescription('借金額').setRequired(true)),
    new SlashCommandBuilder().setName('repay').setDescription('借金を返済します').addIntegerOption(opt => opt.setName('amount').setDescription('返済額').setRequired(true)),
    new SlashCommandBuilder().setName('addpoints').setDescription('ユーザーにポイントを付与').addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('付与ポイント').setRequired(true)),
    new SlashCommandBuilder().setName('stocks').setDescription('現在の株価を表示'),
    new SlashCommandBuilder().setName('buy').setDescription('株を購入').addStringOption(opt => opt.setName('symbol').setDescription('銘柄').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('数量').setRequired(true)),
    new SlashCommandBuilder().setName('sell').setDescription('株を売却').addStringOption(opt => opt.setName('symbol').setDescription('銘柄').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('数量').setRequired(true))
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
    let pointsData = await loadPoints();

    if (interaction.commandName === 'stocks') {
        const { data, error } = await supabase.from('stocks').select('*');
        if (error) return interaction.reply('株価取得エラー');
        let msg = '**📈 現在の株価一覧**\n';
        data.forEach(s => msg += `\n**${s.name} (${s.symbol})**: ${s.price}p`);
        await interaction.reply({ content: msg, ephemeral: true });

    } else if (interaction.commandName === 'buy') {
        await interaction.deferReply({ ephemeral: true });
        const symbol = interaction.options.getString('symbol');
        const amount = interaction.options.getInteger('amount');
        const user = pointsData[userId];
        if (!user) return await interaction.editReply('未登録です');

        const { data, error } = await supabase.from('stocks').select('*').eq('symbol', symbol).single();
        if (error || !data) return await interaction.editReply('銘柄が見つかりません');

        const total = data.price * amount;
        if (user.point < total) return await interaction.editReply('ポイント不足');
        user.point -= total;
        user[`stock_${symbol}`] = (user[`stock_${symbol}`] || 0) + amount;
        await savePoints(pointsData);
        await interaction.editReply(`${data.name} (${symbol}) を ${amount}株購入しました！`);

    } else if (interaction.commandName === 'sell') {
        await interaction.deferReply({ ephemeral: true });
        const symbol = interaction.options.getString('symbol');
        const amount = interaction.options.getInteger('amount');
        const user = pointsData[userId];
        if (!user) return await interaction.editReply('未登録です');

        const holding = user[`stock_${symbol}`] || 0;
        if (holding < amount) return await interaction.editReply('保有株が不足しています');

        const { data, error } = await supabase.from('stocks').select('*').eq('symbol', symbol).single();
        if (error || !data) return await interaction.editReply('銘柄が見つかりません');

        const total = data.price * amount;
        user.point += total;
        user[`stock_${symbol}`] = holding - amount;
        await savePoints(pointsData);
        await interaction.editReply(`${data.name} (${symbol}) を ${amount}株売却しました！`);

    } else if (interaction.commandName === 'profile') {
        await interaction.deferReply({ ephemeral: true });
        const user = pointsData[userId];
        if (!user) return await interaction.editReply('未登録です');
        let msg = `現在のポイント: ${user.point ?? 0}p\n💸 借金残高: ${user.debt || 0}p\n📅 返済期限: ${user.due || 'なし'}`;
        const stocks = Object.keys(user).filter(k => k.startsWith('stock_'));
        if (stocks.length > 0) {
            msg += '\n\n📊 **株式保有状況**';
            for (const s of stocks) {
                const sym = s.replace('stock_', '');
                msg += `\n- ${sym.toUpperCase()}: ${user[s]}株`;
            }
        }
        await interaction.editReply(msg);
    }
});

cron.schedule('0 * * * *', async () => {
    const { data, error } = await supabase.from('stocks').select('*');
    if (error) return console.error('株価取得エラー');
    for (const stock of data) {
        const fluct = 1 + (Math.random() * 0.08 - 0.04);
        const newPrice = Math.max(1, Math.round(stock.price * fluct));
        await supabase.from('stocks').update({ price: newPrice }).eq('symbol', stock.symbol);
    }
    console.log('📈 株価更新完了');
});

client.login(TOKEN);
