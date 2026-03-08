const { exec } = require("child_process");

function logPrefix(requestId) {
    return requestId ? `[verify][${requestId}]` : `[verify]`;
}

function summarizeText(text, maxLen = 400) {
    const normalized = String(text || "").trim();
    if (!normalized) return "";
    return normalized.length > maxLen
        ? `${normalized.slice(0, maxLen)}...(truncated)`
        : normalized;
}

function verifyPort(port, options = {}) {
    const { requestId } = options;
    const prefix = logPrefix(requestId);

    return new Promise((resolve, reject) => {
        const cmd = `curl --socks5-hostname 127.0.0.1:${port} https://api.ipify.org`;

        exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
            const stdoutText = summarizeText(stdout);
            const stderrText = summarizeText(stderr);

            if (error) {
                const message = stderrText || stdoutText || error.message;
                return reject(new Error(message));
            }

            const ip = (stdout || "").trim();
            resolve(ip);
        });
    });
}

module.exports = { verifyPort };
