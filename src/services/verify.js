const { exec } = require("child_process");

function verifyPort(port) {
    return new Promise((resolve, reject) => {
        const cmd = `curl --socks5-hostname 127.0.0.1:${port} https://api.ipify.org`;

        exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(stderr || error.message));
            }
            resolve(stdout.trim());
        });
    });
}

module.exports = { verifyPort };