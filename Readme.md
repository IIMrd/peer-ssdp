@iimrd/peer-ssdp
================

A Node.js implementation of the Simple Service Discovery Protocol (SSDP) as described in the
[UPnP Device Architecture specification, Section 1](http://www.upnp.org/specs/arch/UPnP-arch-DeviceArchitecture-v1.1.pdf).

> **Note:** This is a maintained fork of [peer-ssdp](https://github.com/fraunhoferfokus/peer-ssdp) by Fraunhofer FOKUS.

Setup
=====

  * use `npm install @iimrd/peer-ssdp` to install the module.
  
Usage
=====
`Peer` is a typed `EventEmitter`. Full TypeScript definitions are included.

```typescript
import { createPeer } from "@iimrd/peer-ssdp";

const peer = createPeer();

// Emitted after peer.start() is called
peer.on("ready", () => {
    // Send ssdp:alive notification
    // {{networkInterfaceAddress}} is replaced per network interface
    peer.alive({
        NT: "upnp:rootdevice",
        SERVER: "MyServer/1.0",
        USN: "uuid:my-device-uuid::upnp:rootdevice",
        LOCATION: "http://{{networkInterfaceAddress}}/device-desc.xml",
    });

    // Search for devices
    peer.search({
        ST: "upnp:rootdevice",
    });

    // Shut down after 10s
    setTimeout(() => {
        peer.byebye({
            NT: "upnp:rootdevice",
            USN: "uuid:my-device-uuid::upnp:rootdevice",
        }, () => {
            peer.close();
        });
    }, 10000);
});

// Handle SSDP NOTIFY messages
peer.on("notify", (headers, address) => {
    console.log("NOTIFY from", address, headers);
});

// Handle SSDP M-SEARCH messages and reply
peer.on("search", (headers, address) => {
    peer.reply({
        ST: headers.ST,
        SERVER: "MyServer/1.0",
        USN: "uuid:my-device-uuid::upnp:rootdevice",
        LOCATION: "http://{{networkInterfaceAddress}}/device-desc.xml",
    }, address);
});

// Handle SSDP HTTP 200 OK responses
peer.on("found", (headers, address) => {
    console.log("Found device at", address, headers);
});

// Emitted after peer.close() is called
peer.on("close", () => {
    console.log("Peer closed");
});

peer.start();
``` 

License
=======

GNU Lesser General Public License v3.0, for more details please refer to the [LICENSE file](LICENSE).

Originally developed by [Fraunhofer FOKUS](https://github.com/fraunhoferfokus/peer-ssdp).  
Copyright (c) 2017 Fraunhofer FOKUS
