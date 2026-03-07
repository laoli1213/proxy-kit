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

        if (Number.isNaN(slotNum)) {
            return res.status(400).json({ ok: false, error: "slot must be a number" });
        }

        if (!proxy || !proxy.host || !proxy.port) {
            return res.status(400).json({ ok: false, error: "proxy.host and proxy.port are required" });
        }

        const port = 20000 + slotNum;

        const result = await switchPort(port, proxy);
        res.json({ ok: true, result, slot: slotNum, port });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err.message || "switch failed"
        });
    }
});

module.exports = router;