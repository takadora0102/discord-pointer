// ✅ Supabase連携に対応した index.js（/register, /profile, /borrow, /repay, メッセージ加算含む）

const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, REST, Routes } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
require('dotenv').config();

// 環境変数から取得
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;

  if (interaction.commandName === 'register') {
    await interaction.deferReply({ ephemeral: true });

    const { data } = await supabase.from('points').select('*').eq('user_id', userId);
    if (data.length > 0) {
      await interaction.editReply('すでに登録されています！');
      return;
    }

    const member = await interaction.guild.members.fetch(userId);
    const role = interaction.guild.roles.cache.find(r => r.name === 'Serf(農奴)');
    if (role) await member.roles.add(role);
    try {
      await member.setNickname(`【農奴】${member.user.username}`);
    } catch (e) {
      console.log('ニックネーム変更失敗:', e.message);
    }

    await supabase.from('points').insert({ user_id: userId, points: 1000 });
    await interaction.editReply('登録が完了しました！初期ポイント: 1000p');
  }

  if (interaction.commandName === 'profile') {
    await interaction.deferReply({ ephemeral: true });
    const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!data) {
      await interaction.editReply('まだ登録されていません。/register で登録してください。');
      return;
    }
    let msg = `現在のポイント: ${data.points}p`;
    if (data.debt_amount && data.debt_due) {
      msg += `\n💸 借金残高: ${data.debt_amount}p\n📅 返済期限: ${data.debt_due}`;
    }
    await interaction.editReply(msg);
  }

  if (interaction.commandName === 'borrow') {
    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getInteger('amount');
    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!userData) return interaction.editReply('登録されていません。/register してください。');
    if (userData.debt_amount) return interaction.editReply('借金があります。返済後に再度ご利用ください。');
    if (amount > userData.points * 3) return interaction.editReply(`最大借入可能額は ${userData.points * 3}p です。`);

    const total = Math.ceil(amount * 1.1);
    const due = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    await supabase.from('points').update({
      points: userData.points + amount,
      debt_amount: total,
      debt_due: due,
    }).eq('user_id', userId);

    await interaction.editReply(`💰 ${amount}p 借りました（返済額: ${total}p、期限: ${due}）`);
  }

  if (interaction.commandName === 'repay') {
    await interaction.deferReply({ ephemeral: true });
    const amount = interaction.options.getInteger('amount');
    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!userData || !userData.debt_amount) return interaction.editReply('借金はありません。');
    if (userData.points < amount) return interaction.editReply('ポイントが足りません。');

    const newDebt = userData.debt_amount - amount;
    const updates = {
      points: userData.points - amount,
      debt_amount: newDebt > 0 ? newDebt : null,
      debt_due: newDebt > 0 ? userData.debt_due : null,
    };
    await supabase.from('points').update(updates).eq('user_id', userId);

    await interaction.editReply(newDebt > 0 ? `残りの借金: ${newDebt}p` : '💸 借金を完済しました！');
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const userId = message.author.id;
  const today = new Date().toISOString().split('T')[0];

  const { data: log } = await supabase.from('message_logs').select('*').eq('user_id', userId).eq('date', today).single();
  if (log && log.count >= 20) return;

  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
  if (!userData) return;

  const newCount = (log?.count || 0) + 1;
  if (log) {
    await supabase.from('message_logs').update({ count: newCount }).eq('user_id', userId).eq('date', today);
  } else {
    await supabase.from('message_logs').insert({ user_id: userId, date: today, count: 1 });
  }
  await supabase.from('points').update({ points: userData.points + 5 }).eq('user_id', userId);
});

// スラッシュコマンド登録
const commands = [
  new SlashCommandBuilder().setName('register').setDescription('農奴として登録します'),
  new SlashCommandBuilder().setName('profile').setDescription('ポイントと借金の確認'),
  new SlashCommandBuilder().setName('borrow').setDescription('ポイントを借ります').addIntegerOption(o => o.setName('amount').setDescription('借りたい金額').setRequired(true)),
  new SlashCommandBuilder().setName('repay').setDescription('借金を返します').addIntegerOption(o => o.setName('amount').setDescription('返済金額').setRequired(true)),
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

// Express: Render用にポート開放
const app = express();
app.get('/', (req, res) => res.send('Discord BOT is running.'));
app.listen(process.env.PORT || 3000);
