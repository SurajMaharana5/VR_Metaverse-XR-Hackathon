const express = require("express");
const app = express();
const mongoose = require("mongoose");
const MONGO_URL = "mongodb://127.0.0.1:27017/Indian_legacy_XR";
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const wrapAsync = require("./utils/wrapAsync.js");
const ExpressError = require("./utils/ExpressError.js");
const Post = require("./models/posts");
const User = require("./models/user");
const session = require("express-session");
const State = require("./models/state");
const Festival = require("./models/festival");

// Middleware to check if user is logged in
const isLoggedIn = (req, res, next) => {
  if (!req.session.user_id) {
    return res.redirect("/login");
  }
  next();
};

// Middleware to check if user is the author
const isAuthor = async (req, res, next) => {
  const { id } = req.params;
  const post = await Post.findById(id);
  if (!post) {
    return next(new ExpressError(404, "Post not found"));
  }
  if (!post.author.equals(req.session.user_id)) {
    return res.redirect("/blog");
  }
  next();
};

// Middleware setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.engine("ejs", ejsMate);
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 1 week
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

//! Add user info to all templates
app.use(async (req, res, next) => {
  res.locals.currentUser = await User.findById(req.session.user_id);
  next();
});

//! Global authentication middleware
app.use((req, res, next) => {
  const publicPaths = ["/login", "/register"];
  if (publicPaths.includes(req.path) || req.session.user_id) {
    next();
  } else {
    res.redirect("/login");
  }
});

// Database connection
async function main() {
  await mongoose.connect(MONGO_URL);
}

main()
  .then(() => console.log("Connected to database"))
  .catch((err) => console.log("Error connecting to database:", err));

// Routes
app.get("/", (req, res) => {
  res.render("pages/index.ejs");
});

app.get("/map-nav", (req, res) => {
  res.render("pages/map.ejs");
});

// Add new blog route
app.get(
  "/blog",
  wrapAsync(async (req, res) => {
    const posts = await Post.find({})
      .populate("author")
      .sort({ createdAt: -1 });
    res.render("pages/blog.ejs", { posts });
  })
);

// Blog routes
app.get(
  "/blog/new",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    res.render("pages/edit.ejs", { post: null });
  })
);

app.post(
  "/blog",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    if (!req.body.post) {
      throw new ExpressError(400, "Invalid post data");
    }
    const { title, content } = req.body.post;
    if (!title || !content) {
      throw new ExpressError(400, "Title and content are required");
    }
    const post = new Post({
      ...req.body.post,
      author: req.session.user_id,
    });
    await post.save();
    res.redirect(`/blog/${post._id}`);
  })
);

app.get(
  "/blog/:id",
  wrapAsync(async (req, res) => {
    const post = await Post.findById(req.params.id).populate("author");
    if (!post) {
      throw new ExpressError(404, "Post not found");
    }
    res.render("pages/show.ejs", { post });
  })
);

// Update - Show edit form & Handle update
app.get(
  "/blog/:id/edit",
  isLoggedIn,
  isAuthor,
  wrapAsync(async (req, res) => {
    const post = await Post.findById(req.params.id);
    if (!post) {
      throw new ExpressError(404, "Post not found");
    }
    res.render("pages/edit.ejs", { post });
  })
);

app.put(
  "/blog/:id",
  isLoggedIn,
  isAuthor,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    if (!req.body.post) {
      throw new ExpressError(400, "Invalid post data");
    }
    const { title, content } = req.body.post;
    if (!title || !content) {
      throw new ExpressError(400, "Title and content are required");
    }
    await Post.findByIdAndUpdate(id, req.body.post);
    res.redirect(`/blog/${id}`);
  })
);

// Delete
app.delete(
  "/blog/:id",
  isLoggedIn,
  isAuthor,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    await Post.findByIdAndDelete(id);
    res.redirect("/blog");
  })
);

// Login routes
app.get("/login", (req, res) => {
  if (req.session.user_id) {
    return res.redirect("/");
  }
  res.render("pages/login.ejs");
});

app.post(
  "/login",
  wrapAsync(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      throw new ExpressError(400, "Username and password are required");
    }
    const user = await User.findOne({ username });
    if (!user) {
      throw new ExpressError(401, "Invalid username or password");
    }
    if (user.password !== password) {
      throw new ExpressError(401, "Invalid username or password");
    }
    req.session.user_id = user._id;
    res.redirect("/");
  })
);

// Register routes
app.get("/register", (req, res) => {
  res.render("pages/register.ejs");
});

