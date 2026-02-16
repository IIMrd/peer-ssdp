/*******************************************************************************
 * 
 * Copyright (c) 2013 Louay Bassbouss, Fraunhofer FOKUS, All rights reserved.
 * 
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 3.0 of the License, or (at your option) any later version.
 * 
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 * 
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library. If not, see <http://www.gnu.org/licenses/>. 
 * 
 * AUTHORS: Louay Bassbouss (louay.bassbouss@fokus.fraunhofer.de)
 *     Martin Lasak (martin.lasak@fokus.fraunhofer.de)
 *     Alexander Futasz (alexander.futasz@fokus.fraunhofer.de)
 *
 ******************************************************************************/

const dgram = require('dgram');
const { EventEmitter } = require('events');
const os = require('os');

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_HOST = SSDP_ADDRESS + ":" + SSDP_PORT;
const MAX_AGE = "max-age=1800";
const TTL = 128;
const MX = 2;
const ALIVE = "ssdp:alive";
const BYEBYE = "ssdp:byebye";
const UPDATE = "ssdp:update";
const TYPE_M_SEARCH = "M-SEARCH";
const TYPE_NOTIFY = "NOTIFY";
const TYPE_200_OK = "200 OK";

class Peer extends EventEmitter {
    constructor(options) {
        super();
        this.mcSocket = null;
        this.ucSocket = null;
    }

    /**
     * start the SSDP listening
     */
    start() {
        const socketMap = {};
        const self = this;
        let ready = 0;

        const onMessage = (msg, address) => {
            const req = deserialize(msg);
            self.emit(req.type, req.headers, address);
        };

        const onListening = () => {
            self.emit("listening");
        };

        const onClose = (err) => {
            if (--ready <= 0) {
                self.emit("close", err);
                ready = 0;
            }
        };

        const onError = (err) => {
            self.emit("error", err);
        };

        const onReady = () => {
            if (++ready === 1) {
                self.emit("ready");
            }
        };

        const onBind = (socket, address, isMulticast) => {
            return () => {
                socket.setMulticastTTL(TTL);
                if (isMulticast) {
                    socket.setBroadcast(true);
                    if (address) {
                        socket.addMembership(SSDP_ADDRESS, address);
                    } else {
                        socket.addMembership(SSDP_ADDRESS);
                    }
                    socket.setMulticastLoopback(true);
                }
                onReady();
            };
        };

        // Multicast Socket(s) Handling
        const socketHandling = (adr) => {
            socketMap[adr] = {
                unicast: null,
                multicast: null
            };

            // unicast socket
            const uc = dgram.createSocket({ type: "udp4", reuseAddr: true });
            uc.on("message", onMessage);
            uc.on("listening", onListening);
            uc.on("error", onError);
            uc.on("close", onClose);
            uc.bind(50000 + Math.floor(Math.random() * 1000), adr, onBind(uc, adr, false));
            socketMap[adr].unicast = uc;

            // multicast socket
            const mc = dgram.createSocket({ type: "udp4", reuseAddr: true });
            mc.on("message", onMessage);
            mc.on("listening", onListening);
            mc.on("error", onError);
            mc.on("close", onClose);
            mc.bind(SSDP_PORT, onBind(mc, adr, true));
            socketMap[adr].multicast = mc;
        };

        const interfaces = os.networkInterfaces();
        for (const name in interfaces) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    socketHandling(iface.address);
                }
            }
        }

        const interfaceDiscoHandle = setInterval(() => {
            const currentInterfaces = {};
            const interfaces = os.networkInterfaces();
            for (const name in interfaces) {
                for (const iface of interfaces[name]) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        currentInterfaces[iface.address] = true;
                    }
                }
            }
            for (const addr in currentInterfaces) {
                if (!(socketMap[addr] && socketMap[addr].multicast && socketMap[addr].unicast)) {
                    socketHandling(addr);
                }
            }
            for (const addr in socketMap) {
                if (socketMap[addr] && socketMap[addr].multicast && socketMap[addr].unicast && !currentInterfaces[addr]) {
                    socketMap[addr].multicast.close();
                    delete socketMap[addr].multicast;
                    socketMap[addr].unicast.close();
                    delete socketMap[addr].unicast;
                }
            }
        }, 15000);

        this.stopInterfaceDisco = () => {
            if (interfaceDiscoHandle) {
                clearInterval(interfaceDiscoHandle);
            }
        };

        this.mcSocket = {
            close() {
                for (const addr in socketMap) {
                    if (socketMap[addr].multicast) {
                        socketMap[addr].multicast.close();
                        delete socketMap[addr].multicast;
                    }
                }
            },
            send(processMessageCallback) {
                const processMessage = typeof processMessageCallback === "function";
                for (const addr in socketMap) {
                    if (socketMap[addr].multicast) {
                        const args = processMessage ? processMessageCallback(addr) : arguments;
                        socketMap[addr].multicast.send.apply(socketMap[addr].multicast, args);
                    }
                }
            }
        };

        this.ucSocket = {
            close() {
                for (const addr in socketMap) {
                    if (socketMap[addr].unicast) {
                        socketMap[addr].unicast.close();
                        delete socketMap[addr].unicast;
                    }
                }
            },
            send(processMessageCallback) {
                const processMessage = typeof processMessageCallback === "function";
                for (const addr in socketMap) {
                    if (socketMap[addr].unicast) {
                        const args = processMessage ? processMessageCallback(addr) : arguments;
                        socketMap[addr].unicast.send.apply(socketMap[addr].unicast, args);
                    }
                }
            }
        };

        return this;
    }

    /**
     * close the SSDP listening.
     */
    close() {
        this.stopInterfaceDisco();
        if (this.mcSocket) this.mcSocket.close();
        if (this.ucSocket) this.ucSocket.close();
    }

    /**
     * notify a SSDP message
     * @param headers
     * @param callback
     */
    notify(headers, callback) {
        headers['HOST'] = headers['HOST'] || SSDP_HOST;
        headers['CACHE-CONTROL'] = headers['CACHE-CONTROL'] || MAX_AGE;
        headers['EXT'] = headers['EXT'] || "";
        headers['DATE'] = headers['DATE'] || new Date().toUTCString();
        const processMessageCallback = (networkInterfaceAddress) => {
            const msg = Buffer.from(serialize(TYPE_NOTIFY + " * HTTP/1.1", headers, networkInterfaceAddress));
            return [msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS, (err, bytes) => {
                if (typeof callback === "function") callback.call(null, err, bytes);
            }];
        };
        this.mcSocket.send(processMessageCallback);
    }

    /**
     * notify an SSDP alive message
     */
    alive(headers, callback) {
        headers['NTS'] = ALIVE;
        this.notify(headers, callback);
    }

    /**
     * notify an SSDP byebye message
     */
    byebye(headers, callback) {
        headers['NTS'] = BYEBYE;
        this.notify(headers, callback);
    }

    /**
     * notify an SSDP update message
     */
    update(headers, callback) {
        headers['NTS'] = UPDATE;
        this.notify(headers, callback);
    }

    /**
     * send an SSDP M-SEARCH message
     */
    search(headers, callback) {
        headers['HOST'] = headers['HOST'] || SSDP_HOST;
        headers['MAN'] = '"ssdp:discover"';
        headers['MX'] = headers['MX'] || MX;
        const processMessageCallback = (networkInterfaceAddress) => {
            const msg = Buffer.from(serialize(TYPE_M_SEARCH + " * HTTP/1.1", headers, networkInterfaceAddress));
            return [msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS, (err, bytes) => {
                if (typeof callback === "function") callback.call(null, err, bytes);
            }];
        };
        this.ucSocket.send(processMessageCallback);
    }

    /**
     * reply to an SSDP M-SEARCH message
     */
    reply(headers, address, callback) {
        headers['HOST'] = headers['HOST'] || SSDP_HOST;
        headers['CACHE-CONTROL'] = headers['CACHE-CONTROL'] || MAX_AGE;
        headers['EXT'] = headers['EXT'] || "";
        headers['DATE'] = headers['DATE'] || new Date().toUTCString();
        const processMessageCallback = (networkInterfaceAddress) => {
            const msg = Buffer.from(serialize("HTTP/1.1 " + TYPE_200_OK, headers, networkInterfaceAddress));
            return [msg, 0, msg.length, address.port, address.address, (err, bytes) => {
                if (typeof callback === "function") callback.call(null, err, bytes);
            }];
        };
        this.ucSocket.send(processMessageCallback);
    }
}

