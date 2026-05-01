require("dotenv").config();

const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const { createLocalModels, DATA_PATH } = require("./local-db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-before-deployment";
const MONGODB_URI = process.env.MONGODB_URI;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const IS_VERCEL = Boolean(process.env.VERCEL);
const DATABASE_MODE = MONGODB_URI ? "mongodb" : "local-json";
let databaseConnection;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["Admin", "Member"], default: "Member" }
  },
  { timestamps: true }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2 },
    description: { type: String, trim: true, default: "" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  { timestamps: true }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, minlength: 2 },
    description: { type: String, trim: true, default: "" },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["Todo", "In Progress", "Done"],
      default: "Todo"
    },
    priority: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium"
    },
    dueDate: { type: Date, required: true }
  },
  { timestamps: true }
);

let User = mongoose.model("User", userSchema);
let Project = mongoose.model("Project", projectSchema);
let Task = mongoose.model("Task", taskSchema);

if (!MONGODB_URI && !IS_PRODUCTION) {
  ({ User, Project, Task } = createLocalModels());
}

async function connectDatabase() {
  if (MONGODB_URI) {
    if (mongoose.connection.readyState === 1) return;
    databaseConnection = databaseConnection || mongoose.connect(MONGODB_URI);
    await databaseConnection;
    return;
  }

  if (IS_PRODUCTION) {
    throw new Error("MONGODB_URI is required in production. Add it to deployment environment variables.");
  }
}

app.use(
  asyncRoute(async (req, res, next) => {
    if (req.path.startsWith("/api")) await connectDatabase();
    next();
  })
);

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

function issueToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !body[field] || String(body[field]).trim() === "");
  if (missing.length) {
    const error = new Error(`Missing required field(s): ${missing.join(", ")}`);
    error.status = 400;
    throw error;
  }
}

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Authentication required." });

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ message: "User no longer exists." });

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "Admin") {
    return res.status(403).json({ message: "Admin access required." });
  }
  next();
}

async function visibleProjectFilter(user) {
  if (user.role === "Admin") return {};
  return { members: user._id };
}

async function ensureProjectVisible(projectId, user) {
  if (!isValidObjectId(projectId)) {
    const error = new Error("Invalid project id.");
    error.status = 400;
    throw error;
  }

  const project = await Project.findOne({ _id: projectId, ...(await visibleProjectFilter(user)) });
  if (!project) {
    const error = new Error("Project not found or not accessible.");
    error.status = 404;
    throw error;
  }
  return project;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database: DATABASE_MODE === "mongodb" ? (mongoose.connection.readyState === 1 ? "connected" : "disconnected") : "local-json"
  });
});

app.post(
  "/api/auth/signup",
  asyncRoute(async (req, res) => {
    requireFields(req.body, ["name", "email", "password"]);

    const { name, email, password } = req.body;
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const existing = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (existing) return res.status(409).json({ message: "Email is already registered." });

    let role = req.body.role === "Admin" ? "Admin" : "Member";
    if (role === "Admin" && process.env.ADMIN_INVITE_CODE) {
      if (req.body.inviteCode !== process.env.ADMIN_INVITE_CODE) {
        return res.status(403).json({ message: "Invalid admin invite code." });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash, role });

    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  })
);

app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    requireFields(req.body, ["email", "password"]);

    const user = await User.findOne({ email: String(req.body.email).toLowerCase().trim() });
    if (!user) return res.status(401).json({ message: "Invalid email or password." });

    const matches = await bcrypt.compare(req.body.password, user.passwordHash);
    if (!matches) return res.status(401).json({ message: "Invalid email or password." });

    res.json({ token: issueToken(user), user: publicUser(user) });
  })
);

app.get("/api/auth/me", authenticate, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.get(
  "/api/users",
  authenticate,
  asyncRoute(async (req, res) => {
    const users = await User.find().select("name email role createdAt").sort({ name: 1 });
    res.json({ users });
  })
);

app.get(
  "/api/projects",
  authenticate,
  asyncRoute(async (req, res) => {
    const projects = await Project.find(await visibleProjectFilter(req.user))
      .populate("owner", "name email role")
      .populate("members", "name email role")
      .sort({ updatedAt: -1 });
    res.json({ projects });
  })
);

app.post(
  "/api/projects",
  authenticate,
  requireAdmin,
  asyncRoute(async (req, res) => {
    requireFields(req.body, ["name"]);

    const memberIds = Array.isArray(req.body.members) ? req.body.members : [];
    const members = [...new Set([String(req.user._id), ...memberIds].filter(isValidObjectId))];
    const project = await Project.create({
      name: req.body.name,
      description: req.body.description || "",
      owner: req.user._id,
      members
    });

    const populated = await project.populate([
      { path: "owner", select: "name email role" },
      { path: "members", select: "name email role" }
    ]);
    res.status(201).json({ project: populated });
  })
);

app.put(
  "/api/projects/:id",
  authenticate,
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid project id." });

    const update = {};
    if (req.body.name) update.name = req.body.name;
    if (typeof req.body.description === "string") update.description = req.body.description;
    if (Array.isArray(req.body.members)) {
      update.members = [...new Set([String(req.user._id), ...req.body.members].filter(isValidObjectId))];
    }

    const project = await Project.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true
    })
      .populate("owner", "name email role")
      .populate("members", "name email role");

    if (!project) return res.status(404).json({ message: "Project not found." });
    res.json({ project });
  })
);

app.delete(
  "/api/projects/:id",
  authenticate,
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid project id." });
    const deleted = await Project.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Project not found." });
    await Task.deleteMany({ project: req.params.id });
    res.json({ message: "Project and related tasks deleted." });
  })
);

