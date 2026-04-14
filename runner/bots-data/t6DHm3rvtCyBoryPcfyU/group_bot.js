require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    PermissionsBitField, 
    ChannelType,
    EmbedBuilder,
    Partials,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const { fixArabic: fixArabicUtil, registerFonts } = require('./arabic_utils');

// Register Fonts from the utility file
registerFonts();

// Wrapper for fixArabic to use configuration
function fixArabic(text) {
    return fixArabicUtil(text, pointsData.config?.useArabicDigits);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildVoiceStates
    ],
    partials: [Partials.Channel] // Needed for DMs in v14
});

const pointsPath = path.join(__dirname, 'points.json');

// Initialize points data
let pointsData = {};
if (fs.existsSync(pointsPath)) {
    try {
        pointsData = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
    } catch (err) {
        console.error('Error reading points.json:', err);
        pointsData = {};
    }
}

function savePoints() {
    fs.writeFileSync(pointsPath, JSON.stringify(pointsData, null, 2));
}

function addPoints(userId, points) {
    if (userId === client.user.id) return; // Skip the bot itself
    if (!pointsData[userId]) pointsData[userId] = 0;
    if (typeof pointsData[userId] === 'object') return; // Skip config
    
    // Ensure points is a number to avoid string concatenation (Float supported)
    const pointsToAdd = parseFloat(points);
    if (isNaN(pointsToAdd)) return;

    pointsData[userId] = (pointsData[userId] || 0) + pointsToAdd;
    savePoints();
}

function hasGroup(member) {
    if (!member || !member.guild) return false;
    // A user has a group if they have a role named "عضو" OR a role ending with "★"
    return member.roles.cache.some(role => 
        role.name === "عضو" || role.name.endsWith("★")
    );
}

function isGroupLeader(member) {
    if (!member || !member.guild) return false;
    // A user is a leader if they have a role ending with "★"
    return member.roles.cache.some(role => role.name.endsWith("★"));
}

async function updateTopMessage(guild) {
    if (!pointsData.config || !pointsData.config.channelId || !pointsData.config.messageId) return;

    const channel = guild.channels.cache.get(pointsData.config.channelId);
    if (!channel) return;

    try {
        const message = await channel.messages.fetch(pointsData.config.messageId);
        if (!message) return;

        const topAttachment = await createTopImage(guild);
        await message.edit({ embeds: [], files: [topAttachment] });
        
        // Also sync voice channel positions whenever top is updated
        await syncVoiceChannelPositions(guild);
    } catch (err) {
        console.error('Error updating top message:', err);
    }
}

async function syncVoiceChannelPositions(guild) {
    const voiceCategoryId = getVOICE_CATEGORY_ID();
    const textCategoryId = getTEXT_CATEGORY_ID();
    if (!voiceCategoryId || !textCategoryId) return;

    // Get all groups (text channels in text category)
    const textChannels = guild.channels.cache.filter(c => c.parentId === textCategoryId);
    const groupsList = [];

    for (const [id, channel] of textChannels) {
        const groupName = channel.name;
        // Find corresponding voice channel in voice category
        const voiceChannel = guild.channels.cache.find(c => 
            c.parentId === voiceCategoryId && 
            c.type === ChannelType.GuildVoice && 
            c.name.toLowerCase().trim() === groupName.toLowerCase().trim()
        );

        if (!voiceChannel) continue;

        // Find group owner points (same logic as createTopImage)
        const adminRole = guild.roles.cache.find(r => r.name.toLowerCase().trim() === `${groupName.toLowerCase().trim()} ★`);
        let points = 0;
        if (adminRole) {
            // Ensure members are fetched to find the owner even if they are offline/not in cache
            try {
                const members = await adminRole.guild.members.fetch();
                const owner = members.find(m => m.roles.cache.has(adminRole.id));
                if (owner) {
                    points = pointsData[owner.id] || 0;
                }
            } catch (err) {
                // Fallback to cached first member if fetch fails
                const owner = adminRole.members.first();
                if (owner) points = pointsData[owner.id] || 0;
            }
        }

        groupsList.push({ voiceChannel, points });
    }

    // Sort by points (High to Low)
    groupsList.sort((a, b) => b.points - a.points);

    // Update positions sequentially to avoid conflicts
    // Discord position 0 is top.
    for (let i = 0; i < groupsList.length; i++) {
        const group = groupsList[i];
        if (group.voiceChannel.position !== i) {
            try {
                await group.voiceChannel.setPosition(i);
            } catch (err) {
                console.error(`Failed to set position for ${group.voiceChannel.name}:`, err);
            }
        }
    }
}

async function syncPointsChannelPermissions(guild) {
    // Reverted to original behavior: No special permission logic for points channel
    return;
}

async function createTopImage(guild) {
    const canvas = createCanvas(800, 600); // Increased height for list
    const ctx = canvas.getContext('2d');

    // Background Image (Initialized in ready event)
    let backgroundUrl = pointsData.config?.backgroundImage;
    try {
        const background = await loadImage(backgroundUrl);
        ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
        
        // Add a subtle dark overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } catch (err) {
        console.warn('Failed to load background image. Using dark fallback.');
        ctx.fillStyle = '#0f0f0f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Header
    ctx.fillStyle = '#ffffff';
    const titleFontSize = pointsData.config?.serverNameFontSize || 30;
    ctx.font = `bold ${titleFontSize}px "ArabicFont", "Segoe UI", Tahoma, Arial, sans-serif`;
    ctx.textAlign = 'center';
    const serverName = pointsData.config?.customServerName || guild.name;
    ctx.fillText(fixArabic(serverName), canvas.width / 2, 60);

    // Get all groups and their points
    const textChannels = guild.channels.cache.filter(c => c.parentId === getTEXT_CATEGORY_ID());
    const groupsList = [];
    
    for (const [id, channel] of textChannels) {
        const groupName = channel.name;
        const adminRole = guild.roles.cache.find(r => r.name.toLowerCase().trim() === `${groupName.toLowerCase().trim()} ★`);
        
        let points = 0;
        if (adminRole) {
            // Check if we can find the owner in cache first to be fast
            let owner = adminRole.members.first();
            
            // If not in cache, we don't necessarily want to fetch all members every time
            // but for the top image, we want accuracy.
            if (owner) {
                points = pointsData[owner.id] || 0;
            } else {
                // If the owner is not cached, try to find them by searching members with the role
                // This is still a bit slow, but it's only done if the owner is not in cache
                const roleMembers = guild.members.cache.filter(m => m.roles.cache.has(adminRole.id));
                if (roleMembers.size > 0) {
                    owner = roleMembers.first();
                    points = pointsData[owner.id] || 0;
                }
            }
        }
        groupsList.push({ name: groupName, points: points });
    }
    
    // Sort by points (High to Low)
    groupsList.sort((a, b) => b.points - a.points);
    const topGroups = groupsList.slice(0, 10); // Show top 10

    // Draw List
    const startY = 160;
    const rowHeight = 40;
    const groupFontSize = pointsData.config?.groupNameFontSize || 24;

    topGroups.forEach((group, index) => {
        const y = startY + (index * rowHeight);
        
        // Background for row
        ctx.fillStyle = index < 3 ? 'rgba(241, 196, 15, 0.1)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(50, y - 30, 700, rowHeight - 5);

        // Rank (Right Side)
        ctx.fillStyle = index === 0 ? '#f1c40f' : (index === 1 ? '#bdc3c7' : (index === 2 ? '#e67e22' : '#ffffff'));
        ctx.font = `bold ${groupFontSize}px "ArabicFont", "Segoe UI", Tahoma, Arial, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(fixArabic(`#${index + 1}`), 730, y);

        // Group Name (Middle Right)
        ctx.fillStyle = '#ffffff';
        ctx.font = `${groupFontSize}px "ArabicFont", "Segoe UI", Tahoma, Arial, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillText(fixArabic(group.name), 660, y);

        // LVL and Progress Bar (Left Side)
        const level = Math.floor(group.points / 1000);
        const progress = group.points % 1000;
        const progressPercent = progress / 1000;

        // Draw LVL text
        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${groupFontSize - 4}px "ArabicFont", "Segoe UI", Tahoma, Arial, sans-serif`;
        ctx.fillText(fixArabic(`LVL ${level}`), 70, y);

        // Draw Progress Bar background (small line)
        const barWidth = 100;
        const barHeight = 6;
        const barX = 160;
        const barY = y - (groupFontSize / 2) + 2;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(barX, barY, barWidth, barHeight);

        // Draw Progress Bar fill
        ctx.fillStyle = '#f1c40f'; // Golden fill
        ctx.fillRect(barX, barY, barWidth * progressPercent, barHeight);
    });

    return new AttachmentBuilder(await canvas.encode('png'), { name: 'top-groups.png' });
}

async function createHelpPanelImage(title, items, imageUrl) {
    const canvas = createCanvas(800, 450);
    const ctx = canvas.getContext('2d');

    try {
        const background = await loadImage(imageUrl);
        ctx.drawImage(background, 0, 0, canvas.width, canvas.height);
        
        // Dark overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    } catch (err) {
        console.warn('Failed to load help image. Using fallback.');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px "ArabicFont", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(fixArabic(title), canvas.width / 2, 70);

    // Items
    ctx.font = '28px "ArabicFont", "Segoe UI", Tahoma, Arial, sans-serif';
    ctx.textAlign = 'right';
    const startY = 150;
    const rowHeight = 45;

    items.forEach((item, index) => {
        const y = startY + (index * rowHeight);
        // Bullet point
        ctx.fillStyle = '#f1c40f';
        ctx.fillText('•', 740, y);
        // Text
        ctx.fillStyle = '#ffffff';
        ctx.fillText(fixArabic(item), 720, y);
    });

    return new AttachmentBuilder(await canvas.encode('png'), { name: 'help-panel.png' });
}



// Dynamic Configuration Getters
const getConfig = (key, defaultValue) => pointsData.config?.[key] || defaultValue;

const getCREATOR_ROLE_ID = () => getConfig('creatorRoleId', '1487214910134816969');
const getCREATION_CHANNEL_ID = () => getConfig('creationChannelId', '1487173856413352096');
const getVOICE_CATEGORY_ID = () => getConfig('voiceCategoryId', '1487227437929594962');
const getTEXT_CATEGORY_ID = () => getConfig('textCategoryId', '1485803304238977074');
const getPOINTS_CHANNEL_ID = () => getConfig('pointsChannelId', '1487360267175071805');
const getLOG_CHANNEL_ID = () => getConfig('logChannelId', '1487457175864344576');

// Default background images
const DEFAULT_BG = 'https://cdn.discordapp.com/attachments/1485803304238977076/1487481982412656670/Design_Image.jpg?ex=69c94d0c&is=69c7fb8c&hm=3b59217454431da9bb532c41db4d2bff052ceaa1536c39ee3599d3a06e01d016&';
const DEFAULT_TOP_BG = 'https://cdn.discordapp.com/attachments/1485803304238977076/1487467644851585124/0525f4fdb3e7b43d63032235563466b8.jpg?ex=69c93fb2&is=69c7ee32&hm=49d125ff73471f4cff5223a38e3a76589c6134825bfdd44823ffc9589e2e2af4&';

// Helper to ensure background persists
function initializeBackgrounds() {
    if (!pointsData.config) pointsData.config = {};
    const bgs = ['adminHelpBg', 'topHelpBg', 'customHelpBg', 'idHelpBg', 'groupHelpBg'];
    bgs.forEach(bg => {
        if (!pointsData.config[bg]) pointsData.config[bg] = DEFAULT_BG;
    });
    if (!pointsData.config.backgroundImage) pointsData.config.backgroundImage = DEFAULT_TOP_BG;
    savePoints();
}

const prefix = '-';

// Buffer for voice points logging to avoid spam
let voicePointsLogBuffer = {}; 
let voicePointsIntervalId = null;

function startVoicePointsInterval() {
    if (voicePointsIntervalId) clearInterval(voicePointsIntervalId);
    
    const intervalSeconds = parseInt(pointsData.config?.voicePointsInterval) || 60;

    voicePointsIntervalId = setInterval(() => {
        client.guilds.cache.forEach(async (guild) => {
            const voiceCategoryId = getVOICE_CATEGORY_ID();
            const voiceChannels = guild.channels.cache.filter(c => 
                c.type === ChannelType.GuildVoice && 
                c.parentId === voiceCategoryId
            );
            
            voiceChannels.forEach(voiceChannel => {
                const groupName = voiceChannel.name.toLowerCase().trim();
                
                voiceChannel.members.forEach(member => {
                    if (!member.user.bot) {
                        const hasAdminRole = member.roles.cache.some(r => 
                            r.name.toLowerCase().trim() === `${groupName} ★`
                        );

                        const hasMemberRole = member.roles.cache.some(r => r.name === "عضو");
                        const hasAccess = voiceChannel.permissionOverwrites.cache.some(ov => {
                            const role = guild.roles.cache.get(ov.id);
                            return role && (role.name === "عضو" || role.name.endsWith("★")) && member.roles.cache.has(role.id);
                        });

                        if (!hasAdminRole && (!hasMemberRole || !hasAccess)) return;

                        const isMuted = member.voice.selfMute || member.voice.mute;
                        const isDeafened = member.voice.selfDeaf || member.voice.deaf;
                        
                        if (isMuted || isDeafened) return;

                        const min = pointsData.config?.voicePointsMin ?? 0.15;
                        const max = pointsData.config?.voicePointsMax ?? 0.15;
                        const pointsAmount = min === max ? min : (Math.random() * (max - min) + min);

                        addPoints(member.id, pointsAmount);
                        
                        if (!voicePointsLogBuffer[member.id]) {
                            voicePointsLogBuffer[member.id] = { name: member.user.tag, groupName: voiceChannel.name, points: 0 };
                        }
                        voicePointsLogBuffer[member.id].points += pointsAmount;
                        // Update group name in case they moved
                        voicePointsLogBuffer[member.id].groupName = voiceChannel.name;
                    }
                });
            });
        });
    }, intervalSeconds * 1000);
}

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    console.log('🚀 Group creation bot is online!');
    console.log(`Prefix is set to: "${prefix}"`);

    // Ensure all background images are initialized and persistent
    initializeBackgrounds();

    // Start voice points system
    startVoicePointsInterval();

    // Log voice points buffer every minute to avoid spam
    setInterval(async () => {
        if (Object.keys(voicePointsLogBuffer).length === 0) {
            // Even if no points were added, sync positions and top image
            client.guilds.cache.forEach(async (guild) => {
                await syncVoiceChannelPositions(guild);
                await updateTopMessage(guild);
            });
            return;
        }

        const logChannel = client.channels.cache.get(getLOG_CHANNEL_ID());
        if (logChannel) {
            let description = "";
            for (const userId in voicePointsLogBuffer) {
                const data = voicePointsLogBuffer[userId];
                // Show 2 decimal places for better readability
                const displayPoints = typeof data.points === 'number' ? data.points.toFixed(2) : data.points;
                description += `👤 **${data.name}** (${data.groupName}): \`+${displayPoints}\` نقطة\n`;
            }

            const logEmbed = new EmbedBuilder()
                .setTitle('🎙️ سجل توزيع نقاط الرومات الصوتية (كمية ثابتة)')
                .setDescription(description)
                .setColor('#3498db')
                .setTimestamp();
            
            await logChannel.send({ embeds: [logEmbed] });
        }
        
        // Clear buffer
        voicePointsLogBuffer = {};

        // Sync positions and update top image every minute
        client.guilds.cache.forEach(async (guild) => {
            await syncVoiceChannelPositions(guild);
            await updateTopMessage(guild); // Frequent top update
        });
    }, 60 * 1000); // Every 1 minute

    // Update top message every hour to avoid canvas overhead
    setInterval(() => {
        client.guilds.cache.forEach(async (guild) => {
            await updateTopMessage(guild);
        });
    }, 60 * 60 * 1000); // Every hour
});