function serialize(head, headers, networkInterfaceAddress) {
    let result = head + "\r\n";
    for (const name of Object.keys(headers)) {
        result += name + ": " + headers[name] + "\r\n";
    }
    result += "\r\n";
    if (networkInterfaceAddress) {
        result = result.replace(/{{networkInterfaceAddress}}/g, networkInterfaceAddress);
    }
    return result;
}

function deserialize(msg) {
    const lines = msg.toString().split('\r\n');
    const line = lines.shift();
    const headers = {};
    let type = null;
    if (line.match(/HTTP\/(\d{1})\.(\d{1}) (\d+) (.*)/)) {
        type = "found";
    } else {
        const t = line.split(' ')[0];
        type = (t === TYPE_M_SEARCH) ? "search" : (t === TYPE_NOTIFY ? "notify" : null);
    }
    for (const l of lines) {
        if (l.length) {
            const vv = l.match(/^([^:]+):\s*(.*)$/);
            if (vv && vv.length === 3) {
                headers[vv[1].toUpperCase()] = vv[2];
            }
        }
    }
    return {
        type: type,
        headers: headers
    };
}

/**
 * create a new SSDP Peer
 */
exports.createPeer = function (options) {
    return new Peer(options);
};

exports.ALIVE = ALIVE;
exports.BYEBYE = BYEBYE;
exports.UPDATE = UPDATE;