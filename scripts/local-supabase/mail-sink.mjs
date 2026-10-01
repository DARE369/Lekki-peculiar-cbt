// Tiny SMTP server for local testing: accepts every message and saves it to $MAIL_DIR/<n>.eml.
// Also serves docs/email-templates over HTTP so the local auth server uses the real invite template.
import { createServer } from "node:net";
import { createServer as createHttp } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.MAIL_DIR ?? "/var/tmp/sblogs/mail";
const templates = new URL("../../docs/email-templates/", import.meta.url);
mkdirSync(dir, { recursive: true });
let n = 0;

createServer((sock) => {
  let data = false;
  let buf = "";
  let msg = "";
  const say = (s) => sock.write(s + "\r\n");
  say("220 mail-sink");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (data) {
        if (line === ".") {
          data = false;
          writeFileSync(join(dir, `${Date.now()}-${++n}.eml`), msg);
          msg = "";
          say("250 OK");
        } else msg += (line.startsWith("..") ? line.slice(1) : line) + "\n";
        continue;
      }
      const cmd = line.slice(0, 4).toUpperCase();
      if (cmd === "EHLO") sock.write("250-mail-sink\r\n250 AUTH PLAIN LOGIN\r\n");
      else if (cmd === "HELO") say("250 mail-sink");
      else if (cmd === "AUTH") say("235 OK");
      else if (cmd === "DATA") {
        data = true;
        say("354 go ahead");
      } else if (cmd === "QUIT") {
        say("221 bye");
        sock.end();
      }
      else say("250 OK");
    }
  });
  sock.on("error", () => {});
}).listen(2525, "127.0.0.1");

createHttp((req, res) => {
  try {
    res.end(readFileSync(new URL(req.url.replace(/^\/+/, ""), templates)));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(8899, "127.0.0.1");
