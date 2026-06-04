const state = {
  token: localStorage.getItem("ttm_token"),
  user: JSON.parse(localStorage.getItem("ttm_user") || "null"),
  users: [],
  projects: [],
  tasks: [],
  authMode: "login",
  resetEmail: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2800);
}

function setFormBusy(form, busy) {
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = busy;
  form.setAttribute("aria-busy", String(busy));
}

function showMessage(selector, message, isError = true) {
  const el = $(selector);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("success", Boolean(message) && !isError);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed.");
  return data;
}

function saveSession(payload) {
  state.token = payload.token;
  state.user = payload.user;
  localStorage.setItem("ttm_token", payload.token);
  localStorage.setItem("ttm_user", JSON.stringify(payload.user));
}

function clearSession() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("ttm_token");
  localStorage.removeItem("ttm_user");
}

function isAdmin() {
  return state.user?.role === "Admin";
}

function syncRoleVisibility() {
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", !isAdmin()));
}

function renderShell() {
  const loggedIn = Boolean(state.token && state.user);
  $("#authView").classList.toggle("hidden", loggedIn);
  $("#mainView").classList.toggle("hidden", !loggedIn);
  $("#logoutBtn").classList.toggle("hidden", !loggedIn);
  $("#profileCard").classList.toggle("hidden", !loggedIn);

  if (loggedIn) {
    $("#profileName").textContent = state.user.name;
    $("#profileRole").textContent = `${state.user.role} • ${state.user.email}`;
  }

  syncRoleVisibility();
}

function switchView(view) {
  $$(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.toggle("active-view", panel.id === view));
  $("#viewTitle").textContent = view[0].toUpperCase() + view.slice(1);
  $("#viewEyebrow").textContent = view === "dashboard" ? "Overview" : "Manage";
}

function optionList(items, label = (item) => item.name) {
  return items.map((item) => `<option value="${item._id || item.id}">${label(item)}</option>`).join("");
}

function projectMembers(project) {
  return (project?.members || [])
    .map((member) => (typeof member === "string" ? state.users.find((user) => String(user._id || user.id) === String(member)) : member))
    .filter(Boolean);
}

function renderTaskAssignees() {
  const projectId = $("#taskProject").value;
  const project = state.projects.find((item) => String(item._id || item.id) === String(projectId));
  const members = projectMembers(project);
  const assignee = $("#taskAssignee");

  assignee.innerHTML = members.length
    ? optionList(members, (u) => `${u.name} (${u.role})`)
    : `<option value="">Select a project with members</option>`;
  assignee.disabled = !members.length;
}

function renderUsers() {
  $("#projectMembers").innerHTML = optionList(state.users, (u) => `${u.name} (${u.role})`);
  $("#teamList").innerHTML = state.users.length
    ? state.users
        .map(
          (user) => `
          <article class="card">
            <h4>${user.name}</h4>
            <p>${user.email}</p>
            <div class="meta"><span class="pill">${user.role}</span></div>
          </article>
        `
        )
        .join("")
    : `<p>No users yet.</p>`;
}

function renderProjects() {
  $("#taskProject").innerHTML = optionList(state.projects);
  renderTaskAssignees();
  $("#projectList").innerHTML = state.projects.length
    ? state.projects
        .map(
          (project) => {
            const members = projectMembers(project);
            const memberIds = new Set(members.map((member) => String(member._id || member.id)));
            return `
          <article class="card">
            <h4>${project.name}</h4>
            <p>${project.description || "No description added."}</p>
            <div class="meta">
              <span class="pill">${project.members?.length || 0} member(s)</span>
              <span class="pill">Owner: ${project.owner?.name || "Admin"}</span>
            </div>
            <p class="member-line">${members.length ? members.map((member) => member.name).join(", ") : "No team members assigned."}</p>
            ${
              isAdmin()
                ? `<label class="project-members-editor">
                    Project members
                    <select multiple data-project-members="${project._id}">
                      ${state.users
                        .map(
                          (user) =>
                            `<option value="${user._id || user.id}" ${memberIds.has(String(user._id || user.id)) ? "selected" : ""}>${user.name} (${user.role})</option>`
                        )
                        .join("")}
                    </select>
                  </label>
                  <div class="task-actions">
                    <button class="primary small-action" data-save-project-members="${project._id}">Save Members</button>
                    <button class="ghost-delete" data-delete-project="${project._id}">Delete</button>
                  </div>`
                : ""
            }
          </article>
        `;
          }
        )
        .join("")
    : `<p>No projects yet. Admins can create the first project from the form.</p>`;
}

