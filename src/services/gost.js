const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const { verifyPort } = require("./verify");

const PID_DIR = "/var/run/gost-slots";
const LOG_DIR = "/tmp/gost-slots";

function logPrefix(requestId) {
    return requestId ? `[gost][${requestId}]` : `[gost]`;
}

function summarizeText(text, maxLen = 400) {
    const normalized = String(text || "").trim();
    if (!normalized) return "";
    return normalized.length > maxLen
        ? `${normalized.slice(0, maxLen)}...(truncated)`
        : normalized;
}

function run(cmd, options = {}) {
    const { requestId, timeout } = options;
    const prefix = logPrefix(requestId);

    console.log(`${prefix} exec: ${cmd}`);

    return new Promise((resolve, reject) => {
        exec(cmd, { timeout }, (error, stdout, stderr) => {
            const stdoutText = summarizeText(stdout);
            const stderrText = summarizeText(stderr);

            if (stdoutText) {
                console.log(`${prefix} stdout: ${stdoutText}`);
            }
            if (stderrText) {
                console.warn(`${prefix} stderr: ${stderrText}`);
            }

            if (error) {
                const message = stderrText || stdoutText || error.message;
                console.error(`${prefix} exec failed: ${message}`);
                return reject(new Error(message));
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

async function ensureDirs(requestId) {
    console.log(`${logPrefix(requestId)} ensuring dirs pidDir=${PID_DIR} logDir=${LOG_DIR}`);
    await fs.mkdir(PID_DIR, { recursive: true });
    await fs.mkdir(LOG_DIR, { recursive: true });
}

async function stopPort(port, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);
    const pidFile = pidFileOf(port);

    console.log(`${prefix} stopping port=${port} pidFile=${pidFile}`);

    try {
        const pid = (await fs.readFile(pidFile, "utf8")).trim();
        console.log(`${prefix} existing pid from file=${pid || "<empty>"}`);
        if (pid) {
            await run(`kill ${shellQuote(pid)} 2>/dev/null || true`, { requestId });
            await run(`sleep 1`, { requestId });
        }
    } catch (err) {
        console.log(`${prefix} no readable pid file for port=${port}: ${err.message}`);
    }

    await run(`pkill -f ${shellQuote(`gost.*127.0.0.1:${port}`)} 2>/dev/null || true`, { requestId });
    await run(`rm -f ${shellQuote(pidFile)}`, { requestId });
    console.log(`${prefix} stop completed for port=${port}`);
}

function buildUpstream(proxy, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);

    if (!proxy) {
        console.log(`${prefix} buildUpstream: direct mode`);
        return null;
    }

    const protocol = escapeConfigValue(proxy.protocol || "socks5");
    const host = escapeConfigValue(proxy.host || "");
    const upstreamPort = Number(proxy.port);
    const username = escapeConfigValue(proxy.username || "");
    const password = escapeConfigValue(proxy.password || "");

    console.log(`${prefix} buildUpstream input=`, {
        protocol,
        host,
        port: upstreamPort,
        username,
        hasPassword: Boolean(password)
    });

    if (!host || !Number.isInteger(upstreamPort) || upstreamPort <= 0) {
        throw new Error("invalid proxy config");
    }

    const authPart =
        username || password
            ? `${username}:${password}@`
            : "";

    const upstream = `${protocol}://${authPart}${host}:${upstreamPort}`;
    const safeUpstream = `${protocol}://${username || password ? `${username}:***@` : ""}${host}:${upstreamPort}`;

    console.log(`${prefix} buildUpstream output=${safeUpstream}`);
    return upstream;
}

async function startPort(port, proxy, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);
    const pidFile = pidFileOf(port);
    const logFile = logFileOf(port);
    const upstream = buildUpstream(proxy, { requestId });

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
    console.log(`${prefix} starting port=${port} pidFile=${pidFile} logFile=${logFile}`);
    await run(cmd, { requestId });

    try {
        const pid = (await fs.readFile(pidFile, "utf8")).trim();
        console.log(`${prefix} started port=${port} pid=${pid || "<empty>"}`);
    } catch (err) {
        console.warn(`${prefix} started but failed to read pid file: ${err.message}`);
    }
}

async function readGostLogSnippet(port, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);
    const logFile = logFileOf(port);

    try {
        const content = await fs.readFile(logFile, "utf8");
        const snippet = summarizeText(content, 1200);
        if (snippet) {
            console.log(`${prefix} gost log snippet (${logFile}): ${snippet}`);
        } else {
            console.log(`${prefix} gost log is empty (${logFile})`);
        }
        return snippet;
    } catch (err) {
        console.warn(`${prefix} failed to read gost log ${logFile}: ${err.message}`);
        return "";
    }
}

async function switchPort(port, proxy, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);

    console.log(`${prefix} switchPort begin port=${port} mode=${proxy ? "proxy" : "direct"}`);
    ensurePort(port);
    await ensureDirs(requestId);

    await stopPort(port, { requestId });
    await startPort(port, proxy || null, { requestId });

    console.log(`${prefix} waiting 1500ms before verification`);
    await new Promise((r) => setTimeout(r, 1500));

    try {
        const ip = await verifyPort(port, { requestId });
        console.log(`${prefix} verification success ip=${ip}`);

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
                : null,
            logFile: logFileOf(port)
        };
    } catch (err) {
        const gostLog = await readGostLogSnippet(port, { requestId });
        const enrichedMessage = gostLog
            ? `${err.message} | gostLog=${gostLog}`
            : err.message;
        console.error(`${prefix} verification failed: ${enrichedMessage}`);
        throw new Error(enrichedMessage);
    }
}

module.exports = { switchPort, stopPort, startPort, logFileOf };