app.get(
  "/api/tasks",
  authenticate,
  asyncRoute(async (req, res) => {
    const filter = {};
    if (req.query.project) {
      await ensureProjectVisible(req.query.project, req.user);
      filter.project = req.query.project;
    } else if (req.user.role !== "Admin") {
      filter.assignee = req.user._id;
    }

    if (req.query.status) filter.status = req.query.status;

    const tasks = await Task.find(filter)
      .populate("project", "name")
      .populate("assignee", "name email role")
      .populate("createdBy", "name email role")
      .sort({ dueDate: 1 });
    res.json({ tasks });
  })
);

app.post(
  "/api/tasks",
  authenticate,
  requireAdmin,
  asyncRoute(async (req, res) => {
    requireFields(req.body, ["title", "project", "assignee", "dueDate"]);

    const project = await ensureProjectVisible(req.body.project, req.user);
    if (!isValidObjectId(req.body.assignee)) return res.status(400).json({ message: "Invalid assignee id." });

    const assignee = await User.findById(req.body.assignee);
    if (!assignee) return res.status(404).json({ message: "Assignee not found." });

    if (!project.members.some((id) => String(id) === String(assignee._id))) {
      return res.status(400).json({ message: "Assignee must be a member of the project." });
    }

    const dueDate = new Date(req.body.dueDate);
    if (Number.isNaN(dueDate.getTime())) return res.status(400).json({ message: "Invalid due date." });

    const task = await Task.create({
      title: req.body.title,
      description: req.body.description || "",
      project: project._id,
      assignee: assignee._id,
      createdBy: req.user._id,
      status: req.body.status || "Todo",
      priority: req.body.priority || "Medium",
      dueDate
    });

    const populated = await task.populate([
      { path: "project", select: "name" },
      { path: "assignee", select: "name email role" },
      { path: "createdBy", select: "name email role" }
    ]);
    res.status(201).json({ task: populated });
  })
);

app.put(
  "/api/tasks/:id",
  authenticate,
  asyncRoute(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid task id." });

    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found." });

    const isAssignee = String(task.assignee) === String(req.user._id);
    if (req.user.role !== "Admin" && !isAssignee) {
      return res.status(403).json({ message: "You can only update your assigned tasks." });
    }

    if (req.user.role === "Admin") {
      ["title", "description", "status", "priority"].forEach((field) => {
        if (req.body[field] !== undefined) task[field] = req.body[field];
      });
      if (req.body.assignee) {
        if (!isValidObjectId(req.body.assignee)) return res.status(400).json({ message: "Invalid assignee id." });
        const project = await Project.findById(task.project);
        if (!project.members.some((id) => String(id) === String(req.body.assignee))) {
          return res.status(400).json({ message: "Assignee must be a project member." });
        }
        task.assignee = req.body.assignee;
      }
      if (req.body.dueDate) {
        const dueDate = new Date(req.body.dueDate);
        if (Number.isNaN(dueDate.getTime())) return res.status(400).json({ message: "Invalid due date." });
        task.dueDate = dueDate;
      }
    } else if (req.body.status) {
      task.status = req.body.status;
    } else {
      return res.status(400).json({ message: "Members can update task status only." });
    }

    await task.save();
    const populated = await task.populate([
      { path: "project", select: "name" },
      { path: "assignee", select: "name email role" },
      { path: "createdBy", select: "name email role" }
    ]);
    res.json({ task: populated });
  })
);

app.delete(
  "/api/tasks/:id",
  authenticate,
  requireAdmin,
  asyncRoute(async (req, res) => {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid task id." });
    const deleted = await Task.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Task not found." });
    res.json({ message: "Task deleted." });
  })
);

app.get(
  "/api/dashboard",
  authenticate,
  asyncRoute(async (req, res) => {
    const baseFilter = req.user.role === "Admin" ? {} : { assignee: req.user._id };
    const now = new Date();
    const [tasks, projectsCount, usersCount] = await Promise.all([
      Task.find(baseFilter).populate("project", "name").populate("assignee", "name email role").sort({ dueDate: 1 }),
      req.user.role === "Admin" ? Project.countDocuments() : Project.countDocuments({ members: req.user._id }),
      User.countDocuments()
    ]);

    const counts = tasks.reduce(
      (acc, task) => {
        acc.total += 1;
        acc[task.status] += 1;
        if (task.status !== "Done" && task.dueDate < now) acc.overdue += 1;
        return acc;
      },
      { total: 0, Todo: 0, "In Progress": 0, Done: 0, overdue: 0 }
    );

    res.json({
      summary: {
        tasks: counts.total,
        todo: counts.Todo,
        inProgress: counts["In Progress"],
        done: counts.Done,
        overdue: counts.overdue,
        projects: projectsCount,
        users: req.user.role === "Admin" ? usersCount : undefined
      },
      upcoming: tasks.slice(0, 8)
    });
  })
);

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ message: err.message || "Something went wrong." });
});

async function start() {
  if (MONGODB_URI) {
    await connectDatabase();
  } else if (IS_PRODUCTION) {
    console.error("MONGODB_URI is required in production. Add it to Railway service variables.");
    process.exit(1);
  } else {
    console.log(`No MONGODB_URI found. Using local JSON database at ${DATA_PATH}`);
  }

  app.listen(PORT, () => {
    console.log(`Team Task Manager running on http://localhost:${PORT}`);
  });
}

if (IS_VERCEL) {
  module.exports = app;
} else {
  start().catch((error) => {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  });
}