app.post(
  "/register",
  wrapAsync(async (req, res) => {
    const { username, password, confirmPassword } = req.body;
    if (!username || !password || !confirmPassword) {
      throw new ExpressError(400, "All fields are required");
    }
    if (password.length < 6) {
      throw new ExpressError(400, "Password must be at least 6 characters");
    }
    if (password !== confirmPassword) {
      throw new ExpressError(400, "Passwords do not match");
    }
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      throw new ExpressError(400, "Username already exists");
    }
    const user = new User({ username, password });
    await user.save();
    req.session.user_id = user._id;
    res.redirect("/");
  })
);

// Logout route
app.get("/logout", (req, res, next) => {
  try {
    req.session.destroy();
    res.redirect("/login");
  } catch (err) {
    next(err);
  }
});

// Festival Calendar route
app.get("/festivals", async (req, res, next) => {
  try {
    const festivals = await Festival.find({ year: 2025 });

    // Define month order for sorting
    const monthOrder = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    // Group festivals by month
    const festivalsByMonth = festivals.reduce((acc, festival) => {
      const month = festival.month;
      if (!acc[month]) {
        acc[month] = {
          month: month,
          festivals: [],
          sortOrder: monthOrder.indexOf(month),
        };
      }
      acc[month].festivals.push({
        name: festival.name,
        date: festival.date,
        region: festival.region,
      });
      return acc;
    }, {});

    // Convert to array and sort by month order
    const sortedFestivals = Object.values(festivalsByMonth).sort(
      (a, b) => a.sortOrder - b.sortOrder
    );

    res.render("pages/festivals.ejs", {
      festivals: sortedFestivals,
    });
  } catch (err) {
    next(err);
  }
});

// Update Maharashtra route
app.get("/states/maharashtra", async (req, res) => {
  try {
    const maharashtra = await State.findOne({ stateId: "INMH" });
    if (!maharashtra) {
      throw new ExpressError(404, "State data not found");
    }
    res.render("pages/maharashtra.ejs", { state: maharashtra });
  } catch (err) {
    next(err);
  }
});

// Add this route to handle other state routes
app.get("/states/:state", (req, res, next) => {
  const state = req.params.state;
  if (state !== "maharashtra") {
    throw new ExpressError(
      404,
      `Information about ${state} will be available soon. For now, you can explore Maharashtra state.`
    );
  }
  next();
});

// Add Maharashtra festival calendar route
app.get("/states/maharashtra/calendar", async (req, res, next) => {
  try {
    const festivals = await Festival.find({
      year: 2025,
      $or: [{ region: "Maharashtra" }, { region: "Pan India" }],
    }).sort({ month: 1, date: 1 });

    const monthOrder = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const festivalsByMonth = festivals.reduce((acc, festival) => {
      const month = festival.month;
      if (!acc[month]) {
        acc[month] = {
          month: month,
          festivals: [],
          sortOrder: monthOrder.indexOf(month),
        };
      }
      acc[month].festivals.push(festival);
      return acc;
    }, {});

    const sortedFestivals = Object.values(festivalsByMonth).sort(
      (a, b) => a.sortOrder - b.sortOrder
    );

    res.render("pages/maharashtra-calendar.ejs", {
      festivals: sortedFestivals,
    });
  } catch (err) {
    next(err);
  }
});

// Add this route after other routes
app.get("/states/maharashtra/heritage", (req, res) => {
  res.render("pages/heritage.ejs");
});

// Add these routes after the heritage route
app.get("/states/maharashtra/heritage/rajgad", (req, res) => {
  res.render("pages/rajgad-3d.ejs");
});

app.get("/states/maharashtra/heritage/daulatabad", (req, res) => {
  res.render("pages/daulatabad-3d.ejs");
});

// Add cuisine routes
app.get("/states/maharashtra/cuisine", (req, res) => {
  res.render("pages/cuisine.ejs");
});

app.get("/states/maharashtra/cuisine/thali", (req, res) => {
  res.render("pages/thali-3d.ejs");
});

app.get("/states/maharashtra/cuisine/vada-pav", (req, res) => {
  res.render("pages/vada-pav-3d.ejs");
});

// Error handling middleware
app.all("*", (req, res, next) => {
  next(new ExpressError(404, "Page Not Found!"));
});

app.use((err, req, res, next) => {
  const { statusCode = 500, message = "Something went wrong!" } = err;
  console.error(err);
  if (err.name === "ValidationError") {
    return res.status(400).render("error.ejs", {
      message: "Validation Error: " + err.message,
      redirectLink: "/states/maharashtra",
      redirectText: "Explore Maharashtra",
    });
  }

  if (err.name === "CastError") {
    return res.status(400).render("error.ejs", {
      message: "Invalid ID format",
      redirectLink: "/states/maharashtra",
      redirectText: "Explore Maharashtra",
    });
  }

  res.status(statusCode).render("error.ejs", {
    message,
    redirectLink: "/states/maharashtra",
    redirectText: "Explore Maharashtra",
  });
});

app.listen("8080", (req, res) => {
  console.log("connected");
});
