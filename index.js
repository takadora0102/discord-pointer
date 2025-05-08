const {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ButtonBuilder,
  ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, Events
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

const itemData = [
  { id: 'rename_self', label: '🎭 名前変更（自分）', price: 1000 },
  { id: 'shield', label: '🛡️ シールド', price: 300 },
  { id: 'scope', label: '🔭 望遠鏡', price: 100 }
];

client.once('ready', () => console.log('Bot Ready'));
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  await interaction.deferReply({ ephemeral: interaction.commandName !== 'shop' });

  let member;
  try {
    member = await interaction.guild.members.fetch(userId);
  } catch (err) {
    return interaction.editReply({ content: 'メンバー情報の取得に失敗しました。' });
  }

  if (interaction.commandName === 'register') {
    const { data: existing } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (existing) return interaction.editReply({ content: 'すでに登録済みです。' });

    const role = interaction.guild.roles.cache.find(r => r.name === 'SERF');
    if (role) await member.roles.add(role);
    await member.setNickname(`【SERF】${member.user.username}`).catch(() => {});
    await supabase.from('points').insert({ user_id: userId, point: 1000 });

    return interaction.editReply({ content: '登録完了！1000p 付与されました。' });
  }

  if (interaction.commandName === 'profile') {
    const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!data) return interaction.editReply({ content: '未登録です。/register を先に実行してください。' });

    const shield = data.shield_until ? `🛡️ シールド有効 (${data.shield_until})` : 'なし';
    const locked = data.name_locked_until ? `⏳ 名前変更不可 (${data.name_locked_until})` : 'なし';

    return interaction.editReply({ content: `💰 所持ポイント: ${data.point}p\n${shield}\n${locked}` });
  }

  if (interaction.commandName === 'shop') {
    const sub = interaction.options.getSubcommand();
    if (sub !== 'item') return;

    if (!member.permissions.has('Administrator')) {
      return interaction.editReply({ content: '管理者のみ実行可能です。' });
    }

    const embed = new EmbedBuilder()
      .setTitle('🛍️ アイテムショップ')
      .setDescription('戦略アイテム一覧');

    itemData.forEach(item => {
      embed.addFields({ name: item.label, value: `価格: ${item.price}p`, inline: true });
    });

    const rows = [];
    for (let i = 0; i < itemData.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(
        itemData.slice(i, i + 5).map(item =>
          new ButtonBuilder()
            .setCustomId(`item_${item.id}`)
            .setLabel(item.label)
            .setStyle(ButtonStyle.Secondary)
        )
      ));
    }

    return interaction.editReply({ embeds: [embed], components: rows });
  }
});
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  const itemId = interaction.customId.replace('item_', '');
  const item = itemData.find(i => i.id === itemId);
  if (!item) return;

  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
  if (!userData || userData.point < item.price) {
    return interaction.reply({ content: 'ポイントが不足しています。', ephemeral: true });
  }

  // 🎭 名前変更（自分）→ モーダル表示（※ deferReply 不要）
  if (itemId === 'rename_self') {
    const modal = new ModalBuilder()
      .setCustomId('modal_rename_self')
      .setTitle('名前変更（自分）')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('new_name')
            .setLabel('新しい名前を入力')
            .setStyle(1)
            .setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }

  // 🛡️ シールド使用（直接処理）
  if (itemId === 'shield') {
    const now = new Date();
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24時間後

    if (userData.shield_until && new Date(userData.shield_until) > now) {
      return interaction.reply({ content: 'すでにシールドが有効です。', ephemeral: true });
    }

    await supabase.from('points').update({
      point: userData.point - item.price,
      shield_until: until.toISOString()
    }).eq('user_id', userId);

    return interaction.reply({ content: '🛡️ シールドを展開しました！', ephemeral: true });
  }

  // 🔭 スコープ → モーダル表示（対象ID入力）
  if (itemId === 'scope') {
    const modal = new ModalBuilder()
      .setCustomId('modal_scope')
      .setTitle('🔭 シールド確認')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('target_id')
            .setLabel('対象ユーザーのIDを入力')
            .setStyle(1)
            .setRequired(true)
        )
      );
    return interaction.showModal(modal);
  }
});
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isModalSubmit()) return;

  const userId = interaction.user.id;

  // 🎭 名前変更（自分）
  if (interaction.customId === 'modal_rename_self') {
    await interaction.deferReply({ ephemeral: true });

    const newName = interaction.fields.getTextInputValue('new_name');
    const member = await interaction.guild.members.fetch(userId);
    const updatedNick = `【${member.displayName.split('】')[0].replace('【', '')}】${newName}`;

    await member.setNickname(updatedNick).catch(() => {});
    const { data } = await supabase.from('points').select('*').eq('user_id', userId).single();

    await supabase.from('points').update({ point: data.point - 1000 }).eq('user_id', userId);

    return interaction.editReply({ content: `✅ 名前を「${updatedNick}」に変更しました。` });
  }

  // 🔭 スコープ使用：対象ユーザーのシールド確認
  if (interaction.customId === 'modal_scope') {
    await interaction.deferReply({ ephemeral: true });

    const targetId = interaction.fields.getTextInputValue('target_id');
    const { data: target } = await supabase.from('points').select('*').eq('user_id', targetId).single();
    const now = new Date();

    const shielded = target && target.shield_until && new Date(target.shield_until) > now;

    await supabase.from('points').update({ point: supabase.literal('point - 100') }).eq('user_id', userId);

    return interaction.editReply({
      content: shielded ? '🔭 相手は現在シールド中です。' : '🔭 相手はシールドを使っていません。'
    });
  }
});
const commands = [
  new SlashCommandBuilder().setName('register').setDescription('初期登録'),
  new SlashCommandBuilder().setName('profile').setDescription('プロフィール確認'),
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('ショップ表示')
    .addSubcommand(s => s.setName('item').setDescription('アイテム一覧を表示'))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    await client.login(TOKEN);
  } catch (err) {
    console.error(err);
  }
})();
