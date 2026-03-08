const express = require("express");
const dotenv = require("dotenv");
const switchRouter = require("./routes/switch");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());


app.get("/health", (req, res) => {
    res.json({ ok: true });
});

app.use("/switch", switchRouter);

app.listen(port, () => {
    console.log(`proxy-switcher listening on ${port}`);
});