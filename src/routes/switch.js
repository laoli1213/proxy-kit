const express = require("express");
const { switchPort } = require("../services/gost");

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { port, proxy } = req.body;

        if (!port) {
            return res.status(400).json({ ok: false, error: "port is required" });
        }

        if (!proxy || !proxy.host || !proxy.port) {
            return res.status(400).json({ ok: false, error: "proxy.host and proxy.port are required" });
        }

        const result = await switchPort(Number(port), proxy);
        res.json({ ok: true, result });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err.message || "switch failed"
        });
    }
});

module.exports = router;