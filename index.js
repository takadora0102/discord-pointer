
const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const express = require('express');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 10000;

const POINTS_FILE = './points.json';
function loadPoints() {
    if (!fs.existsSync(POINTS_FILE)) fs.writeFileSync(POINTS_FILE, '{}');
    return JSON.parse(fs.readFileSync(POINTS_FILE, 'utf8'));
}
function savePoints(data) {
    fs.writeFileSync(POINTS_FILE, JSON.stringify(data, null, 2));
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel]
});

const shopRoles = {
    people: [{ name: "Knight(騎士)", price: 10000 }],
    gentry: [{ name: "Baron(男爵)", price: 10 }],
    noble: [
        { name: "Viscount(子爵)", price: 10 },
        { name: "Count(伯爵)", price: 10 },
        { name: "Marquess(侯爵)", price: 10 },
        { name: "Duke(公爵)", price: 10 }
    ]
};

function createShopEmbed(title, roles) {
    const embed = new EmbedBuilder().setTitle(title).setDescription("ボタンを押してロールを購入してください");
    const row = new ActionRowBuilder();
    roles.forEach((role) => {
        row.addComponents(new ButtonBuilder()
            .setCustomId(`buy_${role.name}`)
            .setLabel(`${role.name} - ${role.price}p`)
            .setStyle(ButtonStyle.Primary));
    });
    return { embeds: [embed], components: [row] };
}

client.once('ready', async () => {
    const commands = [
        new SlashCommandBuilder().setName('register').setDescription('ユーザーを登録します'),
        new SlashCommandBuilder().setName('profile').setDescription('プロフィールを表示します'),
        new SlashCommandBuilder().setName('repay').setDescription('借金を返済します').addIntegerOption(option => option.setName('amount').setDescription('返済額').setRequired(true)),
        new SlashCommandBuilder().setName('shop_people').setDescription('民衆層ショップ').setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
        new SlashCommandBuilder().setName('shop_gentry').setDescription('準貴族ショップ').setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
        new SlashCommandBuilder().setName('shop_noble').setDescription('貴族層ショップ').setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });

    console.log("スラッシュコマンドを登録しました。");
    client.user.setActivity('階級社会を監視中');
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = interaction.commandName;
        const userId = interaction.user.id;
        const member = await interaction.guild.members.fetch(userId);
        const pointsData = loadPoints();
        pointsData[userId] ??= { points: 1000 };

        if (command === 'register') {
            try {
                const role = interaction.guild.roles.cache.find(r => r.name === 'Serf(農奴)');
                if (!role) return interaction.reply({ content: '農奴ロールが見つかりません。', ephemeral: true });

                await member.roles.add(role);
                await member.setNickname(`【農奴】${interaction.user.username}`);
                pointsData[userId] = { points: 1000 };
                savePoints(pointsData);
                await interaction.reply({ content: '登録が完了しました！', ephemeral: true });
            } catch (err) {
                console.error("登録時エラー:", err);
                interaction.reply({ content: '登録に失敗しました。', ephemeral: true });
            }
        }

        if (command === 'profile') {
            try {
                await interaction.deferReply({ ephemeral: true });
                const data = pointsData[userId];
                let msg = `現在のポイント: ${data.points}p`;

                if (data.debt) {
                    msg += `
💸 借金残高: ${data.debt.amount}p
📅 返済期限: ${data.debt.due}`;
                }

                await interaction.editReply({ content: msg });
            } catch (err) {
                console.error("reply error (profile full):", err);
            }
        }

        if (command === 'repay') {
            const amount = interaction.options.getInteger('amount');
            const data = pointsData[userId];
            if (!data.debt) return interaction.reply({ content: '借金はありません。', ephemeral: true });
            if (amount > data.points) return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });

            data.points -= amount;
            data.debt.amount -= amount;
            if (data.debt.amount <= 0) delete data.debt;
            savePoints(pointsData);
            interaction.reply({ content: '返済が完了しました。', ephemeral: true });
        }

        if (command === 'shop_people') {
            await interaction.reply(createShopEmbed("民衆層ショップ", shopRoles.people));
        }
        if (command === 'shop_gentry') {
            await interaction.reply(createShopEmbed("準貴族ショップ", shopRoles.gentry));
        }
        if (command === 'shop_noble') {
            await interaction.reply(createShopEmbed("貴族層ショップ", shopRoles.noble));
        }
    }

    if (interaction.isButton()) {
        const customId = interaction.customId;
        const userId = interaction.user.id;
        const member = await interaction.guild.members.fetch(userId);
        const pointsData = loadPoints();
        const userPoints = pointsData[userId]?.points || 0;

        const allRoles = [...shopRoles.people, ...shopRoles.gentry, ...shopRoles.noble];
        const role = allRoles.find(r => `buy_${r.name}` === customId);
        if (!role) return;

        const roleObj = interaction.guild.roles.cache.find(r => r.name === role.name);
        if (!roleObj) return interaction.reply({ content: "ロールが見つかりません。", ephemeral: true });

        const index = allRoles.findIndex(r => r.name === role.name);
        if (index > 0) {
            const lowerRoleName = allRoles[index - 1].name;
            const lowerRole = interaction.guild.roles.cache.find(r => r.name === lowerRoleName);
            if (!member.roles.cache.has(lowerRole?.id)) {
                return interaction.reply({ content: `このロールを購入するには ${lowerRoleName} を所持している必要があります。`, ephemeral: true });
            }
        }

        if (userPoints < role.price) {
            return interaction.reply({ content: `ポイントが不足しています（必要: ${role.price}p）`, ephemeral: true });
        }

        await member.roles.add(roleObj);
        await member.setNickname(`【${role.name.split('(')[1].replace(')', '')}】${interaction.user.username}`);
        pointsData[userId].points -= role.price;
        savePoints(pointsData);
        await interaction.reply({ content: `${role.name} を購入しました！`, ephemeral: true });
    }
});

// --- Express pingサーバー for Render ---
const app = express();
app.get('/', (_, res) => res.send('Bot is alive!'));
app.listen(PORT, () => {
    console.log(`Express server is listening on port ${PORT}`);
});

client.login(TOKEN);
