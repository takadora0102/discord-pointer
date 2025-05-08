// role_shop_test.js - テスト用ロールショップ機能（/shop role 管理者限定）

const { Client, GatewayIntentBits, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const roleData = [
  { name: 'FREEMAN', price: 50000, description: '(説明)' },
  { name: 'LOW NOBLE', price: 250000, description: '(説明)' },
  { name: 'HIGH NOBLE', price: 500000, description: '(説明)' },
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log('Role Shop Bot Ready');
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'shop') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'role') return;

    // 管理者チェック
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'このコマンドは管理者のみ実行できます。', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('🛡️ ロールショップ')
      .setDescription('上位の称号を購入できます。所持ポイントに応じて購入しましょう。');

    roleData.forEach(r => {
      embed.addFields({ name: `${r.name} - ${r.price}p`, value: r.description });
    });

    const buttons = new ActionRowBuilder().addComponents(
      roleData.map(r => new ButtonBuilder()
        .setCustomId(`buy_${r.name}`)
        .setLabel(`${r.name}を購入`)
        .setStyle(ButtonStyle.Primary))
    );

    await interaction.reply({ embeds: [embed], components: [buttons], ephemeral: false });
  }

  if (interaction.isButton()) {
    const userId = interaction.user.id;
    const targetRole = interaction.customId.replace('buy_', '');
    const roleInfo = roleData.find(r => r.name === targetRole);
    if (!roleInfo) return;

    const member = await interaction.guild.members.fetch(userId);
    const roles = member.roles.cache.map(r => r.name);

    const hasHigherRole = roleData.some(r => r.price > roleInfo.price && roles.includes(r.name));
    const lacksPreviousRole = roleData.some(r => r.price < roleInfo.price && !roles.includes(r.name));

    if (hasHigherRole) return interaction.reply({ content: 'あなたは既に上位のロールを持っています。', ephemeral: true });
    if (lacksPreviousRole) return interaction.reply({ content: '前提となる下位のロールを所持していません。', ephemeral: true });

    const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!data || data.point < roleInfo.price) {
      return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });
    }

    const roleObj = interaction.guild.roles.cache.find(r => r.name === roleInfo.name);
    if (!roleObj) return interaction.reply({ content: 'ロールが見つかりません。', ephemeral: true });

    await member.roles.add(roleObj);
    const nickname = `【${roleInfo.name}】${member.user.username}`;
    await member.setNickname(nickname).catch(() => {});
    await supabase.from('points').update({ point: data.point - roleInfo.price }).eq('user_id', userId);

    await interaction.reply({ content: `${roleInfo.name} を購入しました！`, ephemeral: true });
  }
});

const commands = [
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('各種ショップを表示します')
    .addSubcommand(sub => sub.setName('role').setDescription('ロールショップを表示'))
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    await client.login(TOKEN);
  } catch (err) {
    console.error(err);
  }
})();
