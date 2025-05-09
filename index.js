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
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle
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

const commands = [
  new SlashCommandBuilder().setName('register').setDescription('初回登録'),
  new SlashCommandBuilder().setName('profile').setDescription('プロフィールを表示'),
  new SlashCommandBuilder()
    .setName('debt')
    .setDescription('借金または返済')
    .addStringOption(opt =>
      opt.setName('action').setDescription('借りるか返すか').setRequired(true).addChoices(
        { name: '借りる', value: 'borrow' },
        { name: '返す', value: 'repay' }
      ))
    .addIntegerOption(opt => opt.setName('amount').setDescription('金額').setRequired(true)),
  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('アイテムとロールの一覧を表示'),
  new SlashCommandBuilder()
    .setName('buy')
    .setDescription('アイテムまたはロールを購入')
    .addStringOption(opt => opt.setName('item').setDescription('item:shield または role:LOW NOBLE').setRequired(true)),
  new SlashCommandBuilder()
    .setName('use')
    .setDescription('アイテムを使用する')
    .addStringOption(opt => opt.setName('item').setDescription('アイテムID').setRequired(true))
    .addUserOption(opt => opt.setName('user').setDescription('対象ユーザー（任意）'))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
    console.log('✅ コマンド登録完了');
    client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error('❌ コマンド登録失敗', err);
  }
})();
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const member = await interaction.guild.members.fetch(userId);

  if (interaction.commandName === 'register') {
    const { data: exists } = await supabase.from('points').select('user_id').eq('user_id', userId).single();
    if (exists) return interaction.reply({ content: 'すでに登録されています。', ephemeral: true });

    const role = interaction.guild.roles.cache.find(r => r.name === 'SERF');
    if (role) await member.roles.add(role);
    await member.setNickname(`【SERF】${member.user.username}`).catch(() => {});
    await supabase.from('points').insert({ user_id: userId, point: 1000, debt: 0, due: null });

    return interaction.reply({ content: '✅ 登録が完了しました！1000pを付与しました。', ephemeral: true });
  }

  if (interaction.commandName === 'debt') {
    const action = interaction.options.getString('action');
    const amount = interaction.options.getInteger('amount');
    const now = new Date();
    const due = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    const { data: user } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!user) return interaction.reply({ content: '登録されていません。/register を実行してください。', ephemeral: true });

    if (action === 'borrow') {
      if (user.debt > 0) return interaction.reply({ content: 'すでに借金があります。', ephemeral: true });
      if (amount > user.point * 3) return interaction.reply({ content: `最大借入可能額は ${user.point * 3}p です。`, ephemeral: true });

      await supabase.from('points')
        .update({ debt: amount, due: due, point: user.point + amount })
        .eq('user_id', userId);

      return interaction.reply({ content: `${amount}p を借りました。返済総額: ${Math.ceil(amount * 1.1)}p`, ephemeral: true });
    }

    if (action === 'repay') {
      if (!user.debt) return interaction.reply({ content: '借金はありません。', ephemeral: true });

      const total = Math.ceil(user.debt * 1.1);
      if (amount < total) return interaction.reply({ content: `返済額が不足しています（必要: ${total}p）`, ephemeral: true });

      await supabase.from('points')
        .update({ point: user.point - amount, debt: 0, due: null })
        .eq('user_id', userId);

      return interaction.reply({ content: `借金を返済しました。残りポイント: ${user.point - amount}p`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'profile') {
    const now = new Date();
    const { data: user } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!user) return interaction.reply({ content: '未登録です。/register を先に使用してください。', ephemeral: true });

    const shieldMsg = user.shield_until && new Date(user.shield_until) > now
      ? `残り ${Math.floor((new Date(user.shield_until) - now) / 3600000)}時間`
      : 'なし';

    const lockMsg = user.name_locked_ && new Date(user.name_locked_) > now
      ? `あと ${Math.ceil((new Date(user.name_locked_) - now) / 60000)}分`
      : 'なし';

    const role = member.roles.cache.find(r => r.name !== '@everyone')?.name || 'なし';

    const { data: logs } = await supabase.from('item_logs').select('item_name, result, target_id, used_at').eq('user_id', userId);
    const inv = new Map();
    logs?.forEach(l => {
      if (!inv.has(l.item_name)) inv.set(l.item_name, { bought: 0, used: 0 });
      if (l.result === 'purchased') inv.get(l.item_name).bought++;
      else inv.get(l.item_name).used++;
    });

    const unused = Array.from(inv.entries()).filter(([_, v]) => v.bought > v.used)
      .map(([name, v]) => `・${name} ×${v.bought - v.used}`).join('\n') || 'なし';

    const recent = logs?.filter(l => l.result !== 'purchased')
      .sort((a, b) => new Date(b.used_at) - new Date(a.used_at)).slice(0, 5)
      .map(log => {
        const time = new Date(log.used_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        const tgt = log.target_id ? `<@${log.target_id}>` : '自分';
        return `・${log.item_name}（${tgt}, ${log.result}, ${time}）`;
      }).join('\n') || 'なし';

    return interaction.reply({
      content:
        `🧾 **プロフィール情報**\n` +
        `🪙 ポイント: ${user.point}p\n` +
        `💸 借金: ${user.debt ? `${Math.ceil(user.debt * 1.1)}p（利息込み）` : 'なし'}\n` +
        `⏰ 返済期限: ${user.due || 'なし'}\n` +
        `👑 ロール: ${role}\n` +
        `🛡️ シールド状態: ${shieldMsg}\n` +
        `📝 名前変更ロック: ${lockMsg}\n\n` +
        `🎒 **未使用アイテム**\n${unused}\n\n` +
        `🕘 **最近のアイテム使用履歴**\n${recent}`,
      ephemeral: true
    });
  }
});
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const now = new Date();

  if (interaction.commandName === 'shop') {
    const embed = new EmbedBuilder()
      .setTitle('🛍️ 総合ショップ')
      .setDescription('以下の商品は `/buy` コマンドで購入できます。\n例: `/buy item:shield` や `/buy role:LOW NOBLE`')
      .setColor(0x00bfff);

    const itemLines = Object.entries(itemList).map(([id, price]) => `・\`item:${id}\`｜${price}p`).join('\n');
    const roleLines = Object.entries(roleSettings)
      .filter(([_, info]) => info.price > 0)
      .map(([name, info]) => `・\`role:${name}\`｜${info.price}p`).join('\n');

    embed.addFields(
      { name: '🧾 アイテム一覧', value: itemLines || 'なし' },
      { name: '👑 ロール一覧', value: roleLines || 'なし' }
    );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.commandName === 'buy') {
    const rawId = interaction.options.getString('item'); // 例: item:shield, role:LOW NOBLE
    const isItem = rawId.startsWith('item:');
    const isRole = rawId.startsWith('role:');
    const id = rawId.split(':')[1];

    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!userData) return interaction.reply({ content: '未登録です。/register を使ってください。', ephemeral: true });

    // ▼ アイテム購入
    if (isItem) {
      const price = itemList[id];
      if (!price) return interaction.reply({ content: '無効なアイテムIDです。', ephemeral: true });
      if (userData.point < price) return interaction.reply({ content: '❌ ポイントが不足しています。', ephemeral: true });

      await supabase.from('points').update({ point: userData.point - price }).eq('user_id', userId);
      await supabase.from('item_logs').insert({
        user_id: userId,
        item_name: id,
        result: 'purchased',
        used_at: now.toISOString()
      });

      return interaction.reply({ content: `✅ \`${id}\` を ${price}p で購入しました。`, ephemeral: true });
    }

    // ▼ ロール購入
    if (isRole) {
      const roleInfo = roleSettings[id];
      if (!roleInfo || roleInfo.price === 0) return interaction.reply({ content: 'このロールは購入できません。', ephemeral: true });
      if (userData.point < roleInfo.price) return interaction.reply({ content: '❌ ポイントが不足しています。', ephemeral: true });

      const member = await interaction.guild.members.fetch(userId);
      const roles = member.roles.cache.map(r => r.name);
      const hasHigher = Object.entries(roleSettings).some(([r, s]) => s.price > roleInfo.price && roles.includes(r));
      const missingPre = Object.entries(roleSettings).some(([r, s]) => s.price < roleInfo.price && !roles.includes(r));

      if (hasHigher) return interaction.reply({ content: '上位ロールを既に所持しています。', ephemeral: true });
      if (missingPre) return interaction.reply({ content: '前提となるロールを所持していません。', ephemeral: true });

      const roleObj = interaction.guild.roles.cache.find(r => r.name === id);
      if (!roleObj) return interaction.reply({ content: 'ロールが見つかりません。', ephemeral: true });

      await member.roles.add(roleObj);
      await member.setNickname(`【${id}】${member.user.username}`).catch(() => {});
      await supabase.from('points').update({ point: userData.point - roleInfo.price }).eq('user_id', userId);

      return interaction.reply({ content: `👑 \`${id}\` を購入し、ロールを付与しました！`, ephemeral: true });
    }

    return interaction.reply({ content: '❌ 無効な商品IDです。`item:` または `role:` で始めてください。', ephemeral: true });
  }
});
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const userId = interaction.user.id;
  const now = new Date();

  if (interaction.commandName === 'use') {
    const itemId = interaction.options.getString('item');
    const targetUser = interaction.options.getUser('user');

    // 所持チェック
    const { data: itemLogs } = await supabase.from('item_logs').select('item_name, result').eq('user_id', userId);
    const usageMap = {};
    itemLogs?.forEach(log => {
      if (!usageMap[log.item_name]) usageMap[log.item_name] = { bought: 0, used: 0 };
      if (log.result === 'purchased') usageMap[log.item_name].bought++;
      else usageMap[log.item_name].used++;
    });
    const itemCount = usageMap[itemId] || { bought: 0, used: 0 };
    if (itemCount.bought - itemCount.used <= 0) {
      return interaction.reply({ content: '❌ このアイテムは所持していません。まず /buy してください。', ephemeral: true });
    }

    // ユーザーデータ取得
    const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
    if (!userData) return interaction.reply({ content: '未登録です。/register を先に使ってください。', ephemeral: true });

    // ▼ shield
    if (itemId === 'shield') {
      const until = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      await supabase.from('points').update({ shield_until: until }).eq('user_id', userId);
      await supabase.from('item_logs').insert({
        user_id: userId,
        item_name: itemId,
        result: 'success',
        used_at: now.toISOString()
      });
      return interaction.reply({ content: '🛡️ シールドを使用しました。', ephemeral: true });
    }

    // ▼ scope
    if (itemId === 'scope') {
      const { data: target } = await supabase.from('points').select('shield_until').eq('user_id', targetUser.id).single();
      const shielded = target?.shield_until && new Date(target.shield_until) > now;
      await supabase.from('item_logs').insert({
        user_id: userId,
        item_name: itemId,
        target_id: targetUser.id,
        result: shielded ? 'shielded' : 'unshielded',
        used_at: now.toISOString()
      });
      return interaction.reply({
        content: shielded ? `${targetUser.username} は🛡️シールド中です。` : `${targetUser.username} はシールド未使用です。`,
        ephemeral: true
      });
    }

    // ▼ 他者対象アイテム（名前変更 / タイムアウト）
    const needsTarget = ['rename_target_s', 'rename_target_a', 'rename_target_b', 'rename_target_c', 'timeout_s'];
    if (needsTarget.includes(itemId)) {
      if (!targetUser) return interaction.reply({ content: '❌ 対象ユーザーを指定してください。', ephemeral: true });

      const rolePriority = ['SLAVE', 'SERF', 'FREEMAN', 'LOW NOBLE', 'HIGH NOBLE', 'GRAND DUKE', 'KING', 'EMPEROR'];
      const getRank = member => {
        const roles = member.roles.cache.map(r => r.name.toUpperCase());
        return Math.max(...roles.map(r => rolePriority.indexOf(r)).filter(i => i >= 0));
      };

      const member = await interaction.guild.members.fetch(userId);
      const targetMember = await interaction.guild.members.fetch(targetUser.id);

      const { data: targetData } = await supabase.from('points').select('shield_until').eq('user_id', targetUser.id).single();
      if (targetData?.shield_until && new Date(targetData.shield_until) > now) {
        return interaction.reply({ content: '🛡️ 相手は現在シールド中です。', ephemeral: true });
      }

      let success = true;
      if (getRank(targetMember) > getRank(member)) {
        success = Math.random() < 0.5;
      }

      await supabase.from('item_logs').insert({
        user_id: userId,
        item_name: itemId,
        target_id: targetUser.id,
        result: success ? 'success' : 'fail',
        used_at: now.toISOString()
      });

      if (!success) return interaction.reply({ content: '❌ 使用に失敗しました（50%成功）', ephemeral: true });

      // ▼ 名前変更系 → モーダル表示
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

      // ▼ タイムアウト
      if (itemId === 'timeout_s') {
        await targetMember.timeout(5 * 60 * 1000, 'アイテム使用によるタイムアウト');
        return interaction.reply({ content: `⏱️ ${targetUser.username} をタイムアウトしました。`, ephemeral: true });
      }
    }

    // ▼ 自分の名前変更
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

    return interaction.reply({ content: '❌ 無効なアイテムIDです。', ephemeral: true });
  }
});
client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;
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
    return interaction.reply({ content: `✅ ニックネームを「${newName}」に変更しました。`, ephemeral: true });
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
    return interaction.reply({ content: `✅ 対象ユーザーのニックネームを「${newName}」に変更しました。`, ephemeral: true });
  }
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const userId = message.author.id;
  const member = await message.guild.members.fetch(userId);
  const roles = member.roles.cache.map(r => r.name.toUpperCase());
  const matched = roles.find(r => roleSettings[r]);
  if (!matched) return;

  const today = new Date().toISOString().split('T')[0];
  const { payout, limit } = roleSettings[matched];

  const { data: logData } = await supabase
    .from('message_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();

  const count = logData?.count || 0;
  const lastTime = logData?.updated_at ? new Date(logData.updated_at).getTime() : 0;
  if (count >= limit || Date.now() - lastTime < 60000) return;

  const { data: userData } = await supabase.from('points').select('*').eq('user_id', userId).single();
  const newPoint = (userData?.point || 0) + payout;

  if (!userData) {
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
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  if (req.url === '/repay-check') {
    const today = new Date().toISOString().split('T')[0];
    const { data: users } = await supabase.from('points').select('*').lt('due', today).neq('debt', 0);
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild || !users) return res.end('ギルドまたはユーザーなし');

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
          const roleObj = member.roles.cache.find(r => r.name.toUpperCase() === roleName);
          if (roleObj) await member.roles.remove(roleObj);
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
          await supabase.from('points')
            .update({ point: point + recovered - total, debt: 0, due: null })
            .eq('user_id', user.user_id);
        } else {
          const slave = guild.roles.cache.find(r => r.name === 'SLAVE');
          if (slave) await member.roles.add(slave);
          await member.setNickname(`【SLAVE】${member.user.username}`).catch(() => {});
          await supabase.from('points').update({ point: 0, debt: 0, due: null }).eq('user_id', user.user_id);
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('✅ 自動返済チェック完了');
  } else {
    res.writeHead(200);
    res.end('Bot is running');
  }
}).listen(PORT, () => {
  console.log(`📡 HTTP server on port ${PORT}`);
});
client.once('ready', () => {
  console.log('✅ Bot is ready and running');
});
