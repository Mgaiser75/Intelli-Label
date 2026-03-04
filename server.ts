import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});
const upload = multer({ storage });

const db = new Database("labeling.db");

// Seed default user if empty
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
if (userCount.count === 0) {
  db.prepare("INSERT INTO users (name, email, role) VALUES (?, ?, ?)").run("Admin User", "admin@labelmaster.ai", "admin");
  db.prepare("INSERT INTO users (name, email, role) VALUES (?, ?, ?)").run("John Annotator", "john@labelmaster.ai", "annotator");
}

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'annotator', -- 'admin', 'annotator'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    deadline DATETIME,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    pay TEXT,
    type TEXT, -- 'text', 'multimodal', 'rlhf'
    source TEXT,
    discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    taxonomy TEXT, -- JSON array of allowed labels
    assigned_to INTEGER, -- user_id
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(assigned_to) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER,
    content TEXT NOT NULL,
    media_url TEXT,
    media_type TEXT, -- 'image', 'audio', 'text'
    ai_label TEXT,
    ai_confidence REAL,
    ai_reason TEXT,
    validation_status TEXT, -- 'correct', 'incorrect', 'ambiguous'
    validation_suggestion TEXT,
    human_label TEXT,
    comparison_results TEXT, -- JSON object: { model_id: { label, confidence, reason, usage: { input, output } } }
    error_message TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending', -- 'pending', 'ai_processed', 'verified', 'error'
    FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS guidelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_active INTEGER DEFAULT 0
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  // Users
  app.get("/api/users", (req, res) => {
    const users = db.prepare("SELECT * FROM users").all();
    res.json(users);
  });

  // Projects
  app.get("/api/projects", (req, res) => {
    const projects = db.prepare(`
      SELECT p.*, 
      (SELECT COUNT(*) FROM batches b WHERE b.project_id = p.id) as batch_count,
      (SELECT COUNT(*) FROM tasks t JOIN batches b ON t.batch_id = b.id WHERE b.project_id = p.id) as task_count,
      (SELECT COUNT(*) FROM tasks t JOIN batches b ON t.batch_id = b.id WHERE b.project_id = p.id AND t.status = 'verified') as completed_tasks
      FROM projects p ORDER BY created_at DESC
    `).all();
    res.json(projects);
  });

  app.post("/api/projects", (req, res) => {
    const { name, description, deadline } = req.body;
    const result = db.prepare("INSERT INTO projects (name, description, deadline) VALUES (?, ?, ?)")
      .run(name, description, deadline);
    res.json({ id: result.lastInsertRowid, success: true });
  });

  app.delete("/api/projects/:id", (req, res) => {
    db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Batches
  app.get("/api/batches", (req, res) => {
    const batches = db.prepare(`
      SELECT b.*, u.name as assignee_name, p.name as project_name 
      FROM batches b 
      LEFT JOIN users u ON b.assigned_to = u.id 
      LEFT JOIN projects p ON b.project_id = p.id
      ORDER BY b.created_at DESC
    `).all();
    res.json(batches);
  });

  app.post("/api/batches", (req, res) => {
    const { name, tasks, taxonomy, project_id, assigned_to } = req.body;
    const batchInfo = db.prepare("INSERT INTO batches (name, taxonomy, project_id, assigned_to) VALUES (?, ?, ?, ?)")
      .run(name, taxonomy ? JSON.stringify(taxonomy) : null, project_id || null, assigned_to || null);
    const batchId = batchInfo.lastInsertRowid;

    const insertTask = db.prepare("INSERT INTO tasks (batch_id, content, media_type) VALUES (?, ?, ?)");
    const insertMany = db.transaction((tasks) => {
      for (const task of tasks) insertTask.run(batchId, task, 'text');
    });
    insertMany(tasks);

    res.json({ id: batchId, name, taskCount: tasks.length });
  });

  app.patch("/api/batches/:id", (req, res) => {
    const { assigned_to, status, project_id } = req.body;
    const updates = [];
    const params = [];

    if (assigned_to !== undefined) { updates.push("assigned_to = ?"); params.push(assigned_to); }
    if (status !== undefined) { updates.push("status = ?"); params.push(status); }
    if (project_id !== undefined) { updates.push("project_id = ?"); params.push(project_id); }

    params.push(req.params.id);
    db.prepare(`UPDATE batches SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    res.json({ success: true });
  });

  // Job Discovery
  app.get("/api/jobs", (req, res) => {
    const jobs = db.prepare("SELECT * FROM jobs ORDER BY discovered_at DESC LIMIT 50").all();
    res.json(jobs);
  });

  app.post("/api/jobs/discover", async (req, res) => {
    // This is a placeholder for the discovery logic. 
    // In a real app, this would use the Gemini API with googleSearch tool.
    // For now, we'll seed some high-quality platforms if the table is empty.
    const platforms = [
      { company: "DataAnnotation.tech", title: "AI Trainer / Data Annotator", url: "https://www.dataannotation.tech/", pay: "$20-40/hr", type: "text", source: "Direct" },
      { company: "Outlier AI", title: "AI Writing Evaluator", url: "https://outlier.ai/", pay: "$15-50/hr", type: "rlhf", source: "Direct" },
      { company: "Remotasks", title: "AI Generalist", url: "https://www.remotasks.com/", pay: "Variable", type: "multimodal", source: "Scale AI" },
      { company: "Appen", title: "Search Evaluator", url: "https://appen.com/", pay: "Variable", type: "text", source: "Direct" },
      { company: "TELUS International", title: "AI Community Contributor", url: "https://www.telusinternational.com/", pay: "Variable", type: "multimodal", source: "Direct" },
      { company: "Prolific", title: "Research Participant", url: "https://www.prolific.com/", pay: "Min $8/hr", type: "text", source: "Direct" }
    ];

    const insertJob = db.prepare("INSERT INTO jobs (company, title, url, pay, type, source) VALUES (?, ?, ?, ?, ?, ?)");
    for (const p of platforms) {
      const exists = db.prepare("SELECT id FROM jobs WHERE company = ? AND title = ?").get(p.company, p.title);
      if (!exists) {
        insertJob.run(p.company, p.title, p.url, p.pay, p.type, p.source);
      }
    }
    res.json({ success: true, count: platforms.length });
  });

  // Multimodal Task Creation
  app.post("/api/batches/:id/tasks/multimodal", upload.single("file"), (req, res) => {
    const { content, media_type } = req.body;
    const batchId = req.params.id;
    const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;

    const result = db.prepare("INSERT INTO tasks (batch_id, content, media_url, media_type) VALUES (?, ?, ?, ?)")
      .run(batchId, content || "", mediaUrl, media_type || "image");

    res.json({ id: result.lastInsertRowid, success: true });
  });

  app.delete("/api/batches/:id", (req, res) => {
    db.prepare("DELETE FROM batches WHERE id = ?").run(req.params.id);
    res.json({ success: true });
  });

  // Tasks
  app.get("/api/batches/:id/tasks", (req, res) => {
    const tasks = db.prepare("SELECT * FROM tasks WHERE batch_id = ?").all(req.params.id);
    res.json(tasks);
  });

  app.patch("/api/tasks/:id", (req, res) => {
    const { ai_label, ai_confidence, ai_reason, validation_status, validation_suggestion, human_label, status, comparison_results, error_message, input_tokens, output_tokens } = req.body;
    const updates = [];
    const params = [];

    if (ai_label !== undefined) { updates.push("ai_label = ?"); params.push(ai_label); }
    if (ai_confidence !== undefined) { updates.push("ai_confidence = ?"); params.push(ai_confidence); }
    if (ai_reason !== undefined) { updates.push("ai_reason = ?"); params.push(ai_reason); }
    if (validation_status !== undefined) { updates.push("validation_status = ?"); params.push(validation_status); }
    if (validation_suggestion !== undefined) { updates.push("validation_suggestion = ?"); params.push(validation_suggestion); }
    if (human_label !== undefined) { updates.push("human_label = ?"); params.push(human_label); }
    if (status !== undefined) { updates.push("status = ?"); params.push(status); }
    if (comparison_results !== undefined) { updates.push("comparison_results = ?"); params.push(comparison_results); }
    if (error_message !== undefined) { updates.push("error_message = ?"); params.push(error_message); }
    if (input_tokens !== undefined) { updates.push("input_tokens = ?"); params.push(input_tokens); }
    if (output_tokens !== undefined) { updates.push("output_tokens = ?"); params.push(output_tokens); }

    params.push(req.params.id);
    db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    res.json({ success: true });
  });

  // Guidelines
  app.get("/api/guidelines", (req, res) => {
    const guidelines = db.prepare("SELECT * FROM guidelines").all();
    res.json(guidelines);
  });

  app.post("/api/guidelines", (req, res) => {
    const { title, content } = req.body;
    db.prepare("INSERT INTO guidelines (title, content, is_active) VALUES (?, ?, 1)").run(title, content);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
