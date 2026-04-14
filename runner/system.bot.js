require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { collection, onSnapshot, query, where, updateDoc, doc, getDocs, setDoc } = require('firebase/firestore');
const { db } = require('./firebase.js');
const path = require('path');
const fs = require('fs');

// === CONFIGURATION ===
const SYSTEM_BOT_TOKEN = process.env.DISCORD_TOKEN; 
let autoSupportInvite = "https://discord.gg/kkkkkk"; 
const SITE_URL = "https://dist-eight-omega-26.vercel.app";
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ]
});

// إغلاق الخاص: الرد التلقائي عند محاولة مراسلة البوت
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // تجاهل البوتات
    if (!message.guild) { // إذا كانت الرسالة في الخاص (DM)
        try {
            await message.reply("⚠️ **عذراً، رسائل الخاص لهذا البوت مغلقة.**\nيرجى استخدام الموقع الإلكتروني لإدارة بوتاتك أو طلب الدعم.");
        } catch (err) {
            console.error("Could not reply to DM:", err.message);
        }
    }
});

client.once('ready', async () => {
    console.log(`✅ System Notification Bot is online as ${client.user.tag}`);
    
    // تحديث اسم البوت وصورته
    try {
        const newName = "منصة استضافة البوتات السحابية";
        if (client.user.username !== newName) {
            await client.user.setUsername(newName);
            console.log("✅ تم تحديث اسم البوت بنجاح.");
        }
        
        const avatarPath = path.join(__dirname, 'bot_avatar.png');
        if (fs.existsSync(avatarPath)) {
            await client.user.setAvatar(avatarPath);
            console.log("✅ تم تحديث صورة البوت بنجاح.");
        }
    } catch (error) {
        console.error("⚠️ فشل في تحديث بيانات البوت (ربما بسبب قيود ديسكورد للوقت):", error.message);
    }

    // توليد رابط الدعوة تلقائياً من أول سيرفر يتواجد فيه البوت
    try {
        const guild = client.guilds.cache.first();
        if (guild) {
            const channel = guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me).has('CreateInstantInvite'));
            if (channel) {
                const invite = await guild.invites.create(channel.id, { maxAge: 0, maxUses: 0 });
                autoSupportInvite = invite.url;
                console.log(`✅ تم توليد رابط الدعوة التلقائي لسيرفر [${guild.name}]: ${autoSupportInvite}`);
                
                // حفظ الرابط في Firestore ليستخدمه الموقع
                await setDoc(doc(db, 'settings', 'invite'), { url: autoSupportInvite });
            } else {
                console.warn("⚠️ لم أجد قناة نصية بصلاحيات إنشاء دعوة في السيرفر.");
            }
        } else {
            console.warn("⚠️ البوت لا يتواجد في أي سيرفر حالياً لجلب رابط الدعوة.");
        }
    } catch (err) {
        console.error("⚠️ فشل في توليد رابط الدعوة التلقائي:", err.message);
    }

    startMonitoring();
});

// إرسال الإشعار المعلق للمشترك عند انضمامه للسيرفر
client.on('guildMemberAdd', async (member) => {
    console.log(`👤 عضو جديد انضم: ${member.user.tag}`);
    try {
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('discordId', '==', member.id), where('needsSubscriptionDM', '==', true));
        const querySnapshot = await getDocs(q);
        
        querySnapshot.forEach(async (userDoc) => {
            const userData = userDoc.data();
            console.log(`🚀 تفعيل اشتراك معلق للعضو المنضم: ${userData.username}`);
            await triggerSubscriptionDM(userDoc.id, userData);
        });
    } catch (error) {
        console.error("❌ Error in guildMemberAdd listener:", error.message);
    }
});

async function sendDM(userId, data, components = []) {
    try {
        const user = await client.users.fetch(userId);
        const messagePayload = {};
        
        if (data instanceof EmbedBuilder) {
            messagePayload.embeds = [data];
        } else if (typeof data === 'string') {
            messagePayload.content = data;
        } else {
            Object.assign(messagePayload, data);
        }

        if (components.length > 0) {
            messagePayload.components = components;
        }

        await user.send(messagePayload);
        return true;
    } catch (error) {
        console.error(`❌ Failed to send DM to ${userId}:`, error.message);
        return false;
    }
}

