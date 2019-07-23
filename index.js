require("dotenv").config();
const express = require("express");
const path = require("path");
const cors = require("cors");
const bodyParser = require("body-parser");
const session = require("express-session");
const { ExpressOIDC } = require("@okta/oidc-middleware");
const app = express();
const PORT = 3000;

const Sequelize = require("sequelize");
const epilogue = require("epilogue"),
  ForbiddenError = epilogue.Errors.ForbiddenError;

// Session support required to use ExpressOIDC
// OIDC = "OpenID Connect"; An auth layer on top of OAuth2
app.use(
  session({
    secret: process.env.RANDOM_SECRET_WORD,
    resave: true,
    saveUninitialized: false
  })
);

// Create instance of ExpressOIDC - redirect User to Okta for auth
// With flow done, local session created and User context saved for session duration
const oidc = new ExpressOIDC({
  issuer: `${process.env.OKTA_ORG_URL}/oauth2/default`,
  client_id: process.env.OKTA_CLIENT_ID,
  client_secret: process.env.OKTA_CLIENT_SECRET,
  redirect_uri: process.env.REDIRECT_URL,
  appBaseUrl: `http://localhost:${PORT}`,
  scope: "openid profile",
  routes: {
    callback: {
      path: "/authorization-code/callback",
      defaultRedirect: "/admin"
    }
  }
});

// Let "ensureAuthenticated" and "isAuthenticated" work
// ExpressOIDC will attach handlers for the /login and /authorization-code/callback routes
// Redirect to Okta sign-in page by default
// Process the OIDC response, then attach User info to session
app.use(oidc.router);
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// // Routes // //
app.get("/home", (req, res) => {
  res.sendFile(path.join(__dirname, "./public/home.html"));
});

app.get("/admin", oidc.ensureAuthenticated(), (req, res) => {
  res.sendFile(path.join(__dirname, "./public/admin.html"));
});

app.get("/logout", (req, res) => {
  req.logout();
  res.redirect("/home");
});

app.get("/", (req, res) => {
  res.redirect("/home");
});

// // Database // //
// Set up connection with SQLite, store data
const database = new Sequelize({
  dialect: "sqlite",
  storage: "./db.sqlite",
  operatorsAliases: false
});

// Define Post model
const Post = database.define("posts", {
  title: Sequelize.STRING,
  content: Sequelize.TEXT
});

// Initialize Epilogue with our Express.js app and our db
epilogue.initialize({ app, sequelize: database });

// Creates REST resource
const PostResource = epilogue.resource({
  model: Post,
  endpoints: ["/posts", "/posts/:id"]
});

// Adds an auth check to all CRUD routes to protect endpoints
PostResource.all.auth(function(req, res, context) {
  return new Promise(function(resolve, reject) {
    if (!req.isAuthenticated()) {
      res.status(401).send({ message: "Unauthorized" });
      resolve(context.stop);
    } else {
      resolve(context.continue);
    }
  });
});

database.sync().then(() => {
  // // Server Startup // //
  oidc.on("ready", () => {
    app.listen(PORT, () => {
      console.log(`My Blog App listening at http://localhost:${PORT}!`);
    });
  });
});

oidc.on("error", err => {
  console.log("Unable to config ExpressOIDC", err);
});
