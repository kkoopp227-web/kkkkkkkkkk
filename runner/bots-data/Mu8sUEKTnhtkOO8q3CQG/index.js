require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const ffmpegPath = require('ffmpeg-static');

// Create the client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Initialize DisTube
const distube = new DisTube(client, {
    emitNewSongOnly: true,
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false,
    ffmpeg: {
        path: ffmpegPath,
    },
    plugins: [new YtDlpPlugin()],
});


client.on('ready', () => {
    console.log(`✅ ${client.user.tag} is online and ready to play music!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Command: ش [song name]
    if (message.content.startsWith('ش ')) {
        const query = message.content.slice(2).trim();
        if (!query) return message.reply('❌ يرجى كتابة اسم الأغنية بعد حرف "ش"');

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) return message.reply('❌ يجب أن تكون في قناة صوتية أولاً!');

        try {
            await distube.play(voiceChannel, query, {
                message,
                textChannel: message.channel,
                member: message.member,
            });
        } catch (error) {
            console.error('Playback Error:', error);
            // Provide more descriptive error for the user
            let errorMsg = '❌ حدث خطأ أثناء محاولة تشغيل الأغنية.';
            if (error.message.includes('ffmpeg')) {
                errorMsg = '❌ مشكلة في نظام معالجة الصوت (ffmpeg). تأكد من اكتمال التثبيت.';
            } else if (error.message.includes('403') || error.message.includes('sign in')) {
                errorMsg = '❌ يوتيوب قام بحظر المحاولة، يرجى المحاولة لاحقاً أو استخدام رابط آخر.';
            }
            message.channel.send(`${errorMsg}\n\`\`\`${error.message.slice(0, 100)}\`\`\``);
        }
    }

    // Command: وقف
    if (message.content.trim() === 'وقف') {
        const queue = distube.getQueue(message);
        if (!queue) return message.reply('❌ لا يوجد شيء يعمل حالياً لكي أوقفه!');

        try {
            await queue.stop();
            message.channel.send('🛑 تم إيقاف الموسيقى ومغادرة القناة.');
        } catch (error) {
            console.error('Stop Error:', error);
            message.channel.send('❌ حدث خطأ أثناء محاولة إيقاف الأغنية.');
        }
    }
});

// Distube Events
distube.on('playSong', (queue, song) => {
    const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎶 جاري التشغيل الآن')
        .setDescription(`[${song.name}](${song.url})`)
        .addFields(
            { name: 'بواسطة', value: `${song.user}`, inline: true },
            { name: 'المدة', value: `${song.formatDuration()}`, inline: true }
        )
        .setThumbnail(song.thumbnail);

    queue.textChannel.send({ embeds: [embed] });
});

distube.on('addSong', (queue, song) => {
    queue.textChannel.send(`✅ تم إضافة **${song.name}** إلى القائمة بواسطة ${song.user}`);
});

distube.on('error', (channel, e) => {
    console.error('DisTube Error:', e);
    if (channel) {
        channel.send(`❌ حدث خطأ في المشغل: ${e.message.slice(0, 200)}`);
    }
});

// Token check
if (!process.env.TOKEN || process.env.TOKEN === 'YOUR_DISCORD_BOT_TOKEN_HERE') {
    console.error('❌ Error: DISCORD_TOKEN is missing or not set in .env file.');
} else {
    client.login(process.env.TOKEN).catch(err => {
        console.error('❌ Failed to login:', err.message);
    });
}