function createBaseEmbed(title, description, color = '#000000') {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'منصة استضافة البوتات السحابية', iconURL: client.user.displayAvatarURL() });
}

// Helper to trigger the actual Subscription DM
async function triggerSubscriptionDM(docId, userData) {
    const embed = createBaseEmbed('🎉 مرحباً بك في المنصة السحابية', `تم تفعيل اشتراكك بنجاح يا **${userData.username}**. الحساب الآن جاهز للاستخدام!`)
        .addFields(
            { name: '👤 اسم المستخدم', value: `\n\`${userData.username}\``, inline: false },
            { name: '🔑 كلمة السر', value: `\n\`${userData.password || 'لم يتم تعيينها'}\``, inline: false },
            { name: '📂 نوع الحساب', value: userData.isTrial ? '✨ نسخة تجريبية' : '💎 حساب مدفوع', inline: true },
            { name: '📅 مدة البدء', value: `\`10 أيام\``, inline: true },
            { name: '🔗 اشترك من هذا السيرفر', value: autoSupportInvite, inline: false },
            { name: '⚠️ متطلبات ضرورية لتشغيل بوتك', value: 'لضمان عمل بوتك بدون مشاكل، تأكد من تفعيل الآتي في [صفحة المطورين](https://discord.com/developers/applications):\n\n1️⃣ تفعيل كافة خيارات **Privileged Gateway Intents** (Presence, Members, Message Content).\n2️⃣ إعطاء البوت صلاحية **Administrator** أو صلاحيات الروابط والقنوات النصية.\n3️⃣ التأكد من نسخ الـ **Token** ووضعه في مكانه الصحيح.', inline: false }
        )
        .setThumbnail('https://cdn-icons-png.flaticon.com/512/9375/9375279.png');

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setLabel('العودة للموقع وتسجيل الدخول')
                .setStyle(ButtonStyle.Link)
                .setURL(SITE_URL)
        );

    const success = await sendDM(userData.discordId, embed, [row]);
    if (success) {
        await updateDoc(doc(db, 'users', docId), { needsSubscriptionDM: false });
    }
}

