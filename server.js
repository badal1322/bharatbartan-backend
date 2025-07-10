require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const cors = require("cors");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// mongoose.connect("mongodb://localhost:27017/bharatbazaar", {
//   useNewUrlParser: true,
//   useUnifiedTopology: true
// });
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const User = mongoose.model("User", new mongoose.Schema({
  googleId: String,
  name: String,
  email: String,
  cart: [
    {
      productId: String,
      title: String,
      price: Number,
      quantity: Number
    }
  ],
  address: String
}));

const Order = mongoose.model("Order", new mongoose.Schema({
  razorpayPaymentId: String,
  razorpayOrderId: String,
  userEmail: String,
  productList: [String],
  totalAmount: Number,
  address: String,
  status: { type: String, default: "Processing" },
  createdAt: { type: Date, default: Date.now }
}));

app.use(session({ secret: "bharatbartan", resave: false, saveUninitialized: true }));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user.id);
});
passport.deserializeUser((id, done) => {
  User.findById(id).then(user => done(null, user));
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  let user = await User.findOne({ googleId: profile.id });
  if (!user) {
    user = await new User({
      googleId: profile.id,
      name: profile.displayName,
      email: profile.emails[0].value,
      cart: []
    }).save();
  }
  done(null, user);
}));

app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/auth/google/callback", passport.authenticate("google", {
  successRedirect: "/auth/success",
  failureRedirect: "/auth/failure"
}));
app.get("/auth/success", (req, res) => res.send("Login successful"));
app.get("/auth/failure", (req, res) => res.send("Login failed"));

app.post("/api/cart", async (req, res) => {
  const { googleId, productId, title, price } = req.body;
  const user = await User.findOne({ googleId });
  const existing = user.cart.find(item => item.productId === productId);
  if (existing) existing.quantity++;
  else user.cart.push({ productId, title, price, quantity: 1 });
  await user.save();
  res.send(user.cart);
});
app.get("/api/cart/:googleId", async (req, res) => {
  const user = await User.findOne({ googleId: req.params.googleId });
  res.send(user.cart);
});
app.post("/api/address", async (req, res) => {
  const { googleId, address } = req.body;
  const user = await User.findOne({ googleId });
  user.address = address;
  await user.save();
  res.send({ message: "Address updated" });
});
app.post("/api/order", async (req, res) => {
  const {
    razorpayPaymentId,
    razorpayOrderId,
    email,
    productList,
    totalAmount,
    address
  } = req.body;

  const newOrder = new Order({
    razorpayPaymentId,
    razorpayOrderId,
    userEmail: email,
    productList,
    totalAmount,
    address
  });

  await newOrder.save();
  res.send({ message: "Order saved successfully" });
});
app.get("/api/orders", async (req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 });
  res.json(orders);
});
app.put("/api/orders/:id/status", async (req, res) => {
  const { status } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ message: "Order not found" });
  order.status = status;
  await order.save();
  res.json({ message: "Status updated" });
});

const RAZORPAY_SECRET = process.env.RAZORPAY_SECRET;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});
app.post("/webhook/razorpay", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const body = req.body;

  const expectedSignature = crypto.createHmac("sha256", RAZORPAY_SECRET)
    .update(JSON.stringify(body))
    .digest("hex");

  if (signature === expectedSignature) {
    const paymentId = body.payload.payment.entity.id;
    const orderId = body.payload.payment.entity.order_id;

    const order = await Order.findOne({ razorpayPaymentId: paymentId });
    if (order) {
      order.status = "Paid";
      await order.save();

      const mailOptions = {
        from: process.env.GMAIL_USER,
        to: order.userEmail,
        subject: "BharatBartan - Order Confirmed",
        text: `Namaste! Your payment of ₹${order.totalAmount} was successful. Your order is confirmed.`
      };

      transporter.sendMail(mailOptions, (err, info) => {
        if (err) console.error("Email error:", err);
        else console.log("Email sent:", info.response);
      });
    }

    res.status(200).json({ status: "ok" });
  } else {
    res.status(400).json({ status: "invalid signature" });
  }
});

app.get("/", (req, res) => {
  res.send("BharatBartan backend is running 🎉");
});

app.listen(5000, () => {
  console.log("Server running on http://localhost:5000");
});