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

import os from 'node:os';
import { createPeer } from "../dist/peer-ssdp.js";
const SERVER = os.type() + "/" + os.release() + " UPnP/1.1 famium/0.0.1";
const uuid = "6bd5eabd-b7c8-4f7b-ae6c-a30ccdeb5988";
const peer = createPeer();

peer.on("ready", () => {
    console.log("ready");
    onReady();
}).on("notify", (headers, address) => {
    console.log("receive notify message from ", address);
    console.log(headers);
    console.log("=======================");
}).on("search", (headers, address) => {
    console.log("receive search request message from ", address);
    console.log(headers);
    console.log("=======================");
    const replyHeaders = {
        LOCATION: "http://{{networkInterfaceAddress}}/upnp/devices/6bd5eabd-b7c8-4f7b-ae6c-a30ccdeb5988/desc.xml",
        SERVER: SERVER,
        ST: "upnp:rootdevice",
        USN: "uuid:" + uuid + "::upnp:rootdevice",
        'BOOTID.UPNP.ORG': 1
    };
    console.log("reply to search request from ", address);
    console.log(replyHeaders);
    console.log("=======================");
    peer.reply(replyHeaders, address);
}).on("found", (headers, address) => {
    console.log("receive found message from ", address);
    console.log(headers);
    console.log("=======================");
}).on("close", () => {
    console.log("close");
}).start();

const onReady = () => {
    console.log("notify SSDP alive message");
    peer.alive({
        NT: "upnp:rootdevice",
        USN: "uuid:" + uuid + "::upnp:rootdevice",
        LOCATION: "http://{{networkInterfaceAddress}}/upnp/devices/6bd5eabd-b7c8-4f7b-ae6c-a30ccdeb5988/desc.xml",
        SERVER: SERVER
    });

    console.log("search for rootdevices");
    peer.search({
        ST: "upnp:rootdevice"
    });

    setTimeout(() => {
        console.log("notify SSDP byebye message");
        peer.byebye({
            NT: "upnp:rootdevice",
            USN: "uuid:" + uuid + "::upnp:rootdevice",
            LOCATION: "http://{{networkInterfaceAddress}}/upnp/devices/6bd5eabd-b7c8-4f7b-ae6c-a30ccdeb5988/desc.xml",
            SERVER: SERVER
        }, () => {
            peer.close();
        });
    }, 10000);
};