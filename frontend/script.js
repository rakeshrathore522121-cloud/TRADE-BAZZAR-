// TRADE BAZZAR - Login Script
// Fixed: safely initializes after the page loads and defines the $ helper.

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", () => {
  const togglePassword = $("#togglePassword");
  const password = $("#password");
  const forgotBtn = $("#forgotBtn");
  const loginForm = $("#loginForm");

  if (togglePassword && password) {
    togglePassword.onclick = () => {
      password.type = password.type === "password" ? "text" : "password";
      togglePassword.textContent = password.type === "password" ? "👁" : "🙈";
    };
  }

  if (forgotBtn) {
    forgotBtn.onclick = () => {
      alert("Please contact your administrator to reset your password.");
    };
  }

  if (!loginForm) {
    console.error("TRADE BAZZAR: #loginForm not found.");
    return;
  }

  loginForm.onsubmit = async (e) => {
    e.preventDefault();

    const msg = $("#loginMsg");
    const userId = $("#userId");
    const passwordInput = $("#password");

    if (!userId || !passwordInput) {
      if (msg) msg.textContent = "Login form fields not found.";
      return;
    }

    if (msg) msg.textContent = "Signing in...";

    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "include",
        body: JSON.stringify({
          user_id: userId.value.trim(),
          password: passwordInput.value
        })
      });

      let d = {};
      try {
        d = await r.json();
      } catch (_) {
        d = {};
      }

      if (!r.ok) {
        throw new Error(d.message || "Login failed");
      }

      if (!d.user) {
        throw new Error("Login response is missing user data.");
      }

      localStorage.setItem("trade_bazzar_user", JSON.stringify(d.user));
      window.location.href = "/dashboard.html";
    } catch (err) {
      console.error("TRADE BAZZAR login error:", err);
      if (msg) {
        msg.textContent = err.message || "Login failed. Please try again.";
      }
    }
  };
});
