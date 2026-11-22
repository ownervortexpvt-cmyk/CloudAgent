// Minimal SMTP sink for testing — speaks just enough SMTP for nodemailer,
// captures every message to /tmp/smtp-sink/<n>.eml. No dependencies.
const net = require("net");
const fs = require("fs");
const DIR = "/tmp/smtp-sink";
fs.mkdirSync(DIR, { recursive: true });
let count = 0;

const server = net.createServer((socket) => {
  let inData = false;
  let buf = "";
  const write = (s) => socket.write(s + "\r\n");
  write("220 sink.vortex.internal ESMTP sink ready");
  socket.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\r\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          count += 1;
          fs.writeFileSync(`${DIR}/${count}.eml`, current);
          console.log(`CAPTURED message #${count} (${current.length} bytes)`);
          current = "";
          write("250 OK stored");
        } else {
          current += line + "\n";
        }
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
        // multi-line EHLO response, no auth advertised (nodemailer will use NONE)
        socket.write("250-sink.vortex.internal\r\n");
        socket.write("250-SIZE 10485760\r\n");
        write("250 OK");
      } else if (cmd.startsWith("MAIL FROM")) write("250 OK");
      else if (cmd.startsWith("RCPT TO")) write("250 OK");
      else if (cmd.startsWith("DATA")) { inData = true; write("354 go ahead"); }
      else if (cmd.startsWith("QUIT")) { write("221 bye"); socket.end(); }
      else if (cmd.startsWith("RSET")) write("250 OK");
      else if (cmd.startsWith("NOOP")) write("250 OK");
      else write("250 OK");
    }
  });
  socket.on("error", () => {});
});
let current = "";
server.listen(8025, "127.0.0.1", () => console.log("SMTP sink on 127.0.0.1:8025"));
