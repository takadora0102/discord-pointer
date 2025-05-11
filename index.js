const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  REST,
  Routes,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const roleSettings = {
  'SLAVE': { price: 0, payout: 1, limit: 20 },
  'SERF': { price: 0, payout: 5, limit: 20 },
  'FREEMAN': { price: 10000, payout: 10, limit: 30 },
  'LOW NOBLE': { price: 50000, payout: 20, limit: 40 },
  'HIGH NOBLE': { price: 250000, payout: 30, limit: 50 },
  'GRAND DUKE': { price: 500000, payout: 50, limit: Infinity },
  'KING': { price: 500000, payout: 50, limit: Infinity },
  'EMPEROR': { price: 1000000, payout: 50, limit: Infinity }
};

const itemList = {
  rename_self: 1000,
  rename_target_s: 10000,
  rename_target_a: 5000,
  rename_target_b: 3500,
  rename_target_c: 2000,
  timeout_s: 10000,
  shield: 300,
  scope: 100
};
const commands = [
  new SlashCommandBuilder().setName('register').setDescription('初回登録'),
  new SlashCommandBuilder().setName('profile').setDescription('プロフィールを表示'),
  new SlashCommandBuilder()
    .setName('debt')
    .setDescription('借金または返済')
    .addStringOption(opt =>
      opt.setName('action')
        .setDescription('borrow（借りる） or repay（返す）')
        .setRequired(true)
        .addChoices(
          { name: '借りる', value: 'borrow' },
          { name: '返す', value: 'repay' }
        ))
    .addIntegerOption(opt =>
      opt.setName('amount')
        .setDescription('金額')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('ロールとアイテムショップを表示'),
  new SlashCommandBuilder()
    .setName('buy')
    .setDescription('商品を購入')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('item:ID または role:NAME')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('use')
    .setDescription('アイテムを使用')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('アイテムID')
        .setRequired(true))
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('対象ユーザー（必要な場合）'))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slashコマンド登録完了');
    client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error(err);
  }
})();
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const member = await interaction.guild.members.fetch(userId);

  if (interaction.commandName === 'register') {
    await interaction.deferReply({ ephemeral: false });

    const { data: exists } = await supabase.from('points').select('user_id').eq('user_id', userId).single();
    if (exists) {
      return interaction.editReply({ content: '✅ 既に登録済みです。' });
    }

    const newNick = `【SERF】${member.user.username}`;
    try {
      await member.setNickname(newNick);
    } catch (err) {
      console.warn(`ニックネーム変更失敗: ${err.message}`);
    }

    const role = interaction.guild.roles.cache.find(r => r.name === 'SERF');
    if (role) {
      try {
        await member.roles.add(role);
      } catch (err) {
        console.warn(`ロール付与失敗: ${err.message}`);
      }
    }

    const { error } = await supabase.from('points').insert({
      user_id: userId,
      point: 1000,
      debt: 0,
      due: null,
      shield_until: null,
      name_locked_: null
    });

    if (error) {
      return interaction.editReply({ content: '❌ 登録に失敗しました。管理者に連絡してください。' });
    }

    return interaction.editReply({ content: '🎉 登録完了！1000p を付与しました。' });
  }
  if (interaction.commandName === 'profile') {
    await interaction.deferReply({ ephemeral: false });

    const now = new Date();
    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!userData) return interaction.editReply({ content: '未登録です。/register を先に実行してください。' });

    const member = await interaction.guild.members.fetch(userId);
    const role = member.roles.cache.find(r => r.name !== '@everyone')?.name || 'なし';

    const shieldMsg = userData.shield_until && new Date(userData.shield_until) > now
      ? (() => {
          const diff = new Date(userData.shield_until) - now;
          const h = Math.floor(diff / 3600000);
          const m = Math.floor((diff % 3600000) / 60000);
          return `残り ${h}時間${m}分`;
        })()
      : 'なし';

    const lockMsg = userData.name_locked_ && new Date(userData.name_locked_) > now
      ? `あと ${Math.ceil((new Date(userData.name_locked_) - now) / 60000)}分`
      : 'なし';

    const { data: inventory } = await supabase.from('item_inventory').select('*').eq('user_id', userId);
    const itemListText = inventory?.filter(i => i.quantity > 0)
      .map(i => `・${i.item_name} ×${i.quantity}`)
      .join('\n') || 'なし';

    const { data: logs } = await supabase.from('item_logs').select('*').eq('user_id', userId);
    const recent = logs?.filter(l => l.result !== 'purchased')
      .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
      .slice(0, 5)
      .map(log => {
        const time = new Date(log.used_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        const tgt = log.target_id ? `<@${log.target_id}>` : '自分';
        return `・${log.item_name}（${tgt}, ${log.result}, ${time}）`;
      }).join('\n') || 'なし';

    return interaction.editReply({
      content:
        `🧾 **プロフィール情報**\n` +
        `🪙 所持ポイント: ${userData.point}p\n` +
        `💸 借金（返済額）: ${userData.debt ? Math.ceil(userData.debt * 1.1) + 'p' : 'なし'}\n` +
        `⏰ 返済期限: ${userData.due || 'なし'}\n` +
        `👑 現在のロール: ${role}\n` +
        `🛡️ シールド状態: ${shieldMsg}\n` +
        `📝 名前変更ロック: ${lockMsg}\n\n` +
        `🎒 **所持アイテム一覧**\n${itemListText}\n\n` +
        `🕘 **最近のアイテム使用履歴**\n${recent}`
    });
  }
  if (interaction.commandName === 'debt') {
    await interaction.deferReply({ ephemeral: false });

    const action = interaction.options.getString('action');
    const amount = interaction.options.getInteger('amount');
    const now = new Date();
    const due = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!userData) return interaction.editReply({ content: '未登録です。/register を先に実行してください。' });

    if (action === 'borrow') {
      if (userData.debt > 0) return interaction.editReply({ content: '既に借金があります。' });
      if (amount > userData.point * 3) return interaction.editReply({ content: `借金は最大 ${userData.point * 3}p までです。` });

      await supabase.from('points')
        .update({ debt: amount, due: due, point: userData.point + amount })
        .eq('user_id', userId);

      return interaction.editReply({ content: `${amount}p を借りました。返済額: ${Math.ceil(amount * 1.1)}p` });
    }

    if (action === 'repay') {
      if (!userData.debt) return interaction.editReply({ content: '借金はありません。' });
      const total = Math.ceil(userData.debt * 1.1);
      if (amount < total) return interaction.editReply({ content: `返済額が不足しています（必要: ${total}p）` });

      await supabase.from('points')
        .update({ point: userData.point - amount, debt: 0, due: null })
        .eq('user_id', userId);

      return interaction.editReply({ content: `借金を返済しました！残りポイント: ${userData.point - amount}p` });
    }
  }
  if (interaction.commandName === 'shop') {
    await interaction.deferReply({ ephemeral: false });

    const roleEmbed = new EmbedBuilder()
      .setTitle('👑 ロールショップ')
      .setDescription('上位称号を購入できます')
      .setColor(0xffd700);

    const purchasableRoles = Object.entries(roleSettings).filter(
      ([name, info]) =>
        info.price > 0 &&
        !['GRAND DUKE', 'KING', 'EMPEROR'].includes(name)
    );

    for (const [name, info] of purchasableRoles) {
      roleEmbed.addFields({
        name: `/buy role:${name}`,
        value: `${info.price}p`,
        inline: false
      });
    }

    const itemEmbed = new EmbedBuilder()
      .setTitle('🛍️ アイテムショップ')
      .setDescription('以下のアイテムは `/use` コマンドで使用します（購入だけでは効果は発動しません）')
      .setColor(0x00bfff);

    for (const [id, price] of Object.entries(itemList)) {
      itemEmbed.addFields({
        name: `/buy item:${id}`,
        value: `${price}p`,
        inline: false
      });
    }

    return interaction.editReply({
      embeds: [roleEmbed, itemEmbed]
    });
  }
  if (interaction.commandName === 'buy') {
    await interaction.deferReply({ ephemeral: false });

    const input = interaction.options.getString('item');
    const now = new Date();

    const [type, value] = input.split(':');
    if (!type || !value) {
      return interaction.editReply({ content: '❌ 正しい形式で入力してください（例：item:shield / role:FREEMAN）' });
    }

    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!userData) return interaction.editReply({ content: '未登録です。まずは /register を実行してください。' });

    if (type === 'item') {
      const price = itemList[value];
      if (!price) return interaction.editReply({ content: '❌ 無効なアイテムIDです。' });
      if (userData.point < price) return interaction.editReply({ content: '❌ ポイントが不足しています。' });

      const { data: inventory } = await supabase
        .from('item_inventory')
        .select('quantity')
        .eq('user_id', userId)
        .eq('item_name', value)
        .single();

      if (inventory) {
        await supabase.from('item_inventory')
          .update({ quantity: inventory.quantity + 1 })
          .eq('user_id', userId)
          .eq('item_name', value);
      } else {
        await supabase.from('item_inventory')
          .insert({ user_id: userId, item_name: value, quantity: 1 });
      }

      await supabase.from('points')
        .update({ point: userData.point - price })
        .eq('user_id', userId);

      await supabase.from('item_logs').insert({
        user_id: userId,
        item_name: value,
        result: 'purchased',
        used_at: now.toISOString()
      });

      return interaction.editReply({ content: `🛒 \`${value}\` を ${price}p で購入しました。` });
    }
    if (type === 'role') {
      const roleInfo = roleSettings[value];
      if (!roleInfo || roleInfo.price === 0 || ['GRAND DUKE', 'KING', 'EMPEROR'].includes(value)) {
        return interaction.editReply({ content: '❌ このロールは購入できません。' });
      }

      const member = await interaction.guild.members.fetch(userId);
      const roles = member.roles.cache.map(r => r.name.toUpperCase());

      const higher = Object.entries(roleSettings)
        .some(([r, s]) => s.price > roleInfo.price && roles.includes(r));
      const lower = Object.entries(roleSettings)
        .some(([r, s]) => s.price < roleInfo.price && roles.includes(r));

      if (higher) return interaction.editReply({ content: '❌ 上位ロールを既に所持しています。' });
      if (!lower) return interaction.editReply({ content: '❌ 前提ロールを所持していません。' });
      if (userData.point < roleInfo.price) return interaction.editReply({ content: '❌ ポイントが不足しています。' });

      const newRole = interaction.guild.roles.cache.find(r => r.name === value);
      if (!newRole) return interaction.editReply({ content: '❌ ロールが見つかりません。' });

      await member.roles.add(newRole);
      const nickname = `【${value}】${member.user.username}`;
      await member.setNickname(nickname).catch(() => {});

      await supabase.from('points')
        .update({ point: userData.point - roleInfo.price })
        .eq('user_id', userId);

      return interaction.editReply({ content: `✅ \`${value}\` を購入し、ロールを付与しました！` });
    }

    return interaction.editReply({ content: '❌ 無効な形式です（item:xxx / role:xxx）' });
  }
  if (interaction.commandName === 'use') {
  await interaction.deferReply({ ephemeral: false });

  const itemId = interaction.options.getString('item');
  const targetUser = interaction.options.getUser('user');
  const now = new Date();

  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
  if (!userData) return interaction.editReply({ content: '未登録です。' });

  // 🔍 安全な在庫チェック（.single()を使わない）
  const { data: inventoryList, error: inventoryError } = await supabase
    .from('item_inventory')
    .select('quantity')
    .eq('user_id', userId)
    .eq('item_name', itemId)
    .limit(1);

  if (inventoryError) {
    console.error('Supabaseエラー（item_inventory取得）:', inventoryError);
    return interaction.editReply({ content: '⚠️ データベースエラーが発生しました。' });
  }

  const quantity = inventoryList?.[0]?.quantity ?? 0;

  if (quantity < 1) {
    console.warn(`アイテム未所持: user=${userId}, item=${itemId}, quantity=${quantity}`);
    return interaction.editReply({ content: '❌ 所持していないアイテムです。' });
  }

  // ✅ 在庫を1減らす
  await supabase.from('item_inventory')
    .update({ quantity: quantity - 1 })
    .eq('user_id', userId)
    .eq('item_name', itemId);

  // 🛡️ シールド
  if (itemId === 'shield') {
    const until = new Date(now.getTime() + 86400000).toISOString();
    await supabase.from('points').update({ shield_until: until }).eq('user_id', userId);
    await supabase.from('item_logs').insert({
      user_id: userId,
      item_name: itemId,
      result: 'success',
      used_at: now.toISOString()
    });
    return interaction.editReply({ content: '🛡️ シールドを使用しました。' });
  }

  // 🔍 スコープ（相手のシールド確認）
  if (itemId === 'scope') {
    if (!targetUser) return interaction.editReply({ content: '❌ 対象ユーザーを指定してください。' });

    const { data: targetData } = await supabase.from('points').select('shield_until').eq('user_id', targetUser.id).single();
    const shielded = targetData?.shield_until && new Date(targetData.shield_until) > now;

    await supabase.from('item_logs').insert({
      user_id: userId,
      item_name: itemId,
      target_id: targetUser.id,
      result: shielded ? 'shielded' : 'unshielded',
      used_at: now.toISOString()
    });

    return interaction.editReply({
      content: shielded
        ? `${targetUser.username} は現在🛡️シールド中です。`
        : `${targetUser.username} はシールド未使用です。`
    });
  }

  // 🎯 ターゲットアイテム（名前変更・タイムアウト）
  const needsTarget = ['rename_target_s', 'rename_target_a', 'rename_target_b', 'rename_target_c', 'timeout_s'];
  if (needsTarget.includes(itemId) && !targetUser) {
    return interaction.editReply({ content: '❌ 対象ユーザーを指定してください。' });
  }

  const rolePriority = ['SLAVE', 'SERF', 'FREEMAN', 'LOW NOBLE', 'HIGH NOBLE', 'GRAND DUKE', 'KING', 'EMPEROR'];
  const getRank = m => m.roles.cache.map(r => rolePriority.indexOf(r.name)).filter(i => i >= 0).reduce((a, b) => Math.max(a, b), -1);

  const member = await interaction.guild.members.fetch(userId);
  const targetMember = targetUser && await interaction.guild.members.fetch(targetUser.id);

  const { data: targetPoints } = targetUser
    ? await supabase.from('points').select('shield_until').eq('user_id', targetUser.id).single()
    : { data: null };

  if (targetPoints?.shield_until && new Date(targetPoints.shield_until) > now) {
    return interaction.editReply({ content: '🛡️ 相手は現在シールド中です。' });
  }

  let success = true;
  if (targetUser && getRank(targetMember) > getRank(member)) {
    success = Math.random() < 0.5;
  }

  await supabase.from('item_logs').insert({
    user_id: userId,
    item_name: itemId,
    target_id: targetUser?.id || null,
    result: success ? 'success' : 'fail',
    used_at: now.toISOString()
  });

  if (!success) {
    return interaction.editReply({ content: '❌ アイテム使用に失敗しました（成功率50%）' });
  }

  // 📝 名前変更（ターゲット）
  if (itemId.startsWith('rename_target_')) {
    const lockMin = { rename_target_s: 60, rename_target_a: 30, rename_target_b: 20, rename_target_c: 10 }[itemId];
    const lockUntil = new Date(now.getTime() + lockMin * 60000).toISOString();
    await supabase.from('points').update({ name_locked_: lockUntil }).eq('user_id', targetUser.id);

    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`rename_target_modal-${targetUser.id}`)
        .setTitle('相手の名前変更')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('nickname')
              .setLabel('新しいニックネーム')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(20)
              .setRequired(true)
          )
        )
    );
  }

  // ⏱️ タイムアウト
  if (itemId === 'timeout_s') {
    await targetMember.timeout(5 * 60 * 1000, 'アイテム使用によるタイムアウト');
    return interaction.editReply({ content: `⏱️ ${targetUser.username} を5分間タイムアウトしました。` });
  }

  // 🧍 名前変更（自分）
  if (itemId === 'rename_self') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId('rename_self_modal')
        .setTitle('自分の名前変更')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('nickname')
              .setLabel('新しいニックネーム')
              .setStyle(TextInputStyle.Short)
              .setMaxLength(20)
              .setRequired(true)
          )
        )
    );
  }
}

});

