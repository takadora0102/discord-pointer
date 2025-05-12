const { Client, GatewayIntentBits, ApplicationCommandOptionType, ModalBuilder, 
TextInputBuilder, ActionRowBuilder, TextInputStyle } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// Initialize Discord client with needed intents
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Initialize Supabase client (use your actual Supabase URL and API key from environment variables)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Configuration for role-based settings (all limits set to Infinity)
const roleSettings = {
    // Example roles and payouts – replace keys with your server's role IDs or names as needed
    "Bronze":   { payout: 10, limit: Infinity },
    "Silver":   { payout: 20, limit: Infinity },
    "Gold":     { payout: 30, limit: Infinity },
    "Platinum": { payout: 50, limit: Infinity }
};
// If a user has none of the above roles, this default payout will be used
const defaultPayout = 5;  // default points per message for unranked users
const POINT_COOLDOWN = 120000;  // 120,000 ms = 2 minutes cooldown for message points

// In-memory trackers for message cooldowns and scope usage
const lastMessageTime = {};
const scopeUsers = new Set();

// Define shop items and their properties
const items = {
    "shield": {
        name: "Shield(シールド)", price: 100,
        description: "一定時間あらゆる攻撃から守ります"
    },
    "scope": {
        name: "Scope(スコープ)", price: 80,
        description: "次の攻撃を必ず成功させます"
    },
    "timeout": {
        name: "Timeout(タイムアウト)", price: 120,
        description: "対象を一定時間ミュートにします"
    },
    "rename_self": {
        name: "Rename Ticket(自分用)", price: 50,
        description: "自分のニックネームを変更します"
    },
    "rename_target": {
        name: "Rename Ticket(他人用)", price: 100,
        description: "他人のニックネームを変更します"
    },
    "name_lock": {
        name: "Name Lock(ネームロック)", price: 70,
        description: "自分のニックネームを一定時間ロックします"
    }
};

// Durations for item effects (in milliseconds)
const SHIELD_DURATION = 6 * 60 * 60 * 1000;      // 6 hours
const NAME_LOCK_DURATION = 24 * 60 * 60 * 1000;  // 24 hours
const TIMEOUT_DURATION = 10 * 60 * 1000;         // 10 minutes

// Register slash commands (global by default, or to a specific guild if GUILD_ID is provided)
client.once('ready', async () => {
    try {
        const commandsData = [
            {
                name: "register",
                description: "ゲームにユーザー登録します"
            },
            {
                name: "profile",
                description: "自分または指定ユーザーのプロフィールを表示します",
                options: [
                    {
                        name: "user",
                        description: "プロフィールを表示するユーザー（省略時は自分）",
                        type: ApplicationCommandOptionType.User,
                        required: false
                    }
                ]
            },
            {
                name: "debt",
                description: "自分の借金情報を表示します"
            },
            {
                name: "shop",
                description: "ショップの商品一覧を表示します"
            },
            {
                name: "buy",
                description: "ショップでアイテムを購入します",
                options: [
                    {
                        name: "item",
                        description: "購入するアイテム名",
                        type: ApplicationCommandOptionType.String,
                        required: true
                    }
                ]
            },
            {
                name: "use",
                description: "所持しているアイテムを使用します",
                options: [
                    {
                        name: "item",
                        description: "使用するアイテム名",
                        type: ApplicationCommandOptionType.String,
                        required: true
                    },
                    {
                        name: "target",
                        description: "対象ユーザー（アイテムによって必要）",
                        type: ApplicationCommandOptionType.User,
                        required: false
                    }
                ]
            }
        ];
        if (process.env.GUILD_ID) {
            // Register commands to a specific guild (for immediate update during development)
            await client.application.commands.set(commandsData, process.env.GUILD_ID);
        } else {
            // Register commands globally (may take some time to propagate)
            await client.application.commands.set(commandsData);
        }
        console.log("Slash commands registered.");
    } catch (err) {
        console.error("Failed to register commands:", err);
    }
    console.log(`Logged in as ${client.user.tag}!`);
});

