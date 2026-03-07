const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const { verifyPort } = require("./verify");

const PID_DIR = "/var/run/gost-slots";
const LOG_DIR = "/tmp/gost-slots";

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

function logFileOf(port) {
    return path.join(LOG_DIR, `gost-${port}.log`);
}

async function ensureDirs() {
    await fs.mkdir(PID_DIR, { recursive: true });
    await fs.mkdir(LOG_DIR, { recursive: true });
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

    await run(`pkill -f ${shellQuote(`gost.*127.0.0.1:${port}`)} 2>/dev/null || true`);
    await run(`rm -f ${shellQuote(pidFile)}`);
}

function buildUpstream(proxy) {
    if (!proxy) return null;

    const protocol = escapeConfigValue(proxy.protocol || "socks5");
    const host = escapeConfigValue(proxy.host || "");
    const upstreamPort = Number(proxy.port);
    const username = escapeConfigValue(proxy.username || "");
    const password = escapeConfigValue(proxy.password || "");

    if (!host || !Number.isInteger(upstreamPort) || upstreamPort <= 0) {
        throw new Error("invalid proxy config");
    }

    const authPart =
        username || password
            ? `${username}:${password}@`
            : "";

    return `${protocol}://${authPart}${host}:${upstreamPort}`;
}

async function startPort(port, proxy) {
    const pidFile = pidFileOf(port);
    const logFile = logFileOf(port);
    const upstream = buildUpstream(proxy);

    const parts = [
        "export GOST_LOGGER_LEVEL=error;",
        "nohup gost",
        `-L ${shellQuote(`socks5://127.0.0.1:${port}`)}`
    ];

    if (upstream) {
        parts.push(`-F ${shellQuote(upstream)}`);
    }

    parts.push(`>${shellQuote(logFile)} 2>&1 & echo $! > ${shellQuote(pidFile)}`);

    const cmd = parts.join(" ");
    await run(cmd);
}

async function switchPort(port, proxy) {
    ensurePort(port);
    await ensureDirs();

    await stopPort(port);
    await startPort(port, proxy || null);

    await new Promise((r) => setTimeout(r, 1500));

    const ip = await verifyPort(port);

    return {
        port,
        mode: proxy ? "proxy" : "direct",
        ip,
        upstream: proxy
            ? {
                protocol: proxy.protocol || "socks5",
                host: proxy.host,
                port: proxy.port,
                username: proxy.username || ""
            }
            : null
    };
}

module.exports = { switchPort, stopPort, startPort };