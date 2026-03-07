const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const { verifyPort } = require("./verify");

const PID_DIR = "/var/run/gost-slots";

function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error((stderr || error.message).trim()));
            }
            resolve((stdout || "").trim());
        });
    });
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function ensurePort(port) {
    if (!Number.isInteger(port)) {
        throw new Error("port must be an integer");
    }

    if (port < 20001 || port > 20030) {
        throw new Error("port out of allowed range");
    }
}

function escapeConfigValue(value) {
    return String(value).replace(/\n/g, "").trim();
}

function pidFileOf(port) {
    return path.join(PID_DIR, `gost-${port}.pid`);
}

async function ensurePidDir() {
    await fs.mkdir(PID_DIR, { recursive: true });
}

async function stopPort(port) {
    const pidFile = pidFileOf(port);

    try {
        const pid = (await fs.readFile(pidFile, "utf8")).trim();
        if (pid) {
            await run(`kill ${shellQuote(pid)} 2>/dev/null || true`);
            await run(`sleep 1`);
        }
    } catch (_) {
        // ignore missing pid file
    }

    await run(`pkill -f ${shellQuote(`127.0.0.1:${port}`)} 2>/dev/null || true`);
    await run(`rm -f ${shellQuote(pidFile)}`);
}

async function startPort(port, proxy) {
    const protocol = escapeConfigValue(proxy.protocol || "socks5");
    const host = escapeConfigValue(proxy.host || "");
    const upstreamPort = Number(proxy.port);
    const username = escapeConfigValue(proxy.username || "");
    const password = escapeConfigValue(proxy.password || "");

    if (!host || !Number.isInteger(upstreamPort) || upstreamPort <= 0) {
        throw new Error("invalid proxy config");
    }

    const pidFile = pidFileOf(port);

    const authPart =
        username || password
            ? `${username}:${password}@`
            : "";

    const upstream = `${protocol}://${authPart}${host}:${upstreamPort}`;

    const cmd = [
        "nohup gost",
        `-L ${shellQuote(`socks5://127.0.0.1:${port}`)}`,
        `-F ${shellQuote(upstream)}`,
        `>/dev/null 2>&1 & echo $! > ${shellQuote(pidFile)}`
    ].join(" ");

    await run(cmd);
}

async function switchPort(port, proxy) {
    ensurePort(port);
    await ensurePidDir();

    await stopPort(port);
    await startPort(port, proxy);

    await new Promise((r) => setTimeout(r, 1500));

    const ip = await verifyPort(port);

    return {
        port,
        ip,
        upstream: {
            protocol: proxy.protocol || "socks5",
            host: proxy.host,
            port: proxy.port,
            username: proxy.username || ""
        }
    };
}

module.exports = { switchPort };