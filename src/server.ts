import http from "http";
import dotenv from "dotenv";
import express from "express";
import router from "./routes/router_api";
import bodyParser from "body-parser";
import cors from "cors";
import rateLimit from "express-rate-limit";
dotenv.config();
 
const port = Number(process.env.PORT) ;
const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);


app.use(express.json());

app.use(bodyParser.text()); //parse body to text
app.use(bodyParser.json()); //parse body to json

app.use('/', router);

const server = http.createServer(app);
server.listen(port, "0.0.0.0", () => {
  console.log(`Server is started on http://localhost:${port}`);
},).on("error", (error) => {
  console.error(error);
}); 

 