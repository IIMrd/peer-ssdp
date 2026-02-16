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

import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import os from 'node:os';

// ── Constants ────────────────────────────────────────────────────────────────

const SSDP_ADDRESS = "239.255.255.250";
const SSDP_PORT = 1900;
const SSDP_HOST = `${SSDP_ADDRESS}:${SSDP_PORT}`;
const MAX_AGE = "max-age=1800";
const TTL = 128;
const MX = 2;

export const ALIVE = "ssdp:alive";
export const BYEBYE = "ssdp:byebye";
export const UPDATE = "ssdp:update";

const TYPE_M_SEARCH = "M-SEARCH";
const TYPE_NOTIFY = "NOTIFY";
const TYPE_200_OK = "200 OK";

// ── Types ────────────────────────────────────────────────────────────────────

/** SSDP header key-value map. Keys are typically uppercase (e.g. HOST, LOCATION). */
export type SsdpHeaders = Record<string, string | number>;

/** The address of a remote SSDP peer (subset of dgram.RemoteInfo). */
export interface SsdpAddress {
    address: string;
    port: number;
    family?: string;
    size?: number;
}

/** Options for creating a Peer (reserved for future use). */
export interface PeerOptions {
    // Reserved for future configuration options
}

/** The type of a parsed SSDP message. */
export type SsdpEventType = "notify" | "search" | "found" | null;

/** A parsed SSDP message. */
export interface SsdpMessage {
    type: SsdpEventType;
    headers: SsdpHeaders;
}

/** Callback type for send operations. */
export type SendCallback = (err: Error | null, bytes: number) => void;

/** Arguments passed to dgram.Socket.send(). */
type SendArgs = [Buffer, number, number, number, string, SendCallback];

/** Internal socket entry tracking unicast/multicast socket pair per interface. */
interface SocketEntry {
    unicast: dgram.Socket | null;
    multicast: dgram.Socket | null;
}

/** Internal proxy wrapping all sockets of a given type (unicast or multicast). */
interface SocketProxy {
    close(): void;
    send(processMessageCallback: (addr: string) => SendArgs): void;
}

// ── Events ───────────────────────────────────────────────────────────────────

export interface PeerEventMap {
    ready: [];
    close: [err?: Error];
    listening: [];
    error: [err: Error];
    notify: [headers: SsdpHeaders, address: SsdpAddress];
    search: [headers: SsdpHeaders, address: SsdpAddress];
    found: [headers: SsdpHeaders, address: SsdpAddress];
}

// ── Peer class ───────────────────────────────────────────────────────────────

export class Peer extends EventEmitter {
    private mcSocket: SocketProxy | null = null;
    private ucSocket: SocketProxy | null = null;
    private stopInterfaceDisco: (() => void) | null = null;

    constructor(_options?: PeerOptions) {
        super();
    }

    // Typed event emitter overloads
    override on<K extends keyof PeerEventMap>(event: K, listener: (...args: PeerEventMap[K]) => void): this;
    override on(event: string, listener: (...args: unknown[]) => void): this;
    override on(event: string, listener: (...args: unknown[]) => void): this {
        return super.on(event, listener);
    }

    override emit<K extends keyof PeerEventMap>(event: K, ...args: PeerEventMap[K]): boolean;
    override emit(event: string, ...args: unknown[]): boolean;
    override emit(event: string, ...args: unknown[]): boolean {
        return super.emit(event, ...args);
    }

    /**
     * Start the SSDP listening.
     * Creates multicast and unicast UDP sockets per IPv4 non-internal network
     * interface and begins periodic interface discovery (every 15 s).
     */
    start(): this {
        const socketMap: Record<string, SocketEntry> = {};
        let ready = 0;

        const onMessage = (msg: Buffer, address: dgram.RemoteInfo): void => {
            const req = deserialize(msg);
            if (req.type) {
                this.emit(req.type, req.headers, address);
            }
        };

        const onListening = (): void => {
            this.emit("listening");
        };

        const onClose = (err?: Error): void => {
            if (--ready <= 0) {
                this.emit("close", err);
                ready = 0;
            }
        };

        const onError = (err: Error): void => {
            this.emit("error", err);
        };

        const onReady = (): void => {
            if (++ready === 1) {
                this.emit("ready");
            }
        };

        const onBind = (socket: dgram.Socket, address: string, isMulticast: boolean): (() => void) => {
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

        const socketHandling = (adr: string): void => {
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
            const addrs = interfaces[name];
            if (!addrs) continue;
            for (const iface of addrs) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    socketHandling(iface.address);
                }
            }
        }