// Message create event: award points for sending messages (with cooldown per user)
client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;  // ignore bots or DMs

    const userId = message.author.id;
    // Check registration (user must exist in profiles table to earn points)
    const { data: profileData, error: profError } = await supabase
        .from('profiles')
        .select('point')
        .eq('user_id', userId)
        .single();
    if (profError || !profileData) {
        // User not registered or DB error; do nothing (could prompt to register if desired)
        return;
    }

    // Enforce cooldown: only award points if enough time passed since last award
    const now = Date.now();
    if (lastMessageTime[userId] && now - lastMessageTime[userId] < POINT_COOLDOWN) {
        console.log(`Cooldown: message from ${message.author.tag} not eligible for points.`);
        return;
    }

    // Determine payout based on user's role
    const member = message.member;
    let payout = defaultPayout;
    // Loop through configured roles and use the highest payout among roles the user has
    for (const [roleKey, setting] of Object.entries(roleSettings)) {
        // roleKey can be role name or ID depending on configuration
        const roleObj = member.roles.cache.find(r => r.name === roleKey || r.id === roleKey);
        if (roleObj) {
            if (setting.payout > payout) {
                payout = setting.payout;
            }
        }
    }

    // Update user's points in database
    const newPoints = profileData.point + payout;
    const { error: updateError } = await supabase
        .from('profiles')
        .update({ point: newPoints })
        .eq('user_id', userId);
    if (updateError) {
        console.error("Failed to update points for user:", userId, updateError);
        return;
    }
    lastMessageTime[userId] = now;  // update cooldown timestamp
});

