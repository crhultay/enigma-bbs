/* jslint node: true */
'use strict';

//  ENiGMA½
const Log = require('../../logger.js').log;
const { ServerModule } = require('../../server_module.js');
const Config = require('../../config.js').get;
const { Errors } = require('../../enig_error.js');
const SysProps = require('../../system_property.js');
const StatLog = require('../../stat_log.js');

//  deps
const COLOUR_CODES = require('../../constants/ansi/colour_codes').COLOUR_CODES;
const net = require('net');
const _ = require('lodash');
const os = require('os');
const tcpPortUsed = require('tcp-port-used');

// MRC
const clientVersion = '1.3.1';
const lineDelimiter = new RegExp('\r\n|\r|\n|\n\r'); //  eslint-disable-line no-control-regex

const ModuleInfo = (exports.moduleInfo = {
    name: 'MRC',
    desc: 'An MRC Chat Multiplexer',
    author: 'RiPuk',
    packageName: 'codes.l33t.enigma.mrc.server',
    notes: 'https://bbswiki.bottomlessabyss.net/index.php?title=MRC_Chat_platform',
});

const connectedSockets = new Set();

exports.getModule = class MrcModule extends ServerModule {
    constructor() {
        super();

        this.log = Log.child({ server: 'MRC' });

        const config = Config();
        this.boardName = config.general.boardName;

        // Use prettyBoardName only if non-default
        if (config.general.prettyBoardName != '|08XXXXX') this.boardName = config.general.prettyBoardName;

        this.mrcConfig = {
            host: config.chatServers.mrc.serverHostname || 'mrc.bottomlessabyss.net',
            port: config.chatServers.mrc.serverPort || 5000,
            sslport: config.chatServers.mrc.serverSslPort || 5001,
            retryDelay: config.chatServers.mrc.retryDelay || 10000,
            useSsl: config.chatServers.mrc.useSsl || false,
        };

        this.mrcConnectOpts = {
            host: this.mrcConfig.host,
            port: this.mrcConfig.port,
            retryDelay: this.mrcConfig.retryDelay
        }
    }

    _connectionHandler() {
        const enigmaVersion = 'ENiGMA½-BBS_' + require('../../../package.json').version;

        const handshake = `${
            this.boardName
        }~${enigmaVersion}/${os.platform()}.${os.arch()}/${clientVersion}`;
        this.log.debug({ handshake: handshake }, 'Handshaking with MRC server');

        this.sendRaw(handshake);
        this.log.info(this.mrcConnectOpts, 'Connected to MRC server');
    }

    createServer(cb) {
        if (!this.enabled) {
            return cb(null);
        }

        this.connectToMrc();
        this.createLocalListener();

        return cb(null);
    }

    listen(cb) {
        if (!this.enabled) {
            return cb(null);
        }

        const config = Config();

        const port = parseInt(config.chatServers.mrc.multiplexerPort);
        if (isNaN(port)) {
            this.log.warn(
                { port: config.chatServers.mrc.multiplexerPort, server: ModuleInfo.name },
                'Invalid port'
            );
            return cb(
                Errors.Invalid(`Invalid port: ${config.chatServers.mrc.multiplexerPort}`)
            );
        }

        const address = "0.0.0.0";

        tcpPortUsed
            .check(port, address)
            .then(function(inUse) {
                if (inUse) {
                    console.error(`${COLOUR_CODES.BRIGHT_RED}CHAT SERVER: ${COLOUR_CODES.RED}${ModuleInfo.name} Cannot Start! Port is in use: ${COLOUR_CODES.BRIGHT_WHITE}${port} at address ${address}${COLOUR_CODES.WHITE}`)

                    return cb(Errors.UnexpectedState(`Port is in use: ${port} at address ${address}`))
                }
            },
            function(err) {
                return cb(err);
            }
        );

        console.info(`${COLOUR_CODES.BRIGHT_GREEN}CHAT SERVER: ${COLOUR_CODES.GREEN}${ModuleInfo.name} Listening on Port ${COLOUR_CODES.BRIGHT_WHITE}${port} at address ${address}${COLOUR_CODES.WHITE}`)

        Log.info(
            { server: ModuleInfo.name, port: port, address: address },
            'MRC multiplexer starting up'
        );

        return this.server.listen(port, cb);
    }

    /**
     * Handles connecting to to the MRC server
     */
    connectToMrc() {
        const self = this;

        if (this.mrcConfig.useSsl) {
            this.mrcConnectOpts.port = this.mrcConfig.sslport;
        }

        // Create connection
        this.mrcSocket = net.createConnection(
            this.mrcConnectOpts,
            self._connectionHandler.bind(self)
        );

        this.mrcSocket.requestedDisconnect = false;

        // Check if we upgrade the connection to SSL
        if (this.mrcConfig.useSsl) {
            const tls = require('tls')
            this.mrcSecureSocket = new tls.TLSSocket(this.mrcSocket, { isServer: false });
            this.mrcClient = this.mrcSecureSocket;
        }
        else {
            this.mrcClient = this.mrcSocket;
        }

        // do things when we get data from MRC central
        let buffer = new Buffer.from('');

        function handleData(chunk) {
            if (_.isString(chunk)) {
                buffer += chunk;
            } else {
                buffer = Buffer.concat([buffer, chunk]);
            }

            let lines = buffer.toString().split(lineDelimiter);

            if (lines.pop()) {
                // if buffer is not ended with \r\n, there's more chunks.
                return;
            } else {
                // else, initialize the buffer.
                buffer = new Buffer.from('');
            }

            lines.forEach(line => {
                if (line.length) {
                    let message = self.parseMessage(line);
                    if (message) {
                        self.receiveFromMRC(message);
                    }
                }
            });
        }

        this.mrcClient.on('data', data => {
            handleData(data);
        });

        this.mrcClient.on('end', () => {
            this.log.info(this.mrcConnectOpts, 'Disconnected from MRC server');
        });

        this.mrcClient.on('close', () => {
            if (this.mrcClient && this.mrcClient.requestedDisconnect) return;

            this.log.info(
                this.mrcConnectOpts,
                'Disconnected from MRC server, reconnecting'
            );
            this.log.debug(
                'Waiting ' + this.mrcConnectOpts.retryDelay + 'ms before retrying'
            );

            setTimeout(function () {
                self.connectToMrc();
            }, this.mrcConnectOpts.retryDelay);
        });

        this.mrcClient.on('error', err => {
            this.log.info({ error: err.message }, 'MRC server error');
        });
    }

    createLocalListener() {
        // start a local server for clients to connect to

        this.server = net.createServer(socket => {
            socket.setEncoding('ascii');

            socket.on('data', data => {
                // split on \n to deal with getting messages in batches
                data.toString()
                    .split(lineDelimiter)
                    .forEach(item => {
                        if (item == '') return;

                        // save username with socket
                        if (item.startsWith('--DUDE-ITS--')) {
                            connectedSockets.add(socket);
                            socket.username = item.split('|')[1];
                            Log.debug(
                                { server: 'MRC', user: socket.username },
                                'User connected'
                            );
                        } else {
                            this.receiveFromClient(socket.username, item);
                        }
                    });
            });

            socket.on('end', function () {
                connectedSockets.delete(socket);
            });

            socket.on('error', err => {
                if ('ECONNRESET' !== err.code) {
                    //  normal
                    this.log.error({ error: err.message }, 'MRC error');
                }
            });
        });
    }

    get enabled() {
        return _.get(Config(), 'chatServers.mrc.enabled', false) && this.isConfigured();
    }

    isConfigured() {
        const config = Config();
        return _.isNumber(_.get(config, 'chatServers.mrc.multiplexerPort'));
    }

    /**
     * Sends received messages to local clients
     */
    sendToClient(message) {
        connectedSockets.forEach(client => {
            if (
                message.to_user == '' ||
                message.to_user == client.username.toUpperCase() ||
                message.to_user == 'CLIENT' ||
                message.from_user == client.username ||
                message.to_user == 'NOTME'
            ) {
                // this.log.debug({ server : 'MRC', username : client.username, message : message }, 'Forwarding message to connected user');
                client.write(JSON.stringify(message) + '\n');
            }
        });
    }

    /**
     * Processes messages received from the central MRC server
     */
    receiveFromMRC(message) {
        const config = Config();

        if (message.from_user == 'SERVER' && message.body == 'HELLO') {
            // reply with extra bbs info
            this.sendToMrcServer(
                'CLIENT',
                '',
                'SERVER',
                'ALL',
                '',
                `INFOSYS:${StatLog.getSystemStat(SysProps.SysOpUsername)}`
            );
            this.sendToMrcServer(
                'CLIENT',
                '',
                'SERVER',
                'ALL',
                '',
                `INFOWEB:${config.general.website}`
            );
            this.sendToMrcServer(
                'CLIENT',
                '',
                'SERVER',
                'ALL',
                '',
                `INFOTEL:${config.general.telnetHostname}`
            );
            this.sendToMrcServer(
                'CLIENT',
                '',
                'SERVER',
                'ALL',
                '',
                `INFOSSH:${config.general.sshHostname}`
            );
            this.sendToMrcServer(
                'CLIENT',
                '',
                'SERVER',
                'ALL',
                '',
                `INFODSC:${config.general.description}`
            );
        } else if (
            message.from_user == 'SERVER' &&
            message.body.toUpperCase() == 'PING'
        ) {
            // reply to heartbeat
            this.sendToMrcServer(
                'CLIENT',
                '',
                'SERVER',
                'ALL',
                '',
                `IMALIVE:${this.boardName}`
            );
        } else {
            // if not a heartbeat, and we have clients then we need to send something to them
            this.sendToClient(message);
        }
    }

    /**
     * Takes an MRC message and parses it into something usable
     */
    parseMessage(line) {
        let [from_user, from_site, from_room, to_user, to_site, to_room, body] =
            line.split('~');

        // const msg = line.split('~');
        // if (msg.length < 7) {
        //     return;
        // }

        // Make sure to_user and from_user are always uppercase
        to_user = (to_user || '').toUpperCase();
        from_user = (from_user || '').toUpperCase();

        return { from_user, from_site, from_room, to_user, to_site, to_room, body };
    }

    /**
     * Receives a message from a local client and sanity checks before sending on to the central MRC server
     */
    receiveFromClient(username, message) {
        try {
            message = JSON.parse(message);
            this.sendToMrcServer(
                message.from_user,
                message.from_room,
                message.to_user,
                message.to_site,
                message.to_room,
                message.body
            );
        } catch (e) {
            Log.debug(
                { server: 'MRC', user: username, message: message },
                'Dodgy message received from client'
            );
        }
    }

    /**
     * Converts a message back into the MRC format and sends it to the central MRC server
     */
    sendToMrcServer(fromUser, fromRoom, toUser, toSite, toRoom, messageBody) {
        const line =
            [
                fromUser,
                this.boardName,
                sanitiseRoomName(fromRoom || ''),
                sanitiseName(toUser || ''),
                sanitiseName(toSite || ''),
                sanitiseRoomName(toRoom || ''),
                sanitiseMessage(messageBody || ''),
            ].join('~') + '~';

        // Log.debug({ server : 'MRC', data : line }, 'Sending data');
        this.sendRaw(line);
    }

    sendRaw(message) {
        // optionally log messages here
        this.mrcClient.write(message + '\n');
    }
};

/**
 * User / site name must be ASCII 33-125, no MCI, 30 chars max, underscores
 */
function sanitiseName(str) {
    return str
        .replace(/\s/g, '_')
        .replace(
            /[^\x21-\x7D]|(\|\w\w)/g,
            '' // Non-printable & MCI
        )
        .substr(0, 30);
}

function sanitiseRoomName(message) {
    return message.replace(/[^\x21-\x7D]|(\|\w\w)/g, '').substr(0, 30);
}

function sanitiseMessage(message) {
    return message.replace(/[^\x20-\x7D]/g, '');
}