function statusSelect(task) {
  const values = ["Todo", "In Progress", "Done"];
  return `
    <select data-task-status="${task._id}">
      ${values.map((value) => `<option ${task.status === value ? "selected" : ""}>${value}</option>`).join("")}
    </select>
  `;
}

function renderTaskList(target, tasks) {
  $(target).innerHTML = tasks.length
    ? tasks
        .map((task) => {
          const overdue = task.status !== "Done" && new Date(task.dueDate) < new Date();
          return `
            <article class="task">
              <h4>${task.title}</h4>
              <p>${task.description || "No description added."}</p>
              <div class="meta">
                <span class="pill">${task.project?.name || "Project"}</span>
                <span class="pill">${task.assignee?.name || "Unassigned"}</span>
                <span class="pill ${task.priority === "High" ? "high" : ""}">${task.priority}</span>
                <span class="pill ${task.status === "Done" ? "done" : ""}">${task.status}</span>
                ${overdue ? `<span class="pill overdue">Overdue</span>` : ""}
                <span class="pill">Due ${new Date(task.dueDate).toLocaleDateString()}</span>
              </div>
              <div class="task-actions">
                ${statusSelect(task)}
                ${isAdmin() ? `<button class="ghost-delete" data-delete-task="${task._id}">Delete</button>` : ""}
              </div>
            </article>
          `;
        })
        .join("")
    : `<p>No tasks to show.</p>`;
}

function renderTasks() {
  renderTaskList("#taskList", state.tasks);
}

function renderDashboard(data) {
  const summary = data.summary;
  const stats = [
    ["Tasks", summary.tasks],
    ["Todo", summary.todo],
    ["In progress", summary.inProgress],
    ["Done", summary.done],
    ["Overdue", summary.overdue],
    ["Projects", summary.projects]
  ];
  if (summary.users !== undefined) stats.push(["Users", summary.users]);

  $("#statsGrid").innerHTML = stats
    .map(
      ([label, value]) => `
      <div class="stat">
        <span>${label}</span>
        <strong>${value}</strong>
      </div>
    `
    )
    .join("");

  renderTaskList("#upcomingList", data.upcoming);
}

