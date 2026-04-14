const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('ready', () => {
    console.log(`✅ Bot logged in as: ${client.user.tag}`);
    console.log('🤖 Ready directly from the cloud platform!');
});

client.on('messageCreate', message => {
    if (message.content === '!ping') {
        message.reply('🏓 Pong! The platform works perfectly!');
    }
});

client.login(process.env.DISCORD_TOKEN);