// Interaction create event: handle slash commands and modal submissions
client.on('interactionCreate', async (interaction) => {
    try {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            const { commandName } = interaction;
            if (commandName === 'register') {
                // Register a new user in the profiles table
                await interaction.deferReply({ ephemeral: true });
                const userId = interaction.user.id;
                // Check if already registered
                const { data: existingProfile, error: selError } = await supabase
                    .from('profiles')
                    .select('user_id')
                    .eq('user_id', userId)
                    .single();
                if (existingProfile) {
                    await interaction.editReply("あなたは既に登録済みです。");
                } else {
                    // Insert a new profile row with default values
                    const { error: insError } = await supabase.from('profiles').insert({ user_id: userId });
                    if (insError) {
                        console.error("Register insert error:", insError);
                        await interaction.editReply("ユーザー登録中にエラーが発生しました。");
                    } else {
                        await interaction.editReply("ユーザー登録が完了しました。");
                    }
                }
            }
            else if (commandName === 'profile') {
                await interaction.deferReply({ ephemeral: true });
                // Determine whose profile to show (self or target user)
                const targetUser = interaction.options.getUser('user') || interaction.user;
                const userId = targetUser.id;
                // Fetch profile from DB
                const { data: profile, error: profErr } = await supabase
                    .from('profiles')
                    .select('*')
                    .eq('user_id', userId)
                    .single();
                if (profErr || !profile) {
                    await interaction.editReply("ユーザーが登録されていません。");
                } else {
                    // Prepare profile info
                    let response = "";
                    if (targetUser.id === interaction.user.id) {
                        response += "🔹 **あなたのプロフィール:**\n";
                    } else {
                        response += `🔹 **${targetUser.username}さんのプロフィール:**\n`;
                    }
                    response += `**ポイント:** ${profile.point} ポイント\n`;
                    response += `**借金:** ${profile.debt} ポイント\n`;
                    // Shield status
                    const now = new Date();
                    if (profile.shield_until && new Date(profile.shield_until) > now) {
                        const shieldTime = new Date(profile.shield_until).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        response += `**シールド:** 有効 (～ ${shieldTime} まで)\n`;
                    } else {
                        response += `**シールド:** なし\n`;
                    }
                    // Name lock status
                    if (profile.name_locked_until && new Date(profile.name_locked_until) > now) {
                        const lockTime = new Date(profile.name_locked_until).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        response += `**名前ロック:** 有効 (～ ${lockTime} まで)\n`;
                    } else {
                        response += `**名前ロック:** なし\n`;
                    }
                    // Debt due date
                    if (profile.debt > 0 && profile.due) {
                        const dueDate = new Date(profile.due).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        response += `**支払期限:** ${dueDate}\n`;
                    } else {
                        response += `**支払期限:** なし\n`;
                    }
                    // Inventory items
                    const { data: invItems, error: invErr } = await supabase
                        .from('item_inventory')
                        .select('item_name, quantity')
                        .eq('user_id', userId);
                    if (!invErr && invItems && invItems.length > 0) {
                        const itemList = invItems.filter(it => it.quantity > 0).map(it => {
                            const itemLabel = items[it.item_name]?.name || it.item_name;
                            return `${itemLabel} x${it.quantity}`;
                        });
                        if (itemList.length > 0) {
                            response += `**所持アイテム:** ${itemList.join('， ')}\n`;
                        } else {
                            response += `**所持アイテム:** なし\n`;
                        }
                    } else {
                        response += `**所持アイテム:** なし\n`;
                    }
                    // 最近使ったアイテム (過去5件)
                    const { data: recentLogs, error: logErr } = await supabase
                        .from('item_logs')
                        .select('item_name, used_at')
                        .eq('user_id', userId)
                        .order('used_at', { ascending: false })
                        .limit(5);
                    if (!logErr && recentLogs && recentLogs.length > 0) {
                        const recentItemList = recentLogs.map(log => items[log.item_name]?.name || log.item_name);
                        response += `**最近使用アイテム:** ${recentItemList.join('， ')}\n`;
                    } else {
                        response += `**最近使用アイテム:** なし\n`;
                    }
                    await interaction.editReply(response);
                }
            }
            else if (commandName === 'debt') {
                await interaction.deferReply({ ephemeral: true });
                const userId = interaction.user.id;
                const { data: profile, error: profErr } = await supabase
                    .from('profiles')
                    .select('debt, due')
                    .eq('user_id', userId)
                    .single();
                if (profErr || !profile) {
                    await interaction.editReply("ユーザーが登録されていません。");
                } else {
                    if (profile.debt <= 0) {
                        await interaction.editReply("現在、借金はありません。");
                    } else {
                        let msg = `あなたの借金は **${profile.debt}** ポイントです。\n`;
                        if (profile.due) {
                            const dueDate = new Date(profile.due).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
                            msg += `返済期限: ${dueDate}までに自動返済が行われます。`;
                        } else {
                            msg += "返済期限: なし（随時自動返済されます）";
                        }
                        await interaction.editReply(msg);
                    }
                }
            }
            else if (commandName === 'shop') {
                await interaction.deferReply({ ephemeral: true });
                // List available items with price and description
                let shopList = "🔸 **ショップ商品一覧** 🔸\n";
                for (const key in items) {
                    const it = items[key];
                    shopList += `\`${key}\` - ${it.name}: **${it.price}** ポイント (${it.description})\n`;
                }
                shopList += "購入するには `/buy <item>` コマンドを使用してください。";
                await interaction.editReply(shopList);
            }
            else if (commandName === 'buy') {
                await interaction.deferReply({ ephemeral: true });
                const userId = interaction.user.id;
                const itemInput = interaction.options.getString('item');
                if (!itemInput) {
                    await interaction.editReply("購入するアイテム名を指定してください。");
                    return;
                }
                // Normalize item name (trim, toLowerCase, remove leading "item:" if present)
                let itemName = itemInput.trim().toLowerCase();
                if (itemName.startsWith("item:")) {
                    itemName = itemName.slice(5).trim().toLowerCase();
                }
                if (!items[itemName]) {
                    await interaction.editReply("指定されたアイテムは存在しません。");
                    return;
                }
                const price = items[itemName].price;
                // Fetch user profile for current points and debt
                const { data: profile, error: profErr } = await supabase
                    .from('profiles')
                    .select('point, debt, due')
                    .eq('user_id', userId)
                    .single();
                if (profErr || !profile) {
                    await interaction.editReply("ユーザーが登録されていません。");
                    return;
                }
                let currentPoints = profile.point;
                let currentDebt = profile.debt;
                let dueDate = profile.due;
                // Determine payment and update debt if needed
                let newPoint = 0;
                let newDebt = currentDebt;
                if (currentPoints >= price) {
                    // User has enough points, just deduct
                    newPoint = currentPoints - price;
                } else {
                    // Not enough points: use all points and take the rest as debt
                    const deficit = price - currentPoints;
                    newPoint = 0;
                    newDebt = currentDebt + deficit;
                    // Set due date if going into debt for the first time
                    if (currentDebt === 0) {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        dueDate = tomorrow.toISOString().split('T')[0];  // store as "YYYY-MM-DD"
                    }
                }
                // Update profiles table with new point/debt values
                const updates = { point: newPoint, debt: newDebt };
                if (newDebt !== currentDebt) {
                    updates.due = dueDate;
                }
                const { error: upErr } = await supabase.from('profiles').update(updates).eq('user_id', userId);
                if (upErr) {
                    console.error("Error updating profile on buy:", upErr);
                    await interaction.editReply("購入処理中にエラーが発生しました。");
                    return;
                }
                // Update item inventory: increment item count
                // Check if user already has this item in inventory
                const { data: invRow, error: invErr } = await supabase
                    .from('item_inventory')
                    .select('quantity')
                    .eq('user_id', userId)
                    .eq('item_name', itemName)
                    .single();
                if (invErr && invErr.code !== 'PGRST116') {  // PGRST116 might indicate no rows (not a critical error)
                    console.error("Inventory fetch error on buy:", invErr);
                }
                if (!invErr && invRow) {
                    // Row exists, update quantity
                    const newQty = invRow.quantity + 1;
                    await supabase.from('item_inventory')
                        .update({ quantity: newQty })
                        .eq('user_id', userId)
                        .eq('item_name', itemName);
                } else {
                    // No existing row, insert new
                    await supabase.from('item_inventory')
                        .insert({ user_id: userId, item_name: itemName, quantity: 1 });
                }
                // Reply with success message
                let replyMsg = `「${items[itemName].name}」を **${items[itemName].price}** ポイントで購入しました。`;
                if (currentPoints < price) {
                    replyMsg += `\nポイントが不足したため **${(items[itemName].price - currentPoints)}** ポイントが借金に追加されました。`;
                }
                replyMsg += `\n現在のポイント: ${newPoint} ポイント、借金: ${newDebt} ポイント。`;
                await interaction.editReply(replyMsg);
            }
            else if (commandName === 'use') {
                // Using an item from inventory
                const itemInput = interaction.options.getString('item');
                let targetUser = interaction.options.getUser('target');
                if (!itemInput) {
                    await interaction.reply({ content: "使用するアイテム名を指定してください。", ephemeral: true });
                    return;
                }
                // Normalize item name
                let itemName = itemInput.trim().toLowerCase();
                if (itemName.startsWith("item:")) {
                    itemName = itemName.slice(5).trim().toLowerCase();
                }
                if (!items[itemName]) {
                    await interaction.reply({ content: "指定されたアイテムは存在しません。", ephemeral: true });
                    return;
                }
                // Check inventory for the item
                const userId = interaction.user.id;
                const { data: invRow, error: invErr } = await supabase
                    .from('item_inventory')
                    .select('quantity')
                    .eq('user_id', userId)
                    .eq('item_name', itemName)
                    .single();
                if (invErr || !invRow || invRow.quantity < 1) {
                    await interaction.reply({ content: "そのアイテムは所持していません。", ephemeral: true });
                    return;
                }

                // Handle items that require or don't require a target
                if ((itemName === 'rename_target' || itemName === 'timeout') && !targetUser) {
                    await interaction.reply({ content: "対象ユーザーを指定してください。", ephemeral: true });
                    return;
                }
                if (itemName !== 'rename_target' && itemName !== 'timeout') {
                    // If target provided but item doesn't use it, ignore the target
                    targetUser = null;
                }

                // Special handling for name change items (open modal for new name input)
                if (itemName === 'rename_self' || itemName === 'rename_target') {
                    // Check if target is protected (for rename_target) or user is locked (for rename_self)
                    if (itemName === 'rename_self') {
                        // If the user has locked their own name
                        const { data: selfProfile } = await supabase
                            .from('profiles')
                            .select('name_locked_until')
                            .eq('user_id', userId)
                            .single();
                        if (selfProfile && selfProfile.name_locked_until && new Date(selfProfile.name_locked_until) > new Date()) {
                            await interaction.reply({ content: "現在、自分の名前はロックされています。解除されるまで変更できません。", ephemeral: true });
                            return;
                        }
                    } else if (itemName === 'rename_target') {
                        // If target is the user themselves, that's essentially rename_self (but we'll allow it)
                        if (targetUser && targetUser.id === userId) {
                            // Renaming self using rename_target item (not typical, but handle as self)
                        }
                        // Check target's profile for shield or name lock
                        const { data: targetProfile } = await supabase
                            .from('profiles')
                            .select('shield_until, name_locked_until')
                            .eq('user_id', targetUser.id)
                            .single();
                        if (!targetProfile) {
                            await interaction.reply({ content: "対象ユーザーはゲームに登録されていません。", ephemeral: true });
                            return;
                        }
                        const now = new Date();
                        if (targetProfile.shield_until && new Date(targetProfile.shield_until) > now) {
                            await interaction.reply({ content: "対象ユーザーは現在シールドで守られています。", ephemeral: true });
                            return;
                        }
                        if (targetProfile.name_locked_until && new Date(targetProfile.name_locked_until) > now) {
                            await interaction.reply({ content: "対象ユーザーの名前はロックされています。変更できません。", ephemeral: true });
                            return;
                        }
                    }
                    // Show modal for entering the new nickname
                    const modalId = itemName === 'rename_self' 
                        ? "rename_self_modal" 
                        : `rename_target_${targetUser.id}`;
                    const modalTitle = itemName === 'rename_self' ? "ニックネームの変更" : `ニックネーム変更: ${targetUser.username}`;
                    const modal = new ModalBuilder()
                        .setCustomId(modalId)
                        .setTitle(modalTitle);
                    const input = new TextInputBuilder()
                        .setCustomId('newName')
                        .setLabel('新しいニックネーム')
                        .setStyle(TextInputStyle.Short)
                        .setMaxLength(32)
                        .setRequired(true);
                    modal.addComponents(new ActionRowBuilder().addComponents(input));
                    await interaction.showModal(modal);
                    return; // Do not send a reply yet; modal submission will be handled separately
                }

                // For other items (shield, scope, timeout, name_lock), we proceed with immediate effect
                await interaction.deferReply({ ephemeral: true });
                const userProfileRes = await supabase.from('profiles').select('*').eq('user_id', userId).single();
                const userProfile = userProfileRes.data;
                // If any DB error or missing profile (shouldn't happen if they got inventory)
                if (!userProfile) {
                    await interaction.editReply("ユーザープロファイルの取得中にエラーが発生しました。");
                    return;
                }
                let resultMessage = "";
                let actionSuccess = false;
                // Handle each item effect
                if (itemName === 'shield') {
                    // Activate shield for the user
                    const now = Date.now();
                    const currentShieldUntil = userProfile.shield_until ? new Date(userProfile.shield_until).getTime() : 0;
                    const newShieldUntil = (currentShieldUntil > now ? currentShieldUntil : now) + SHIELD_DURATION;
                    const { error: updErr } = await supabase.from('profiles')
                        .update({ shield_until: new Date(newShieldUntil).toISOString() })
                        .eq('user_id', userId);
                    if (updErr) {
                        console.error("Error updating shield:", updErr);
                        resultMessage = "シールドの使用中にエラーが発生しました。";
                    } else {
                        const untilStr = new Date(newShieldUntil).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        resultMessage = `シールドを使用しました。（${untilStr} まで有効）`;
                        actionSuccess = true;
                    }
                }
                else if (itemName === 'scope') {
                    // Activate scope buff for the user
                    if (scopeUsers.has(userId)) {
                        resultMessage = "既にスコープを使用中です。次の攻撃が終わるまで新たに使用できません。";
                        actionSuccess = false;
                    } else {
                        scopeUsers.add(userId);
                        resultMessage = "スコープを使用しました。次のターゲットへの攻撃は必ず成功します。";
                        actionSuccess = true;
                    }
                }
                else if (itemName === 'name_lock') {
                    // Activate name lock for the user (protect their name from change)
                    const now = Date.now();
                    const currentLockUntil = userProfile.name_locked_until ? new Date(userProfile.name_locked_until).getTime() : 0;
                    const newLockUntil = (currentLockUntil > now ? currentLockUntil : now) + NAME_LOCK_DURATION;
                    const { error: updErr } = await supabase.from('profiles')
                        .update({ name_locked_until: new Date(newLockUntil).toISOString() })
                        .eq('user_id', userId);
                    if (updErr) {
                        console.error("Error updating name lock:", updErr);
                        resultMessage = "名前ロックの使用中にエラーが発生しました。";
                    } else {
                        const untilStr = new Date(newLockUntil).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        resultMessage = `名前ロックを使用しました。（${untilStr} まで有効）`;
                        actionSuccess = true;
                    }
                }
                else if (itemName === 'timeout') {
                    // Use timeout on target user
                    const targetMember = targetUser ? await interaction.guild.members.fetch(targetUser.id) : null;
                    if (!targetMember) {
                        resultMessage = "指定したユーザーは見つかりません。";
                        actionSuccess = false;
                    } else {
                        // Check if target has shield active
                        const { data: targetProfile } = await supabase
                            .from('profiles')
                            .select('shield_until')
                            .eq('user_id', targetUser.id)
                            .single();
                        const now = new Date();
                        if (targetProfile && targetProfile.shield_until && new Date(targetProfile.shield_until) > now) {
                            resultMessage = "対象ユーザーはシールドで守られており、効果がありませんでした。";
                            actionSuccess = false;
                        } else {
                            // Determine success chance
                            let success = true;
                            if (targetUser.id !== userId) {
                                // Determine ranks of user and target
                                const memberRoles = interaction.member.roles.cache;
                                const targetRoles = targetMember.roles.cache;
                                let userRankValue = 0;
                                let targetRankValue = 0;
                                for (const [roleKey, setting] of Object.entries(roleSettings)) {
                                    if (memberRoles.find(r => r.name === roleKey || r.id === roleKey)) {
                                        if (setting.payout > userRankValue) userRankValue = setting.payout;
                                    }
                                    if (targetRoles.find(r => r.name === roleKey || r.id === roleKey)) {
                                        if (setting.payout > targetRankValue) targetRankValue = setting.payout;
                                    }
                                }
                                if (targetRankValue > userRankValue) {
                                    // Target has higher role
                                    if (scopeUsers.has(userId)) {
                                        success = true;
                                    } else {
                                        success = (Math.random() < 0.5);
                                    }
                                }
                                // Remove scope buff after an offensive attempt
                                if (scopeUsers.has(userId)) {
                                    scopeUsers.delete(userId);
                                }
                            }
                            if (!success) {
                                resultMessage = "タイムアウトの効果は失敗しました。";
                                actionSuccess = false;
                            } else {
                                // Attempt to timeout the member
                                try {
                                    await targetMember.timeout(TIMEOUT_DURATION, `Timeout item used by ${interaction.user.username}`);
                                    resultMessage = `${targetUser.username} さんをタイムアウトしました。`;
                                    actionSuccess = true;
                                } catch (err) {
                                    console.error("Failed to timeout member:", err);
                                    resultMessage = "指定ユーザーをタイムアウトできません。（権限不足）";
                                    actionSuccess = false;
                                }
                            }
                        }
                    }
                }

                // Deduct the item from inventory (one use)
                const newQty = invRow.quantity - 1;
                await supabase.from('item_inventory')
                    .update({ quantity: newQty })
                    .eq('user_id', userId)
                    .eq('item_name', itemName);
                // Log the item usage in item_logs
                const logEntry = {
                    user_id: userId,
                    target_id: targetUser ? targetUser.id : null,
                    item_name: itemName,
                    result: actionSuccess ? "success" : "fail",
                    used_at: new Date().toISOString()
                };
                await supabase.from('item_logs').insert(logEntry);
                // Respond to the user with the result
                await interaction.editReply(resultMessage);
            }
        } 
    } catch (err) {
        console.error("Error in interactionCreate handler:", err);
    }
});
// Modal submit handling (rename_self_modal, rename_target_xxx)
client.on('interactionCreate', async (interaction) => {
    if (interaction.isModalSubmit()) {
        // Get the text input value (新しいニックネーム)
        const newName = interaction.fields.getTextInputValue('newName');
        if (interaction.customId === 'rename_self_modal') {
            let actionSuccess = false;
            try {
                // 自分自身のニックネームを変更
                await interaction.member.setNickname(newName);
                actionSuccess = true;
                await interaction.reply({ content: `あなたのニックネームを「${newName}」に変更しました。`, ephemeral: true });
            } catch (err) {
                console.error(err);
                await interaction.reply({ content: 'ニックネームの変更に失敗しました。', ephemeral: true });
            }
            // Deduct used item and log usage
            const userId = interaction.user.id;
            const { data: invData } = await supabase.from('item_inventory').select('quantity').eq('user_id', userId).eq('item_name', 'rename_self').single();
            if (invData && invData.quantity > 0) {
                await supabase.from('item_inventory').update({ quantity: invData.quantity - 1 }).eq('user_id', userId).eq('item_name', 'rename_self');
            }
            const logEntry = {
                user_id: userId,
                target_id: null,
                item_name: 'rename_self',
                result: actionSuccess ? 'success' : 'fail',
                used_at: new Date().toISOString()
            };
            await supabase.from('item_logs').insert(logEntry);
        } else if (interaction.customId.startsWith('rename_target_')) {
            let actionSuccess = false;
            const targetId = interaction.customId.replace('rename_target_', '');
            try {
                // 対象ユーザーのニックネームを変更
                const targetMember = await interaction.guild.members.fetch(targetId);
                await targetMember.setNickname(newName);
                actionSuccess = true;
                await interaction.reply({ content: `<@${targetId}> さんのニックネームを「${newName}」に変更しました。`, ephemeral: true });
            } catch (err) {
                console.error(err);
                await interaction.reply({ content: '指定ユーザーのニックネームを変更できませんでした。', ephemeral: true });
            }
            // Deduct used item and log usage
            const userId = interaction.user.id;
            const { data: invData } = await supabase.from('item_inventory').select('quantity').eq('user_id', userId).eq('item_name', 'rename_target').single();
            if (invData && invData.quantity > 0) {
                await supabase.from('item_inventory').update({ quantity: invData.quantity - 1 }).eq('user_id', userId).eq('item_name', 'rename_target');
            }
            const logEntry = {
                user_id: userId,
                target_id: targetId,
                item_name: 'rename_target',
                result: actionSuccess ? 'success' : 'fail',
                used_at: new Date().toISOString()
            };
            await supabase.from('item_logs').insert(logEntry);
        }
    }
});

