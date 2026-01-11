import http from "http";
import dotenv from "dotenv";
import express from "express";
import router from "./routes/router_api";
import bodyParser from "body-parser";
import cors from "cors";
import os from  "os"; 
import rateLimit from "express-rate-limit";
dotenv.config();
 
const port = Number(process.env.PORT) || 3000;
const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  })
);

app.use(express.json());

app.use(bodyParser.text()); //parse body to text
app.use(bodyParser.json()); //parse body to json

app.use('/', router);

var ip = "0.0.0.0";
const nets = os.networkInterfaces();

if (nets) {
  Object.keys(nets).forEach((_interface) => {
    const netInfo = nets[_interface];
    if (netInfo) {
      netInfo.forEach((_dev) => {
        if (_dev.family === "IPv4" && !_dev.internal) {
          ip = _dev.address;
        }
      });
    }
  });
}

const server = http.createServer(app);

server.listen(port, "0.0.0.0", () => {
  console.log(`Server is started on http://${ip}:${port}`);
},).on("error", (error) => {
  console.error(error);
}); 

 