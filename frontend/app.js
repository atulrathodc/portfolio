/* ── frontend/app.js ────────────────────────────────────────
   Fetches the portfolio API and renders real data into the
   DOM.  All paths are root-relative (/api/..., /frontend/...).
   No frameworks, no eval.  Errors are rendered visibly.
   ─────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  /* ── helpers ──────────────────────────────────────────── */

  function showError(container, msg) {
    container.innerHTML = "";
    var div = document.createElement("div");
    div.className = "ph-error";
    div.textContent = msg;
    container.appendChild(div);
  }

  function sanitizeText(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /* ── profile ──────────────────────────────────────────── */

  function renderProfile(data) {
    var nameEl = document.getElementById("profile-name");
    var roleEl = document.getElementById("profile-role");
    var titleEl = document.getElementById("profile-title");
    var resumeEl = document.getElementById("profile-resume");

    nameEl.textContent = data.name || "";
    roleEl.textContent = data.role || "";
    titleEl.textContent = data.title || "";

    if (data.resume) {
      resumeEl.href = data.resume;
      resumeEl.style.display = "inline-block";
    } else {
      resumeEl.style.display = "none";
    }

    var countEl = document.getElementById("project-count");
    countEl.textContent = data.project_count
      ? data.project_count + " project" + (data.project_count !== 1 ? "s" : "") + " available"
      : "No projects published yet";
  }

  /* ── projects ─────────────────────────────────────────── */

  function renderProjects(projects) {
    var grid = document.getElementById("project-grid");
    if (!projects || projects.length === 0) {
      grid.innerHTML = '<p class="ph-count">No project images found in assets/images/portfolio/.</p>';
      return;
    }

    grid.innerHTML = "";
    projects.forEach(function (p) {
      var card = document.createElement("div");
      card.className = "ph-card";

      var img = document.createElement("img");
      img.src = "/" + p.image;
      img.alt = p.id;
      img.loading = "lazy";
      card.appendChild(img);

      var link = document.createElement("a");
      link.className = "ph-card-link";
      link.href = p.url || "#";
      link.textContent = p.id.replace(/_/g, " ");
      card.appendChild(link);

      grid.appendChild(card);
    });
  }

  /* ── health ───────────────────────────────────────────── */

  function renderHealth(data) {
    var el = document.getElementById("health-status");
    if (!data || data.status !== "ok") {
      showError(el, "API health check failed.");
      return;
    }
    el.innerHTML =
      '<span class="ph-ok">&#10003; API ok</span>' +
      " — service: " + sanitizeText(data.service) +
      ", api_version: " + sanitizeText(data.api_version) +
      ", uptime: " + (data.uptime_seconds || 0).toFixed(0) + "s" +
      ", routes: " + (data.routes ? data.routes.length : 0);
  }

  /* ── fetch + error handling ───────────────────────────── */

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return res.json();
    });
  }

  /* ── init ─────────────────────────────────────────────── */

  function init() {
    // Profile
    fetchJson("/api/profile")
      .then(renderProfile)
      .catch(function (e) {
        showError(document.getElementById("profile-name"), "Failed to load profile: " + e.message);
      });

    // Projects
    fetchJson("/api/projects")
      .then(renderProjects)
      .catch(function () {
        showError(document.getElementById("project-grid"), "Failed to load projects.");
      });

    // Health
    fetchJson("/api/health")
      .then(renderHealth)
      .catch(function () {
        showError(document.getElementById("health-status"), "Failed to check API health.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
