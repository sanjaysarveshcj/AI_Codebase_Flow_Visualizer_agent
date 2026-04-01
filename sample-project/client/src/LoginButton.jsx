import axios from "axios";

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

export function LoginButton() {
  return <button onClick={handleLogin}>Login</button>;
}
