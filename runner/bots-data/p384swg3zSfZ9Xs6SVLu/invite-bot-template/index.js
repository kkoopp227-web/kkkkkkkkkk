const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const config = require('./config.json');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once('ready', () => {
    console.log(`✅ Invite Bot is online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    // تجاهل رسائل البوتات
    if (message.author.bot) return;

    // الأوامر المسموح بها: رابط أو رابطي
    const commands = ['رابط', 'رابطي'];
    
    if (commands.includes(message.content.trim())) {
        const embed = new EmbedBuilder()
            .setTitle('🔗 رابط الدعوة الدائم')
            .setDescription(`مرحباً بك! هذا هو رابط السيرفر الخاص بنا، لن ينتهي أبداً:\n\n**${config.inviteLink}**`)
            .setColor(config.embedColor)
            .setThumbnail(message.guild.iconURL())
            .setFooter({ text: 'تم البرمجة بواسطة Cloud Hosting', iconURL: client.user.displayAvatarURL() })
            .setTimestamp();

        try {
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Failed to send message:', error.message);
        }
    }
});

client.login(config.token);