async function loadData() {
  if (!state.token) return;
  const [users, projects, tasks, dashboard] = await Promise.all([
    api("/api/users"),
    api("/api/projects"),
    api(`/api/tasks${$("#statusFilter").value ? `?status=${encodeURIComponent($("#statusFilter").value)}` : ""}`),
    api("/api/dashboard")
  ]);

  state.users = users.users;
  state.projects = projects.projects;
  state.tasks = tasks.tasks;

  renderUsers();
  renderProjects();
  renderTasks();
  renderDashboard(dashboard);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function selectedValues(select) {
  return Array.from(select.selectedOptions).map((option) => option.value);
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isSignup = mode === "signup";
  const isForgot = mode === "forgot";
  const isReset = mode === "reset";
  const passwordInput = document.querySelector('[name="password"]');
  const confirmInput = document.querySelector('[name="confirmPassword"]');

  $$(".segment").forEach((item) => item.classList.toggle("active", item.dataset.mode === mode));
  $$(".signup-field").forEach((field) => field.classList.toggle("hidden", !isSignup));
  $$(".reset-field").forEach((field) => field.classList.toggle("hidden", !isReset));
  $("#passwordField").classList.toggle("hidden", isForgot);
  $("#forgotPasswordBtn").classList.toggle("hidden", mode !== "login");

  passwordInput.required = !isForgot;
  passwordInput.autocomplete = isReset ? "new-password" : "current-password";
  confirmInput.required = isReset;
  $("#authSubmit").textContent = isSignup ? "Create account" : isForgot ? "Continue" : isReset ? "Update password" : "Login";
  $("#authMessage").textContent = "";
}

function bindEvents() {
  $$(".segment").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.mode));
  });

  $("#forgotPasswordBtn").addEventListener("click", () => setAuthMode("forgot"));

  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage("#authMessage", "");
    const form = event.currentTarget;
    const body = formData(form);

    try {
      if (state.authMode === "forgot") {
        const result = await api("/api/auth/forgot-password", {
          method: "POST",
          body: JSON.stringify({ email: body.email })
        });
        state.resetEmail = body.email;
        setAuthMode("reset");
        showMessage("#authMessage", result.message, false);
        return;
      }

      if (state.authMode === "reset") {
        if (body.password !== body.confirmPassword) {
          throw new Error("Passwords do not match.");
        }

        const result = await api("/api/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ email: body.email || state.resetEmail, password: body.password })
        });
        form.reset();
        state.resetEmail = null;
        setAuthMode("login");
        showMessage("#authMessage", result.message, false);
        return;
      }

      const payload = await api(`/api/auth/${state.authMode}`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      saveSession(payload);
      renderShell();
      await loadData();
      toast(`Welcome, ${state.user.name}`);
    } catch (error) {
      showMessage("#authMessage", error.message);
    }
  });

  $("#logoutBtn").addEventListener("click", () => {
    clearSession();
    renderShell();
  });

  $$(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("#quickTaskBtn").addEventListener("click", () => switchView("tasks"));

  $("#projectForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showMessage("#projectMessage", "");
    setFormBusy(form, true);

    try {
      const body = formData(form);
      body.members = selectedValues($("#projectMembers"));
      await api("/api/projects", { method: "POST", body: JSON.stringify(body) });
      form.reset();
      await loadData();
      showMessage("#projectMessage", "Project created.", false);
      toast("Project created");
    } catch (error) {
      showMessage("#projectMessage", error.message);
      toast(error.message);
    } finally {
      setFormBusy(form, false);
    }
  });

  $("#taskForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    showMessage("#taskMessage", "");
    setFormBusy(form, true);

    try {
      const body = formData(form);
      await api("/api/tasks", { method: "POST", body: JSON.stringify(body) });
      form.reset();
      await loadData();
      showMessage("#taskMessage", "Task created.", false);
      toast("Task created");
    } catch (error) {
      showMessage("#taskMessage", error.message);
      toast(error.message);
    } finally {
      setFormBusy(form, false);
    }
  });

  $("#taskProject").addEventListener("change", renderTaskAssignees);

  $("#statusFilter").addEventListener("change", loadData);

  document.addEventListener("change", async (event) => {
    const taskId = event.target.dataset.taskStatus;
    if (!taskId) return;

    await api(`/api/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ status: event.target.value })
    });
    await loadData();
    toast("Task status updated");
  });

  document.addEventListener("click", async (event) => {
    const taskId = event.target.dataset.deleteTask;
    if (!taskId) return;
    if (!confirm("Delete this task?")) return;
    await api(`/api/tasks/${taskId}`, { method: "DELETE" });
    await loadData();
    toast("Task deleted");
  });

  document.addEventListener("click", async (event) => {
    const projectId = event.target.dataset.deleteProject;
    if (!projectId) return;
    if (!confirm("Delete this project and its related tasks?")) return;
    await api(`/api/projects/${projectId}`, { method: "DELETE" });
    await loadData();
    toast("Project deleted");
  });

  document.addEventListener("click", async (event) => {
    const projectId = event.target.dataset.saveProjectMembers;
    if (!projectId) return;

    const select = document.querySelector(`[data-project-members="${projectId}"]`);
    const members = selectedValues(select);
    await api(`/api/projects/${projectId}`, {
      method: "PUT",
      body: JSON.stringify({ members })
    });
    await loadData();
    toast("Project members updated");
  });
}

async function boot() {
  bindEvents();
  renderShell();
  if (state.token) {
    try {
      const me = await api("/api/auth/me");
      state.user = me.user;
      localStorage.setItem("ttm_user", JSON.stringify(me.user));
      renderShell();
      await loadData();
    } catch (error) {
      clearSession();
      renderShell();
    }
  }
}

boot();
