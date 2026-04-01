import axios from "axios";

function buildDemoSecret() {
  return `secret-${Date.now()}`;
}

async function handleLogin() {
  const loginResponse = await axios.post("/api/auth/login", {
    email: "demo@example.com",
    password: "secret",
  });

  const token = loginResponse?.data?.token;

  await axios.get("/api/auth/profile", {
    headers: {
      Authorization: `Bearer ${token || "demo-token"}`,
    },
  });
}

async function handleRegister() {
  const secret = buildDemoSecret();

  await axios.post("/api/auth/register", {
    email: "new-user@example.com",
    password: secret,
  });
}

async function handleSecurityUpdate() {
  const secret = buildDemoSecret();
  const authHeaders = {
    Authorization: "Bearer demo-token",
  };

  await axios.patch(
    "/api/auth/password",
    { password: secret },
    { headers: authHeaders }
  );

  await axios.get("/api/auth/activity", {
    headers: authHeaders,
  });

  await axios.post(
    "/api/auth/logout",
    {},
    {
      headers: authHeaders,
    }
  );
}

async function handleProjectLifecycle() {
  const projectHeaders = {
    Authorization: "Bearer demo-token",
    "x-project-role": "editor",
  };

  await axios.post(
    "/api/projects",
    {
      name: "Roadmap Visualizer",
      tags: ["ai", "graph"],
    },
    { headers: projectHeaders }
  );

  await axios.get("/api/projects", {
    headers: projectHeaders,
  });

  await axios.get("/api/projects/demo-project", {
    headers: projectHeaders,
  });

  await axios.patch(
    "/api/projects/demo-project/status",
    { status: "in-progress" },
    { headers: projectHeaders }
  );

  await axios.delete("/api/projects/demo-project", {
    headers: projectHeaders,
  });
}

export function LoginButton() {
  return (
    <div>
      <button onClick={handleRegister}>Register</button>
      <button onClick={handleLogin}>Login</button>
      <button onClick={handleSecurityUpdate}>Security Update</button>
      <button onClick={handleProjectLifecycle}>Project Lifecycle</button>
    </div>
  );
}
