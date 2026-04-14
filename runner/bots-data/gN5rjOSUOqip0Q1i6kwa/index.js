require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false,
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
            console.error(error);
            message.channel.send('❌ حدث خطأ أثناء محاولة تشغيل الأغنية.');
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
            console.error(error);
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
    console.error(e);
    if (channel) channel.send(`❌ حدث خطأ: ${e.message.slice(0, 500)}`);
});

client.login(process.env.TOKEN);