// HTTP server setup (/repay-check endpoint for automatic debt repayment)
const http = require('http');
const PORT = process.env.PORT || 3000;
const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/repay-check') {
        console.log('/repay-check endpoint called');
        try {
            // Find all profiles with debt whose due date has passed or is today
            const today = new Date().toISOString().split('T')[0];
            const { data: dueProfiles, error: fetchErr } = await supabase
                .from('profiles')
                .select('user_id, point, debt, due')
                .gt('debt', 0)
                .not('due', 'is', null)
                .lte('due', today);
            if (fetchErr) throw fetchErr;

            // Process each such profile for repayment
            for (const profile of dueProfiles) {
                const userId = profile.user_id;
                const currentPoints = profile.point;
                const debt = profile.debt;
                if (!debt || debt <= 0) continue;
                const newPoints = currentPoints - debt;
                // Update profile: subtract debt from points, clear debt and due
                const updates = { point: newPoints, debt: 0, due: null };
                const { error: updErr } = await supabase.from('profiles').update(updates).eq('user_id', userId);
                if (updErr) {
                    console.error(`Failed to update profile for user ${userId}:`, updErr);
                    continue;
                }
                console.log(`Auto-repaid ${debt} points for user ${userId}. New point balance: ${newPoints}.`);
            }

            // Send success response
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        } catch (err) {
            console.error('Error in /repay-check handler:', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Error processing repayments');
        }
    } else {
        // Response for undefined routes
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});
server.listen(PORT, () => {
    console.log(`HTTP Server is listening on port ${PORT}`);
});

// Bot startup and login
client.once('ready', () => {
    console.log(`Bot is online! Logged in as ${client.user.tag}`);
});
client.login(process.env.DISCORD_TOKEN);
