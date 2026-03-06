const { exec } = require("child_process");
const { fetchSocksFromProvider } = require("./provider");
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

async function switchPort(port) {
    if (port < 20001 || port > 20030) {
        throw new Error("port out of allowed range");
    }

    const proxy = await fetchSocksFromProvider();

    const killCmd = `pkill -f '127.0.0.1:${port}' || true`;
    await run(killCmd);

    const startCmd = [
        "nohup gost",
        `-L "socks5://127.0.0.1:${port}"`,
        `-F "${proxy.protocol}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}"`,
        ">/dev/null 2>&1 &"
    ].join(" ");

    await run(startCmd);

    await new Promise((r) => setTimeout(r, 1500));

    const ip = await verifyPort(port);

    return {
        port,
        upstream: `${proxy.host}:${proxy.port}`,
        ip
    };
}

module.exports = { switchPort };