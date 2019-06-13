const events = require('events');
const fs = require('fs');
const path = require('path');
const MatterMostClient = require('mattermost-client');
const Log = require('log');

const logger = new Log('debug');

const DIRECT = 'direct';
const CHANNEL_MENTION = 'channel-mention';
const CHANNEL_MESSAGE = 'channel-message';
const BOT_INVITED_CHANNEL = 'bot-invited-channel';
const USER_INVITED_CHANNEL = 'user-invited-channel';

class Program {
	constructor() {
		this.bots = [];
	}
	async main() {
		try {
			await this.program();
		} catch (e) {
			logger.error(e);
			process.exit(1);
		}
	}

	program() {
		return new Promise(async (success, fail) => {
			process.env.MATTERMOST_USE_TLS = process.env.MATTERMOST_USE_TLS || 'true';
			try {
				if (process.env.MATTERMOST_HOST === undefined) {
					throw new Error('informe o MATTERMOST_HOST');
				}
				let host = (process.env.MATTERMOST_HOST || 'mattermost.valebroker.com.br');
				if (process.env.ACCESS_TOKEN === undefined) {
					throw new Error('informe o ACCESS_TOKEN');
				}
				let tokens = process.env.ACCESS_TOKEN.split(',');
				for (let k = 0; k < tokens.length; k++) {
					let token = tokens[k];
					await this.initializeBot(host, token);
				}
				await this.connectBots();
				await this.prepareScripts();
				await this.startBots();
				return success();
			} catch (e) {
				return fail(e);
			}
		});
	}

	startBots() {
		return new Promise(async (success, fail) => {
			try {
				for (let k = 0; k < this.bots.length; k++) {
					let bot = this.bots[k];
					await bot.start();
				}
				success();
			} catch (e) {
				fail(e);
			}
		});
	}

	initializeBot(host, token) {
		return new Promise((success, fail) => {
			let bot = new Bot(host, token);
			this.bots.push(bot);
			success();
		});
	}

	connectBots() {
		return new Promise(async (success, fail) => {
			try {
				for (let k = 0; k < this.bots.length; k++) {
					await this.bots[k].connect();
				}
				return success();
			} catch (e) {
				fail(e);
			}
		})
	}

	prepareScripts() {
		return new Promise((success, fail) => {
			let dir = path.resolve(process.env.SCRIPT_PATH || path.join('.', 'scripts'));
			fs.readdir(dir, async (err, files) => {
				if (err != null) {
					return fail(err);
				}
				try {
					for (let k = 0; k < files.length; k++) {
						if (files[k].endsWith('.js')) {
							await this.initScript(path.join(dir, files[k]));
						}
					}
					return success();
				} catch (e) {
					return fail(e);
				}
			});
		});
	}

	initScript(scriptPath) {
		return new Promise((success, fail) => {
			let script = require(scriptPath);
			try {
				for (let k = 0; k < this.bots.length; k++) {
					let bot = this.bots[k];
					script.init(bot.client.me, new BotListener(bot));
				}
			} catch (e) {
				return fail(e);
			}
			return success();
		});
	}
}
class Bot extends events.EventEmitter {
	constructor(host, token) {
		super();
		this.queue = [];
		this.host = host;
		this.token = token;
	}
	start() {
		return new Promise(async (success, fail) => {
			try {
				this.connected = true;
				while (this.queue.length) {
					await this.handleMessage(this.queue.shift());
				}
				success();
			} catch (e) {
				fail(e);
			}
		});
	}
	connect() {
		return new Promise((success, fail) => {
			try {
				let client = this.client = new MatterMostClient(this.host, '', {});
				client.on('connected', () => success());
				client.on('error', (e) => console.error(e));
				client.on('message', async (message) => {
					try {
						await this.handleMessage(message);
					} catch (e) {
						console.error(e);
					}
				});
				client.tokenLogin(this.token);
			} catch (e) {
				fail(e);
			}
		});
	}
	handleMessage(message) {
		return new Promise(async (success, fail) => {
			if (message.data.post != undefined) {
				let post = JSON.parse(message.data.post);
				for (let i in post) {
					message.data[i] = post[i];
				}
				delete message.data.post;
			}
			if (message.data.mentions != undefined) {
				message.data.mentions = JSON.parse(message.data.mentions);
			}
			console.log(message);
			if (message.data.user_id == this.client.me.id) {
				return success();
			}
			if (!this.connected) {
				this.queue.push(message);
				return success();
			}
			try {
				let kind = await this.solveMessageKind(message);
				//this.emit(this.client.me.username + '/' + kind, message);
				//this.emit('*/' + kind, message);
				this.emit(kind, message);
				return success();
			} catch (e) {
				return fail(e);
			}
		});
	}
	solveMessageKind(message) {
		return new Promise(async (success, fail) => {
			if (message.data.channel_type == 'D') {
				return success(DIRECT);
			}
			if (message.data.channel_type == 'O') {
				let me = this.client.me;
				if (message.data.type == 'system_add_to_channel') {
					if (message.data.addedUserId == me.id) {
						return success(BOT_INVITED_CHANNEL);
					}
					return success(USER_INVITED_CHANNEL);
				}
				if (message.data.mentions != undefined) {
					for (let k = 0; k < message.data.mentions.length; k++) {
						if (message.data.mentions[k] == me.id) {
							return success(CHANNEL_MENTION);
						}
					}
				}
				return success(CHANNEL_MESSAGE);
			}
			return success(false);
		});
	}
	send(to, what) {
		return new Promise((success, fail) => {
			try {
				let req = this.client.postMessage(what, to);
				req.on('response', response => success());
				req.on('error', err => fail(err));
			} catch (e) {
				fail(e);
			}
		});
	}
}

class BotListener {
	constructor(owner) {
		this.owner = owner;
	}
	onDirect(callback) {
		this.owner.on(DIRECT, callback);
	}
	onChannelMention(callback) {
		this.owner.on(CHANNEL_MENTION, callback);
	}
	onChannelMessage(callback) {
		this.owner.on(CHANNEL_MESSAGE, callback);
	}
	onBotInvitedChannel(callback) {
		this.owner.on(BOT_INVITED_CHANNEL, callback);
	}
	onUserInvitedChannel(callback) {
		this.owner.on(USER_INVITED_CHANNEL, callback);
	}
	send(to, what) {
		return this.owner.send(to, what);
	}
}

new Program().main();
