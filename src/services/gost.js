const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");

const PID_DIR = "/var/run/gost-slots";
const LOG_DIR = "/tmp/gost-slots";
const STATE_DIR = "/var/run/gost-slots";

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

function stateFileOf(port) {
    return path.join(STATE_DIR, `gost-${port}.json`);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForExit(pid, timeoutMs = 3000, intervalMs = 200) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) {
            return true;
        }
        await sleep(intervalMs);
    }
    return !isProcessAlive(pid);
}

function normalizeProxy(proxy) {
    if (!proxy) return null;

    const protocol = escapeConfigValue(proxy.protocol || "socks5");
    const host = escapeConfigValue(proxy.host || "");
    const port = Number(proxy.port);
    const username = escapeConfigValue(proxy.username || "");
    const password = escapeConfigValue(proxy.password || "");

    if (!host || !Number.isInteger(port) || port <= 0) {
        throw new Error("invalid proxy config");
    }

    return { protocol, host, port, username, password };
}

function getDesiredState(port, proxy) {
    const normalizedProxy = normalizeProxy(proxy);
    return {
        port,
        mode: normalizedProxy ? "proxy" : "direct",
        proxy: normalizedProxy,
    };
}

function maskProxy(proxy) {
    if (!proxy) return null;
    return {
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        hasPassword: Boolean(proxy.password),
    };
}

function sameState(a, b) {
    if (!a || !b) return false;
    if (a.port !== b.port || a.mode !== b.mode) return false;
    if (a.mode === "direct") return true;

    return (
        a.proxy?.protocol === b.proxy?.protocol &&
        a.proxy?.host === b.proxy?.host &&
        Number(a.proxy?.port) === Number(b.proxy?.port) &&
        (a.proxy?.username || "") === (b.proxy?.username || "") &&
        (a.proxy?.password || "") === (b.proxy?.password || "")
    );
}

async function readState(port) {
    try {
        const raw = await fs.readFile(stateFileOf(port), "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function writeState(port, state) {
    const payload = {
        ...state,
        updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(stateFileOf(port), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function removeState(port) {
    await fs.rm(stateFileOf(port), { force: true });
}

async function ensureDirs(requestId) {
    await fs.mkdir(PID_DIR, { recursive: true });
    await fs.mkdir(LOG_DIR, { recursive: true });
}

async function readPidFromFile(port, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);
    const pidFile = pidFileOf(port);

    try {
        const raw = (await fs.readFile(pidFile, "utf8")).trim();
        if (!/^\d+$/.test(raw)) {
            return null;
        }
        return Number(raw);
    } catch (err) {
        return null;
    }
}

async function findGostPidsByPort(port, options = {}) {
    const output = await run(
        `ps -eo pid=,args= | awk '/[g]ost/ && /127\\.0\\.0\\.1:${port}/ {print $1}'`,
        { requestId: options.requestId }
    ).catch(() => "");

    return String(output || "")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => /^\d+$/.test(item))
        .map(Number);
}

async function stopPort(port, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);
    const pidFile = pidFileOf(port);
    const handled = new Set();

    const pidFromFile = await readPidFromFile(port, { requestId });
    const candidatePids = [];

    if (pidFromFile) {
        candidatePids.push(pidFromFile);
    }

    const fallbackPids = await findGostPidsByPort(port, { requestId });
    for (const pid of fallbackPids) {
        if (!candidatePids.includes(pid)) {
            candidatePids.push(pid);
        }
    }

    for (const pid of candidatePids) {
        if (handled.has(pid)) continue;
        handled.add(pid);

        if (!isProcessAlive(pid)) {
            continue;
        }

        try {
            process.kill(pid, "SIGTERM");
        } catch (err) {
            continue;
        }

        const exited = await waitForExit(pid, 3000, 200);
        if (!exited && isProcessAlive(pid)) {
            try {
                process.kill(pid, "SIGKILL");
            } catch (err) {
            }
            await waitForExit(pid, 1500, 100);
        }

        if (isProcessAlive(pid)) {
            throw new Error(`failed to stop gost process pid=${pid} on port ${port}`);
        }
    }

    await fs.rm(pidFile, { force: true });
}

function buildUpstream(proxy) {
    if (!proxy) return null;

    const authPart =
        proxy.username || proxy.password
            ? `${proxy.username}:${proxy.password}@`
            : "";

    return `${proxy.protocol}://${authPart}${proxy.host}:${proxy.port}`;
}

async function startPort(port, proxy, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);
    const pidFile = pidFileOf(port);
    const logFile = logFileOf(port);
    const normalizedProxy = normalizeProxy(proxy);
    const upstream = buildUpstream(normalizedProxy);

    const existingPids = await findGostPidsByPort(port, { requestId });
    if (existingPids.length) {
        throw new Error(`port ${port} still has running gost pid(s): ${existingPids.join(",")}`);
    }

    const parts = [
        "export GOST_LOGGER_LEVEL=error;",
        "nohup gost",
        `-L ${shellQuote(`socks5://127.0.0.1:${port}`)}`,
    ];

    if (upstream) {
        parts.push(`-F ${shellQuote(upstream)}`);
    }

    parts.push(`>${shellQuote(logFile)} 2>&1 & echo $! > ${shellQuote(pidFile)}`);

    const cmd = parts.join(" ");
    await run(cmd, { requestId });

    await sleep(300);
    const pid = await readPidFromFile(port, { requestId });
    if (!pid) {
        throw new Error(`failed to read pid after start for port ${port}`);
    }

    if (!isProcessAlive(pid)) {
        throw new Error(`gost exited immediately after start pid=${pid} port=${port}`);
    }

    return pid;
}

async function switchPort(port, proxy, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);

    ensurePort(port);
    await ensureDirs(requestId);

    const desiredState = getDesiredState(port, proxy);
    const currentState = await readState(port);
    const currentPid = await readPidFromFile(port, { requestId });
    const currentAlive = Boolean(currentPid && isProcessAlive(currentPid));

    if (sameState(currentState, desiredState) && currentAlive) {
        return {
            port,
            mode: desiredState.mode,
            upstream: desiredState.proxy
                ? {
                    protocol: desiredState.proxy.protocol,
                    host: desiredState.proxy.host,
                    port: desiredState.proxy.port,
                    username: desiredState.proxy.username || "",
                }
                : null,
            logFile: logFileOf(port),
            reused: true,
        };
    }

    await stopPort(port, { requestId });
    await startPort(port, desiredState.proxy, { requestId });
    await writeState(port, desiredState);

    return {
        port,
        mode: desiredState.mode,
        upstream: desiredState.proxy
            ? {
                protocol: desiredState.proxy.protocol,
                host: desiredState.proxy.host,
                port: desiredState.proxy.port,
                username: desiredState.proxy.username || "",
            }
            : null,
        logFile: logFileOf(port),
        reused: false,
    };
}

module.exports = { switchPort, stopPort, startPort, logFileOf, stateFileOf };
