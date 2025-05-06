// === DiscordポイントBOTメインコード 全機能統合・株価確認追加 ===

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

const rolesList = ["Slave(奴隷)", "Serf(農奴)", "Freeman(自由民)", "LowerNoble(下級貴族)", "UpperNoble(上級貴族)"];

const commands = [
    new SlashCommandBuilder().setName('register').setDescription('ポイントシステムに登録します'),
    new SlashCommandBuilder().setName('profile').setDescription('現在のポイント、借金、株保有情報を確認します'),
    new SlashCommandBuilder().setName('borrow').setDescription('借金します').addIntegerOption(opt => opt.setName('amount').setDescription('借金額').setRequired(true)),
    new SlashCommandBuilder().setName('repay').setDescription('借金を返済します').addIntegerOption(opt => opt.setName('amount').setDescription('返済額').setRequired(true)),
    new SlashCommandBuilder().setName('addpoints').setDescription('ユーザーにポイントを付与').addUserOption(opt => opt.setName('user').setDescription('対象ユーザー').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('付与ポイント').setRequired(true)),
    new SlashCommandBuilder().setName('shop').setDescription('ロールショップを表示します'),
    new SlashCommandBuilder().setName('stock').setDescription('株を売買します').addStringOption(opt => opt.setName('action').setDescription('売買の選択').setRequired(true).addChoices(
        { name: '購入', value: 'buy' },
        { name: '売却', value: 'sell' }
    )).addStringOption(opt => opt.setName('name').setDescription('銘柄名').setRequired(true)).addIntegerOption(opt => opt.setName('amount').setDescription('株数').setRequired(true)),
    new SlashCommandBuilder().setName('stockprice').setDescription('現在の株価を確認します')
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

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options, user, guild } = interaction;

    if (commandName === 'stockprice') {
        await interaction.deferReply({ ephemeral: true });
        const { data, error } = await supabase.from('stocks').select('*');
        if (error) return await interaction.editReply('株価の取得に失敗しました');

        let content = `📊 **現在の株価一覧**\n\n`;
        for (const stock of data) {
            content += `- ${stock.name}: ${stock.price}p\n`;
        }
        await interaction.editReply(content);
        return;
    }

    // === 各コマンド処理をここに記述 ===
    if (commandName === 'register') {
        // ユーザー登録処理: Supabaseにユーザー情報を保存
        const { error } = await supabase.from('users').upsert({ user_id: user.id, points: 0, debt: 0 });
        if (error) return await interaction.reply('ユーザー登録に失敗しました');
        await interaction.reply('ユーザー登録が完了しました');
    } else if (commandName === 'profile') {
        // ポイント、借金、株保有情報を表示
        const { data, error } = await supabase.from('users').select('points, debt').eq('user_id', user.id);
        if (error) return await interaction.reply('プロフィール情報の取得に失敗しました');
        
        const userInfo = data[0];
        const stockData = await supabase.from('stocks').select('name, amount').eq('user_id', user.id);
        let stockInfo = '';
        stockData.forEach(stock => {
            stockInfo += `- ${stock.name}: ${stock.amount}株\n`;
        });

        const profileContent = `
        📋 **プロフィール**
        - ポイント: ${userInfo.points}p
        - 借金残高: ${userInfo.debt}p
        - 保有株:
        ${stockInfo || '株を保有していません'}
        `;
        await interaction.reply(profileContent);
    } else if (commandName === 'borrow') {
        // 借金処理: 借金額を増やす
        const amount = options.getInteger('amount');
        if (amount <= 0) return await interaction.reply('借金額は正の数で入力してください');

        const { data, error } = await supabase.from('users').select('debt').eq('user_id', user.id);
        if (error) return await interaction.reply('借金処理に失敗しました');
        
        const newDebt = data[0].debt + amount;
        await supabase.from('users').update({ debt: newDebt }).eq('user_id', user.id);
        await interaction.reply(`借金を${amount}pしました。現在の借金残高は${newDebt}pです。`);
    } else if (commandName === 'repay') {
        // 借金返済処理: 借金額を減らす
        const amount = options.getInteger('amount');
        if (amount <= 0) return await interaction.reply('返済額は正の数で入力してください');

        const { data, error } = await supabase.from('users').select('debt').eq('user_id', user.id);
        if (error) return await interaction.reply('借金返済に失敗しました');
        
        const newDebt = data[0].debt - amount;
        if (newDebt < 0) return await interaction.reply('返済額が借金残高を上回っています');
        
        await supabase.from('users').update({ debt: newDebt }).eq('user_id', user.id);
        await interaction.reply(`借金を${amount}p返済しました。現在の借金残高は${newDebt}pです。`);
    } else if (commandName === 'addpoints') {
        // 管理者用のポイント付与: 対象ユーザーにポイントを追加
        const targetUser = options.getUser('user');
        const amount = options.getInteger('amount');
        if (amount <= 0) return await interaction.reply('ポイントは正の数で入力してください');

        const { data, error } = await supabase.from('users').select('points').eq('user_id', targetUser.id);
        if (error) return await interaction.reply('ポイントの付与に失敗しました');
        
        const newPoints = data[0].points + amount;
        await supabase.from('users').update({ points: newPoints }).eq('user_id', targetUser.id);
        await interaction.reply(`${targetUser.username}に${amount}pを付与しました。`);
    } else if (commandName === 'shop') {
        // ロール購入用のボタン付きメッセージ表示
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('buy_freeman').setLabel('Freeman(自由民)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_lower_noble').setLabel('LowerNoble(下級貴族)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('buy_upper_noble').setLabel('UpperNoble(上級貴族)').setStyle(ButtonStyle.Primary)
        );

        await interaction.reply({
            content: '以下のボタンからロールを購入できます：',
            components: [row]
        });
    } else if (commandName === 'stock') {
        // 株式の購入・売却処理
        const action = options.getString('action');
        const stockName = options.getString('name');
        const stockAmount = options.getInteger('amount');

        const { data: stockData, error: stockError } = await supabase.from('stocks').select('*').eq('name', stockName);
        if (stockError) return await interaction.reply('株データの取得に失敗しました');
        const stock = stockData[0];

        if (action === 'buy') {
            // 購入処理
            const { data: userStockData, error: userStockError } = await supabase.from('user_stocks').select('*').eq('user_id', user.id).eq('stock_id', stock.id);
            if (userStockError) return await interaction.reply('購入処理に失敗しました');

            const newAmount = userStockData.length ? userStockData[0].amount + stockAmount : stockAmount;
            await supabase.from('user_stocks').upsert({ user_id: user.id, stock_id: stock.id, amount: newAmount });
            await interaction.reply(`${stockName}を${stockAmount}株購入しました。`);
        } else if (action === 'sell') {
            // 売却処理
            const { data: userStockData, error: userStockError } = await supabase.from('user_stocks').select('*').eq('user_id', user.id).eq('stock_id', stock.id);
            if (userStockError) return await interaction.reply('売却処理に失敗しました');

            const newAmount = userStockData[0].amount - stockAmount;
            if (newAmount < 0) return await interaction.reply('売却する株数が足りません');

            await supabase.from('user_stocks').update({ amount: newAmount }).eq('user_id', user.id).eq('stock_id', stock.id);
            await interaction.reply(`${stockName}を${stockAmount}株売却しました。`);
        }
    }
});

client.login(TOKEN);
