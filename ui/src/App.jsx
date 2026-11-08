import { useCallback, useEffect, useState } from "react";
import "./App.css";

// const API_URL = "http://localhost:8000";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
async function apiRequest(path, options = {}) {
  const token = sessionStorage.getItem("access_token");

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;

    if (typeof data.detail === "string") {
      message = data.detail;
    } else if (Array.isArray(data.detail)) {
      message = data.detail
        .map((item) => item.msg || JSON.stringify(item))
        .join(", ");
    } else if (data.detail) {
      message = JSON.stringify(data.detail);
    }

    throw new Error(message);
  }
  return data;
}

function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [users, setUsers] = useState([]);
  const [leads, setLeads] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [qualificationResults, setQualificationResults] = useState({});
  const [aiLoading, setAiLoading] = useState({});

  const [leadForm, setLeadForm] = useState({
    name: "",
    email: "",
    company: "",
    budget: "",
    source: "website",
    requirements: "",
  });

  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    project_id: "",
  });

  const [projectAssignments, setProjectAssignments] = useState({});
  const [taskAssignments, setTaskAssignments] = useState({});
  const [contacts, setContacts] = useState([]);

  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    lead_id: "",
  });

  const loadData = useCallback(async (currentUser) => {
    setError("");

    try {
      const [projectData, taskData] = await Promise.all([
        apiRequest("/projects"),
        apiRequest("/tasks"),
      ]);

      setProjects(projectData);
      setTasks(taskData);
      if (currentUser.role !== "delivery_member") {
        const [leadData, proposalData, contactData] = await Promise.all([
          apiRequest("/leads"),
          apiRequest("/proposals"),
          apiRequest("/contacts"),
        ]);

        setLeads(leadData);
        setProposals(proposalData);
        setContacts(contactData);
      } else {
        setLeads([]);
        setProposals([]);
        setContacts([]);
      }
      if (currentUser.role === "admin") {
        const userData = await apiRequest("/users");
        setUsers(userData);
      } else {
        setUsers([]);
      }
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const token = sessionStorage.getItem("access_token");

      if (!token) return;

      try {
        const currentUser = await apiRequest("/auth/me");

        if (cancelled) return;

        setUser(currentUser);
        await loadData(currentUser);
      } catch {
        if (!cancelled) {
          sessionStorage.removeItem("access_token");
        }
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, [loadData]);
  async function toggleUserStatus(targetUser) {
    setError("");

    try {
      const updatedUser = await apiRequest(
        `/users/${targetUser.id}/status?is_active=${!targetUser.is_active}`,
        { method: "PATCH" }
      );

      setUsers((prev) =>
        prev.map((u) => u.id === updatedUser.id ? updatedUser : u)
      );
    } catch (err) {
      setError(err.message);
    }
  }
  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await apiRequest("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      sessionStorage.setItem("access_token", result.access_token);

      const currentUser = await apiRequest("/auth/me");
      setUser(currentUser);
      await loadData(currentUser);
    } catch (err) {
      sessionStorage.removeItem("access_token");
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    sessionStorage.removeItem("access_token");
    setUser(null);
    setUsers([]);
    setLeads([]);
    setProjects([]);
    setTasks([]);
    setProposals([]);
    setContacts([]);
    setQualificationResults({});
    setAiLoading({});
    setProjectAssignments({});
    setTaskAssignments({});
    setActiveTab("overview");
    setError("");
  }

  async function createLead(event) {
    event.preventDefault();
    setError("");

    try {
      await apiRequest("/leads", {
        method: "POST",
        body: JSON.stringify({
          ...leadForm,
          budget: Number(leadForm.budget),
        }),
      });

      setLeadForm({
        name: "",
        email: "",
        company: "",
        budget: "",
        source: "website",
        requirements: "",
      });

      await loadData(user);
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeLeadStatus(leadId, status) {
    setError("");

    try {
      await apiRequest(
        `/leads/${leadId}/status?status=${encodeURIComponent(status)}`,
        { method: "PATCH" }
      );

      await loadData(user);
    } catch (err) {
      setError(err.message);
    }
  }

  async function qualifyLead(leadId) {
    setError("");
    setAiLoading((previous) => ({ ...previous, [`lead-${leadId}`]: true }));

    try {
      const result = await apiRequest(`/ai/leads/${leadId}/qualify`, {
        method: "POST",
      });
      setQualificationResults((previous) => ({ ...previous, [leadId]: result }));
    } catch (err) {
      setError(err.message);
    } finally {
      setAiLoading((previous) => ({ ...previous, [`lead-${leadId}`]: false }));
    }
  }

  async function generateProposal(leadId) {
    setError("");
    setAiLoading((previous) => ({ ...previous, [`proposal-${leadId}`]: true }));

    try {
      await apiRequest("/ai/proposals/generate", {
        method: "POST",
        body: JSON.stringify({ lead_id: leadId }),
      });
      await loadData(user);
      setActiveTab("proposals");
    } catch (err) {
      setError(err.message);
    } finally {
      setAiLoading((previous) => ({ ...previous, [`proposal-${leadId}`]: false }));
    }
  }
  async function createContact(event) {
    event.preventDefault();
    setError("");

    try {
      await apiRequest("/contacts", {
        method: "POST",
        body: JSON.stringify({
          name: contactForm.name.trim(),
          email: contactForm.email.trim() || null,
          phone: contactForm.phone.trim() || null,
          company: contactForm.company.trim() || null,
          lead_id: contactForm.lead_id
            ? Number(contactForm.lead_id)
            : null,
        }),
      });

      setContactForm({
        name: "",
        email: "",
        phone: "",
        company: "",
        lead_id: "",
      });

      await loadData(user);
    } catch (err) {
      setError(err.message);
    }
  }
  async function createTask(event) {
    event.preventDefault();
    setError("");

    try {
      await apiRequest("/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: taskForm.title,
          description: taskForm.description || null,
          project_id: Number(taskForm.project_id),
        }),
      });

      setTaskForm({ title: "", description: "", project_id: "" });
      await loadData(user);
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeTaskStatus(taskId, status) {
    setError("");

    try {
      await apiRequest(`/tasks/${taskId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });

      await loadData(user);
    } catch (err) {
      setError(err.message);
    }
  }

  async function assignProject(projectId) {
    const assignedTo = Number(projectAssignments[projectId]);
    if (!assignedTo) {
      setError("Enter a valid delivery member user ID.");
      return;
    }

    setError("");

    try {
      await apiRequest(`/projects/${projectId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_to: assignedTo }),
      });

      await loadData(user);
    } catch (err) {
      setError(err.message);
    }
  }

  async function assignTask(taskId) {
    const assignedTo = Number(taskAssignments[taskId]);
    if (!assignedTo) {
      setError("Enter a valid delivery member user ID.");
      return;
    }

    setError("");

    try {
      await apiRequest(`/tasks/${taskId}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ assigned_to: assignedTo }),
      });

      await loadData(user);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!user) {
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="brand">
            <div className="brand-icon">L</div>
            <span>LeadFlow</span>
          </div>

          <div className="login-heading">
            <h1>Welcome back</h1>
            <p>Sign in to continue to your workspace.</p>
          </div>

          <form onSubmit={handleLogin}>
            <label>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />

            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              required
            />

            <button type="submit" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {error && <p className="error-message">{error}</p>}
          <p className="login-footer">AI-powered sales and project management</p>
        </section>
      </main>
    );
  }

  const canManageSales = user.role !== "delivery_member";
  const canManageTasks = ["admin", "sales_rep"].includes(user.role);
  const leadStages = ["new", "qualified", "proposal_sent", "won", "lost"];

  const leadStats = leadStages.map((stage) => ({
    stage,
    count: leads.filter((lead) => lead.status === stage).length,
  }));

  const taskStats = ["todo", "in_progress", "completed"].map((status) => ({
    status,
    count: tasks.filter((task) => task.status === status).length,
  }));

  const projectStats = Object.entries(
    projects.reduce((counts, project) => {
      counts[project.status] = (counts[project.status] || 0) + 1;
      return counts;
    }, {})
  );
  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">L</div>
          <span>LeadFlow</span>
        </div>

        <p className="sidebar-label">WORKSPACE</p>

        <button
          className={activeTab === "overview" ? "nav-button active" : "nav-button"}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>

        {canManageSales && (
          <button
            className={activeTab === "leads" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveTab("leads")}
          >
            Leads
          </button>
        )}

        {canManageSales && (
          <button
            className={activeTab === "proposals" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveTab("proposals")}
          >
            Proposals
          </button>
        )}
        {canManageSales && (
          <button
            className={activeTab === "contacts" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveTab("contacts")}
          >
            Contacts
          </button>
        )}
        <button
          className={activeTab === "projects" ? "nav-button active" : "nav-button"}
          onClick={() => setActiveTab("projects")}
        >
          Projects
        </button>

        <button
          className={activeTab === "tasks" ? "nav-button active" : "nav-button"}
          onClick={() => setActiveTab("tasks")}
        >
          Tasks
        </button>
        {user.role === "admin" && (
          <button
            className={activeTab === "users" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveTab("users")}
          >
            Manage Users
          </button>
        )}
        {user.role === "admin" && (
          <button
            className={activeTab === "analytics" ? "nav-button active" : "nav-button"}
            onClick={() => setActiveTab("analytics")}
          >
            Analytics
          </button>
        )}
        <div className="sidebar-user">
          <strong>{user.name}</strong>
          <span>{user.role.replace("_", " ")}</span>
          <button className="logout-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="dashboard">
        <header className="topbar">
          <div>
            <h1>
              {activeTab === "overview"
                ? "Overview"
                : activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </h1>
            <p>Welcome back, {user.name}.</p>
          </div>
          <span className="role-tag">{user.role.replace("_", " ")}</span>
        </header>

        {error && <div className="error-banner">{error}</div>}
        {activeTab === "users" && user.role === "admin" && (
          <section className="content-card">
            <h2>User Management</h2>
            <p>Total users: {users.length}</p>

            {users.length === 0 ? (
              <p className="muted">No users found.</p>
            ) : (
              users.map((item) => (
                <div className="list-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <p>{item.email}</p>
                    <small>
                      User ID: {item.id} | Role: {item.role} |{" "}
                      {item.is_active ? "Active" : "Inactive"}
                    </small>
                  </div>

                  <button
                    disabled={item.id === user.id}
                    onClick={() => toggleUserStatus(item)}
                  >
                    {item.is_active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              ))
            )}
          </section>
        )}

        {activeTab === "analytics" && user.role === "admin" && (
          <>
            <section className="stats-grid">
              <article className="stat-card">
                <span>Total users</span>
                <strong>{users.length}</strong>
              </article>
              <article className="stat-card">
                <span>Active users</span>
                <strong>{users.filter((item) => item.is_active).length}</strong>
              </article>
              <article className="stat-card">
                <span>Total leads</span>
                <strong>{leads.length}</strong>
              </article>
              <article className="stat-card">
                <span>Won leads</span>
                <strong>{leads.filter((lead) => lead.status === "won").length}</strong>
              </article>
              <article className="stat-card">
                <span>Total projects</span>
                <strong>{projects.length}</strong>
              </article>
              <article className="stat-card">
                <span>Total tasks</span>
                <strong>{tasks.length}</strong>
              </article>
              <article className="stat-card">
                <span>Completed tasks</span>
                <strong>{tasks.filter((task) => task.status === "completed").length}</strong>
              </article>
            </section>

            <section className="content-card">
              <h2>Lead Pipeline Analytics</h2>
              {leadStats.map(({ stage, count }) => (
                <div className="list-row" key={stage}>
                  <strong>{stage.replace("_", " ")}</strong>
                  <strong>{count}</strong>
                </div>
              ))}
            </section>

            <section className="content-card">
              <h2>Project Analytics</h2>
              {projectStats.length === 0 ? (
                <p className="muted">No projects available.</p>
              ) : (
                projectStats.map(([status, count]) => (
                  <div className="list-row" key={status}>
                    <strong>{status.replaceAll("_", " ")}</strong>
                    <strong>{count}</strong>
                  </div>
                ))
              )}
            </section>

            <section className="content-card">
              <h2>Task Analytics</h2>
              {taskStats.map(({ status, count }) => (
                <div className="list-row" key={status}>
                  <strong>{status.replaceAll("_", " ")}</strong>
                  <strong>{count}</strong>
                </div>
              ))}
            </section>
          </>
        )}
        {activeTab === "overview" && (
          <>
            <section className="stats-grid">
              {canManageSales && (
                <article className="stat-card">
                  <span>Total leads</span>
                  <strong>{leads.length}</strong>
                </article>
              )}
              <article className="stat-card">
                <span>Projects</span>
                <strong>{projects.length}</strong>
              </article>
              <article className="stat-card">
                <span>Total tasks</span>
                <strong>{tasks.length}</strong>
              </article>
              <article className="stat-card">
                <span>Completed tasks</span>
                <strong>{tasks.filter((t) => t.status === "completed").length}</strong>
              </article>
            </section>

            <section className="content-card">
              <h2>Recent projects</h2>
              {projects.length === 0 ? (
                <p className="muted">No projects available yet.</p>
              ) : (
                projects.slice(0, 5).map((project) => (
                  <div className="list-row" key={project.id}>
                    <div>
                      <strong>{project.name}</strong>
                      <p>{project.description || "No description"}</p>
                    </div>
                    <span className="status-tag">{project.status}</span>
                  </div>
                ))
              )}
            </section>
          </>
        )}

        {activeTab === "leads" && canManageSales && (
          <>
            <section className="content-card">
              <h2>Create a lead</h2>
              <form className="data-form" onSubmit={createLead}>
                <input
                  placeholder="Contact name"
                  value={leadForm.name}
                  onChange={(e) => setLeadForm({ ...leadForm, name: e.target.value })}
                  required
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={leadForm.email}
                  onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })}
                  required
                />
                <input
                  placeholder="Company"
                  value={leadForm.company}
                  onChange={(e) => setLeadForm({ ...leadForm, company: e.target.value })}
                  required
                />
                <input
                  type="number"
                  min="1"
                  placeholder="Budget"
                  value={leadForm.budget}
                  onChange={(e) => setLeadForm({ ...leadForm, budget: e.target.value })}
                  required
                />
                <textarea
                  placeholder="Customer requirements (at least 20 characters for proposal generation)"
                  value={leadForm.requirements}
                  onChange={(e) =>
                    setLeadForm({ ...leadForm, requirements: e.target.value })
                  }
                  rows={3}
                />
                <select
                  value={leadForm.source}
                  onChange={(e) => setLeadForm({ ...leadForm, source: e.target.value })}
                >
                  <option value="website">Website</option>
                  <option value="referral">Referral</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="other">Other</option>
                </select>
                <button type="submit">Create lead</button>
              </form>
            </section>

            <section className="content-card">
              <h2>Lead pipeline</h2>
              {leads.length === 0 ? (
                <p className="muted">No leads yet. Create your first lead above.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Budget</th>
                        <th>Stage</th>
                        <th>Update stage</th>
                        <th>AI actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((lead) => (
                        <tr key={lead.id}>
                          <td>{lead.name}</td>
                          <td>{lead.company}</td>
                          <td>{Number(lead.budget).toLocaleString()}</td>
                          <td>{lead.status}</td>
                          <td>
                            <select
                              value={lead.status}
                              onChange={(e) => changeLeadStatus(lead.id, e.target.value)}
                            >
                              {["new", "qualified", "proposal_sent", "won", "lost"].map(
                                (status) => (
                                  <option key={status} value={status}>
                                    {status.replace("_", " ")}
                                  </option>
                                )
                              )}
                            </select>
                          </td>
                          <td>
                            <div className="assignment-controls">
                              <button
                                type="button"
                                disabled={Boolean(aiLoading[`lead-${lead.id}`])}
                                onClick={() => qualifyLead(lead.id)}
                              >
                                {aiLoading[`lead-${lead.id}`] ? "Checking..." : "AI qualify"}
                              </button>
                              <button
                                type="button"
                                disabled={
                                  Boolean(aiLoading[`proposal-${lead.id}`]) ||
                                  !lead.requirements ||
                                  lead.requirements.trim().length < 20
                                }
                                title={
                                  !lead.requirements || lead.requirements.trim().length < 20
                                    ? "Add at least 20 characters of requirements when creating this lead"
                                    : "Generate a proposal using this lead's saved requirements"
                                }
                                onClick={() => generateProposal(lead.id)}
                              >
                                {aiLoading[`proposal-${lead.id}`]
                                  ? "Generating..."
                                  : "Generate proposal"}
                              </button>
                            </div>
                            {qualificationResults[lead.id] && (
                              <div className="muted">
                                <strong>AI score: {qualificationResults[lead.id].score}/100</strong>
                                <p>Decision: {qualificationResults[lead.id].decision}</p>
                                <p>{qualificationResults[lead.id].reasoning}</p>
                                <small>Next action: {qualificationResults[lead.id].next_action}</small>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {activeTab === "proposals" && canManageSales && (
          <section className="content-card">
            <h2>Generated proposals</h2>
            {proposals.length === 0 ? (
              <p className="muted">No proposals generated yet. Generate one from the Leads page.</p>
            ) : (
              proposals.map((proposal) => (
                <article className="list-row" key={proposal.id}>
                  <div>
                    <strong>{proposal.title}</strong>
                    <p>{proposal.executive_summary}</p>
                    <p><strong>Scope:</strong> {proposal.scope}</p>
                    <small>
                      Proposal #{proposal.id} · Lead #{proposal.lead_id} · {proposal.timeline} ·
                      Budget: {Number(proposal.estimated_budget).toLocaleString()}
                    </small>
                    <ul>
                      {proposal.deliverables.map((item, index) => (
                        <li key={`${proposal.id}-${index}`}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  <span className="status-tag">{proposal.status}</span>
                </article>
              ))
            )}
          </section>
        )}
        {activeTab === "contacts" && canManageSales && (
          <>
            <section className="content-card">
              <h2>Add a contact</h2>

              <form className="data-form" onSubmit={createContact}>
                <input
                  placeholder="Full name"
                  value={contactForm.name}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, name: e.target.value })
                  }
                  required
                />

                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={contactForm.email}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, email: e.target.value })
                  }
                />

                <input
                  type="tel"
                  placeholder="Phone (optional)"
                  value={contactForm.phone}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, phone: e.target.value })
                  }
                />

                <input
                  placeholder="Company (optional)"
                  value={contactForm.company}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, company: e.target.value })
                  }
                />

                <select
                  value={contactForm.lead_id}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, lead_id: e.target.value })
                  }
                >
                  <option value="">No linked lead</option>
                  {leads.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name} — {lead.company}
                    </option>
                  ))}
                </select>

                <button type="submit">Save contact</button>
              </form>
            </section>

            <section className="content-card">
              <h2>Contacts</h2>

              {contacts.length === 0 ? (
                <p className="muted">No contacts yet. Add a contact above.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Company</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>Linked lead</th>
                      </tr>
                    </thead>

                    <tbody>
                      {contacts.map((contact) => {
                        const linkedLead = leads.find(
                          (lead) => lead.id === contact.lead_id
                        );

                        return (
                          <tr key={contact.id}>
                            <td>{contact.name}</td>
                            <td>{contact.company || "—"}</td>
                            <td>{contact.email || "—"}</td>
                            <td>{contact.phone || "—"}</td>
                            <td>
                              {linkedLead
                                ? `${linkedLead.name} (#${linkedLead.id})`
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
        {activeTab === "projects" && (
          <section className="content-card">
            <h2>Projects</h2>
            {projects.length === 0 ? (
              <p className="muted">No projects available. A project is created when a lead is marked won.</p>
            ) : (
              projects.map((project) => (
                <div className="list-row" key={project.id}>
                  <div>
                    <strong>{project.name}</strong>
                    <p>{project.description || "No description"}</p>
                    <small>Project #{project.id} · Assigned user: {project.assigned_to ?? "Unassigned"}</small>
                  </div>
                  <div className="assignment-controls">
                    <span className="status-tag">{project.status}</span>
                    {canManageTasks && (
                      <>
                        <input
                          type="number"
                          min="1"
                          placeholder="Delivery user ID"
                          value={projectAssignments[project.id] || ""}
                          onChange={(e) =>
                            setProjectAssignments({
                              ...projectAssignments,
                              [project.id]: e.target.value,
                            })
                          }
                        />
                        <button onClick={() => assignProject(project.id)}>Assign</button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {activeTab === "tasks" && (
          <>
            {canManageTasks && (
              <section className="content-card">
                <h2>Create a task</h2>
                <form className="data-form" onSubmit={createTask}>
                  <input
                    placeholder="Task title"
                    value={taskForm.title}
                    onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                    required
                  />
                  <input
                    placeholder="Description (optional)"
                    value={taskForm.description}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, description: e.target.value })
                    }
                  />
                  <select
                    value={taskForm.project_id}
                    onChange={(e) =>
                      setTaskForm({ ...taskForm, project_id: e.target.value })
                    }
                    required
                  >
                    <option value="">Choose a project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" disabled={projects.length === 0}>
                    Create task
                  </button>
                </form>
              </section>
            )}
            <section className="content-card">
              <h2>Tasks</h2>
              {tasks.length === 0 ? (
                <p className="muted">No tasks available.</p>
              ) : (
                tasks.map((task) => (
                  <div className="list-row" key={task.id}>
                    <div>
                      <strong>{task.title}</strong>
                      <p>{task.description || "No description"}</p>
                      <small>
                        Task #{task.id} · Project #{task.project_id} · Assigned user:{" "}
                        {task.assigned_to ?? "Unassigned"}
                      </small>
                    </div>
                    <div className="assignment-controls">
                      {canManageTasks && (
                        <>
                          <input
                            type="number"
                            min="1"
                            placeholder="Delivery user ID"
                            value={taskAssignments[task.id] || ""}
                            onChange={(e) =>
                              setTaskAssignments({
                                ...taskAssignments,
                                [task.id]: e.target.value,
                              })
                            }
                          />
                          <button onClick={() => assignTask(task.id)}>Assign</button>
                        </>
                      )}
                      {(user.role === "admin" || user.role === "delivery_member") && (
                        <select
                          value={task.status}
                          onChange={(e) => changeTaskStatus(task.id, e.target.value)}
                        >
                          <option value="todo">To do</option>
                          <option value="in_progress">In progress</option>
                          <option value="completed">Completed</option>
                        </select>
                      )}
                      <span className="status-tag">{task.status}</span>
                    </div>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