client.on('interactionCreate', async interaction => {
  if (interaction.isModalSubmit()) {
    const userId = interaction.user.id;
    const now = new Date();

    if (interaction.customId === 'rename_self_modal') {
      const newName = interaction.fields.getTextInputValue('nickname');
      const member = await interaction.guild.members.fetch(userId);
      await member.setNickname(newName);
      await supabase.from('item_logs').insert({
        user_id: userId,
        item_name: 'rename_self',
        target_id: userId,
        result: 'success',
        used_at: now.toISOString()
      });
      return interaction.reply({ content: `✅ 自分のニックネームを「${newName}」に変更しました。`, ephemeral: false });
    }

    if (interaction.customId.startsWith('rename_target_modal')) {
      const targetId = interaction.customId.split('-')[1];
      const newName = interaction.fields.getTextInputValue('nickname');
      const member = await interaction.guild.members.fetch(targetId);
      await member.setNickname(newName);
      await supabase.from('item_logs').insert({
        user_id: userId,
        item_name: 'rename_target',
        target_id: targetId,
        result: 'success',
        used_at: now.toISOString()
      });
      return interaction.reply({ content: `✅ 対象ユーザーのニックネームを「${newName}」に変更しました。`, ephemeral: false });
    }
  }
});
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const member = await message.guild.members.fetch(userId);
  const roles = member.roles.cache.map(r => r.name.toUpperCase());
  const matched = roles.find(r => roleSettings[r]);
  if (!matched) return;

  const { payout, limit } = roleSettings[matched];
  const today = new Date().toISOString().split('T')[0];

  const { data: logData } = await supabase
    .from('message_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();

  const count = logData?.count || 0;
  const lastTime = logData?.updated_at ? new Date(logData.updated_at).getTime() : 0;
  if (count >= limit || Date.now() - lastTime < 60000) return;

  const { data: pointData } = await supabase
    .from('points')
    .select('*')
    .eq('user_id', userId)
    .single();

  const newPoint = (pointData?.point || 0) + payout;
  if (!pointData) {
    await supabase.from('points').insert({ user_id: userId, point: newPoint, debt: 0, due: null });
  } else {
    await supabase.from('points').update({ point: newPoint }).eq('user_id', userId);
  }

  if (!logData) {
    await supabase.from('message_logs').insert({ user_id: userId, date: today, count: 1 });
  } else {
    await supabase.from('message_logs').update({ count: count + 1 }).eq('user_id', userId).eq('date', today);
  }
});
// 自動返済処理（Renderやcronから呼び出す）
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  if (req.url === '/repay-check') {
    const today = new Date().toISOString().split('T')[0];
    const { data: users } = await supabase.from('points').select('*').lt('due', today).neq('debt', 0);
    if (users) {
      const guild = client.guilds.cache.get(process.env.GUILD_ID);
      for (const user of users) {
        const member = await guild.members.fetch(user.user_id).catch(() => null);
        if (!member) continue;
        const total = Math.ceil(user.debt * 1.1);
        let point = user.point;

        if (point >= total) {
          await supabase.from('points').update({ point: point - total, debt: 0, due: null }).eq('user_id', user.user_id);
        } else {
          const roles = member.roles.cache.map(r => r.name.toUpperCase());
          const owned = Object.entries(roleSettings).filter(([r]) => roles.includes(r)).sort((a, b) => b[1].price - a[1].price);
          let recovered = 0;

          for (const [roleName, info] of owned) {
            if (info.price === 0) continue;
            const role = member.roles.cache.find(r => r.name.toUpperCase() === roleName);
            if (role) await member.roles.remove(role);
            recovered += Math.floor(info.price / 2);
            const lower = Object.entries(roleSettings).filter(([r, s]) => s.price < info.price).sort((a, b) => b[1].price - a[1].price)[0];
            if (lower) {
              const newRole = guild.roles.cache.find(r => r.name === lower[0]);
              if (newRole) await member.roles.add(newRole);
              await member.setNickname(`【${lower[0]}】${member.user.username}`).catch(() => {});
            }
            break;
          }

          if (point + recovered >= total) {
            await supabase.from('points').update({ point: point + recovered - total, debt: 0, due: null }).eq('user_id', user.user_id);
          } else {
            const slave = guild.roles.cache.find(r => r.name === 'SLAVE');
            if (slave) await member.roles.add(slave);
            await member.setNickname(`【SLAVE】${member.user.username}`).catch(() => {});
            await supabase.from('points').update({ point: 0, debt: 0, due: null }).eq('user_id', user.user_id);
          }
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Repay check completed.');
  } else {
    res.writeHead(200);
    res.end('Bot is alive.');
  }
}).listen(PORT, () => {
  console.log(`HTTP server running on port ${PORT}`);
});

client.once('ready', () => {
  console.log('✅ Bot Ready');
});