        const interfaceDiscoHandle = setInterval(() => {
            const currentInterfaces: Record<string, boolean> = {};
            const ifaces = os.networkInterfaces();
            for (const name in ifaces) {
                const addrs = ifaces[name];
                if (!addrs) continue;
                for (const iface of addrs) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        currentInterfaces[iface.address] = true;
                    }
                }
            }
            for (const addr in currentInterfaces) {
                if (!(socketMap[addr]?.multicast && socketMap[addr]?.unicast)) {
                    socketHandling(addr);
                }
            }
            for (const addr in socketMap) {
                if (socketMap[addr]?.multicast && socketMap[addr]?.unicast && !currentInterfaces[addr]) {
                    socketMap[addr].multicast!.close();
                    socketMap[addr].multicast = null;
                    socketMap[addr].unicast!.close();
                    socketMap[addr].unicast = null;
                }
            }
        }, 15000);

        this.stopInterfaceDisco = () => {
            clearInterval(interfaceDiscoHandle);
        };

        this.mcSocket = {
            close() {
                for (const addr in socketMap) {
                    if (socketMap[addr].multicast) {
                        socketMap[addr].multicast!.close();
                        socketMap[addr].multicast = null;
                    }
                }
            },
            send(processMessageCallback: (addr: string) => SendArgs) {
                for (const addr in socketMap) {
                    if (socketMap[addr].multicast) {
                        const args = processMessageCallback(addr);
                        socketMap[addr].multicast!.send(...args);
                    }
                }
            }
        };

        this.ucSocket = {
            close() {
                for (const addr in socketMap) {
                    if (socketMap[addr].unicast) {
                        socketMap[addr].unicast!.close();
                        socketMap[addr].unicast = null;
                    }
                }
            },
            send(processMessageCallback: (addr: string) => SendArgs) {
                for (const addr in socketMap) {
                    if (socketMap[addr].unicast) {
                        const args = processMessageCallback(addr);
                        socketMap[addr].unicast!.send(...args);
                    }
                }
            }
        };

        return this;
    }

    /**
     * Close the SSDP listening.
     * Stops interface discovery and closes all sockets.
     */
    close(): void {
        this.stopInterfaceDisco?.();
        this.mcSocket?.close();
        this.ucSocket?.close();
    }

    /**
     * Send an SSDP NOTIFY message via multicast.
     * @param headers - SSDP headers (HOST, CACHE-CONTROL, EXT, DATE are auto-filled if missing)
     * @param callback - optional callback invoked after each socket send
     */
    notify(headers: SsdpHeaders, callback?: SendCallback): void {
        headers['HOST'] ??= SSDP_HOST;
        headers['CACHE-CONTROL'] ??= MAX_AGE;
        headers['EXT'] ??= "";
        headers['DATE'] ??= new Date().toUTCString();
        const processMessageCallback = (networkInterfaceAddress: string): SendArgs => {
            const msg = Buffer.from(serialize(TYPE_NOTIFY + " * HTTP/1.1", headers, networkInterfaceAddress));
            return [msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS, (err, bytes) => {
                callback?.(err, bytes);
            }];
        };
        this.mcSocket!.send(processMessageCallback);
    }

    /**
     * Send an SSDP alive notification (NOTIFY with NTS ssdp:alive).
     */
    alive(headers: SsdpHeaders, callback?: SendCallback): void {
        headers['NTS'] = ALIVE;
        this.notify(headers, callback);
    }

    /**
     * Send an SSDP byebye notification (NOTIFY with NTS ssdp:byebye).
     */
    byebye(headers: SsdpHeaders, callback?: SendCallback): void {
        headers['NTS'] = BYEBYE;
        this.notify(headers, callback);
    }

    /**
     * Send an SSDP update notification (NOTIFY with NTS ssdp:update).
     */
    update(headers: SsdpHeaders, callback?: SendCallback): void {
        headers['NTS'] = UPDATE;
        this.notify(headers, callback);
    }

    /**
     * Send an SSDP M-SEARCH message via unicast socket to the multicast address.
     * @param headers - SSDP headers (HOST, MAN, MX are auto-filled if missing)
     * @param callback - optional callback invoked after each socket send
     */
    search(headers: SsdpHeaders, callback?: SendCallback): void {
        headers['HOST'] ??= SSDP_HOST;
        headers['MAN'] = '"ssdp:discover"';
        headers['MX'] ??= MX;
        const processMessageCallback = (networkInterfaceAddress: string): SendArgs => {
            const msg = Buffer.from(serialize(TYPE_M_SEARCH + " * HTTP/1.1", headers, networkInterfaceAddress));
            return [msg, 0, msg.length, SSDP_PORT, SSDP_ADDRESS, (err, bytes) => {
                callback?.(err, bytes);
            }];
        };
        this.ucSocket!.send(processMessageCallback);
    }

    /**
     * Reply to an SSDP M-SEARCH with an HTTP/1.1 200 OK response.
     * @param headers - SSDP headers (HOST, CACHE-CONTROL, EXT, DATE are auto-filled if missing)
     * @param address - the address to reply to
     * @param callback - optional callback invoked after each socket send
     */
    reply(headers: SsdpHeaders, address: SsdpAddress, callback?: SendCallback): void {
        headers['HOST'] ??= SSDP_HOST;
        headers['CACHE-CONTROL'] ??= MAX_AGE;
        headers['EXT'] ??= "";
        headers['DATE'] ??= new Date().toUTCString();
        const processMessageCallback = (networkInterfaceAddress: string): SendArgs => {
            const msg = Buffer.from(serialize("HTTP/1.1 " + TYPE_200_OK, headers, networkInterfaceAddress));
            return [msg, 0, msg.length, address.port, address.address, (err, bytes) => {
                callback?.(err, bytes);
            }];
        };
        this.ucSocket!.send(processMessageCallback);
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function serialize(head: string, headers: SsdpHeaders, networkInterfaceAddress?: string): string {
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

function deserialize(msg: Buffer): SsdpMessage {
    const lines = msg.toString().split('\r\n');
    const line = lines.shift()!;
    const headers: SsdpHeaders = {};
    let type: SsdpEventType = null;
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
    return { type, headers };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new SSDP Peer.
 */
export function createPeer(options?: PeerOptions): Peer {
    return new Peer(options);
}
