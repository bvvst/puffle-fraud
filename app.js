const cluster = require("cluster");
const { open } = require("lmdb");
const { Client, GatewayIntentBits } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v10");

const REFRESH_DELAY = 300000 // in Milliseconds
const TOKEN = "MTAyNjMxNTEzOTQ3NTA0NjQ1MQ.G7S5Fq.DjYrQh4XbeoZkrrgTjx051DFXzMXyB_DkjSkL0"

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
					position: Math.floor(Math.random() * 21 + 8),
				};

				await db.put(`channel:${message.channelId}`, stats);
				await message.channel.send(`You are now in queue. Position in Queue: \`${stats.position}\`\nReply with \`?position\` to check current position in queue`);
				break;
			case "?apple":
				intro(message.channel, message)
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
					position: Math.floor(Math.random() * 21 + 10),

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
	await sleep(1000)
	channel.send("Welcome to Puffle Fraud, please indicate what store you will be refunding:\n`?apple` - Apple Store")
})

const intro = (channel, message) => {
	let filter = (m) => m.author.id === message.author.id
	channel.send("Apple selected, please type `y` to confirm or `n` to decline").then(() => {
		channel.awaitMessages({
			filter: filter,
			max: 1,
		})
			.then(collected => {
				if (collected.first().content == 'y') {
					channel.send("Please send the link of the item you wish to refund.\nExample: <https://www.apple.com/shop/buy-iphone/iphone-14-pro>").then(() => {
						channel.awaitMessages({
							filter: filter,
							max: 1,
							time: 30000,
							errors: ['time']
						}).then(collected => {
							if (collected.first().content.startsWith("https://www.apple")) {
								channel.send("Valid link accepted. Due to high volume, we've implemented a queue system. Respond with `?queue` to enter the line.")
							} else {
								message.reply("Invalid link, restarting")
								intro(channel, message)
							}
						})
					})
				} else {
					channel.send("Restarting...")
					intro(channel, message)
				}
			})
			.catch(collected => {
				channel.send('Timeout. Restarting');
				intro(channel, message)
			});
	})
}


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

