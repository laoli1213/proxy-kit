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

        if (slot === undefined || slot === null || slot === "") {
            return res.status(400).json({ ok: false, error: "slot is required", requestId });
        }

        const slotNum = Number(slot);

        if (!Number.isInteger(slotNum)) {
            return res.status(400).json({ ok: false, error: "slot must be an integer", requestId });
        }

        if (proxy != null) {
            if (!proxy.host || !proxy.port) {
                return res.status(400).json({
                    ok: false,
                    error: "proxy.host and proxy.port are required when proxy is provided",
                    requestId
                });
            }
        }

        const port = 20000 + slotNum;

        const result = await switchPort(port, proxy || null, { requestId });
        const durationMs = Date.now() - startedAt;

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
