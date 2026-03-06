const { exec } = require("child_process");
const { verifyPort } = require("./verify");

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(stderr || error.message));
            }
            resolve(stdout.trim());
        });
    });
}

function escapeShell(value) {
    return String(value).replace(/"/g, '\\"');
}

async function switchPort(port, proxy) {
    if (!Number.isInteger(port)) {
        throw new Error("port must be an integer");
    }

    if (port < 20001 || port > 20030) {
        throw new Error("port out of allowed range");
    }

    const protocol = proxy.protocol || "socks5";
    const host = proxy.host;
    const upstreamPort = proxy.port;
    const username = proxy.username || "";
    const password = proxy.password || "";

    if (!host || !upstreamPort) {
        throw new Error("invalid proxy config");
    }

    const authPart =
        username || password
            ? `${escapeShell(username)}:${escapeShell(password)}@`
            : "";

    await run(`pkill -f '127.0.0.1:${port}' || true`);

    const startCmd = [
        "nohup gost",
        `-L "socks5://127.0.0.1:${port}"`,
        `-F "${escapeShell(protocol)}://${authPart}${escapeShell(host)}:${escapeShell(upstreamPort)}"`,
        ">/dev/null 2>&1 &"
    ].join(" ");

    await run(startCmd);
    await new Promise((r) => setTimeout(r, 1500));

    const ip = await verifyPort(port);

    return {
        port,
        ip,
        upstream: {
            protocol,
            host,
            port: upstreamPort,
            username
        }
    };
}

module.exports = { switchPort };