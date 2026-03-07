const express = require("express");
const { switchPort } = require("../services/gost");

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { slot, proxy } = req.body;

        if (slot === undefined || slot === null || slot === "") {
            return res.status(400).json({ ok: false, error: "slot is required" });
        }

        const slotNum = Number(slot);

        if (!Number.isInteger(slotNum)) {
            return res.status(400).json({ ok: false, error: "slot must be an integer" });
        }

        if (slotNum < 1 || slotNum > 30) {
            return res.status(400).json({ ok: false, error: "slot out of range" });
        }

        if (proxy != null) {
            if (!proxy.host || !proxy.port) {
                return res.status(400).json({
                    ok: false,
                    error: "proxy.host and proxy.port are required when proxy is provided"
                });
            }
        }

        const port = 20000 + slotNum;
        const result = await switchPort(port, proxy || null);

        res.json({
            ok: true,
            action: proxy ? "set-proxy" : "set-direct",
            result,
            slot: slotNum,
            port
        });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err.message || "switch failed"
        });
    }
});

module.exports = router;