function startMonitoring() {
    // 1. Monitor for new Bot creations
    onSnapshot(collection(db, 'bots'), (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const botData = change.doc.data();
                if (botData.needsCreationDM && botData.ownerDiscordId) {
                    const embed = createBaseEmbed('✅ تم إنشاء البوت بنجاح', 'لقد تم إضافة بوت جديد إلى حسابك في المنصة السحابية.')
                        .addFields(
                            { name: '🤖 اسم البوت', value: `\`${botData.name}\``, inline: true },
                            { name: '📅 وقت الإنشاء', value: `\`${new Date().toLocaleString('ar-EG')}\``, inline: true }
                        )
                        .setThumbnail('https://cdn-icons-png.flaticon.com/512/4712/4712035.png'); // Bot icon

                    const success = await sendDM(botData.ownerDiscordId, embed);
                    if (success) {
                        await updateDoc(doc(db, 'bots', change.doc.id), { needsCreationDM: false });
                    }
                }
            }
        });
    });

    // 2. Monitor for new Subscriptions/Logins and Time Updates
    onSnapshot(collection(db, 'users'), (snapshot) => {
        snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added' || change.type === 'modified') {
                const userData = change.doc.data();
                const userId = change.doc.id;

                // Case A: New Subscription
                if (userData.needsSubscriptionDM && userData.discordId) {
                    const guild = client.guilds.cache.first();
                    const isMember = guild?.members.cache.has(userData.discordId);

                    if (isMember) {
                        await triggerSubscriptionDM(userId, userData);
                    } else {
                        console.log(`⌛ بانتظار انضمام ${userData.username} للسيرفر لإرسال البيانات.`);
                    }
                }

                // Case B: Time Management Update
                if (userData.timeUpdate && userData.discordId) {
                    const { diff, newTotal } = userData.timeUpdate;
                    const type = diff > 0 ? 'إضافة' : 'خصم';
                    const color = diff > 0 ? '#00FF00' : '#FF0000';
                    const icon = diff > 0 ? '🚀' : '⚠️';
                    
                    const embed = createBaseEmbed(`${icon} تعديل في مدة الاشتراك`, `لقد قام المسؤول بتعديل مدة اشتراكك في المنصة.`, color)
                        .addFields(
                            { name: '⚙️ العملية', value: `\`تم ${type} ${Math.abs(diff)} أيام\``, inline: true },
                            { name: '⏳ المتبقي الإجمالي', value: `\`${newTotal} أيام\``, inline: true }
                        );
                    
                    const success = await sendDM(userData.discordId, embed);
                    if (success) {
                        await updateDoc(doc(db, 'users', userId), { timeUpdate: null });
                    }
                }

                // Case C: Subscription Help Request (Upgrade)
                if (userData.needsSubscriptionHelpDM && userData.discordId) {
                    const embed = createBaseEmbed('💎 طلب ترقية الحساب', 'يسعدنا اهتمامك بالاشتراك في النسخة الكاملة من المنصة السحابية! ✨')
                        .addFields(
                            { name: '🚫 القيود الحالية', value: 'أنت حالياً تستخدم النسخة التجريبية (3 بوتات كحد أقصى).', inline: false },
                            { name: '🔓 المميزات الكاملة', value: 'عند الاشتراك ستحصل على عدد غير محدود من البوتات، استقرار أعلى، ودعم فني مباشر.', inline: false },
                            { name: '💬 كيفية الاشتراك', value: 'يرجى التواصل مع الإدارة مباشرة للدفع وتفعيل الحساب الكامل.', inline: false }
                        )
                        .setThumbnail('https://cdn-icons-png.flaticon.com/512/10675/10675646.png');

                    const success = await sendDM(userData.discordId, embed);
                    if (success) {
                        await updateDoc(doc(db, 'users', userId), { needsSubscriptionHelpDM: false });
                    }
                }
            }
        });
    });

    // 3. Periodic check for Expirations (Every 1 hour)
    setInterval(async () => {
        console.log("🕒 Running expiration checks...");
        const usersRef = collection(db, 'users');
        const querySnapshot = await getDocs(usersRef);
        
        const now = new Date().getTime();
        const oneDayMs = 24 * 60 * 60 * 1000;

        querySnapshot.forEach(async (userDoc) => {
            const userData = userDoc.data();
            if (!userData.discordId || !userData.expiresAt) return;

            const timeLeft = userData.expiresAt - now;

            // Check if 1 day left
            if (timeLeft > 0 && timeLeft <= oneDayMs && !userData.warnedDayBefore) {
                const embed = createBaseEmbed('⚠️ تنبيه بانتهاء الاشتراك', 'يتبقى يوم واحد فقط على انتهاء اشتراكك الحالي. يرجى تجديد الاشتراك لضمان استمرار عمل البوتات.', '#FFA500');
                await sendDM(userData.discordId, embed);
                await updateDoc(doc(db, 'users', userDoc.id), { warnedDayBefore: true });
            }

            // Check if expired
            if (timeLeft <= 0 && !userData.warnedExpired) {
                const embed = createBaseEmbed('🚫 انتهى وقت الاشتراك', 'انتهت صلاحية اشتراكك اليوم. تم إيقاف جميع البوتات الخاصة بك تلقائياً.', '#FF0000');
                await sendDM(userData.discordId, embed);
                await updateDoc(doc(db, 'users', userDoc.id), { warnedExpired: true });
                
                // Stop all bots of this user
                const botsQuery = query(collection(db, 'bots'), where('owner', '==', userData.username));
                const botSnaps = await getDocs(botsQuery);
                botSnaps.forEach(async (botDoc) => {
                    await updateDoc(doc(db, 'bots', botDoc.id), { status: 'offline' });
                });
            }
        });
    }, 60 * 60 * 1000); 
}

client.login(SYSTEM_BOT_TOKEN);
