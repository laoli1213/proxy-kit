const express = require("express");
const { switchPort } = require("../services/gost");

const router = express.Router();

function makeRequestId() {
    return `sw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

router.post("/", async (req, res) => {
    const requestId = makeRequestId();
    const startedAt = Date.now();

    try {
        const { slot, proxy } = req.body || {};

        console.log(`[switch][${requestId}] incoming request body=`, req.body || {});

        if (slot === undefined || slot === null || slot === "") {
            console.warn(`[switch][${requestId}] rejected: slot is required`);
            return res.status(400).json({ ok: false, error: "slot is required", requestId });
        }

        const slotNum = Number(slot);
        console.log(`[switch][${requestId}] parsed slot=${slotNum} rawSlot=${JSON.stringify(slot)}`);

        if (!Number.isInteger(slotNum)) {
            console.warn(`[switch][${requestId}] rejected: slot must be an integer`);
            return res.status(400).json({ ok: false, error: "slot must be an integer", requestId });
        }

        if (proxy != null) {
            console.log(`[switch][${requestId}] proxy summary=`, {
                protocol: proxy.protocol || "socks5",
                host: proxy.host,
                port: proxy.port,
                username: proxy.username || "",
                hasPassword: Boolean(proxy.password),
                timezone: proxy.timezone,
                loc: proxy.loc,
                altitude: proxy.altitude
            });

            if (!proxy.host || !proxy.port) {
                console.warn(`[switch][${requestId}] rejected: proxy.host and proxy.port are required`);
                return res.status(400).json({
                    ok: false,
                    error: "proxy.host and proxy.port are required when proxy is provided",
                    requestId
                });
            }
        } else {
            console.log(`[switch][${requestId}] proxy is null, switching to direct mode`);
        }

        const port = 20000 + slotNum;
        console.log(`[switch][${requestId}] mapped slot=${slotNum} -> port=${port}`);

        const result = await switchPort(port, proxy || null, { requestId });
        const durationMs = Date.now() - startedAt;

        console.log(`[switch][${requestId}] success in ${durationMs}ms result=`, result);

        res.json({
            ok: true,
            action: proxy ? "set-proxy" : "set-direct",
            result,
            slot: slotNum,
            port,
            requestId,
            durationMs
        });
    } catch (err) {
        const durationMs = Date.now() - startedAt;
        console.error(`[switch][${requestId}] failed in ${durationMs}ms:`, err);
        res.status(500).json({
            ok: false,
            error: err.message || "switch failed",
            requestId,
            durationMs,
            stack: process.env.NODE_ENV === "production" ? undefined : err.stack
        });
    }
});

module.exports = router;
