const express = require("express");
const { switchPort } = require("../services/gost");

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { port } = req.body;

        if (!port) {
            return res.status(400).json({ ok: false, error: "port is required" });
        }

        const result = await switchPort(Number(port));
        res.json({ ok: true, result });
    } catch (err) {
        res.status(500).json({
            ok: false,
            error: err.message || "switch failed"
        });
    }
});

module.exports = router;