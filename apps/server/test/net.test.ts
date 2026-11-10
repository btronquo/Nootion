import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { isPrivateAddress, outboundRequest, PrivateAddressError } from "../src/net.js";

describe("outbound requests", () => {
  it("tell local addresses from the internet, however they are written", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.1.10",
      "172.16.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "fec0::1",
      "ff02::1",
      // IPv4 addresses inside IPv6 ones: mapped (dotted and hexadecimal), compatible, NAT64, 6to4.
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:c0a8:10a",
      "::7f00:1",
      "64:ff9b::7f00:1",
      "2002:7f00:1::",
      "2002:c0a8:101::1",
      "not an address",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "2002:808:808::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("refuse the local network, also behind a redirection or a name, unless allowed", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/go") return res.writeHead(302, { location: "/there" }).end();
      res.end("hello");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      await expect(outboundRequest(`http://127.0.0.1:${port}/`)).rejects.toBeInstanceOf(PrivateAddressError);
      await expect(outboundRequest(`http://[::ffff:7f00:1]:${port}/`)).rejects.toBeInstanceOf(PrivateAddressError);
      // The name is checked as the connection is made.
      await expect(outboundRequest(`http://localhost:${port}/`)).rejects.toBeInstanceOf(PrivateAddressError);
      await expect(outboundRequest("ftp://example.com/")).rejects.toThrow("http or https only");

      const res = await outboundRequest(`http://127.0.0.1:${port}/go`, { allowPrivate: true, maxRedirects: 2, maxBytes: 100 });
      expect(res.ok).toBe(true);
      expect(res.url.pathname).toBe("/there");
      expect(res.body.toString()).toBe("hello");
      // Redirections aren't followed unless asked.
      expect((await outboundRequest(`http://127.0.0.1:${port}/go`, { allowPrivate: true })).status).toBe(302);
    } finally {
      server.close();
    }
  });
});
