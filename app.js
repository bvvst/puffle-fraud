const cluster = require("cluster");
const { open } = require("lmdb");
const { Client, GatewayIntentBits } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

const REFRESH_DELAY = 300000 // in Milliseconds
const TOKEN = "MTAyNjMxNTEzOTQ3NTA0NjQ1MQ.GjsrXy.hDUo_qTp3kmw2KQrOnoCnXY7czsDV6kQ-9JgPQ"

const rest = new REST({ version: "10" }).setToken(TOKEN);

const db = open({
	path: "./puffle",
});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });


if (cluster.isMaster) {
	main();
	cluster.fork();
} else {
	updatePositions();
}

client.on("ready", () => {
	console.log(`Logged in as ${client.user.tag}!`);
});

client.on("messageCreate", async (message) => {
	if (!message.channel.name.startsWith("ticket-") || message.author.bot) {
		return
	}

	const stats = await db.get(`channel:${message.channelId}`);

	if (stats === undefined) {
		switch (message.content) {
			case "?queue":
				const stats = {
					user: message.author.id,
					notified: false,
					position: Math.floor(Math.random() * 21 + 20),
				};

				await db.put(`channel:${message.channelId}`, stats);
				await message.channel.send(`You are now in queue. Position in Queue: \`${stats.position}\`\nReply with \`?position\` to check current position in queue`);
				break;
			default:
				await message.channel.send("You are not yet in the queue, join the queue with `?queue`");
		}
	} else {
		switch (message.content) {
			case "?queue":
				await message.channel.send(`You are already in queue.\nPosition in Queue: \`${stats.position}\`\nReply with \`?position\` to check current position in queue`);
				return
			case "?position":
				await message.channel.send(`Position in Queue: \`${stats.position}\`\nReply with \`?position\` to check current position in queue`);
				return;

			case "?here":
				if (stats.position > 0) {
					await message.channel.send(`It is not your turn yet.\nPosition in Queue: \`${stats.position}\`\nReply with \`?position\` to check current position in queue`);
					return;
				}

				const requeue = {
					user: message.author.id,
					notified: false,
					position: Math.floor(Math.random() * 21 + 30),

				};

				await db.put(`channel:${message.channelId}`, requeue);
				await message.channel.send(`Session timed out, you have been requeued. New position in queue: \`${requeue.position}\``)

				return;
		}
	}

})

client.on("channelCreate", async (channel) => {
	if (!channel.name.startsWith("ticket-")) {
		return
	}

	await channel.send("Welcome to 4PF, due to high message volumes we now operate a queue system.\nReply with `?queue` to get a position in line.")
})


async function main() {
	await client.login(TOKEN);
}

async function updatePositions() {
	await sleep(20_000)

	while (true) {
		const keys = await db.getKeys();

		for (const key of keys) {
			if (key.startsWith("channel:")) {
				const channelId = key.slice(8);
				const stats = await db.get(key);
				stats.position -= 1;

				if (stats.position > 0) {
					try {
						await db.put(key, stats);
						await rest.post(Routes.channelMessages(channelId), {
							body: {
								content: `Updated Queue Position: \`${stats.position}\`\nReply with \`?position\` to check current position in queue`,
							},
						})
					} catch (error) {
						if (error.status === 404) {
							await db.remove(key);
						}
					}
				} else if (!stats.notified) {
					stats.position = 0
					stats.notified = true

					try {
						await db.put(key, stats);
						await rest.post(Routes.channelMessages(channelId), {
							body: {
								content: "You are next in line please reply `?here` if you wish to proceed",
							},
						})
					} catch (error) {
						if (error.status === 404) {
							await db.remove(key);
						}
					}
				}
			}
		}

		await sleep(REFRESH_DELAY)
	}
}

