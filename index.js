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

    if (commandName === 'register') {
        // ユーザーの情報をデータベースに登録する処理
        const userId = user.id;
        const { error } = await supabase
            .from('profiles')
            .upsert([{ user_id: userId, points: 0, debt: 0, stocks: [] }], { onConflict: ['user_id'] });

        if (error) {
            await interaction.reply('ユーザー登録に失敗しました。');
        } else {
            await interaction.reply('登録が完了しました。');
        }
    } else if (commandName === 'profile') {
        await interaction.deferReply({ ephemeral: true });
        const userId = user.id;

        const { data, error } = await supabase
            .from('profiles')
            .select('points, debt, stocks')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            return await interaction.editReply('情報の取得に失敗しました。データベースにユーザーの情報がないか、エラーが発生しました。');
        }

        const points = data.points || 0;
        const debt = data.debt || 0;
        const stocks = data.stocks || [];

        let stocksInfo = '保有株:\n';
        if (stocks.length === 0) {
            stocksInfo += '株を保有していません。\n';
        } else {
            stocks.forEach(stock => {
                stocksInfo += `- ${stock.name} : ${stock.amount}株 (${stock.price}p) \n`;
            });
        }

        const profileMessage = `**ポイント:** ${points}p\n**借金残高:** ${debt}p\n\n${stocksInfo}`;

        await interaction.editReply(profileMessage);
    } else if (commandName === 'borrow') {
        const amount = options.getInteger('amount');
        if (amount <= 0) {
            return await interaction.reply('借金額は1以上でなければなりません。');
        }

        const userId = user.id;
        const { data, error } = await supabase
            .from('profiles')
            .select('points, debt')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            return await interaction.reply('ユーザーの情報が取得できませんでした。');
        }

        const newDebt = data.debt + amount;
        const newPoints = data.points - amount;

        if (newPoints < 0) {
            return await interaction.reply('ポイントが不足しています。');
        }

        await supabase
            .from('profiles')
            .update({ debt: newDebt, points: newPoints })
            .eq('user_id', userId);

        await interaction.reply(`借金が${amount}p増えました。現在の借金残高は${newDebt}pです。`);
    } else if (commandName === 'repay') {
        const amount = options.getInteger('amount');
        if (amount <= 0) {
            return await interaction.reply('返済額は1以上でなければなりません。');
        }

        const userId = user.id;
        const { data, error } = await supabase
            .from('profiles')
            .select('points, debt')
            .eq('user_id', userId)
            .single();

        if (error || !data) {
            return await interaction.reply('ユーザーの情報が取得できませんでした。');
        }

        if (data.debt < amount) {
            return await interaction.reply('返済額が借金残高を上回っています。');
        }

        const newDebt = data.debt - amount;
        const newPoints = data.points - amount;

        if (newPoints < 0) {
            return await interaction.reply('ポイントが不足しています。');
        }

        await supabase
            .from('profiles')
            .update({ debt: newDebt, points: newPoints })
            .eq('user_id', userId);

        await interaction.reply(`返済が完了しました。残りの借金は${newDebt}pです。`);
    } else if (commandName === 'addpoints') {
        const targetUser = options.getUser('user');
        const amount = options.getInteger('amount');

        if (!targetUser || amount <= 0) {
            return await interaction.reply('無効な引数です。');
        }

        const { data, error } = await supabase
            .from('profiles')
            .select('points')
            .eq('user_id', targetUser.id)
            .single();

        if (error || !data) {
            return await interaction.reply('ユーザーの情報が取得できませんでした。');
        }

        const newPoints = data.points + amount;

        await supabase
            .from('profiles')
            .update({ points: newPoints })
            .eq('user_id', targetUser.id);

        await interaction.reply(`${targetUser.tag}に${amount}pが付与されました。`);
    } else if (commandName === 'shop') {
        // ロールショップ表示の処理
        await interaction.reply('ロールショップの表示機能を実装します');
    } else if (commandName === 'stock') {
        const action = options.getString('action');
        const stockName = options.getString('name');
        const stockAmount = options.getInteger('amount');

        if (action === 'buy') {
            // 株を購入する処理
            await interaction.reply(`株の購入処理: ${stockName} を${stockAmount}株購入します。`);
        } else if (action === 'sell') {
            // 株を売却する処理
            await interaction.reply(`株の売却処理: ${stockName} を${stockAmount}株売却します。`);
        }
    }
});

client.login(TOKEN);