client.on('messageCreate', async (message) => {
    // Basic log to see if bot receives ANY message
    console.log(`Received message: "${message.content}" from ${message.author.tag}`);

    if (message.author.bot) return;

    // Check if message starts with prefix or the command keywords directly
    let content = message.content;
    let isCommand = false;
    let commandStr = "";

    if (content.startsWith(prefix)) {
        isCommand = true;
        content = content.slice(prefix.length).trim();
    }

    if (!isCommand) return;

    // Check if the user is authorized to use the bot
    const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
    const userHasGroup = hasGroup(message.member);

    // If the user doesn't have a group and is not an authorized creator role holder, they can't use commands
    if (!userHasGroup && !isAuthorizedCreator) {
        return;
    }

    // Check if the user has permission to use group commands in this channel
    if (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID()) {
        const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        
        // Find roles via channel overwrites
        const currentName = message.channel.name.toLowerCase().trim();
        const baseRoleObj = message.channel.permissionOverwrites.cache.find(ov => {
            const r = message.guild.roles.cache.get(ov.id);
            return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
        });
        const adminRoleObj = message.channel.permissionOverwrites.cache.find(ov => {
            const r = message.guild.roles.cache.get(ov.id);
            return r && r.name.endsWith('★');
        });

        const hasBaseRole = baseRoleObj && message.member.roles.cache.has(baseRoleObj.id);
        const hasAdminRole = adminRoleObj && message.member.roles.cache.has(adminRoleObj.id);

        // Allow group members (base role) or group admins (★) or authorized creator role holders
        if (!isAuthorizedCreator && !hasBaseRole && !hasAdminRole) {
            return; // Ignore if user is not part of the group
        }
    }

    console.log('Valid command detected.');

    const args = content.trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'top' || command === 'توب' || command === 'المتصدرين') {
        const isPointsChannel = message.channel.id === getPOINTS_CHANNEL_ID();

        // STRICT RESTRICTION: Only allow in the designated Points (Top) channel for EVERYONE
        if (!isPointsChannel) return;

        const topAttachment = await createTopImage(message.guild);
        return message.channel.send({ files: [topAttachment] });
    }

    if (command === 'points' || command === 'نقاطي' || command === 'نقاط') {
        const isPointsChannel = message.channel.id === getPOINTS_CHANNEL_ID();
        const isGroupChannel = message.guild && message.channel.parentId === getTEXT_CATEGORY_ID();
        const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));

        if (isPointsChannel && isAuthorizedCreator) {
            // Proceed
        } else if (isGroupChannel) {
            // Proceed
        } else {
            return; // Ignore everywhere else
        }

        const target = message.mentions.users.first() || message.author;
        const points = pointsData[target.id] || 0;
        return message.reply(`👤 **نقاط ${target.tag}:** \`${points}\` نقطة.`);
    }

    if (command === 'add-points' || command === 'اضافة-نقاط') {
        if (message.channel.id !== getPOINTS_CHANNEL_ID()) return;
        // Only authorized creator role holders
        const isAuthorized = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        
        if (!isAuthorized) return;

        const targetUser = message.mentions.members.first();
        const amount = parseInt(args[1]);

        if (!targetUser || isNaN(amount)) {
            return message.reply('❌ يرجى منشن الشخص وكتابة عدد النقاط. مثال: `-اضافة-نقاط @user 100`');
        }

        addPoints(targetUser.id, amount);
        
        // Sync positions and top immediately
        await syncVoiceChannelPositions(message.guild);
        await updateTopMessage(message.guild);

        // Send log to log channel
        const logChannel = message.guild.channels.cache.get(getLOG_CHANNEL_ID());
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('💰 سجل إضافة نقاط (يدوي)')
                .addFields(
                    { name: '👤 المسؤول', value: `${message.author} (${message.author.id})`, inline: true },
                    { name: '👥 المستلم', value: `${targetUser} (${targetUser.id})`, inline: true },
                    { name: '📈 الكمية', value: `\`${amount}\` نقطة`, inline: true }
                )
                .setColor('#f1c40f')
                .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
        }

        return message.reply(`✅ تم إضافة \`${amount}\` نقطة لـ ${targetUser}.`);
    }

    if (command === 'set-points' || command === 'تحديد-نقاط') {
        if (message.channel.id !== getPOINTS_CHANNEL_ID()) return;
        // Only authorized creator role holders
        const isAuthorized = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        
        if (!isAuthorized) return;

        const targetUser = message.mentions.members.first();
        const amount = parseInt(args[1]);

        if (!targetUser || isNaN(amount)) {
            return message.reply('❌ يرجى منشن الشخص وكتابة عدد النقاط. مثال: `-تحديد-نقاط @user 500`');
        }

        // Set points directly (not adding)
        pointsData[targetUser.id] = amount;
        savePoints();
        
        // Sync positions and top immediately
        await syncVoiceChannelPositions(message.guild);
        await updateTopMessage(message.guild);

        // Send log to log channel
        const logChannel = message.guild.channels.cache.get(getLOG_CHANNEL_ID());
        if (logChannel) {
            const logEmbed = new EmbedBuilder()
                .setTitle('💰 سجل تحديد نقاط (يدوي)')
                .addFields(
                    { name: '👤 المسؤول', value: `${message.author} (${message.author.id})`, inline: true },
                    { name: '👥 المستلم', value: `${targetUser} (${targetUser.id})`, inline: true },
                    { name: '📈 الكمية الجديدة', value: `\`${amount}\` نقطة`, inline: true }
                )
                .setColor('#3498db')
                .setTimestamp();
            await logChannel.send({ embeds: [logEmbed] });
        }

        return message.reply(`✅ تم تحديد نقاط ${targetUser} لتكون \`${amount}\` نقطة.`);
    }

    if (command === 'reset-points' || command === 'تصفير-نقاط') {
        if (message.channel.id !== getPOINTS_CHANNEL_ID()) return;
        const isAuthorized = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        
        if (!isAuthorized) return;

        const targetUser = message.mentions.members.first();
        if (targetUser) {
            pointsData[targetUser.id] = 0;
            savePoints();
            await syncVoiceChannelPositions(message.guild);
            await updateTopMessage(message.guild);
            return message.reply(`✅ تم تصفير نقاط ${targetUser}.`);
        } else if (args[0] === 'الكل' || args[0] === 'all') {
            const config = pointsData.config;
            pointsData = {};
            if (config) pointsData.config = config;
            savePoints();
            await syncVoiceChannelPositions(message.guild);
            await updateTopMessage(message.guild);
            return message.reply('✅ تم تصفير جميع نقاط المستخدمين.');
        } else {
            return message.reply('❌ يرجى منشن الشخص أو كتابة `الكل`. مثال: `-تصفير-نقاط @user` أو `-تصفير-نقاط الكل`');
        }
    }

    if (command === 'id' || command === 'معرفات') {
        const isAuthorized = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        
        if (!isAuthorized) return;

        const idsEmbed = new EmbedBuilder()
            .setTitle('🆔 قائمة المعرفات الحالية')
            .addFields(
                { name: '📝 شات اللوق', value: `\`${getLOG_CHANNEL_ID()}\``, inline: true },
                { name: '💰 شات النقاط', value: `\`${getPOINTS_CHANNEL_ID()}\``, inline: true },
                { name: '➕ شات الإنشاء', value: `\`${getCREATION_CHANNEL_ID()}\``, inline: true },
                { name: '🔊 كتجري الصوت', value: `\`${getVOICE_CATEGORY_ID()}\``, inline: true },
                { name: '💬 كتجري الشات', value: `\`${getTEXT_CATEGORY_ID()}\``, inline: true },
                { name: '👑 رتبة المنشئ', value: `\`${getCREATOR_ROLE_ID()}\``, inline: true }
            )
            .setColor('#9b59b6')
            .setTimestamp();

        const idSettingsMenu = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('id_admin_settings_menu')
                    .setPlaceholder('تعديل المعرفات...')
                    .addOptions([
                        { label: 'شات اللوق', value: 'set_log_channel', emoji: '📝' },
                        { label: 'شات النقاط', value: 'set_points_channel', emoji: '💰' },
                        { label: 'شات الإنشاء', value: 'set_creation_channel', emoji: '➕' },
                        { label: 'كتجري الرومات الصوتية', value: 'set_voice_category', emoji: '🔊' },
                        { label: 'كتجري رومات الشات', value: 'set_text_category', emoji: '💬' },
                        { label: 'رتبة المنشئ', value: 'set_creator_role', emoji: '👑' }
                    ])
            );

        return message.channel.send({ embeds: [idsEmbed], components: [idSettingsMenu] });
    }

    if (command === 'setup-top' || command === 'تثبيت-توب' || command === 'اعدادات-التوب') {
        const isCreationChannel = message.channel.id === getCREATION_CHANNEL_ID();
        const isPointsChannel = message.channel.id === getPOINTS_CHANNEL_ID();
        
        // Only authorized creator role holders
        const isAuthorized = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        
        if (!isAuthorized) return;

        // If in creation channel, send the settings control panel
        if (isCreationChannel) {
            const topSettingsEmbed = new EmbedBuilder()
                .setTitle('⚙️ لوحة تحكم إعدادات التوب')
                .setDescription('يمكنك من هنا إدارة شكل وموقع قائمة المتصدرين:')
                .addFields(
                    { name: '🖼️ الخلفية', value: 'تغيير صورة خلفية التوب (رابط أو رفع)', inline: true },
                    { name: '📌 التثبيت', value: 'تثبيت رسالة التحديث التلقائي في قناة النقاط', inline: true }
                )
                .setColor('#f1c40f')
                .setTimestamp();

            const topSettingsMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('top_admin_settings_menu')
                        .setPlaceholder('اختر إعداد للتعديل...')
                        .addOptions([
                            {
                                label: 'تغيير صورة الخلفية',
                                description: 'تحديث خلفية قائمة المتصدرين',
                                value: 'change_bg',
                                emoji: '🖼️'
                            },
                            {
                                label: 'تثبيت رسالة التوب',
                                description: 'إرسال وتثبيت رسالة التحديث التلقائي',
                                value: 'setup_auto_top',
                                emoji: '📌'
                            }
                        ])
                );

            return message.channel.send({ embeds: [topSettingsEmbed], components: [topSettingsMenu] });
        }

        // Legacy behavior for setup-top in points channel
        if (isPointsChannel && (command === 'setup-top' || command === 'تثبيت-توب')) {
            const topAttachment = await createTopImage(message.guild);
            const sentMessage = await message.channel.send({ files: [topAttachment] });
            
            pointsData.config = {
                ...pointsData.config,
                channelId: message.channel.id,
                messageId: sentMessage.id
            };
            savePoints();
            
            return message.reply(`✅ تم تثبيت قائمة المتصدرين في هذه القناة. سيتم تحديثها تلقائياً كل ساعة.`);
        }
    }

    if (command === 'groups' || command === 'قروبات') {
        const isAuthorized = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        
        if (!isAuthorized) return;

        const voiceChannels = message.guild.channels.cache
            .filter(c => c.parentId === getVOICE_CATEGORY_ID() && c.type === ChannelType.GuildVoice)
            .sort((a, b) => b.members.size - a.members.size);

        const top10 = Array.from(voiceChannels.values()).slice(0, 10);
        const groupList = top10.map((c, index) => `${index + 1}. **${c.name}** | عدد المتواجدين: \`${c.members.size}\``).join('\n') || 'لا توجد رومات صوتية حالياً.';

        const embed = new EmbedBuilder()
            .setTitle('📋 حالة الرومات الصوتية للمجموعات (أعلى 10)')
            .setDescription(`إجمالي الرومات: **${voiceChannels.size}**\n\n${groupList}`)
            .setColor('#3498db')
            .setTimestamp();

        return message.channel.send({ embeds: [embed] });
    }

    if (command === 'add-to-group' || command === 'اضافة' || command === 'إضافة') {
        const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        const isGroupChannel = (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID());
        
        // Silent ignore if not in a group channel and not an authorized creator
        if (!isGroupChannel && !isAuthorizedCreator) return;

        let role;
        let adminRole;
        let targetUser = message.mentions.members.first();
        const userIdArg = args.find(arg => /^\d{17,19}$/.test(arg));

        if (!targetUser && userIdArg) {
            try { targetUser = await message.guild.members.fetch(userIdArg); } catch (err) {}
        }

        // Find group role from current channel overwrites
        if (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID()) {
            const currentName = message.channel.name.toLowerCase().trim();
            role = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
            });
            if (role) role = message.guild.roles.cache.get(role.id);

            adminRole = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && r.name.endsWith('★');
            });
            if (adminRole) adminRole = message.guild.roles.cache.get(adminRole.id);
        }

        if (!role || !targetUser) {
            return message.reply('❌ يرجى استخدام الأمر داخل شات المجموعة ومنشن الشخص المراد إضافته.');
        }

        // Helper to check if user has global management perms
        const isGlobalAuthorized = message.member.roles.cache.has(getCREATOR_ROLE_ID());

        // Check if user is group admin
        if (!message.member.roles.cache.has(adminRole?.id)) {
            return message.reply('❌ هذا الأمر مخصص لـ **مسؤولي المجموعة (★)** فقط.');
        }

        // Check if author is trying to add themselves
        if (targetUser.id === message.author.id) {
            return message.reply('❌ ما تقدر تضيف نفسك بالقروب، أنت مضاف بالفعل.');
        }

        // Check if target is already in the group (member or admin)
        const isMember = targetUser.roles.cache.has(role.id);
        const isAdmin = adminRole && targetUser.roles.cache.has(adminRole.id);
        
        if (isMember || isAdmin) {
            return message.reply('❌ هذا الشخص موجود.');
        }

        try {
            await targetUser.roles.add(role);
            message.reply(`✅ تمت إضافة ${targetUser} إلى المجموعة بنجاح!`);
        } catch (error) {
            message.reply('❌ حدث خطأ أثناء إضافة العضو.');
        }
    }

    if (command === 'remove-from-group' || command === 'طرد' || command === 'ازالة') {
        const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        const isGroupChannel = (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID());
        
        // Silent ignore if not in a group channel and not an authorized creator
        if (!isGroupChannel && !isAuthorizedCreator) return;

        let role;
        let adminRole;
        let targetUser = message.mentions.members.first();
        const userIdArg = args.find(arg => /^\d{17,19}$/.test(arg));

        if (!targetUser && userIdArg) {
            try { targetUser = await message.guild.members.fetch(userIdArg); } catch (err) {}
        }

        // Find group role from current channel overwrites
        if (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID()) {
            const currentName = message.channel.name.toLowerCase().trim();
            role = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
            });
            if (role) role = message.guild.roles.cache.get(role.id);

            adminRole = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && r.name.endsWith('★');
            });
            if (adminRole) adminRole = message.guild.roles.cache.get(adminRole.id);
        }

        if (!role || !targetUser) {
            return message.reply('❌ يرجى استخدام الأمر داخل شات المجموعة ومنشن الشخص المراد إزالته.');
        }

        // Helper to check if user has global management perms
        const isGlobalAuthorized = message.member.roles.cache.has(getCREATOR_ROLE_ID());

        // Check permissions
        if (!message.member.roles.cache.has(adminRole?.id)) {
            return message.reply('❌ هذا الأمر مخصص لـ **مسؤولي المجموعة (★)** فقط.');
        }

        // Check if user is actually in the group
        if (!targetUser.roles.cache.has(role.id)) {
            return message.reply('❌ هذا الشخص مو بالقروب.');
        }

        try {
            await targetUser.roles.remove(role);
            // Also remove admin role if they have it
            if (adminRole && targetUser.roles.cache.has(adminRole.id)) {
                await targetUser.roles.remove(adminRole);
            }
            message.reply(`✅ تم إزالة ${targetUser} من المجموعة بنجاح.`);
        } catch (error) {
            message.reply('❌ حدث خطأ أثناء إزالة العضو.');
        }
    }

    if (command === 'rename-group' || command === 'تغيير-اسم' || command === 'تسمية') {
        const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        const isGroupChannel = (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID());
        
        // Silent ignore if not in a group channel and not an authorized creator
        if (!isGroupChannel && !isAuthorizedCreator) return;

        let role;
        let adminRole;
        const newName = args.join(' ');
        
        // Find the group role associated with this channel
        if (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID()) {
            const currentName = message.channel.name.toLowerCase().trim();
            // Find base role (either "عضو" or matches current channel name)
            role = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
            });
            if (role) role = message.guild.roles.cache.get(role.id);

            // Find admin role (ends with ★)
            adminRole = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && r.name.endsWith('★');
            });
            if (adminRole) adminRole = message.guild.roles.cache.get(adminRole.id);
        }

        if (!role || !adminRole || !newName) {
            return message.reply('❌ يرجى استخدام الأمر داخل شات المجموعة وكتابة الاسم الجديد.\nمثال: `تغيير-اسم اسم جديد`');
        }

        // Helper to check if user has global management perms
        const isGlobalAuthorized = message.member.roles.cache.has(getCREATOR_ROLE_ID());

        // Revised: Allow group admin (★) - Members (عضو) will be blocked
        if (!message.member.roles.cache.has(adminRole?.id)) {
            return message.reply('❌ هذا الأمر مخصص لـ **مالك المجموعة والمسؤولين (★)** فقط. العضو العادي لا يمكنه تغيير الاسم.');
        }

        try {
            const oldName = message.channel.name;
            
            // Base role name becomes "عضو"
            await role.setName("عضو");
            // Admin role name follows group name
            await adminRole.setName(`${newName} ★`);
            
            // Rename text channel
            await message.channel.setName(newName);

            // Find and rename voice channel
            const voiceChannel = message.guild.channels.cache.find(c => 
                c.parentId === getVOICE_CATEGORY_ID() && 
                c.name.toLowerCase().trim() === oldName.toLowerCase().trim()
            );
            if (voiceChannel) {
                await voiceChannel.setName(newName);
            }

            message.reply(`✅ تم تغيير اسم المجموعة إلى **${newName}** بنجاح!\n- رتبة العضو أصبحت: \`عضو\`\n- رتبة المسؤول أصبحت: \`${newName} ★\``);
        } catch (error) {
            console.error(error);
            message.reply('❌ حدث خطأ أثناء تغيير الاسم.');
        }
    }

    if (command === 'promote' || command === 'ترقية') {
        const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        const isGroupChannel = (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID());
        
        // Silent ignore if not in a group channel and not an authorized creator
        if (!isGroupChannel && !isAuthorizedCreator) return;

        let role;
        let adminRole;
        let targetUser = message.mentions.members.first();
        const userIdArg = args.find(arg => /^\d{17,19}$/.test(arg));

        if (!targetUser && userIdArg) {
            try { targetUser = await message.guild.members.fetch(userIdArg); } catch (err) {}
        }

        // Find the group from the current channel overwrites
        if (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID()) {
            const currentName = message.channel.name.toLowerCase().trim();
            role = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
            });
            if (role) role = message.guild.roles.cache.get(role.id);

            adminRole = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && r.name.endsWith('★');
            });
            if (adminRole) adminRole = message.guild.roles.cache.get(adminRole.id);
        }

        if (!targetUser || !adminRole) {
            return message.reply('❌ يرجى استخدام هذا الأمر داخل شات المجموعة ومنشن الشخص المراد ترقيته.');
        }

        // Helper to check if user has global management perms
        const isGlobalAuthorized = message.member.roles.cache.has(getCREATOR_ROLE_ID());

        // Find the actual group leader
        const currentGroupName = message.channel.name.toLowerCase().trim();
        let groupLeaderId = pointsData.config?.groupLeaders?.[currentGroupName];
        let groupLeader = null;

        if (groupLeaderId) {
            try { groupLeader = await message.guild.members.fetch(groupLeaderId); } catch (err) {}
        }

        // Fallback: If no leader is stored, pick the one with the most points among those who have the admin role
        if (!groupLeader) {
            let adminMembersArr = [];
            try {
                const fetched = await message.guild.members.fetch({ role: adminRole.id });
                adminMembersArr = Array.from(fetched.values());
            } catch (err) {
                adminMembersArr = Array.from(adminRole.members.values());
            }

            if (adminMembersArr.length > 0) {
                // Sort by points (High to Low)
                adminMembersArr.sort((a, b) => (pointsData[b.id] || 0) - (pointsData[a.id] || 0));
                groupLeader = adminMembersArr[0];
                
                // Automatically save this person as the leader to points.json for next time
                if (!pointsData.config) pointsData.config = {};
                if (!pointsData.config.groupLeaders) pointsData.config.groupLeaders = {};
                pointsData.config.groupLeaders[currentGroupName] = groupLeader.id;
                savePoints();
            }
        }

        const isActualLeader = groupLeader && message.author.id === groupLeader.id;

        // Check if user is the leader or global creator
        if (!isGlobalAuthorized && !isActualLeader) {
            return message.reply('❌ هذا الأمر مخصص لـ **قائد المجموعة** فقط. المسؤول العادي لا يمكنه ترقية أعضاء آخرين.');
        }

        // Check if user is already in the group (has the base group role)
        if (!targetUser.roles.cache.has(role.id)) {
            return message.reply('❌ هذا الشخص مو بالقروب.');
        }

        // Check if user is already promoted
        if (targetUser.roles.cache.has(adminRole.id)) {
            return message.reply('❌ هذا الشخص مترقي بالفعل.');
        }

        if (targetUser.id === message.author.id) {
            return message.reply('❌ ما تقدر ترقي نفسك.');
        }

        const targetIsLeader = targetUser.id === message.guild.ownerId || 
                             targetUser.roles.cache.has(getCREATOR_ROLE_ID()) ||
                             (groupLeader && targetUser.id === groupLeader.id);
        if (!isGlobalAuthorized && targetIsLeader) {
            return message.reply('❌ ما تقدر ترقي القائد.');
        }

        try {
            await targetUser.roles.add(adminRole);
            message.reply(`✅ تم ترقية ${targetUser} ليصبح **مسؤولاً (★)** في المجموعة بنجاح!`);
        } catch (error) {
            message.reply('❌ حدث خطأ أثناء الترقية.');
        }
    }

    if (command === 'demote' || command === 'ازالة-ترقية' || command === 'إزالة-ترقية') {
        const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));
        const isGroupChannel = (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID());
        
        // Silent ignore if not in a group channel and not an authorized creator
        if (!isGroupChannel && !isAuthorizedCreator) return;

        let role;
        let adminRole;
        const userIdArg = args[0];
        let targetUser = message.mentions.members.first();

        if (!targetUser && userIdArg) {
            try { targetUser = await message.guild.members.fetch(userIdArg); } catch (err) {}
        }

        // Find the group from the current channel overwrites
        if (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID()) {
            const currentName = message.channel.name.toLowerCase().trim();
            role = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
            });
            if (role) role = message.guild.roles.cache.get(role.id);

            adminRole = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && r.name.endsWith('★');
            });
            if (adminRole) adminRole = message.guild.roles.cache.get(adminRole.id);
        }

        if (!targetUser || !adminRole) {
            return message.reply('❌ يرجى استخدام هذا الأمر داخل شات المجموعة ومنشن الشخص المراد إزالة ترقيته.');
        }

        // Helper to check if user has global management perms
        const isGlobalAuthorized = message.member.roles.cache.has(getCREATOR_ROLE_ID());

        // Find the actual group leader
        const currentGroupName = message.channel.name.toLowerCase().trim();
        let groupLeaderId = pointsData.config?.groupLeaders?.[currentGroupName];
        let groupLeader = null;

        if (groupLeaderId) {
            try { groupLeader = await message.guild.members.fetch(groupLeaderId); } catch (err) {}
        }

        // Fallback: If no leader is stored, pick the one with the most points among those who have the admin role
        if (!groupLeader) {
            let adminMembersArr = [];
            try {
                const fetched = await message.guild.members.fetch({ role: adminRole.id });
                adminMembersArr = Array.from(fetched.values());
            } catch (err) {
                adminMembersArr = Array.from(adminRole.members.values());
            }

            if (adminMembersArr.length > 0) {
                // Sort by points (High to Low)
                adminMembersArr.sort((a, b) => (pointsData[b.id] || 0) - (pointsData[a.id] || 0));
                groupLeader = adminMembersArr[0];
                
                // Automatically save this person as the leader to points.json for next time
                if (!pointsData.config) pointsData.config = {};
                if (!pointsData.config.groupLeaders) pointsData.config.groupLeaders = {};
                pointsData.config.groupLeaders[currentGroupName] = groupLeader.id;
                savePoints();
            }
        }

        const isActualLeader = groupLeader && message.author.id === groupLeader.id;

        // Check if user is the leader or global creator
        if (!isGlobalAuthorized && !isActualLeader) {
            return message.reply('❌ هذا الأمر مخصص لـ **قائد المجموعة** فقط. المسؤول العادي لا يمكنه إزالة ترقية مسؤولين آخرين.');
        }

        if (targetUser.id === message.author.id) {
            return message.reply('❌ ما تقدر تزيل الترقية عن نفسك.');
        }

        const targetIsLeader = targetUser.id === message.guild.ownerId || 
                             targetUser.roles.cache.has(getCREATOR_ROLE_ID()) ||
                             (groupLeader && targetUser.id === groupLeader.id);
        if (!isGlobalAuthorized && targetIsLeader) {
            return message.reply('❌ ما تقدر تنزل رتبة القائد.');
        }

        if (!targetUser.roles.cache.has(adminRole.id)) {
            return message.reply('❌ هذا الشخص مو مسؤول في المجموعة أصلاً.');
        }

        try {
            await targetUser.roles.remove(adminRole);
            message.reply(`✅ تم إزالة الترقية عن ${targetUser} بنجاح.`);
        } catch (error) {
            message.reply('❌ حدث خطأ أثناء إزالة الترقية.');
        }
    }

    if (command === 'members' || command === 'اعضاء' || command === 'الأعضاء') {
        const isGroupChannel = (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID());
        
        // STRICT: Only allow inside the group text channel
        if (!isGroupChannel) return;

        let role;
        let adminRole;
        if (message.guild && message.channel.parentId === getTEXT_CATEGORY_ID()) {
            const currentName = message.channel.name.toLowerCase().trim();
            role = message.channel.permissionOverwrites.cache.find(ov => {
                const r = message.guild.roles.cache.get(ov.id);
                return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
            });
            if (role) {
                role = message.guild.roles.cache.get(role.id);
                adminRole = message.channel.permissionOverwrites.cache.find(ov => {
                    const r = message.guild.roles.cache.get(ov.id);
                    return r && r.name.endsWith('★');
                });
                if (adminRole) adminRole = message.guild.roles.cache.get(adminRole.id);
            }
        }

        if (!role) {
            return message.reply('❌ هذا الأمر يعمل فقط داخل شات المجموعة.');
        }

        // Combine members from base role and admin role (★)
        const groupMembers = Array.from(role.members.values());
        const adminMembersRole = adminRole ? Array.from(adminRole.members.values()) : [];
        
        // Use Map to ensure unique members by ID
        const allMembersMap = new Map();
        groupMembers.forEach(m => allMembersMap.set(m.id, m));
        adminMembersRole.forEach(m => allMembersMap.set(m.id, m));
        const members = Array.from(allMembersMap.values());
        
        // Group Leader is the first member of the admin role (★)
        const adminMembers = adminRole ? Array.from(adminRole.members.values()) : [];
        const groupLeader = adminMembers.length > 0 ? adminMembers[0] : null;

        // Sorting: Group Leader first, then Server Owner, then Admins, then regular members
        members.sort((a, b) => {
            const aIsGroupLeader = groupLeader && a.id === groupLeader.id;
            const bIsGroupLeader = groupLeader && b.id === groupLeader.id;
            const aIsAdmin = adminRole && a.roles.cache.has(adminRole.id);
            const bIsAdmin = adminRole && b.roles.cache.has(adminRole.id);
            const aIsOwner = a.id === message.guild.ownerId;
            const bIsOwner = b.id === message.guild.ownerId;
            
            if (aIsGroupLeader) return -1;
            if (bIsGroupLeader) return 1;
            if (aIsOwner) return -1;
            if (bIsOwner) return 1;
            if (aIsAdmin && !bIsAdmin) return -1;
            if (!aIsAdmin && bIsAdmin) return 1;
            return 0;
        });

        let memberListText = `عدد الأعضاء: **${members.length}**\n\n`;
        members.forEach((m, index) => {
            const isGroupLeader = groupLeader && m.id === groupLeader.id;
            const isOwner = m.id === message.guild.ownerId;
            const isAdmin = adminRole && m.roles.cache.has(adminRole.id);
            
            let tag = '👤 عضو';
            if (isGroupLeader) tag = '👑 قائد المجموعة';
            else if (isOwner) tag = '👑 قائد السيرفر';
            else if (isAdmin) tag = '⭐ مسؤول';
            
            memberListText += `**${index + 1}.** ${m.user.tag} | \`${tag}\`\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle(`👥 أعضاء مجموعة: ${message.channel.name}`)
            .setDescription(memberListText)
            .setColor('#f1c40f');

        message.channel.send({ embeds: [embed] });
    }

    if (command === 'help' || command === 'اوامر' || command === 'الأوامر') {
        const mainBotChannelId = process.env.ROOM_id;
        const creationChannelId = getCREATION_CHANNEL_ID();
        const textCategoryId = getTEXT_CATEGORY_ID();
        
        const isMainBotChannel = message.channel.id === mainBotChannelId;
        const isCreationChannel = message.channel.id === creationChannelId;
        const isGroupChannel = message.guild && message.channel.parentId === textCategoryId;
        const isAuthorizedCreator = (message.member && message.member.roles.cache.has(getCREATOR_ROLE_ID()));

        // If it's an admin channel, show admin panels to authorized creators
        if ((isMainBotChannel || isCreationChannel) && isAuthorizedCreator) {
            // 1. Admin Help Panel
            const adminHelpUrl = getConfig('adminHelpBg');
            const adminHelpTitle = getConfig('adminHelpTitle', 'لوحة إدارة المجموعات');
            const adminHelpItems = getConfig('adminHelpItems', ['إنشاء مجموعة جديدة', 'حذف مجموعة عضو', 'عرض المجموعات النشطة']);
            const adminHelpImage = await createHelpPanelImage(adminHelpTitle, adminHelpItems, adminHelpUrl);

            // 2. Top Settings Panel
            const topHelpUrl = getConfig('topHelpBg');
            const topHelpTitle = getConfig('topHelpTitle', 'لوحة إعدادات التوب');
            const topHelpItems = getConfig('topHelpItems', ['تغيير خلفية التوب', 'تغيير اسم السيرفر', 'تعديل النقاط', 'تثبيت التوب']);
            const topHelpImage = await createHelpPanelImage(topHelpTitle, topHelpItems, topHelpUrl);

            // 3. Customization Panel
            const customHelpUrl = getConfig('customHelpBg');
            const customHelpTitle = getConfig('customHelpTitle', 'لوحة تخصيص المساعدة');
            const customHelpItems = getConfig('customHelpItems', ['تغيير الصور', 'تغيير العناوين', 'تغيير النصوص']);
            const customHelpImage = await createHelpPanelImage(customHelpTitle, customHelpItems, customHelpUrl);

            // 4. ID Settings Panel
            const idHelpUrl = getConfig('idHelpBg');
            const idHelpTitle = getConfig('idHelpTitle', 'لوحة إعدادات المعرفات');
            const idHelpItems = getConfig('idHelpItems', ['شات اللوق والنقاط', 'شات الإنشاء', 'كتجري الصوت والشات', 'رتبة المنشئ']);
            const idHelpImage = await createHelpPanelImage(idHelpTitle, idHelpItems, idHelpUrl);

            const createMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('creation_admin_menu')
                        .setPlaceholder('إدارة المجموعات...')
                        .addOptions([
                            { label: 'إنشاء مجموعة جديدة', value: 'start_creation', emoji: '➕' },
                            { label: 'حذف مجموعة عضو', value: 'admin_delete_group', emoji: '🗑️' },
                            { label: 'عرض المجموعات النشطة', value: 'admin_view_groups', emoji: '📋' }
                        ])
                );

            const topSettingsMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('top_admin_settings_menu')
                        .setPlaceholder('إعدادات التوب...')
                        .addOptions([
                            { label: 'تغيير صورة الخلفية', value: 'change_bg', emoji: '🖼️' },
                            { label: 'تغيير اسم السيرفر في الصورة', value: 'change_title', emoji: '📝' },
                            { label: 'تغيير حجم اسم السيرفر', value: 'change_title_size', emoji: '📏' },
                            { label: 'تغيير حجم أسماء المجموعات', value: 'change_groups_size', emoji: '🔡' },
                            { label: 'أرقام عربية (تفعيل/تعطيل)', value: 'toggle_arabic_digits', emoji: '🔢' },
                            { label: 'تعديل مدة النقاط', value: 'change_points_interval', emoji: '⏱️' },
                            { label: 'تعديل كمية النقاط', value: 'change_points_amount', emoji: '💰' },
                            { label: 'تصفير نقاط التوب', value: 'reset_top_points', emoji: '🧹' },
                            { label: 'تثبيت رسالة التوب', value: 'setup_auto_top', emoji: '📌' },
                            { label: 'إلغاء تثبيت التوب', value: 'remove_auto_top', emoji: '❌' }
                        ])
                );

            const helpCustomMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('help_custom_settings_menu')
                        .setPlaceholder('تخصيص لوحات المساعدة...')
                        .addOptions([
                            { label: 'لوحة الإدارة (صورة/عنوان/نص)', value: 'group_admin_custom', emoji: '🛠️' },
                            { label: 'لوحة المجموعات (صورة/عنوان/نص)', value: 'group_user_custom', emoji: '👥' },
                            { label: 'لوحة التوب (صورة/عنوان/نص)', value: 'group_top_custom', emoji: '📊' },
                            { label: 'لوحة التخصيص (صورة/عنوان/نص)', value: 'group_custom_custom', emoji: '🎨' },
                            { label: 'لوحة المعرفات (صورة/عنوان/نص)', value: 'group_id_custom', emoji: '🆔' }
                        ])
                );

            const idSettingsMenu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('id_admin_settings_menu')
                        .setPlaceholder('إعدادات المعرفات (IDs)...')
                        .addOptions([
                            { label: 'شات اللوق', value: 'set_log_channel', emoji: '📝' },
                            { label: 'شات النقاط', value: 'set_points_channel', emoji: '💰' },
                            { label: 'شات الإنشاء', value: 'set_creation_channel', emoji: '➕' },
                            { label: 'كتجري الرومات الصوتية', value: 'set_voice_category', emoji: '🔊' },
                            { label: 'كتجري رومات الشات', value: 'set_text_category', emoji: '💬' },
                            { label: 'رتبة المنشئ', value: 'set_creator_role', emoji: '👑' }
                        ])
                );
            
            return message.channel.send({ 
                files: [adminHelpImage, topHelpImage, customHelpImage, idHelpImage],
                components: [createMenu, topSettingsMenu, helpCustomMenu, idSettingsMenu] 
            });
        }

        // 2. Help for Group Management
        // Only show inside the group text channel
        if (isGroupChannel) {
            const groupHelpUrl = getConfig('groupHelpBg');
            const groupHelpTitle = getConfig('groupHelpTitle', 'قائمة إدارة المجموعة');
            const groupHelpItems = getConfig('groupHelpItems', [
                'إضافة عضو جديد',
                'طرد عضو من المجموعة',
                'تغيير اسم المجموعة',
                'ترقية عضو لمسؤول',
                'إزالة ترقية مسؤول',
                'عرض قائمة الأعضاء'
            ]);
            
            const groupHelpImage = await createHelpPanelImage(groupHelpTitle, groupHelpItems, groupHelpUrl);

            const menu = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('help_menu')
                        .setPlaceholder('اختر قسماً للإدارة...')
                        .addOptions([
                            {
                                label: 'إضافة عضو',
                                description: 'كيفية إضافة شخص لمجموعتك',
                                value: 'add_member',
                                emoji: '➕'
                            },
                            {
                                label: 'طرد عضو',
                                description: 'كيفية إزالة شخص من مجموعتك',
                                value: 'remove_member',
                                emoji: '➖'
                            },
                            {
                                label: 'تغيير الاسم',
                                description: 'تغيير اسم المجموعة وروماتها',
                                value: 'rename_group',
                                emoji: '📝'
                            },
                            {
                                label: 'ترقية عضو',
                                description: 'إعطاء رتبة مسؤول (★) لعضو',
                                value: 'promote_member',
                                emoji: '⭐'
                            },
                            {
                                label: 'إزالة ترقية',
                                description: 'إزالة رتبة مسؤول (★) من عضو',
                                value: 'demote_member',
                                emoji: '📉'
                            },
                            {
                                label: 'الأعضاء',
                                description: 'عدد وقائمة أعضاء المجموعة',
                                value: 'view_members',
                                emoji: '👥'
                            },
                            {
                                label: 'إعدادات المجموعة',
                                description: 'تغيير الاسم وغيرها',
                                value: 'settings',
                                emoji: '🛠️'
                            },
                            {
                                label: 'إخفاء الروم الصوتي',
                                description: 'منع الجميع من رؤية الروم الصوتي',
                                value: 'hide_voice',
                                emoji: '👻'
                            },
                            {
                                label: 'إظهار الروم الصوتي',
                                description: 'السماح للجميع برؤية الروم الصوتي',
                                value: 'show_voice',
                                emoji: '👁️'
                            }
                        ])
                );

            message.channel.send({ files: [groupHelpImage], components: [menu] });
            return;
        }
    }

});

// Interaction handler for the help menu
client.on('interactionCreate', async (interaction) => {
    const filter = m => m.author.id === interaction.user.id;
    const isGlobalAuthorized = (interaction.member && interaction.member.roles.cache.has(getCREATOR_ROLE_ID()));
    const userHasGroup = hasGroup(interaction.member);

    // Button interactions for members list pagination
    if (interaction.isButton()) {
        if (!interaction.customId.startsWith('members_page_')) return;
        
        const [,, pageStr] = interaction.customId.split('_');
        const page = parseInt(pageStr);
        
        // Find group role from current channel overwrites
        let groupRole;
        let adminRole;
        
        if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
            const currentName = interaction.channel.name.toLowerCase().trim();
            groupRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                const r = interaction.guild.roles.cache.get(ov.id);
                return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
            });
            if (groupRole) groupRole = interaction.guild.roles.cache.get(groupRole.id);

            adminRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                const r = interaction.guild.roles.cache.get(ov.id);
                return r && r.name.endsWith('★');
            });
            if (adminRole) adminRole = interaction.guild.roles.cache.get(adminRole.id);
        }
        
        if (!groupRole) return await interaction.reply({ content: '❌ تعذر العثور على رتبة المجموعة في هذه القناة.', ephemeral: true });
        
        // Combine members from base role and admin role (★)
        const groupMembers = Array.from(groupRole.members.values());
        const adminMembersRole = adminRole ? Array.from(adminRole.members.values()) : [];
        
        // Use Map to ensure unique members by ID
        const allMembersMap = new Map();
        groupMembers.forEach(m => allMembersMap.set(m.id, m));
        adminMembersRole.forEach(m => allMembersMap.set(m.id, m));
        const members = Array.from(allMembersMap.values());
        
        // Group Leader is the first member of the admin role (★)
        const adminMembers = adminRole ? Array.from(adminRole.members.values()) : [];
        const groupLeader = adminMembers.length > 0 ? adminMembers[0] : null;

        // Sorting: Group Leader first, then Server Owner, then Admins, then regular members
        members.sort((a, b) => {
            const aIsGroupLeader = groupLeader && a.id === groupLeader.id;
            const bIsGroupLeader = groupLeader && b.id === groupLeader.id;
            const aIsAdmin = adminRole && a.roles.cache.has(adminRole.id);
            const bIsAdmin = adminRole && b.roles.cache.has(adminRole.id);
            const aIsOwner = a.id === interaction.guild.ownerId;
            const bIsOwner = b.id === interaction.guild.ownerId;
            
            if (aIsGroupLeader) return -1;
            if (bIsGroupLeader) return 1;
            if (aIsOwner) return -1;
            if (bIsOwner) return 1;
            if (aIsAdmin && !bIsAdmin) return -1;
            if (!aIsAdmin && bIsAdmin) return 1;
            return 0;
        });

        const pageSize = 10;
        const totalPages = Math.ceil(members.length / pageSize);
        const start = page * pageSize;
        const end = start + pageSize;
        const pageMembers = members.slice(start, end);

        let description = `عدد الأعضاء الكلي: **${members.length}**\n\n`;
        pageMembers.forEach((m, index) => {
            const isGroupLeader = groupLeader && m.id === groupLeader.id;
            const isOwner = m.id === interaction.guild.ownerId;
            const isAdmin = adminRole && m.roles.cache.has(adminRole.id);
            
            let tag = '👤 عضو';
            if (isGroupLeader) tag = '👑 قائد المجموعة';
            else if (isOwner) tag = '👑 قائد السيرفر';
            else if (isAdmin) tag = '⭐ مسؤول';
            
            description += `**${start + index + 1}.** ${m.user.tag} | \`${tag}\`\n`;
        });

        const embed = new EmbedBuilder()
            .setTitle(`👥 أعضاء مجموعة: ${interaction.channel.name}`)
            .setDescription(description)
            .setFooter({ text: `صفحة ${page + 1} من ${totalPages}` })
            .setColor('#f1c40f');

        const row = new ActionRowBuilder();
        if (page > 0) {
            row.addComponents(new ButtonBuilder().setCustomId(`members_page_${page - 1}`).setLabel('السابق').setStyle(ButtonStyle.Primary));
        }
        if (end < members.length) {
            row.addComponents(new ButtonBuilder().setCustomId(`members_page_${page + 1}`).setLabel('التالي').setStyle(ButtonStyle.Primary));
        }

        return await interaction.update({ embeds: [embed], components: row.components.length > 0 ? [row] : [] });
    }

    if (!interaction.isStringSelectMenu()) return;

    const value = interaction.values[0];

    // If the user doesn't have a group and is not an authorized creator role holder, they can't use interactions
    if (!userHasGroup && !isGlobalAuthorized) {
        return await interaction.reply({ content: '❌ هذا البوت مخصص لأصحاب المجموعات أو حاملي رتبة المنشئ فقط.', ephemeral: true });
    }

    // Restriction: Non-admins can only interact inside their own group channel
    const isGroupChannel = interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID();
    if (!isGlobalAuthorized && !isGroupChannel) {
        return await interaction.reply({ content: '❌ يمكنك استخدام التفاعلات فقط داخل شات مجموعتك.', ephemeral: true });
    }

    if (interaction.customId === 'top_admin_settings_menu') {
        if (!isGlobalAuthorized) {
            return await interaction.reply({ content: '❌ هذا الخيار متاح للمنشئين المصرح لهم فقط.', ephemeral: true });
        }

        switch (value) {
            case 'change_bg':
                await interaction.reply({ content: '🖼️ **من فضلك أرسل الصورة أو رابط الصورة الجديدة لخلفية التوب الآن:**', ephemeral: true });
                const imageCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                imageCollector.on('collect', async m => {
                    const attachment = m.attachments.first();
                    const newUrl = attachment ? attachment.url : m.content.trim();
                    
                    if (!newUrl.startsWith('http')) {
                        return m.reply('❌ يرجى إرسال صورة أو رابط صحيح.');
                    }

                    try {
                        await loadImage(newUrl);
                        if (!pointsData.config) pointsData.config = {};
                        pointsData.config.backgroundImage = newUrl;
                        savePoints();
                        await m.reply('✅ تم تحديث خلفية قائمة المتصدرين بنجاح!');
                    } catch (err) {
                        console.error(err);
                        await m.reply('❌ فشل تحميل الصورة. تأكد من أن الملف صورة صالحة أو الرابط مباشر.');
                    }
                });
                break;

            case 'change_title':
                await interaction.reply({ content: '📝 **من فضلك اكتب اسم السيرفر الجديد الذي تريده أن يظهر في الصورة:**', ephemeral: true });
                const titleCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                titleCollector.on('collect', async m => {
                    const newTitle = m.content.trim();
                    if (!newTitle) return m.reply('❌ يرجى كتابة اسم صحيح.');

                    if (!pointsData.config) pointsData.config = {};
                    pointsData.config.customServerName = newTitle;
                    savePoints();

                    await m.reply(`✅ تم تغيير اسم السيرفر في الصورة إلى: **${newTitle}** بنجاح!`);
                });
                break;

            case 'change_title_size':
                await interaction.reply({ content: '📏 **من فضلك اكتب حجم الخط الجديد لاسم السيرفر (من 1 إلى 100):**', ephemeral: true });
                const titleSizeCollector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
                titleSizeCollector.on('collect', async m => {
                    const size = parseInt(m.content.trim());
                    if (isNaN(size) || size < 1 || size > 100) {
                        return m.reply('❌ يرجى كتابة رقم صحيح بين 1 و 100.');
                    }

                    if (!pointsData.config) pointsData.config = {};
                    pointsData.config.serverNameFontSize = size;
                    savePoints();

                    await m.reply(`✅ تم تغيير حجم اسم السيرفر في الصورة إلى: **${size}** بنجاح!`);
                });
                break;

            case 'change_groups_size':
                await interaction.reply({ content: '🔡 **من فضلك اكتب حجم الخط الجديد لأسماء المجموعات (من 1 إلى 100):**', ephemeral: true });
                const groupsSizeCollector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
                groupsSizeCollector.on('collect', async m => {
                    const size = parseInt(m.content.trim());
                    if (isNaN(size) || size < 1 || size > 100) {
                        return m.reply('❌ يرجى كتابة رقم صحيح بين 1 و 100.');
                    }

                    if (!pointsData.config) pointsData.config = {};
                    pointsData.config.groupNameFontSize = size;
                    savePoints();

                    await m.reply(`✅ تم تغيير حجم أسماء المجموعات في الصورة إلى: **${size}** بنجاح!`);
                });
                break;

            case 'change_points_interval':
                await interaction.reply({ content: '⏱️ **من فضلك اكتب مدة منح النقاط بالثواني (مثلاً: 60 ليعطي كل دقيقة):**', ephemeral: true });
                const intervalCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                intervalCollector.on('collect', async m => {
                    const seconds = parseInt(m.content.trim());
                    if (isNaN(seconds) || seconds < 1) {
                        return m.reply('❌ يرجى كتابة رقم صحيح أكبر من 0.');
                    }

                    if (!pointsData.config) pointsData.config = {};
                    pointsData.config.voicePointsInterval = seconds;
                    savePoints();
                    
                    // Restart interval with new setting
                    startVoicePointsInterval();

                    await m.reply(`✅ تم تحديث مدة منح النقاط إلى: **${seconds} ثوانٍ** بنجاح! سيتم توزيع النقاط كل \`${seconds}\` ثانية.`);
                });

                intervalCollector.on('end', async (collected, reason) => {
                    if (reason === 'time' && collected.size === 0) {
                        await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                    }
                });
                break;

            case 'change_points_amount':
                await interaction.reply({ content: '💰 **اكتب من كم؟ (مثلاً: 0.1):**', ephemeral: true });
                const minCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                
                minCollector.on('collect', async m1 => {
                    const min = parseFloat(m1.content.trim());
                    if (isNaN(min) || min < 0.1) {
                        return m1.reply('❌ يرجى كتابة رقم صحيح أكبر من أو يساوي 0.1.');
                    }

                    await m1.reply('💰 **لكم؟ (مثلاً: 5):**');
                    const maxCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                    
                    maxCollector.on('collect', async m2 => {
                        const max = parseFloat(m2.content.trim());
                        if (isNaN(max) || max < 0.1) {
                            return m2.reply('❌ يرجى كتابة رقم صحيح أكبر من أو يساوي 0.1.');
                        }

                        // Ensure min is actually the smaller number
                        const realMin = Math.min(min, max);
                        const realMax = Math.max(min, max);

                        if (!pointsData.config) pointsData.config = {};
                        pointsData.config.voicePointsMin = realMin;
                        pointsData.config.voicePointsMax = realMax;
                        pointsData.config.voicePointsAmount = realMin === realMax ? realMin : null;
                        savePoints();
                        
                        // Restart interval with new setting
                        startVoicePointsInterval();

                        const responseMsg = realMin === realMax 
                            ? `✅ تم تحديث كمية النقاط الممنوحة إلى: **${realMin}** نقاط ثابتة.`
                            : `✅ تم تحديث مدى النقاط الممنوحة إلى: من **${realMin}** إلى **${realMax}** نقاط عشوائية.`;
                        
                        await m2.reply(`${responseMsg} بنجاح!`);
                    });

                    maxCollector.on('end', async (collected, reason) => {
                        if (reason === 'time' && collected.size === 0) {
                            try {
                                await interaction.followUp({ content: '❌ فشل الطلب (لكم)، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                            } catch (err) {}
                        }
                    });
                });

                minCollector.on('end', async (collected, reason) => {
                    if (reason === 'time' && collected.size === 0) {
                        try {
                            await interaction.followUp({ content: '❌ فشل الطلب (من كم)، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                        } catch (err) {}
                    }
                });
                break;

            case 'toggle_arabic_digits':
                if (!pointsData.config) pointsData.config = {};
                pointsData.config.useArabicDigits = !pointsData.config.useArabicDigits;
                savePoints();
                await interaction.reply({ 
                    content: `✅ تم **${pointsData.config.useArabicDigits ? 'تفعيل' : 'تعطيل'}** الأرقام العربية في الصور بنجاح!`, 
                    ephemeral: true 
                });
                break;

            case 'reset_top_points':
                await interaction.reply({ content: '⚠️ **هل أنت متأكد من تصفير جميع نقاط التوب؟ اكتب "نعم" للتأكيد:**', ephemeral: true });
                const resetCollector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });
                resetCollector.on('collect', async m => {
                    if (m.content.trim() === 'نعم') {
                        try {
                            const config = pointsData.config;
                            pointsData = {};
                            if (config) pointsData.config = config;
                            savePoints();

                            // Send log to log channel
                            const logChannel = interaction.guild.channels.cache.get(getLOG_CHANNEL_ID());
                            if (logChannel) {
                                const logEmbed = new EmbedBuilder()
                                    .setTitle('🧹 سجل تصفير نقاط التوب')
                                    .addFields(
                                        { name: '👤 المسؤول', value: `${interaction.user} (${interaction.user.id})`, inline: true },
                                        { name: '📝 الإجراء', value: 'تصفير كافة نقاط المستخدمين', inline: true }
                                    )
                                    .setColor('#e74c3c')
                                    .setTimestamp();
                                await logChannel.send({ embeds: [logEmbed] });
                            }

                            await m.reply('✅ تم تصفير جميع نقاط التوب بنجاح!');
                        } catch (err) {
                            console.error(err);
                            await m.reply('❌ حدث خطأ أثناء تصفير النقاط.');
                        }
                    } else {
                        await m.reply('❌ تم إلغاء عملية التصفير.');
                    }
                });
                break;

            case 'setup_auto_top':
                try {
                    const topAttachment = await createTopImage(interaction.guild);
                    const pointsChannel = interaction.guild.channels.cache.get(getPOINTS_CHANNEL_ID());
                    if (!pointsChannel) return await interaction.reply({ content: '❌ لم يتم العثور على قناة النقاط المحددة.', ephemeral: true });

                    const sentMessage = await pointsChannel.send({ files: [topAttachment] });
                    if (!pointsData.config) pointsData.config = {};
                    pointsData.config.channelId = getPOINTS_CHANNEL_ID();
                    pointsData.config.messageId = sentMessage.id;
                    savePoints();

                    await interaction.reply({ content: `✅ تم تثبيت رسالة التوب في <#${getPOINTS_CHANNEL_ID()}> بنجاح!`, ephemeral: true });
                } catch (err) {
                    console.error(err);
                    await interaction.reply({ content: '❌ حدث خطأ أثناء تثبيت الرسالة.', ephemeral: true });
                }
                break;

            case 'remove_auto_top':
                try {
                    if (!pointsData.config || !pointsData.config.messageId) {
                        return await interaction.reply({ content: '❌ لا توجد رسالة توب مثبتة حالياً.', ephemeral: true });
                    }

                    const channel = interaction.guild.channels.cache.get(pointsData.config.channelId);
                    if (channel) {
                        try {
                            const message = await channel.messages.fetch(pointsData.config.messageId);
                            if (message) await message.delete();
                        } catch (e) {
                            console.log('Pinned top message already deleted or not found.');
                        }
                    }

                    // Clear from config
                    pointsData.config.channelId = null;
                    pointsData.config.messageId = null;
                    savePoints();

                    await interaction.reply({ content: '✅ تم إلغاء تثبيت قائمة المتصدرين وإيقاف التحديث التلقائي.', ephemeral: true });
                } catch (err) {
                    console.error(err);
                    await interaction.reply({ content: '❌ حدث خطأ أثناء إلغاء التثبيت.', ephemeral: true });
                }
                break;
        }
        return;
    }

    if (interaction.customId === 'help_custom_settings_menu') {
        if (!isGlobalAuthorized) {
            return await interaction.reply({ content: '❌ هذا الخيار متاح للمنشئين المصرح لهم فقط.', ephemeral: true });
        }

        const panelMap = {
            'group_admin_custom': { label: 'لوحة الإدارة', prefix: 'adminHelp' },
            'group_user_custom': { label: 'لوحة المجموعات', prefix: 'groupHelp' },
            'group_top_custom': { label: 'لوحة التوب', prefix: 'topHelp' },
            'group_custom_custom': { label: 'لوحة التخصيص', prefix: 'customHelp' },
            'group_id_custom': { label: 'لوحة المعرفات', prefix: 'idHelp' }
        };

        const panel = panelMap[value];
        if (!panel) return;

        const subMenu = new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`help_sub_custom_${panel.prefix}`)
                    .setPlaceholder(`تعديل ${panel.label}...`)
                    .addOptions([
                        { label: 'تغيير الخلفية', value: 'bg', emoji: '🖼️' },
                        { label: 'تغيير العنوان', value: 'title', emoji: '📝' },
                        { label: 'تغيير النصوص', value: 'items', emoji: '📜' }
                    ])
            );

        return await interaction.reply({ content: `🎨 **ماذا تريد أن تعدل في (${panel.label})؟**`, components: [subMenu], ephemeral: true });
    }

    if (interaction.customId.startsWith('help_sub_custom_')) {
        if (!isGlobalAuthorized) return;
        
        const prefix = interaction.customId.replace('help_sub_custom_', '');
        const type = value; // bg, title, or items
        
        const typeLabels = { 'bg': 'الخلفية', 'title': 'العنوان', 'items': 'النصوص' };
        const configKey = prefix + (type === 'bg' ? 'Bg' : (type === 'title' ? 'Title' : 'Items'));

        let promptMsg = `🎨 **من فضلك أرسل (${typeLabels[type]}) الجديد الآن:**`;
        if (type === 'items') promptMsg += '\n*(اكتب النصوص وافصل بينها بعلامة - أو سطر جديد)*';
        
        await interaction.reply({ content: promptMsg, ephemeral: true });
        const customCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
        
        customCollector.on('collect', async m => {
            let newValue;
            if (type === 'bg') {
                const attachment = m.attachments.first();
                newValue = attachment ? attachment.url : m.content.trim();
                if (!newValue.startsWith('http')) return m.reply('❌ يرجى إرسال صورة أو رابط صحيح.');
            } else if (type === 'items') {
                newValue = m.content.split(/[-\n]/).map(s => s.trim()).filter(s => s.length > 0);
                if (newValue.length === 0) return m.reply('❌ يرجى كتابة نصوص صحيحة.');
            } else {
                newValue = m.content.trim();
                if (!newValue) return m.reply('❌ يرجى كتابة نص صحيح.');
            }

            if (!pointsData.config) pointsData.config = {};
            pointsData.config[configKey] = newValue;
            savePoints();

            await m.reply(`✅ تم تحديث **${typeLabels[type]}** بنجاح!`);
        });
        return;
    }

    if (interaction.customId === 'id_admin_settings_menu') {
        if (!isGlobalAuthorized) {
            return await interaction.reply({ content: '❌ هذا الخيار متاح للمنشئين المصرح لهم فقط.', ephemeral: true });
        }

        const idMap = {
            'set_log_channel': { label: 'شات اللوق', key: 'logChannelId' },
            'set_points_channel': { label: 'شات النقاط', key: 'pointsChannelId' },
            'set_creation_channel': { label: 'شات الإنشاء', key: 'creationChannelId' },
            'set_voice_category': { label: 'كتجري الرومات الصوتية', key: 'voiceCategoryId' },
            'set_text_category': { label: 'كتجري رومات الشات', key: 'textCategoryId' },
            'set_creator_role': { label: 'رتبة المنشئ', key: 'creatorRoleId' }
        };

        const target = idMap[value];
        if (!target) return;

        await interaction.reply({ content: `🆔 **من فضلك أرسل الـ ID الجديد لـ (${target.label}) الآن:**`, ephemeral: true });
        const idCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
        
        idCollector.on('collect', async m => {
            const newId = m.content.trim().replace(/[<@&#>]/g, ''); // Clean ID from mentions
            if (!/^\d{17,20}$/.test(newId) && target.key !== 'authorizedCreatorId') {
                return m.reply('❌ يرجى إرسال ID صحيح (رقمي فقط).');
            }

            if (!pointsData.config) pointsData.config = {};
            pointsData.config[target.key] = newId;
            savePoints();

            await m.reply(`✅ تم تحديث **${target.label}** إلى: \`${newId}\` بنجاح!`);
        });

        idCollector.on('end', async (collected, reason) => {
            if (reason === 'time' && collected.size === 0) {
                await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
            }
        });
        return;
    }

    if (interaction.customId === 'creation_admin_menu') {
        if (!isGlobalAuthorized) {
            return await interaction.reply({ content: '❌ هذا الخيار متاح للمنشئين المصرح لهم فقط.', ephemeral: true });
        }

        switch (value) {
            case 'start_creation':
                await interaction.reply({ content: '➕ **من فضلك سو منشن للشخص المراد إنشاء مجموعة له الآن:**', ephemeral: true });
                const createCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                createCollector.on('collect', async m => {
                    let targetUser = m.mentions.members.first();
                    const userId = m.content.trim();
                    if (!targetUser && /^\d{17,19}$/.test(userId)) {
                        try { targetUser = await interaction.guild.members.fetch(userId); } catch (err) {}
                    }
                    if (!targetUser) return m.reply('❌ لم تقم بعمل منشن أو وضع ID صحيح.');

                    // Check if user already has a group they are a leader of
                    if (isGroupLeader(targetUser)) {
                        return m.reply('❌ هذا الشخص قائد لمجموعة بالفعل.');
                    }

                    await m.reply('📝 **الآن اكتب اسم المجموعة:**');
                    const nameCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                    nameCollector.on('collect', async nameMsg => {
                        const groupName = nameMsg.content.trim();
                        if (!groupName) return nameMsg.reply('❌ اسم المجموعة غير صالح.');
                        
                        await nameMsg.reply('👥 **كم عدد أعضاء المجموعة؟ (الحد الأدنى 3):**');
                        const countCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                        countCollector.on('collect', async countMsg => {
                            const memberCount = parseInt(countMsg.content.trim());
                            if (isNaN(memberCount) || memberCount < 3) {
                                return countMsg.reply('❌ يرجى كتابة رقم صحيح (3 أو أكثر). تم إلغاء العملية.');
                            }

                            // Execute creation logic
                            try {
                                const groupRole = await interaction.guild.roles.create({ name: 'عضو', color: '#3498db' });
                                const adminRole = await interaction.guild.roles.create({ name: `${groupName} ★`, color: '#f1c40f' });
                                const textChannel = await interaction.guild.channels.create({
                                    name: groupName,
                                    type: ChannelType.GuildText,
                                    parent: getTEXT_CATEGORY_ID(),
                                    permissionOverwrites: [
                                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                                        { id: groupRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
                                        { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ReadMessageHistory] }
                                    ]
                                });
                                const voiceChannel = await interaction.guild.channels.create({
                                    name: groupName,
                                    type: ChannelType.GuildVoice,
                                    parent: getVOICE_CATEGORY_ID(),
                                    userLimit: memberCount,
                                    permissionOverwrites: [
                                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                                        { id: groupRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak] },
                                        { id: adminRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak, PermissionsBitField.Flags.MuteMembers, PermissionsBitField.Flags.DeafenMembers, PermissionsBitField.Flags.MoveMembers] }
                                    ]
                                });
                                await targetUser.roles.add(groupRole);
                                await targetUser.roles.add(adminRole);

                                // Save group leader ID
                                if (!pointsData.config) pointsData.config = {};
                                if (!pointsData.config.groupLeaders) pointsData.config.groupLeaders = {};
                                pointsData.config.groupLeaders[groupName.toLowerCase().trim()] = targetUser.id;
                                savePoints();

                                // Reset points for the target user to 0
                                pointsData[targetUser.id] = 0;
                                savePoints();
                                
                                // Send help message to the new text channel
                                const helpEmbed = new EmbedBuilder()
                                    .setTitle(`مرحباً بكم في مجموعة ${groupName}`)
                                    .setDescription('يمكنكم الآن البدء في استخدام المجموعة. إليكم بعض التعليمات:')
                                    .addFields(
                                        { name: '👥 إدارة الأعضاء', value: '`-اضافة @user` أو `[ID]` | `-طرد @user` | `اعضاء`', inline: false },
                                        { name: '🛠️ الإعدادات', value: '`-تغيير-اسم [الاسم]` | `-ترقية @user` (داخل الشات فقط)', inline: false },
                                        { name: '📊 عدد الأعضاء المسجل', value: `\`${memberCount}\` عضو`, inline: false }
                                    )
                                    .setColor('#3498db');

                                await textChannel.send({ content: `مرحباً ${targetUser}! تم تجهيز المجموعة بنجاح.`, embeds: [helpEmbed] });

                                await countMsg.reply(`✅ تم إنشاء المجموعة **${groupName}** بنجاح!\nعدد الأعضاء: \`${memberCount}\`\nالشات: ${textChannel}\nالروم: ${voiceChannel}`);

                                // Send log to log channel
                                const logChannel = interaction.guild.channels.cache.get(getLOG_CHANNEL_ID());
                                if (logChannel) {
                                    const logEmbed = new EmbedBuilder()
                                        .setTitle('📝 سجل إنشاء مجموعة جديدة (عبر القائمة)')
                                        .addFields(
                                            { name: '👤 المنشئ', value: `${interaction.user} (${interaction.user.id})`, inline: true },
                                            { name: '👥 للعضو', value: `${targetUser} (${targetUser.id})`, inline: true },
                                            { name: '📂 اسم المجموعة', value: `${groupName}`, inline: false },
                                            { name: '👥 عدد الأعضاء', value: `\`${memberCount}\``, inline: true },
                                            { name: '💬 الشات', value: `${textChannel}`, inline: true },
                                            { name: '🔊 الروم الصوتي', value: `${voiceChannel}`, inline: true }
                                        )
                                        .setColor('#2ecc71')
                                        .setTimestamp();
                                    await logChannel.send({ embeds: [logEmbed] });
                                }
                            } catch (err) {
                                console.error(err);
                                await countMsg.reply('❌ حدث خطأ أثناء الإنشاء.');
                            }
                        });

                        countCollector.on('end', async (collected, reason) => {
                            if (reason === 'time' && collected.size === 0) {
                                await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                            }
                        });
                    });

                    nameCollector.on('end', async (collected, reason) => {
                        if (reason === 'time' && collected.size === 0) {
                            await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                        }
                    });
                });

                createCollector.on('end', async (collected, reason) => {
                    if (reason === 'time' && collected.size === 0) {
                        await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                    }
                });
                break;

            case 'admin_delete_group':
                await interaction.reply({ content: '🗑️ **من فضلك سو منشن للشخص المراد حذف مجموعته أو اكتب الـ ID الخاص به الآن:**', ephemeral: true });
                const deleteAdminCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                deleteAdminCollector.on('collect', async m => {
                    let targetUser = m.mentions.members.first();
                    const userId = m.content.trim();
                    if (!targetUser && /^\d{17,19}$/.test(userId)) {
                        try { targetUser = await interaction.guild.members.fetch(userId); } catch (err) {}
                    }
                    if (!targetUser) return m.reply('❌ لم تقم بعمل منشن أو وضع ID صحيح.');

                    // Find the user's admin role (the one that ends with ★ and is named after the group)
                    const adminRole = targetUser.roles.cache.find(r => r.name.endsWith('★'));

                    if (!adminRole) return m.reply('❌ هذا الشخص لا يملك رتبة مسؤول مجموعة (★).');

                    const groupName = adminRole.name.replace('★', '').trim();
                    const textChannel = interaction.guild.channels.cache.find(c => 
                        c.parentId === getTEXT_CATEGORY_ID() && 
                        c.name.toLowerCase().trim() === groupName.toLowerCase().trim()
                    );

                    if (!textChannel) return m.reply('❌ لم يتم العثور على شات المجموعة.');

                    // Find the base "عضو" role from the channel overwrites
                    let groupRole = textChannel.permissionOverwrites.cache.find(ov => {
                        const r = interaction.guild.roles.cache.get(ov.id);
                        return r && r.name === "عضو";
                    });
                    if (groupRole) groupRole = interaction.guild.roles.cache.get(groupRole.id);

                    await m.reply(`📝 **سيتم حذف مجموعة (${groupName}). من فضلك اكتب سبب الحذف الآن:**`);
                    const reasonCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
                    
                    reasonCollector.on('collect', async reasonMsg => {
                        const reason = reasonMsg.content.trim();
                        if (!reason) return reasonMsg.reply('❌ لم يتم ذكر سبب، تم إلغاء الحذف.');

                        try {
                            const voiceChannel = interaction.guild.channels.cache.find(c => 
                                c.parentId === getVOICE_CATEGORY_ID() && 
                                c.name.toLowerCase().trim() === groupName.toLowerCase().trim()
                            );

                            // Send log to log channel
                            const logChannel = interaction.guild.channels.cache.get(getLOG_CHANNEL_ID());
                            if (logChannel) {
                                const logEmbed = new EmbedBuilder()
                                    .setTitle('🗑️ سجل حذف مجموعة (إداري)')
                                    .addFields(
                                        { name: '👤 المسؤول', value: `${interaction.user} (${interaction.user.id})`, inline: true },
                                        { name: '👥 العضو', value: `${targetUser} (${targetUser.id})`, inline: true },
                                        { name: '📂 اسم المجموعة', value: `${groupName}`, inline: true },
                                        { name: '📝 سبب الحذف', value: `${reason}`, inline: false }
                                    )
                                    .setColor('#ff0000')
                                    .setTimestamp();
                                await logChannel.send({ embeds: [logEmbed] });
                            }

                            if (voiceChannel) await voiceChannel.delete();
                            if (textChannel) await textChannel.delete();
                            if (adminRole) await adminRole.delete();
                            if (groupRole) await groupRole.delete();

                            await reasonMsg.reply(`✅ تم حذف مجموعة **${groupName}** بالكامل بنجاح.`);
                        } catch (err) {
                            console.error(err);
                            await reasonMsg.reply('❌ حدث خطأ أثناء حذف المجموعة.');
                        }
                    });

                    reasonCollector.on('end', async (collected, reason) => {
                        if (reason === 'time' && collected.size === 0) {
                            await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                        }
                    });
                });

                deleteAdminCollector.on('end', async (collected, reason) => {
                    if (reason === 'time' && collected.size === 0) {
                        await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                    }
                });
                break;

            case 'admin_view_groups':
                const voiceChannels = interaction.guild.channels.cache
                    .filter(c => c.parentId === getVOICE_CATEGORY_ID() && c.type === ChannelType.GuildVoice)
                    .sort((a, b) => b.members.size - a.members.size);
                       
                   const top10 = Array.from(voiceChannels.values()).slice(0, 10);
                   const groupList = top10.map((c, index) => `${index + 1}. **${c.name}** | عدد المتواجدين: \`${c.members.size}\``).join('\n') || 'لا توجد رومات صوتية حالياً.';
   
                   const groupsEmbed = new EmbedBuilder()
                       .setTitle('📋 حالة الرومات الصوتية للمجموعات (أعلى 10)')
                       .setDescription(`إجمالي الرومات: **${voiceChannels.size}**\n\n${groupList}`)
                       .setColor('#3498db')
                       .setTimestamp();

                await interaction.reply({ embeds: [groupsEmbed], ephemeral: true });
                break;

            case 'admin_image_settings':
                // Removed, handled in top_admin_settings_menu
                break;
        }
        return;
    }

    if (interaction.customId !== 'help_menu') return;

    switch (value) {
        case 'add_member':
            // Check permissions
            let addAdminRole;
            if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                addAdminRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                    const r = interaction.guild.roles.cache.get(ov.id);
                    return r && r.name.endsWith('★');
                });
                if (addAdminRole) addAdminRole = interaction.guild.roles.cache.get(addAdminRole.id);
            }
            if (!interaction.member.roles.cache.has(addAdminRole?.id)) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح لـ **مالك المجموعة ومسؤوليها (★)** فقط.', ephemeral: true });
            }

            await interaction.reply({ content: '👤 **من فضلك سو منشن للشخص المراد إضافته أو اكتب الـ ID الخاص به الآن:**', ephemeral: true });
            
            const addCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
            addCollector.on('collect', async m => {
                let targetUser = m.mentions.members.first();
                const userId = m.content.trim();

                if (!targetUser && /^\d{17,19}$/.test(userId)) {
                    try { targetUser = await interaction.guild.members.fetch(userId); } catch (err) {}
                }

                if (!targetUser) return m.reply('❌ لم تقم بعمل منشن أو وضع ID صحيح.');

                let role;
                if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                    const currentName = interaction.channel.name.toLowerCase().trim();
                    role = interaction.channel.permissionOverwrites.cache.find(ov => {
                        const r = interaction.guild.roles.cache.get(ov.id);
                        return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
                    });
                    if (role) role = interaction.guild.roles.cache.get(role.id);
                }

                if (!role) return m.reply('❌ يجب أن تكون داخل شات المجموعة لإضافة أعضاء.');

                try {
                    await targetUser.roles.add(role);
                    await m.reply(`✅ تمت إضافة ${targetUser} إلى المجموعة بنجاح!`);
                } catch (error) {
                    await m.reply('❌ حدث خطأ أثناء إضافة العضو. تأكد من صلاحيات البوت.');
                }
            });

            addCollector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                }
            });
            break;

        case 'remove_member':
            // Check permissions
            let removeAdminRole;
            if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                removeAdminRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                    const r = interaction.guild.roles.cache.get(ov.id);
                    return r && r.name.endsWith('★');
                });
                if (removeAdminRole) removeAdminRole = interaction.guild.roles.cache.get(removeAdminRole.id);
            }
            if (!interaction.member.roles.cache.has(removeAdminRole?.id)) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح لـ **مالك المجموعة ومسؤوليها (★)** فقط.', ephemeral: true });
            }

            await interaction.reply({ content: '➖ **من فضلك سو منشن للشخص المراد إزالته أو اكتب الـ ID الخاص به الآن:**', ephemeral: true });
            
            const removeCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
            removeCollector.on('collect', async m => {
                let targetUser = m.mentions.members.first();
                const userId = m.content.trim();

                if (!targetUser && /^\d{17,19}$/.test(userId)) {
                    try { targetUser = await interaction.guild.members.fetch(userId); } catch (err) {}
                }

                if (!targetUser) return m.reply('❌ لم تقم بعمل منشن أو وضع ID صحيح.');

                let role;
                if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                    const currentName = interaction.channel.name.toLowerCase().trim();
                    role = interaction.channel.permissionOverwrites.cache.find(ov => {
                        const r = interaction.guild.roles.cache.get(ov.id);
                        return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
                    });
                    if (role) role = interaction.guild.roles.cache.get(role.id);
                }

                if (!role) return m.reply('❌ يجب أن تكون داخل شات المجموعة لإزالة أعضاء.');

                // Check if user is actually in the group
                if (!targetUser.roles.cache.has(role.id)) {
                    return m.reply('❌ هذا الشخص مو بالقروب.');
                }

                try {
                    await targetUser.roles.remove(role);
                    // Also remove admin role if they have it
                    if (removeAdminRole && targetUser.roles.cache.has(removeAdminRole.id)) {
                        await targetUser.roles.remove(removeAdminRole);
                    }
                    await m.reply(`✅ تم إزالة ${targetUser} من المجموعة بنجاح.`);
                } catch (error) {
                    await m.reply('❌ حدث خطأ أثناء إزالة العضو. تأكد من صلاحيات البوت.');
                }
            });

            removeCollector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                }
            });
            break;

        case 'rename_group':
            // Find the admin role if in a group channel
            let renameAdminRole;
            if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                const adminRoleObj = interaction.channel.permissionOverwrites.cache.find(ov => {
                    const r = interaction.guild.roles.cache.get(ov.id);
                    return r && r.name.endsWith('★');
                });
                if (adminRoleObj) renameAdminRole = interaction.guild.roles.cache.get(adminRoleObj.id);
            }

            // Check permissions before asking: Allow group admin (★)
            if (!renameAdminRole || !interaction.member.roles.cache.has(renameAdminRole.id)) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح لـ **مالك المجموعة والمسؤولين (★)** فقط. العضو العادي لا يمكنه تغيير الاسم.', ephemeral: true });
            }

            await interaction.reply({ content: '📝 **من فضلك اكتب الاسم الجديد للمجموعة الآن:**', ephemeral: true });
            
            const renameCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
            renameCollector.on('collect', async m => {
                const newName = m.content.trim();
                if (!newName) return m.reply('❌ لم تقم بكتابة اسم صحيح.');

                try {
                    const oldName = interaction.channel.name;
                    let role;
                    let adminRole;
                    
                    if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                        const currentName = interaction.channel.name.toLowerCase().trim();
                        role = interaction.channel.permissionOverwrites.cache.find(ov => {
                            const r = interaction.guild.roles.cache.get(ov.id);
                            return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
                        });
                        if (role) role = interaction.guild.roles.cache.get(role.id);

                        adminRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                            const r = interaction.guild.roles.cache.get(ov.id);
                            return r && r.name.endsWith('★');
                        });
                        if (adminRole) adminRole = interaction.guild.roles.cache.get(adminRole.id);
                    }

                    if (role) await role.setName("عضو");
                    if (adminRole) await adminRole.setName(`${newName} ★`);
                    
                    await interaction.channel.setName(newName);

                    const voiceChannel = interaction.guild.channels.cache.find(c => 
                        c.parentId === getVOICE_CATEGORY_ID() && 
                        c.name.toLowerCase().trim() === oldName.toLowerCase().trim()
                    );
                    if (voiceChannel) await voiceChannel.setName(newName);

                    await m.reply(`✅ تم تغيير اسم المجموعة إلى **${newName}** بنجاح!\n- رتبة العضو أصبحت: \`عضو\`\n- رتبة المسؤول أصبحت: \`${newName} ★\``);
                } catch (error) {
                    console.error(error);
                    await m.reply('❌ حدث خطأ أثناء تغيير الاسم. تأكد من صلاحيات البوت.');
                }
            });

            renameCollector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                }
            });
            break;

        case 'promote_member':
            // Find the admin role if in a group channel
            let promoteAdminRole;
            if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                promoteAdminRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                    const r = interaction.guild.roles.cache.get(ov.id);
                    return r && r.name.endsWith('★');
                });
                if (promoteAdminRole) promoteAdminRole = interaction.guild.roles.cache.get(promoteAdminRole.id);
            }

            if (!promoteAdminRole) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح فقط داخل شات المجموعة.', ephemeral: true });
            }

            // Check permissions before asking
            if (!interaction.member.roles.cache.has(promoteAdminRole.id)) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح لـ **مالك المجموعة ومسؤوليها (★)** فقط.', ephemeral: true });
            }

            await interaction.reply({ content: '⭐ **من فضلك سو منشن للشخص المراد ترقيته لمسؤول أو اكتب الـ ID الخاص به الآن:**', ephemeral: true });
            
            const promoteCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
            promoteCollector.on('collect', async m => {
                let targetUser = m.mentions.members.first();
                const userId = m.content.trim();

                if (!targetUser && /^\d{17,19}$/.test(userId)) {
                    try { targetUser = await interaction.guild.members.fetch(userId); } catch (err) {}
                }

                if (!targetUser) return m.reply('❌ لم تقم بعمل منشن أو وضع ID صحيح.');

                let role;
                if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                    const currentName = interaction.channel.name.toLowerCase().trim();
                    role = interaction.channel.permissionOverwrites.cache.find(ov => {
                        const r = interaction.guild.roles.cache.get(ov.id);
                        return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
                    });
                    if (role) role = interaction.guild.roles.cache.get(role.id);
                }

                if (!role) return m.reply('❌ يجب أن تكون داخل شات المجموعة للترقية.');

                // Check if user is already in the group (has the base group role)
                if (!targetUser.roles.cache.has(role.id)) {
                    return m.reply('❌ هذا الشخص مو بالقروب.');
                }

                // Check if user is already promoted
                if (targetUser.roles.cache.has(promoteAdminRole.id)) {
                    return m.reply('❌ هذا الشخص مترقي بالفعل.');
                }

                if (targetUser.id === interaction.user.id) {
                    return m.reply('❌ ما تقدر ترقي نفسك.');
                }

                const adminMembers = promoteAdminRole ? Array.from(promoteAdminRole.members.values()) : [];
                const groupLeader = adminMembers.length > 0 ? adminMembers[0] : null;
                const targetIsLeader = targetUser.id === interaction.guild.ownerId || 
                                     targetUser.roles.cache.has(getCREATOR_ROLE_ID()) ||
                                     (groupLeader && targetUser.id === groupLeader.id);
                if (!isGlobalAuthorized && targetIsLeader) {
                    return m.reply('❌ ما تقدر ترقي القائد.');
                }

                try {
                    await targetUser.roles.add(promoteAdminRole);
                    await m.reply(`✅ تم ترقية ${targetUser} ليصبح **مسؤولاً (★)** في المجموعة بنجاح!`);
                } catch (error) {
                    await m.reply('❌ حدث خطأ أثناء الترقية. تأكد من صلاحيات البوت.');
                }
            });

            promoteCollector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                }
            });
            break;

        case 'demote_member':
            // Find the admin role if in a group channel
            let demoteAdminRole;
            if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                demoteAdminRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                    const r = interaction.guild.roles.cache.get(ov.id);
                    return r && r.name.endsWith('★');
                });
                if (demoteAdminRole) demoteAdminRole = interaction.guild.roles.cache.get(demoteAdminRole.id);
            }

            if (!demoteAdminRole) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح فقط داخل شات المجموعة.', ephemeral: true });
            }

            // Check permissions before asking
            if (!interaction.member.roles.cache.has(demoteAdminRole.id)) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح لـ **مالك المجموعة ومسؤوليها (★)** فقط.', ephemeral: true });
            }

            await interaction.reply({ content: '📉 **من فضلك سو منشن للشخص المراد إزالة ترقيته أو اكتب الـ ID الخاص به الآن:**', ephemeral: true });
            
            const demoteCollector = interaction.channel.createMessageCollector({ filter, time: 60000, max: 1 });
            demoteCollector.on('collect', async m => {
                let targetUser = m.mentions.members.first();
                const userId = m.content.trim();

                if (!targetUser && /^\d{17,19}$/.test(userId)) {
                    try { targetUser = await interaction.guild.members.fetch(userId); } catch (err) {}
                }

                if (!targetUser) return m.reply('❌ لم تقم بعمل منشن أو وضع ID صحيح.');

                if (targetUser.id === interaction.user.id) {
                    return m.reply('❌ ما تقدر تزيل الترقية عن نفسك.');
                }

                const adminMembers = demoteAdminRole ? Array.from(demoteAdminRole.members.values()) : [];
                const groupLeader = adminMembers.length > 0 ? adminMembers[0] : null;
                const targetIsLeader = targetUser.id === interaction.guild.ownerId || 
                                     targetUser.roles.cache.has(getCREATOR_ROLE_ID()) ||
                                     (groupLeader && targetUser.id === groupLeader.id);
                if (!isGlobalAuthorized && targetIsLeader) {
                    return m.reply('❌ ما تقدر تنزل رتبة القائد.');
                }

                if (!targetUser.roles.cache.has(demoteAdminRole.id)) {
                    return m.reply('❌ هذا الشخص مو مسؤول في المجموعة أصلاً.');
                }

                try {
                    await targetUser.roles.remove(demoteAdminRole);
                    await m.reply(`✅ تم إزالة الترقية عن ${targetUser} بنجاح.`);
                } catch (error) {
                    await m.reply('❌ حدث خطأ أثناء إزالة الترقية. تأكد من صلاحيات البوت.');
                }
            });

            demoteCollector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    await interaction.followUp({ content: '❌ فشل الطلب، حاول مرة أخرى (انتهى الوقت).', ephemeral: true });
                }
            });
            break;

        case 'view_members':
            let groupRole;
            if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                const currentName = interaction.channel.name.toLowerCase().trim();
                groupRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                    const r = interaction.guild.roles.cache.get(ov.id);
                    return r && (r.name === "عضو" || r.name.toLowerCase().trim() === currentName);
                });
                if (groupRole) groupRole = interaction.guild.roles.cache.get(groupRole.id);
            }

            if (!groupRole) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح فقط داخل شات المجموعة.', ephemeral: true });
            }

            const adminRole = interaction.channel.permissionOverwrites.cache.find(ov => {
                const r = interaction.guild.roles.cache.get(ov.id);
                return r && r.name.endsWith('★');
            });
            const adminRoleObj = adminRole ? interaction.guild.roles.cache.get(adminRole.id) : null;
            
            // Combine members from base role and admin role (★)
            const groupMembers = Array.from(groupRole.members.values());
            const adminMembersRole = adminRoleObj ? Array.from(adminRoleObj.members.values()) : [];
            
            // Use Map to ensure unique members by ID
            const allMembersMap = new Map();
            groupMembers.forEach(m => allMembersMap.set(m.id, m));
            adminMembersRole.forEach(m => allMembersMap.set(m.id, m));
            const members = Array.from(allMembersMap.values());
            
            // Group Leader is the first member of the admin role (★)
            const adminMembers = adminRoleObj ? Array.from(adminRoleObj.members.values()) : [];
            const groupLeader = adminMembers.length > 0 ? adminMembers[0] : null;

            // Sorting: Group Leader first, then Server Owner, then Admins, then regular members
            members.sort((a, b) => {
                const aIsGroupLeader = groupLeader && a.id === groupLeader.id;
                const bIsGroupLeader = groupLeader && b.id === groupLeader.id;
                const aIsAdmin = adminRoleObj && a.roles.cache.has(adminRoleObj.id);
                const bIsAdmin = adminRoleObj && b.roles.cache.has(adminRoleObj.id);
                const aIsOwner = a.id === interaction.guild.ownerId;
                const bIsOwner = b.id === interaction.guild.ownerId;
                
                if (aIsGroupLeader) return -1;
                if (bIsGroupLeader) return 1;
                if (aIsOwner) return -1;
                if (bIsOwner) return 1;
                if (aIsAdmin && !bIsAdmin) return -1;
                if (!aIsAdmin && bIsAdmin) return 1;
                return 0;
            });

            const pageSize = 10;
            const totalPages = Math.ceil(members.length / pageSize);
            const pageMembers = members.slice(0, pageSize);

            let description = `عدد الأعضاء الكلي: **${members.length}**\n\n`;
            pageMembers.forEach((m, index) => {
                const isGroupLeader = groupLeader && m.id === groupLeader.id;
                const isOwner = m.id === interaction.guild.ownerId;
                const isAdmin = adminRoleObj && m.roles.cache.has(adminRoleObj.id);
                
                let tag = '👤 عضو';
                if (isGroupLeader) tag = '👑 قائد المجموعة';
                else if (isOwner) tag = '👑 قائد السيرفر';
                else if (isAdmin) tag = '⭐ مسؤول';
                
                description += `**${index + 1}.** ${m.user.tag} | \`${tag}\`\n`;
            });

            const membersEmbed = new EmbedBuilder()
                .setTitle(`👥 أعضاء مجموعة: ${interaction.channel.name}`)
                .setDescription(description)
                .setFooter({ text: `صفحة 1 من ${totalPages}` })
                .setColor('#f1c40f');

            const row = new ActionRowBuilder();
            if (members.length > pageSize) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`members_page_1`)
                        .setLabel('التالي')
                        .setStyle(ButtonStyle.Primary)
                );
            }

            await interaction.reply({ embeds: [membersEmbed], components: row.components.length > 0 ? [row] : [], ephemeral: true });
            break;

        case 'settings':
            const settingsEmbed = new EmbedBuilder()
                .setTitle('⚙️ إعدادات المجموعة')
                .addFields(
                    { name: 'إدارة المجموعة', value: 'يمكنك تغيير اسم المجموعة، إضافة أعضاء، طرد أعضاء، أو ترقية أعضاء لمسؤولين عبر هذه القائمة.', inline: false },
                    { name: 'الروم الصوتي', value: 'يمكنك إخفاء أو إظهار الروم الصوتي للأعضاء غير المضافين في المجموعة.', inline: false },
                    { name: 'الدعم', value: 'جميع الأوامر تدعم المنشن والمعرف (ID).', inline: false }
                )
                .setColor('#3498db');
            await interaction.reply({ embeds: [settingsEmbed], ephemeral: true });
            break;

        case 'hide_voice':
        case 'show_voice':
            // Check permissions
            let voiceAdminRole;
            if (interaction.guild && interaction.channel.parentId === getTEXT_CATEGORY_ID()) {
                const adminRoleObj = interaction.channel.permissionOverwrites.cache.find(ov => {
                    const r = interaction.guild.roles.cache.get(ov.id);
                    return r && r.name.endsWith('★');
                });
                if (adminRoleObj) voiceAdminRole = interaction.guild.roles.cache.get(adminRoleObj.id);
            }

            if (!voiceAdminRole) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح فقط داخل شات المجموعة.', ephemeral: true });
            }

            if (!interaction.member.roles.cache.has(voiceAdminRole.id)) {
                return await interaction.reply({ content: '❌ هذا الخيار متاح لـ **مالك المجموعة ومسؤوليها (★)** فقط.', ephemeral: true });
            }

            try {
                const voiceChannel = interaction.guild.channels.cache.find(c => 
                    c.parentId === getVOICE_CATEGORY_ID() && 
                    c.name.toLowerCase().trim() === interaction.channel.name.toLowerCase().trim()
                );

                if (!voiceChannel) {
                    return await interaction.reply({ content: '❌ لم أتمكن من العثور على الروم الصوتي لهذه المجموعة.', ephemeral: true });
                }

                const isHide = value === 'hide_voice';
                
                await voiceChannel.permissionOverwrites.edit(interaction.guild.id, {
                    ViewChannel: !isHide
                });

                await interaction.reply({ 
                    content: isHide ? '✅ تم إخفاء الروم الصوتي عن الجميع بنجاح!' : '✅ تم إظهار الروم الصوتي للجميع بنجاح!', 
                    ephemeral: true 
                });
            } catch (error) {
                console.error(error);
                await interaction.reply({ content: '❌ حدث خطأ أثناء تعديل صلاحيات الروم الصوتي.', ephemeral: true });
            }
            break;
    }
});

// --- Global Error Handling to Prevent Crashes ---
process.on('unhandledRejection', (reason, promise) => {
    console.error(' [Unhandled Rejection] at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err, origin) => {
    console.error(' [Uncaught Exception] at:', origin, 'error:', err);
});

client.on('error', (err) => {
    console.error(' [Discord Client Error]:', err);
});

client.login(process.env.DISCORD_TOKEN);
