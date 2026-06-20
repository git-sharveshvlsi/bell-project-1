// ==========================================================================
// Application Script - IoT School Bell Portal & Admin Console
// ==========================================================================

// Global state variables
let isLoggedIn = false;
let isPoweredOn = false;
let isWiFiConnected = false;

// ESP32 Hardware REST API Integration Config
const ESP32_BASE_URL = "";

// Safe wrapper for lucide.createIcons
function safeCreateIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    try {
      lucide.createIcons();
    } catch (e) {
      console.warn("Lucide icons generation error:", e);
    }
  } else {
    console.warn("Lucide library not loaded or defined.");
  }
}

// Theme System Initialization
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  const lightIcon = document.getElementById('theme-icon-light');
  const darkIcon = document.getElementById('theme-icon-dark');
  
  if (savedTheme === 'light') {
    document.body.classList.add('light-theme');
    if (lightIcon) lightIcon.style.display = 'block';
    if (darkIcon) darkIcon.style.display = 'none';
  } else {
    document.body.classList.remove('light-theme');
    if (lightIcon) lightIcon.style.display = 'none';
    if (darkIcon) darkIcon.style.display = 'block';
  }
  safeCreateIcons();
}

// Toggle Theme function
function toggleTheme() {
  const body = document.body;
  const lightIcon = document.getElementById('theme-icon-light');
  const darkIcon = document.getElementById('theme-icon-dark');
  
  if (body.classList.contains('light-theme')) {
    body.classList.remove('light-theme');
    if (lightIcon) lightIcon.style.display = 'none';
    if (darkIcon) darkIcon.style.display = 'block';
    localStorage.setItem('theme', 'dark');
  } else {
    body.classList.add('light-theme');
    if (lightIcon) lightIcon.style.display = 'block';
    if (darkIcon) darkIcon.style.display = 'none';
    localStorage.setItem('theme', 'light');
  }
  safeCreateIcons();
}

// Run theme setup on script load
setTimeout(initTheme, 50);

let hardwarePollInterval = null;


// Schedule object arrays for multiple system modes: General, Exam, and Holiday
let currentMode = "general";
let schedules = {
  general: [
    { time: "08:30:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
    { time: "10:30:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
    { time: "12:00:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
    { time: "13:30:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] },
    { time: "15:30:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] }
  ],
  exam: [
    { time: "09:00:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
    { time: "12:00:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
    { time: "13:00:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] },
    { time: "16:00:00", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] }
  ],
  holiday: [] // Start with no default alarms, administrators can customize
};

let schedule = schedules[currentMode];


let systemTime = new Date("2026-06-17T14:43:56"); // Lock to current time context
let dayOverride = null;
let systemState = "POWER_OFF";
let isLooping = false;
let loopTimeout = null;
let syncComplete = false;
let triggerCount = 0;
let eventLogsDb = [];

// Admin Dashboard telemetry states
let signalStrength = -45; // default strong
let bellsRangToday = 0;
let bellsRangThisWeek = 25; // pre-seeded
let notifications = [];

// Government Holidays List (2026 Calendar Year)
const governmentHolidays = [
  { date: "2026-01-01", name: "New Year's Day", icon: "gift" },
  { date: "2026-01-26", name: "Republic Day", icon: "landmark" },
  { date: "2026-03-17", name: "Maha Shivratri", icon: "sparkles" },
  { date: "2026-03-25", name: "Holi Festival", icon: "palette" },
  { date: "2026-04-14", name: "Ambedkar Jayanti", icon: "award" },
  { date: "2026-05-01", name: "Labor Day / May Day", icon: "wrench" },
  { date: "2026-06-25", name: "Bakrid / Eid al-Adha", icon: "sun" },
  { date: "2026-08-15", name: "Independence Day", icon: "flag" },
  { date: "2026-10-02", name: "Gandhi Jayanti", icon: "glasses" },
  { date: "2026-11-08", name: "Diwali Festival", icon: "flame" },
  { date: "2026-12-25", name: "Christmas Day", icon: "snowflake" }
];

// Interactive calendar view coordinates
let calViewMonth = systemTime.getMonth();
let calViewYear = systemTime.getFullYear();

// DOM Element Selectors - Simulator Portal
const valClock = document.getElementById("val-clock");
const valWifi = document.getElementById("val-wifi");
const valState = document.getElementById("val-state");
const valRelay = document.getElementById("val-relay");
const valBell = document.getElementById("val-bell");
const valCloud = document.getElementById("val-cloud");
const consoleLogs = document.getElementById("console-logs");

const iconWifi = document.getElementById("icon-wifi");
const iconRelay = document.getElementById("icon-relay");
const iconBell = document.getElementById("icon-bell");
const iconCloud = document.getElementById("icon-cloud");
const sidebarStatusBadge = document.getElementById("sidebar-status-badge");

const btnWiFi = document.getElementById("btn-wifi");
const btnForceBell = document.getElementById("btn-force-bell");
const timeInput = document.getElementById("time-input");
const btnAddAlarm = document.getElementById("btn-add-alarm");

const cloudTotalRings = document.getElementById("cloud-total-rings");
const cloudLastTimestamp = document.getElementById("cloud-last-timestamp");
const cloudLogsTableBody = document.querySelector("#cloud-logs-table tbody");
const emptyTableRow = document.getElementById("empty-table-row");

// DOM Element Selectors - Admin Dashboard
const dashClock = document.getElementById("dash-clock");
const dashDateDay = document.getElementById("dash-date-day");
const dashBellIcon = document.getElementById("dash-bell-icon");
const dashBellStatusBadge = document.getElementById("dash-bell-status-badge");
const dashBellStatusSub = document.getElementById("dash-bell-status-sub");
const btnRingNow = document.getElementById("btn-ring-now");
const btnStopNow = document.getElementById("btn-stop-now");
const dashAlarmList = document.getElementById("dash-alarm-list");
const dashNewAlarmTime = document.getElementById("dash-new-alarm-time");
const dashEsp32Status = document.getElementById("dash-esp32-status");
const dashWifiStatus = document.getElementById("dash-wifi-status");
const dashSignalVal = document.getElementById("dash-signal-val");
const dashSignalBadge = document.getElementById("dash-signal-badge");
const dashRingsToday = document.getElementById("dash-rings-today");
const dashRingsWeek = document.getElementById("dash-rings-week");
const weeklyGoalPercent = document.getElementById("weekly-goal-percent");
const weeklyGoalFill = document.getElementById("weekly-goal-fill");

// Initialize Lucide Icons
safeCreateIcons();

// --- Mode Switching Controller ---
function setSystemMode(mode) {
  if (mode !== "general" && mode !== "exam" && mode !== "holiday") return;

  currentMode = mode;
  schedule = schedules[currentMode];

  // Update header active mode badge visual state
  const modeText = document.getElementById("dash-active-mode-text");
  const modeBadge = document.getElementById("dash-active-mode-badge");
  
  if (modeText && modeBadge) {
    const modeNames = {
      general: "General Mode",
      exam: "Exam Mode",
      holiday: "Holiday Mode"
    };
    modeText.innerText = modeNames[mode];
    
    // Set colors and icons
    const iconEl = modeBadge.querySelector("i");
    if (mode === "general") {
      modeBadge.style.background = "rgba(0, 240, 255, 0.08)";
      modeBadge.style.borderColor = "rgba(0, 240, 255, 0.2)";
      modeBadge.style.color = "var(--color-primary)";
      if (iconEl) iconEl.setAttribute("data-lucide", "calendar");
    } else if (mode === "exam") {
      modeBadge.style.background = "rgba(139, 92, 246, 0.08)";
      modeBadge.style.borderColor = "rgba(139, 92, 246, 0.2)";
      modeBadge.style.color = "var(--color-secondary)";
      if (iconEl) iconEl.setAttribute("data-lucide", "file-signature");
    } else if (mode === "holiday") {
      modeBadge.style.background = "rgba(245, 158, 11, 0.08)";
      modeBadge.style.borderColor = "rgba(245, 158, 11, 0.2)";
      modeBadge.style.color = "var(--color-warn)";
      if (iconEl) iconEl.setAttribute("data-lucide", "sun");
    }
    // Re-create icons for the badge
    safeCreateIcons();
  }

  // Show/hide mode-specific warning banners in schedule card
  const bannerHoliday = document.getElementById("dash-mode-banner-holiday");
  const bannerExam = document.getElementById("dash-mode-banner-exam");

  if (bannerHoliday) bannerHoliday.style.display = (mode === "holiday") ? "flex" : "none";
  if (bannerExam) bannerExam.style.display = (mode === "exam") ? "flex" : "none";

  // Trigger UI Updates
  renderAlarmListDash();
  renderScheduleChips();

  // Print logs
  const modeNames = {
    general: "General Mode",
    exam: "Exam Mode",
    holiday: "Holiday Mode"
  };
  addLog("system", "sys", `Active system configuration mode changed to: ${modeNames[mode].toUpperCase()}`);
  addNotification(`System switched to ${modeNames[mode]}. Active schedule loaded.`, "info");
}

// --- Tab Switching Logic ---
function switchTab(tabId) {
  // Toggle Active Classes on Sidebar Menu Items
  document.querySelectorAll(".nav-menu .nav-item").forEach(item => {
    item.classList.remove("active");
  });
  const activeTab = document.getElementById(`tab-${tabId}`);
  if (activeTab) activeTab.classList.add("active");

  // Toggle Active Classes on Main Page Sections
  document.querySelectorAll(".page-section").forEach(sec => {
    sec.classList.remove("active");
  });
  const activeSection = document.getElementById(`sec-${tabId}`);
  if (activeSection) activeSection.classList.add("active");

  // Close Mobile Menu on Switch
  document.getElementById("app-sidebar").classList.remove("show-mobile");
  
  // Custom Redraw Actions
  if (tabId === 'cloud') {
    setTimeout(renderCanvasChart, 100);
  } else if (tabId === 'holidays') {
    calViewMonth = systemTime.getMonth();
    calViewYear = systemTime.getFullYear();
    setTimeout(() => {
      updateCalendarUI();
      renderHolidayDirectory();
    }, 50);
  }
}

// Custom mobile handler helper
function toggleMobileMenu() {
  document.getElementById("app-sidebar").classList.toggle("show-mobile");
}

// Custom style override for mobile sidebar toggle
const styleOverride = document.createElement("style");
styleOverride.innerHTML = `
  @media (max-width: 768px) {
    .sidebar {
      transform: translateX(-100%);
      transition: transform 0.3s ease;
      position: fixed !important;
      height: 100vh !important;
    }
    .sidebar.show-mobile {
      transform: translateX(0);
      display: flex !important;
    }
  }
`;
document.head.appendChild(styleOverride);

// --- Clock tick function (Every 1s) ---
setInterval(() => {
  systemTime.setSeconds(systemTime.getSeconds() + 1);
  const timeStr = formatTime(systemTime);
  
  // Update Simulator Clock widget
  if (valClock) valClock.innerText = timeStr;
  
  // Update Dashboard Clock widgets
  if (dashClock) dashClock.innerText = timeStr;
  if (dashDateDay) dashDateDay.innerText = formatClockDateDay(systemTime);
  
  // Check Holiday Status and update dash indicators
  updateHolidayBannerState();
  
  // Auto clock monitor match checks
  if (systemState === "MONITOR_COMPARE" && isWiFiConnected) {
    checkTimeMatch(timeStr);
  }
}, 1000);

function formatTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatClockDateDay(date) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayName = dayOverride ? dayOverride : days[date.getDay()];
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${dayName}, ${yyyy}-${mm}-${dd}`;
}

// --- Holiday Search Utilities ---
function getHolidayForDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  return governmentHolidays.find(h => h.date === dateStr);
}

function updateHolidayBannerState() {
  const todayHoliday = getHolidayForDate(systemTime);
  const holidayIndicator = document.getElementById("dash-holiday-indicator");
  const holidayNameSpan = document.getElementById("dash-holiday-name");

  if (todayHoliday) {
    if (holidayIndicator && holidayIndicator.style.display !== "flex") {
      holidayIndicator.style.display = "flex";
      holidayNameSpan.innerText = todayHoliday.name;
    }
  } else {
    if (holidayIndicator && holidayIndicator.style.display !== "none") {
      holidayIndicator.style.display = "none";
    }
  }
}

// --- Console Log Monitor ---
function addLog(tag, category, text) {
  const timeStr = formatTime(systemTime);
  const line = document.createElement("div");
  line.className = "terminal-line";
  line.innerHTML = `<span class="term-timestamp">[${timeStr}]</span><span class="term-${category}">${tag.toUpperCase()}: ${text}</span>`;
  
  if (consoleLogs) {
    consoleLogs.appendChild(line);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }
}

// --- Notification Feed Logger ---
function addNotification(message, type = "info") {
  const timeStr = formatTime(systemTime);
  const newNotif = {
    time: timeStr,
    message: message,
    type: type
  };
  
  notifications.unshift(newNotif);
  
  // Cap at 20 entries
  if (notifications.length > 20) {
    notifications.pop();
  }
  
  updateNotificationsUI();
}

function updateNotificationsUI() {
  // UI panel removed
}

function clearNotifications() {
  notifications = [];
}

// --- Flowchart SVG Styling Controls ---
function clearHighlightNodes() {
  document.querySelectorAll(".flow-node").forEach(node => {
    node.classList.remove("active-node");
  });
  document.querySelectorAll(".flow-path").forEach(path => {
    path.classList.remove("active-path", "active-path-yes", "active-path-no");
  });
}

function setNodeActive(nodeId) {
  const node = document.getElementById(nodeId);
  if (node) node.classList.add("active-node");
}

function setPathActive(pathId, type = "default") {
  const path = document.getElementById(pathId);
  if (path) {
    if (type === "yes") path.classList.add("active-path-yes");
    else if (type === "no") path.classList.add("active-path-no");
    else path.classList.add("active-path");
  }
}

// --- Schedule Sync Helpers ---
async function loadSchedulesFromESP32() {
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/schedule`);
    if (!res.ok) throw new Error("Failed to fetch schedules");
    const data = await res.json();
    schedules.general = data.general || [];
    schedules.exam = data.exam || [];
    schedules.holiday = data.holiday || [];
    schedule = schedules[currentMode];
    renderAlarmListDash();
    renderScheduleChips();
  } catch (err) {
    console.error("Error loading schedules from ESP32:", err);
  }
}

async function saveScheduleToESP32() {
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: currentMode,
        schedule: schedule
      })
    });
    if (!res.ok) throw new Error("Failed to save schedule");
  } catch (err) {
    console.error("Error saving schedule to ESP32:", err);
    addNotification("Failed to save schedule to hardware.", "danger");
  }
}

// --- Authentication Handler ---
async function handleLogin(event) {
  event.preventDefault();
  const userVal = document.getElementById("username").value.trim();
  const passVal = document.getElementById("password").value;
  const loginError = document.getElementById("login-error");
  
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: userVal, password: passVal })
    });
    
    if (res.ok) {
      isLoggedIn = true;
      document.getElementById("login-container").style.display = "none";
      document.getElementById("mode-setup-container").style.display = "flex";
      
      safeCreateIcons();
      addNotification("Session authenticated successfully. Please choose mode.", "success");
      
      // Load schedules from ESP32
      await loadSchedulesFromESP32();
    } else {
      throw new Error("Unauthorized");
    }
  } catch (err) {
    loginError.style.display = "flex";
    setTimeout(() => {
      loginError.style.display = "none";
    }, 4000);
  }
}

async function selectStartupMode(mode) {
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode })
    });
    
    if (res.ok) {
      // Apply selected mode
      setSystemMode(mode);
      
      // Transition to main dashboard
      document.getElementById("mode-setup-container").style.display = "none";
      document.getElementById("app-wrapper").style.display = "flex";
      
      safeCreateIcons();
      updateDashboardUI();
      renderAlarmListDash();
      
      // Trigger boot sequence simulation
      triggerBootSequence();
    } else {
      alert("Failed to set startup mode on ESP32 hardware.");
    }
  } catch (err) {
    console.error("Error setting startup mode:", err);
    alert("Connection error setting system mode on hardware: " + err.message + "\n" + err.stack);
  }
}

function handleLogout() {
  isLoggedIn = false;
  document.getElementById("login-container").style.display = "flex";
  document.getElementById("app-wrapper").style.display = "none";
  document.getElementById("mode-setup-container").style.display = "none";
  
  // Reset credentials
  document.getElementById("username").value = "";
  document.getElementById("password").value = "";
  document.getElementById("login-error").style.display = "none";
  
  // Halt active simulator loop
  if (loopTimeout) clearTimeout(loopTimeout);
  isLooping = false;
  isPoweredOn = false;
  isWiFiConnected = false;
  
  addNotification("Session terminated.", "info");
}

// --- Clock Editor Controls ---
let isEditingTime = false;

function toggleTimeEditor(show) {
  isEditingTime = show;
  const form = document.getElementById("time-editor-form");
  const actions = document.getElementById("clock-actions-row");
  
  if (show) {
    form.style.display = "block";
    actions.style.display = "none";
    
    // Populate inputs with current simulated clock state
    const h = String(systemTime.getHours()).padStart(2, '0');
    const m = String(systemTime.getMinutes()).padStart(2, '0');
    const s = String(systemTime.getSeconds()).padStart(2, '0');
    document.getElementById("edit-time").value = `${h}:${m}:${s}`;
    
    const yyyy = systemTime.getFullYear();
    const mm = String(systemTime.getMonth() + 1).padStart(2, '0');
    const dd = String(systemTime.getDate()).padStart(2, '0');
    document.getElementById("edit-date").value = `${yyyy}-${mm}-${dd}`;
    
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    document.getElementById("edit-day").value = dayOverride ? dayOverride : days[systemTime.getDay()];
  } else {
    form.style.display = "none";
    actions.style.display = "flex";
  }
}

async function saveSystemTime() {
  const timeVal = document.getElementById("edit-time").value.trim();
  const dateVal = document.getElementById("edit-date").value;
  const dayVal = document.getElementById("edit-day").value;
  
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
  if (!timeRegex.test(timeVal)) {
    alert("Please enter time in HH:MM:SS format (e.g. 14:30:00).");
    return;
  }
  
  if (!dateVal) {
    alert("Please select a date.");
    return;
  }
  
  const [year, month, day] = dateVal.split("-").map(Number);
  const [hour, minute, second] = timeVal.split(":").map(Number);
  
  systemTime = new Date(year, month - 1, day, hour, minute, second);
  dayOverride = dayVal;
  
  toggleTimeEditor(false);
  
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ntp_sync: false,
        time: timeVal,
        date: dateVal,
        day: dayVal
      })
    });
    if (!res.ok) throw new Error("Time POST failed");
    addNotification(`Clock manually edited to ${timeVal} (${dayVal}).`, "warning");
  } catch (err) {
    console.error("Failed to save time on hardware:", err);
    addNotification("Failed to update clock on hardware.", "danger");
  }
  
  updateDashboardUI();
}

async function syncClockWithHost() {
  dayOverride = null;
  systemTime = new Date();
  
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/time`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ntp_sync: true
      })
    });
    if (!res.ok) throw new Error("Time Sync failed");
    addNotification("NTP time synchronization successful.", "success");
  } catch (err) {
    console.error("Failed to sync NTP on hardware:", err);
    addNotification("Failed to re-enable NTP on hardware.", "danger");
  }
  
  updateDashboardUI();
}

// --- Dashboard Alarm List CRUD with Customizable Days ---
function renderAlarmListDash() {
  if (!dashAlarmList) return;
  
  dashAlarmList.innerHTML = "";
  if (schedule.length === 0) {
    dashAlarmList.innerHTML = `<div style="text-align:center; color:var(--color-text-muted); font-size:12.5px; padding:15px;">No alarms scheduled.</div>`;
    return;
  }
  
  const dayAbbrevs = {
    "Monday": "M",
    "Tuesday": "T",
    "Wednesday": "W",
    "Thursday": "T",
    "Friday": "F",
    "Saturday": "S",
    "Sunday": "S"
  };
  const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  
  schedule.forEach((alarm, index) => {
    const item = document.createElement("div");
    item.className = "alarm-item-dash";
    item.id = `dash-alarm-item-${index}`;
    
    // Generate active day mini badges
    let badgesHtml = "";
    weekDays.forEach(day => {
      const isActive = alarm.days.includes(day);
      const activeClass = isActive ? "active" : "";
      badgesHtml += `<span class="mini-day-badge ${activeClass}">${dayAbbrevs[day]}</span>`;
    });
    
    item.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="alarm-time-display" id="dash-alarm-display-text-${index}">
          <i data-lucide="alarm-clock"></i>
          <span>${alarm.time}</span>
        </div>
        <div class="alarm-days-display" id="dash-alarm-display-days-${index}">
          ${badgesHtml}
        </div>
      </div>
      <div class="alarm-actions" id="dash-alarm-actions-${index}">
        <button class="btn-icon-only" title="Edit Alarm" onclick="startEditAlarm(${index})">
          <i data-lucide="edit-2" style="width: 13px; height: 13px;"></i>
        </button>
        <button class="btn-icon-only btn-delete" title="Delete Alarm" onclick="deleteAlarmFromDash(${index})">
          <i data-lucide="trash-2" style="width: 13px; height: 13px;"></i>
        </button>
      </div>
    `;
    dashAlarmList.appendChild(item);
  });
  
  safeCreateIcons();
}

let activeEditIndex = null;

function startEditAlarm(index) {
  if (activeEditIndex !== null) {
    renderAlarmListDash();
  }
  
  activeEditIndex = index;
  const timeTextDiv = document.getElementById(`dash-alarm-display-text-${index}`);
  const daysDiv = document.getElementById(`dash-alarm-display-days-${index}`);
  const actionsDiv = document.getElementById(`dash-alarm-actions-${index}`);
  const alarm = schedule[index];
  
  timeTextDiv.innerHTML = `
    <i data-lucide="alarm-clock" style="color: var(--color-secondary);"></i>
    <input type="text" class="alarm-edit-row-input" id="dash-alarm-edit-input-${index}" value="${alarm.time}">
  `;
  
  const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const dayLabels = {
    "Monday": "M",
    "Tuesday": "T",
    "Wednesday": "W",
    "Thursday": "T",
    "Friday": "F",
    "Saturday": "S",
    "Sunday": "S"
  };
  
  // Render edit day selector chips inline
  let editChipsHtml = "";
  weekDays.forEach(day => {
    const isActive = alarm.days.includes(day);
    const activeClass = isActive ? "active" : "";
    editChipsHtml += `<button type="button" class="day-chip ${activeClass}" style="width:19px; height:19px; font-size:8.5px;" data-day="${day}" onclick="toggleEditDayChip(this)">${dayLabels[day]}</button>`;
  });
  
  daysDiv.className = "day-chips-wrap";
  daysDiv.style.marginLeft = "22px";
  daysDiv.style.marginTop = "6px";
  daysDiv.innerHTML = editChipsHtml;
  
  actionsDiv.innerHTML = `
    <button class="btn-icon-only btn-save-edit" title="Save" onclick="saveEditAlarm(${index})">
      <i data-lucide="check" style="width: 13px; height: 13px;"></i>
    </button>
    <button class="btn-icon-only" title="Cancel" onclick="renderAlarmListDash()">
      <i data-lucide="x" style="width: 13px; height: 13px;"></i>
    </button>
  `;
  
  safeCreateIcons();
  
  const input = document.getElementById(`dash-alarm-edit-input-${index}`);
  input.focus();
  input.select();
}

function toggleAddDayChip(button) {
  button.classList.toggle("active");
}

function toggleEditDayChip(button) {
  button.classList.toggle("active");
}

async function saveEditAlarm(index) {
  const input = document.getElementById(`dash-alarm-edit-input-${index}`);
  const newVal = input.value.trim();
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
  
  if (!timeRegex.test(newVal)) {
    alert("Please use HH:MM:SS format (e.g. 16:30:00).");
    return;
  }
  
  // Retrieve selected days from the chips
  const daysDiv = document.getElementById(`dash-alarm-display-days-${index}`);
  const activeChips = daysDiv.querySelectorAll(".day-chip.active");
  const selectedDays = [];
  activeChips.forEach(chip => {
    selectedDays.push(chip.getAttribute("data-day"));
  });
  
  if (selectedDays.length === 0) {
    alert("Please select at least one active day.");
    return;
  }
  
  const oldVal = schedule[index].time;
  schedule[index].time = newVal;
  schedule[index].days = selectedDays;
  
  // Re-sort schedule chronologically
  schedule.sort((a, b) => a.time.localeCompare(b.time));
  activeEditIndex = null;
  
  renderAlarmListDash();
  renderScheduleChips(); // Sync chips on flow tab
  
  await saveScheduleToESP32();
  
  addNotification(`Alarm updated to ${newVal} for [${selectedDays.map(d=>d.substring(0,3)).join(", ")}].`, "info");
  addLog("db", "db", `Modified alarm schedule entry: ${oldVal} -> ${newVal} on [${selectedDays.join(", ")}]`);
}

async function deleteAlarmFromDash(index) {
  const deletedTime = schedule[index].time;
  schedule.splice(index, 1);
  
  renderAlarmListDash();
  renderScheduleChips(); // Sync chips on flow tab
  
  await saveScheduleToESP32();
  
  addNotification(`Schedule updated: removed alarm for ${deletedTime}.`, "warning");
  addLog("db", "db", `Removed schedule entry: ${deletedTime}`);
}

async function addAlarmFromDash() {
  const input = document.getElementById("dash-new-alarm-time");
  const val = input.value.trim();
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
  
  if (!timeRegex.test(val)) {
    alert("Please enter time in HH:MM:SS format (e.g. 08:30:00).");
    return;
  }
  
  const exists = schedule.some(item => item.time === val);
  if (exists) {
    alert("This alarm time already exists! You can edit its active days in the list.");
    return;
  }
  
  // Get active day selections
  const activeChips = document.querySelectorAll("#dash-add-day-chips .day-chip.active");
  const selectedDays = [];
  activeChips.forEach(chip => {
    selectedDays.push(chip.getAttribute("data-day"));
  });
  
  if (selectedDays.length === 0) {
    alert("Please select at least one active day.");
    return;
  }
  
  schedule.push({
    time: val,
    days: selectedDays
  });
  schedule.sort((a, b) => a.time.localeCompare(b.time));
  input.value = "";
  
  // Reset chips back to default Weekdays selection
  const chips = document.querySelectorAll("#dash-add-day-chips .day-chip");
  chips.forEach(chip => {
    const day = chip.getAttribute("data-day");
    if (["Saturday", "Sunday"].includes(day)) {
      chip.classList.remove("active");
    } else {
      chip.classList.add("active");
    }
  });
  
  renderAlarmListDash();
  renderScheduleChips(); // Sync chips on flow tab
  
  await saveScheduleToESP32();
  
  addNotification(`Added scheduled alarm: ${val} for [${selectedDays.map(d=>d.substring(0,3)).join(", ")}].`, "success");
  addLog("db", "db", `Added scheduled alarm time: ${val} on days: ${selectedDays.join(", ")}`);
}

// --- Alarm Schedule Sync for Simulator Chip View ---
function renderScheduleChips() {
  const container = document.getElementById("schedule-chips-container");
  if (!container) return;
  container.innerHTML = "";
  
  schedule.forEach((alarm, index) => {
    const chip = document.createElement("span");
    chip.className = "alarm-chip";
    chip.innerHTML = `${alarm.time} <button onclick="removeAlarm(${index})">&times;</button>`;
    container.appendChild(chip);
  });
}

async function removeAlarm(index) {
  if (!isWiFiConnected) {
    addLog("system", "err", "Access Denied: Cloud offline.");
    return;
  }
  const deletedTime = schedule[index].time;
  schedule.splice(index, 1);
  renderScheduleChips();
  renderAlarmListDash();
  
  await saveScheduleToESP32();
  
  addNotification(`Schedule updated: removed alarm for ${deletedTime}.`, "warning");
  addLog("db", "db", `Removed schedule entry: ${deletedTime}`);
}

async function addNewAlarm() {
  const val = timeInput.value.trim();
  const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;
  if (!timeRegex.test(val)) {
    alert("Please use HH:MM:SS format (e.g. 16:29:30)");
    return;
  }
  const exists = schedule.some(item => item.time === val);
  if (exists) {
    alert("Warning: This bell schedule entry already exists!");
    return;
  }
  
  // Default to Mon-Fri for alarms added from simulator flow tab
  schedule.push({
    time: val,
    days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
  });
  schedule.sort((a, b) => a.time.localeCompare(b.time));
  renderScheduleChips();
  renderAlarmListDash();
  
  await saveScheduleToESP32();
  
  addNotification(`Schedule updated: alarm set for ${val} (Weekdays).`, "success");
  addLog("db", "db", `Added scheduled alarm time: ${val} (Mon-Fri)`);
  timeInput.value = "";
}

// --- Wi-Fi Signal Telemetry Simulator ---
function simulateSignalChange(level) {
  const bars = document.querySelectorAll(".sig-bar");
  const valText = document.getElementById("dash-signal-val");
  const badge = document.getElementById("dash-signal-badge");
  
  // Clear status classes
  bars.forEach(bar => {
    bar.className = "sig-bar";
  });
  badge.className = "signal-badge";
  
  if (level === "strong") {
    signalStrength = -45;
    valText.innerText = `${signalStrength} dBm`;
    badge.innerText = "STRONG";
    badge.classList.add("strong");
    
    bars.forEach(bar => {
      bar.classList.add("active-green");
    });
    
    // Update online widgets
    dashEsp32Status.innerHTML = `<span class="status-dot status-active"></span>ONLINE`;
    dashWifiStatus.innerHTML = `<span class="status-dot status-active"></span>CONNECTED`;
    
    if (!isWiFiConnected) {
      toggleWiFiConnection(); // re-enable connection
    }
    
    addNotification("Wi-Fi signal strength is excellent (-45 dBm).", "success");
  } 
  else if (level === "weak") {
    signalStrength = -78;
    valText.innerText = `${signalStrength} dBm`;
    badge.innerText = "WEAK";
    badge.classList.add("weak");
    
    bars.forEach((bar, idx) => {
      if (idx < 3) {
        bar.classList.add("active-yellow");
      }
    });
    
    dashEsp32Status.innerHTML = `<span class="status-dot status-active"></span>ONLINE`;
    dashWifiStatus.innerHTML = `<span class="status-dot status-active"></span>CONNECTED`;
    
    if (!isWiFiConnected) {
      toggleWiFiConnection();
    }
    
    addNotification("Wi-Fi signal degraded to Weak (-78 dBm).", "warning");
  } 
  else if (level === "offline") {
    signalStrength = -95;
    valText.innerText = `${signalStrength} dBm`;
    badge.innerText = "NO SIGNAL";
    badge.classList.add("offline");
    
    bars[0].classList.add("active-red");
    
    dashEsp32Status.innerHTML = `<span class="status-dot status-inactive"></span>OFFLINE`;
    dashWifiStatus.innerHTML = `<span class="status-dot status-inactive"></span>DISCONNECTED`;
    
    if (isWiFiConnected) {
      toggleWiFiConnection(); // disconnect
    }
    
    addNotification("Device offline alert: Wi-Fi connection lost (-95 dBm).", "danger");
  }
}

// --- Manual Bell Controllers ---
async function ringBellManual() {
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ring" })
    });
    if (res.ok) {
      addNotification("Manual ring command sent.", "success");
    } else {
      throw new Error("HTTP error");
    }
  } catch (err) {
    console.error("Failed to ring bell:", err);
    addNotification("Failed to send ring command to hardware.", "danger");
  }
}

async function stopBellManual(wasAutoExpired = false) {
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" })
    });
    if (res.ok) {
      addNotification("Manual stop command sent.", "warning");
    } else {
      throw new Error("HTTP error");
    }
  } catch (err) {
    console.error("Failed to stop bell:", err);
    addNotification("Failed to send stop command to hardware.", "danger");
  }
}

// --- Analytics & Reports Updater ---
function updateReportsUI() {
  if (dashRingsToday) dashRingsToday.innerText = bellsRangToday;
  if (dashRingsWeek) dashRingsWeek.innerText = bellsRangThisWeek;
  
  // Goal progress based on 35 target rings/week
  const goalTarget = 35;
  const percentage = Math.min(Math.round((bellsRangThisWeek / goalTarget) * 100), 100);
  
  if (weeklyGoalPercent) weeklyGoalPercent.innerText = `${percentage}%`;
  if (weeklyGoalFill) weeklyGoalFill.style.width = `${percentage}%`;
}

function updateNextHolidayUI() {
  const todayY = systemTime.getFullYear();
  const todayM = String(systemTime.getMonth() + 1).padStart(2, '0');
  const todayD = String(systemTime.getDate()).padStart(2, '0');
  const todayStr = `${todayY}-${todayM}-${todayD}`;
  
  // Filter for holidays on or after today
  let nextHoliday = governmentHolidays.find(h => h.date >= todayStr);
  if (!nextHoliday && governmentHolidays.length > 0) {
    nextHoliday = governmentHolidays[0]; // fallback
  }
  
  const nextHolidayName = document.getElementById("next-holiday-name");
  if (nextHolidayName && nextHoliday) {
    const [year, month, day] = nextHoliday.date.split("-");
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formattedDate = `${monthNames[parseInt(month) - 1]} ${parseInt(day)}`;
    nextHolidayName.innerText = `${nextHoliday.name} (${formattedDate})`;
  }
}

function updateDashboardUI() {
  updateReportsUI();
  updateNotificationsUI();
  renderAlarmListDash();
  updateNextHolidayUI();
}

// --- Interactive Holidays Calendar Drawing ---
function changeCalMonth(direction) {
  calViewMonth += direction;
  if (calViewMonth < 0) {
    calViewMonth = 11;
    calViewYear--;
  } else if (calViewMonth > 11) {
    calViewMonth = 0;
    calViewYear++;
  }
  updateCalendarUI();
}

function updateCalendarUI() {
  const grid = document.getElementById("cal-days-grid");
  const label = document.getElementById("cal-month-year-label");
  if (!grid || !label) return;
  
  grid.innerHTML = "";
  
  const monthNames = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ];
  label.innerText = `${monthNames[calViewMonth]} ${calViewYear}`;
  
  const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
  const totalDays = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  
  // Fill empty spaces before start of month
  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "cal-day-cell empty";
    grid.appendChild(emptyCell);
  }
  
  // Draw month dates
  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement("div");
    cell.className = "cal-day-cell";
    cell.innerText = day;
    
    const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Check if date corresponds to a government holiday
    const holiday = governmentHolidays.find(h => h.date === dateStr);
    if (holiday) {
      cell.classList.add("is-holiday");
      cell.title = holiday.name;
      // Add separate icon (flag icon) inside the holiday date cell!
      cell.innerHTML = `${day} <i data-lucide="flag-triangle-left"></i>`;
    }
    
    // Check if cell is the active simulated date
    const sysY = systemTime.getFullYear();
    const sysM = systemTime.getMonth();
    const sysD = systemTime.getDate();
    if (calViewYear === sysY && calViewMonth === sysM && day === sysD) {
      cell.classList.add("active-today");
    }
    
    // Click date: shift simulated clock date to cell day
    cell.onclick = () => {
      systemTime.setDate(day);
      systemTime.setMonth(calViewMonth);
      systemTime.setFullYear(calViewYear);
      
      const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      dayOverride = daysOfWeek[systemTime.getDay()];
      
      if (holiday) {
        addNotification(`Simulated system date set to holiday: ${holiday.name} (${dateStr}).`, "danger");
        addLog("system", "sys", `Date modified manually: ${dateStr} - HOLIDAY (${holiday.name})`);
      } else {
        addNotification(`Simulated system date set to ${dateStr} (${dayOverride}).`, "info");
        addLog("system", "sys", `Date modified manually: ${dateStr}`);
      }
      
      updateDashboardUI();
      updateCalendarUI();
      renderHolidayDirectory();
    };
    
    grid.appendChild(cell);
  }
  
  safeCreateIcons();
}

function renderHolidayDirectory() {
  const container = document.getElementById("holiday-directory-list");
  if (!container) return;
  
  container.innerHTML = "";
  
  const todayY = systemTime.getFullYear();
  const todayM = String(systemTime.getMonth() + 1).padStart(2, '0');
  const todayD = String(systemTime.getDate()).padStart(2, '0');
  const todayStr = `${todayY}-${todayM}-${todayD}`;
  
  governmentHolidays.forEach(h => {
    const item = document.createElement("div");
    item.className = "holiday-item-dir";
    
    let statusClass = "upcoming";
    let statusText = "Upcoming";
    
    if (h.date < todayStr) {
      statusClass = "passed";
      statusText = "Passed";
      item.classList.add("past");
    } else if (h.date === todayStr) {
      statusClass = "today";
      statusText = "Today / Holiday";
      item.classList.add("active-today");
    }
    
    const [year, month, day] = h.date.split("-");
    const monthNames = [
      "January", "February", "March", "April", "May", "June", 
      "July", "August", "September", "October", "November", "December"
    ];
    const formattedDate = `${monthNames[parseInt(month) - 1]} ${parseInt(day)}, ${year}`;
    
    item.innerHTML = `
      <div class="holiday-meta">
        <div class="holiday-icon-wrap">
          <i data-lucide="${h.icon}"></i>
        </div>
        <div class="holiday-details">
          <h4>${h.name}</h4>
          <span>${formattedDate}</span>
        </div>
      </div>
      <span class="holiday-status-badge ${statusClass}">${statusText}</span>
    `;
    container.appendChild(item);
  });
  
  safeCreateIcons();
}

// --- Simulation Boot Sequence ---
function triggerBootSequence() {
  if (loopTimeout) clearTimeout(loopTimeout);
  isLooping = false;
  
  isPoweredOn = true;
  syncComplete = false;
  systemState = "BOOT_POWER_ON";
  
  // Dashboard Widget Statuses - Flow Sim panel
  valState.innerText = "Power On";
  sidebarStatusBadge.innerText = "BOOTING";
  sidebarStatusBadge.style.color = "var(--color-warn)";
  sidebarStatusBadge.style.borderColor = "var(--color-warn)";
  
  valWifi.innerHTML = `<span class="status-dot status-inactive"></span>Off`;
  iconWifi.style.color = "var(--color-text-muted)";
  valRelay.innerHTML = `<span class="status-dot status-inactive"></span>LOW`;
  iconRelay.style.color = "var(--color-text-muted)";
  valBell.innerText = "SILENT";
  valBell.style.color = "var(--color-text-muted)";
  iconBell.classList.remove("bell-icon-active");
  valCloud.innerText = "Offline";
  valCloud.style.color = "var(--color-text-muted)";
  iconCloud.style.color = "var(--color-text-muted)";
  
  const syncLabel = document.getElementById("sync-status");
  if (syncLabel) {
    syncLabel.innerText = "Unsynchronized";
    syncLabel.style.color = "var(--color-text-muted)";
  }
  
  // Simulator form fields activation
  btnWiFi.disabled = false;
  btnWiFi.innerHTML = `<i data-lucide="wifi-off"></i> Disconnect Wi-Fi`;
  btnForceBell.disabled = true;
  timeInput.disabled = true;
  btnAddAlarm.disabled = true;
  safeCreateIcons();

  consoleLogs.innerHTML = "";
  addLog("system", "sys", "Initializing system firmware boot sequence...");
  
  clearHighlightNodes();
  setNodeActive("node-power-on");

  // Step 2: WiFi Connect
  setTimeout(() => {
    if (!isPoweredOn) return;
    systemState = "BOOT_WIFI_CONNECTING";
    valState.innerText = "WiFi Conn";
    addLog("wifi", "wifi", "Configuring ESP32 Wi-Fi hardware controller... Connecting to 'School_Bell_Net'...");
    
    clearHighlightNodes();
    setNodeActive("node-connect-wifi");
    setPathActive("path-power-to-wifi");

    // Success WiFi
    setTimeout(() => {
      if (!isPoweredOn) return;
      isWiFiConnected = true;
      valWifi.innerHTML = `<span class="status-dot status-active"></span>Connected`;
      iconWifi.style.color = "var(--color-primary)";
      addLog("wifi", "wifi", "Connected successfully. Assigned IP: 192.168.1.104, RSSI: -45 dBm.");
      addNotification("ESP32 connected to network SSID: School_Bell_Net.", "success");

      // Step 3: NTP/RTC Time Sync
      systemState = "BOOT_SYNC_TIME";
      valState.innerText = "Time Sync";
      addLog("system", "sys", "Connecting to NTP server pool.ntp.org... Syncing RTC DS3231 module...");
      
      clearHighlightNodes();
      setNodeActive("node-sync-time");
      setPathActive("path-wifi-to-sync");

      // Success Time
      setTimeout(() => {
        if (!isPoweredOn) return;
        addLog("system", "sys", "Local Clock Calibrated. High-precision hardware RTC sync status: OK.");
        addNotification("RTC clock synchronized with NTP network time.", "success");
        
        // Step 4: Schedule DB GET
        systemState = "BOOT_GET_SCHEDULE";
        valState.innerText = "Fetching DB";
        addLog("db", "db", "Polling Cloud database REST endpoint for bell schedule...");
        
        clearHighlightNodes();
        setNodeActive("node-get-schedule");
        setPathActive("path-sync-to-schedule");

        // Success DB
        setTimeout(() => {
          if (!isPoweredOn) return;
          syncComplete = true;
          valCloud.innerText = "Connected";
          valCloud.style.color = "var(--color-success)";
          iconCloud.style.color = "var(--color-success)";
          
          if (syncLabel) {
            syncLabel.innerText = "Cloud Synced";
            syncLabel.style.color = "var(--color-success)";
          }
          
          addLog("db", "db", `Successfully synchronized schedule: [${schedule.map(s => s.time).join(", ")}]`);
          addNotification("Alarm database retrieved. Local copy loaded.", "info");
          
          btnForceBell.disabled = false;
          timeInput.disabled = false;
          btnAddAlarm.disabled = false;
          renderScheduleChips();

          // Step 5: Start Comparison Monitoring Loop
          enterMonitoringLoop();

        }, 1200);
      }, 1000);
    }, 1200);
  }, 800);
}

// --- Continuous Monitoring Loop ---
function enterMonitoringLoop() {
  if (!isPoweredOn) return;
  isLooping = true;
  systemState = "MONITOR_COMPARE";
  valState.innerText = "Monitoring";
  sidebarStatusBadge.innerText = "RUNNING";
  sidebarStatusBadge.style.color = "var(--color-success)";
  sidebarStatusBadge.style.borderColor = "var(--color-success)";
  
  addLog("system", "sys", "Entering continuous hardware comparison loop.");
  startHardwarePolling();
}

function runCompareLoop() {
  // Simulated compare loop disabled in favor of hardware polling
}

// --- Alarm Scheduler Match Engine with Weekday & Holiday Checking ---
function checkTimeMatch(currentTimeStr) {
  // Check if today is a government holiday
  const todayHoliday = getHolidayForDate(systemTime);
  if (todayHoliday) {
    if (systemTime.getSeconds() === 0) {
      addLog("system", "sys", `Muted for Holiday: Today is ${todayHoliday.name}. Automatic bell de-energized.`);
      addNotification(`Automatic bell triggers bypassed for ${todayHoliday.name}.`, "warning");
    }
    return;
  }

  const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const currentDayName = dayOverride ? dayOverride : daysOfWeek[systemTime.getDay()];
  
  // Scan schedule list to match exact time and active day
  const matchedAlarm = schedule.find(item => item.time === currentTimeStr);
  if (matchedAlarm) {
    if (matchedAlarm.days.includes(currentDayName)) {
      isLooping = false;
      if (loopTimeout) clearTimeout(loopTimeout);
      
      const modeNames = {
        general: "General Mode",
        exam: "Exam Mode",
        holiday: "Holiday Mode"
      };
      
      addLog("system", "sys", `Time & Day MATCH: Alarm triggered at ${currentTimeStr} (${currentDayName}) [${modeNames[currentMode].toUpperCase()}]`);
      triggerAlarmSequence(currentTimeStr);
    } else {
      const modeNames = {
        general: "General Mode",
        exam: "Exam Mode",
        holiday: "Holiday Mode"
      };
      addLog("system", "sys", `Time match at ${currentTimeStr} skipped (Alarm not active on ${currentDayName} in ${modeNames[currentMode].toUpperCase()})`);
    }
  }
}

function simulateBellTimeMatch() {
  if (!isPoweredOn || !isWiFiConnected) return;
  isLooping = false;
  if (loopTimeout) clearTimeout(loopTimeout);
  triggerAlarmSequence(formatTime(systemTime));
}

// --- State-Machine Bell sequence ---
function triggerAlarmSequence(matchTime) {
  systemState = "MONITOR_DECISION";
  valState.innerText = "Alarm Match";
  clearHighlightNodes();
  setNodeActive("node-is-bell-time");
  setPathActive("path-compare-to-decision");

  setTimeout(() => {
    if (!isPoweredOn) return;
    
    // Step 2: Relay High
    systemState = "BELL_ACTIVATE_RELAY";
    valState.innerText = "Relay HIGH";
    valRelay.innerHTML = `<span class="status-dot status-active"></span>HIGH`;
    iconRelay.style.color = "var(--color-success)";
    addLog("system", "sys", "GPIO Pin 23 OUTPUT set to HIGH. Energizing relay coil...");

    clearHighlightNodes();
    setNodeActive("node-activate-relay");
    setPathActive("path-decision-to-relay", "yes");

    // Step 3: Bell Ringing
    setTimeout(() => {
      if (!isPoweredOn) return;
      systemState = "BELL_RINGING";
      valState.innerText = "Ringing";
      valBell.innerText = "RINGING (10s)";
      valBell.style.color = "var(--color-warn)";
      iconBell.classList.add("bell-icon-active");
      addLog("system", "sys", "AC Contacts Closed. Ringing industrial bell...");

      // Update Dashboard Bell indicators
      dashBellStatusBadge.innerText = "RINGING";
      dashBellStatusBadge.classList.add("ringing");
      dashBellIcon.classList.add("bell-icon-active");
      dashBellStatusSub.innerText = `Scheduled ring for ${matchTime}`;
      
      addNotification(`Bell successfully rang (Scheduled: ${matchTime}).`, "success");
      
      // Increment stats
      bellsRangToday++;
      bellsRangThisWeek++;
      updateReportsUI();

      clearHighlightNodes();
      setNodeActive("node-ring-bell");
      setPathActive("path-relay-to-ring");

      // Ringing duration (3 seconds simulation in UI)
      setTimeout(() => {
        if (!isPoweredOn) return;
        
        // Step 4: Turn OFF Bell
        systemState = "BELL_TURN_OFF";
        valState.innerText = "Relay LOW";
        valRelay.innerHTML = `<span class="status-dot status-inactive"></span>LOW`;
        iconRelay.style.color = "var(--color-text-muted)";
        valBell.innerText = "SILENT";
        valBell.style.color = "var(--color-text-muted)";
        iconBell.classList.remove("bell-icon-active");
        addLog("system", "sys", "Ring timer expired. GPIO Pin 23 OUTPUT set to LOW. De-energizing relay.");

        // Update Dashboard Bell indicators
        dashBellStatusBadge.innerText = "SILENT";
        dashBellStatusBadge.classList.remove("ringing");
        dashBellIcon.classList.remove("bell-icon-active");
        dashBellStatusSub.innerText = "Automatic Scheduling Active";

        clearHighlightNodes();
        setNodeActive("node-turn-off-bell");
        setPathActive("path-ring-to-off");

        // Step 5: Upload logs
        setTimeout(() => {
          if (!isPoweredOn) return;
          systemState = "BELL_UPLOAD_LOGS";
          valState.innerText = "Upload Log";
          addLog("db", "db", "Posting ring event payload to Cloud database logging API...");

          clearHighlightNodes();
          setNodeActive("node-upload-logs");
          setPathActive("path-off-to-upload");

          setTimeout(() => {
            if (!isPoweredOn) return;
            triggerCount++;
            
            // Cloud db log entry creation
            const timestamp = formatTime(systemTime);
            const logEntry = {
              id: `TX_${Math.floor(10000 + Math.random() * 90000)}`,
              deviceId: "ESP32_BELL_01",
              event: "BELL_RING_10S",
              time: timestamp,
              relay: "HIGH_TO_LOW",
              code: "200 OK"
            };
            
            eventLogsDb.unshift(logEntry);
            updateCloudLogsTable();
            
            // Update cloud statistics widgets
            cloudTotalRings.innerText = triggerCount;
            cloudLastTimestamp.innerText = timestamp;
            
            addLog("db", "db", "API post completed. DB response status: 200 OK.");
            addNotification("Device telemetry log uploaded to cloud REST servers.", "info");
            
            // Flash chart update
            renderCanvasChart();
            
            // Return path
            clearHighlightNodes();
            setPathActive("path-upload-to-compare");

            setTimeout(() => {
              enterMonitoringLoop();
            }, 800);
          }, 1200);
        }, 1000);
      }, 3000);
    }, 1000);
  }, 1000);
}

// --- Cloud Table Updater ---
function updateCloudLogsTable() {
  if (!cloudLogsTableBody) return;
  
  if (emptyTableRow) emptyTableRow.style.display = "none";
  
  cloudLogsTableBody.innerHTML = "";
  eventLogsDb.forEach(log => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td style="font-family: 'Courier Prime', monospace; font-weight: bold; color: var(--color-primary);">${log.id}</td>
      <td>${log.deviceId}</td>
      <td><span style="background: rgba(139, 92, 246, 0.1); border: 1px solid rgba(139, 92, 246, 0.2); color: var(--color-secondary); padding: 2px 6px; border-radius: 4px; font-size:11px;">${log.event}</span></td>
      <td style="font-family: 'Courier Prime', monospace;">${log.time}</td>
      <td><span style="color: var(--color-success); font-weight: 600;">${log.relay}</span></td>
      <td><span style="color: var(--color-success); font-weight: bold;">${log.code}</span></td>
    `;
    cloudLogsTableBody.appendChild(row);
  });
}

// --- Canvas Chart Plotting ---
function renderCanvasChart() {
  const canvas = document.getElementById("analytics-chart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  
  const rect = canvas.parentNode.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = 240;
  
  const width = canvas.width;
  const height = canvas.height;
  
  ctx.clearRect(0, 0, width, height);
  
  // Grid Lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  const gridRows = 5;
  for (let i = 0; i <= gridRows; i++) {
    const y = (height - 40) * (i / gridRows) + 15;
    ctx.beginPath();
    ctx.moveTo(40, y);
    ctx.lineTo(width - 20, y);
    ctx.stroke();
  }
  
  // Data points
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const baseline = [5, 6, 4, 5, 5, 0, 0];
  baseline[2] = 4 + triggerCount; // Dynamic Wed update based on triggers
  
  const maxVal = 12;
  const chartWidth = width - 60;
  const chartHeight = height - 50;
  const stepX = chartWidth / (days.length - 1);
  
  // Area Gradient
  ctx.beginPath();
  ctx.moveTo(40, chartHeight + 15);
  for (let i = 0; i < days.length; i++) {
    const x = 40 + i * stepX;
    const y = chartHeight + 15 - (baseline[i] / maxVal) * chartHeight;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(40 + (days.length - 1) * stepX, chartHeight + 15);
  ctx.closePath();
  
  const areaGrad = ctx.createLinearGradient(0, 0, 0, chartHeight + 15);
  areaGrad.addColorStop(0, "rgba(139, 92, 246, 0.2)");
  areaGrad.addColorStop(1, "rgba(139, 92, 246, 0)");
  ctx.fillStyle = areaGrad;
  ctx.fill();

  // Line drawing
  ctx.beginPath();
  for (let i = 0; i < days.length; i++) {
    const x = 40 + i * stepX;
    const y = chartHeight + 15 - (baseline[i] / maxVal) * chartHeight;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "#8b5cf6";
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Drawing Dots & Labels
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px Outfit, sans-serif";
  ctx.textAlign = "center";
  
  for (let i = 0; i < days.length; i++) {
    const x = 40 + i * stepX;
    const y = chartHeight + 15 - (baseline[i] / maxVal) * chartHeight;
    
    // Label x-axis
    ctx.fillText(days[i], x, height - 10);
    
    // Draw Dot
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#00f0ff";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Value text
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px Outfit, sans-serif";
    ctx.fillText(baseline[i], x, y - 8);
  }
}

// Window resize listener to scale canvas chart responsively
window.addEventListener("resize", () => {
  if (document.getElementById("sec-cloud").classList.contains("active")) {
    renderCanvasChart();
  }
});

// --- Clipboard Copy System ---
function copyFirmwareCode() {
  const codeBlock = document.getElementById("firmware-code-block");
  if (!codeBlock) return;
  const codeText = codeBlock.innerText;
  
  navigator.clipboard.writeText(codeText).then(() => {
    const toast = document.getElementById("toast-container");
    if (toast) {
      toast.classList.add("show");
      setTimeout(() => {
        toast.classList.remove("show");
      }, 2500);
    }
  });
}

// Initialize Active Mode Selector states on page load
setSystemMode(currentMode);



// ==========================================================================
// ESP32 Hardware Status and Logs Polling Integration
// ==========================================================================

function startHardwarePolling() {
  if (hardwarePollInterval) clearInterval(hardwarePollInterval);
  pollHardwareStatus();
  hardwarePollInterval = setInterval(pollHardwareStatus, 1500);
}

async function pollHardwareStatus() {
  if (!isLoggedIn || !isPoweredOn) return;
  
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/status`);
    if (!res.ok) throw new Error("Offline");
    const data = await res.json();
    
    isWiFiConnected = (data.esp32_status === "ONLINE" || data.esp32_status === "AP_MODE");
    currentMode = data.mode;
    bellDuration = data.bell_duration;
    ntpSyncEnabled = data.ntp_sync;
    isBellRinging = (data.bell_status === "RINGING");
    bellsRangToday = data.rings_today;
    bellsRangThisWeek = data.rings_week;
    
    // Update Digital Clock and Date/Day UI
    if (dashClock) dashClock.innerText = data.time;
    if (dashDateDay) dashDateDay.innerText = `${data.day}, ${data.date}`;
    
    // Synchronize systemTime so the rest of the UI matches perfectly
    const [year, month, day] = data.date.split("-").map(Number);
    const [hour, minute, second] = data.time.split(":").map(Number);
    systemTime = new Date(year, month - 1, day, hour, minute, second);
    dayOverride = data.day;
    
    // Update active mode badge
    const activeText = document.getElementById("dash-active-mode-text");
    if (activeText) {
      const modeNames = { general: "General Mode", exam: "Exam Mode", holiday: "Holiday Mode" };
      activeText.innerText = modeNames[currentMode] || currentMode;
    }
    
    // Update Bell Widget status
    if (isBellRinging) {
      if (valBell) {
        valBell.innerText = "RINGING";
        valBell.style.color = "var(--color-danger)";
      }
      if (iconBell) iconBell.classList.add("bell-icon-active");
      if (dashBellIcon) dashBellIcon.classList.add("bell-icon-active");
      if (dashBellStatusBadge) {
        dashBellStatusBadge.innerText = "RINGING";
        dashBellStatusBadge.className = "signal-badge ringing";
      }
      if (dashBellStatusSub) dashBellStatusSub.innerText = "Relay output HIGH";
      if (btnRingNow) btnRingNow.disabled = true;
      if (btnStopNow) btnStopNow.disabled = false;
      
      // Flow chart animation node
      clearHighlightNodes();
      setNodeActive("node-ring-bell");
    } else {
      if (valBell) {
        valBell.innerText = "SILENT";
        valBell.style.color = "var(--color-text-muted)";
      }
      if (iconBell) iconBell.classList.remove("bell-icon-active");
      if (dashBellIcon) dashBellIcon.classList.remove("bell-icon-active");
      if (dashBellStatusBadge) {
        dashBellStatusBadge.innerText = "SILENT";
        dashBellStatusBadge.className = "signal-badge";
      }
      if (dashBellStatusSub) dashBellStatusSub.innerText = "Automatic Scheduling Active";
      if (btnRingNow) btnRingNow.disabled = false;
      if (btnStopNow) btnStopNow.disabled = true;
      
      // Flow chart compare node
      clearHighlightNodes();
      setNodeActive("node-compare-time");
      setPathActive("path-schedule-to-compare");
    }
    
    // Update Device WiFi status widget
    if (valWifi) {
      valWifi.innerHTML = `<span class="status-dot status-active"></span>${data.wifi_ssid}`;
      if (iconWifi) iconWifi.style.color = "var(--color-primary)";
    }
    
    // Update cloud connection status widget
    if (valCloud) {
      valCloud.innerText = (data.esp32_status === "ONLINE") ? "Online (Cloud)" : "AP Mode";
      valCloud.style.color = "var(--color-success)";
      if (iconCloud) iconCloud.style.color = "var(--color-success)";
    }
    
    // Update hardware info stats card
    const hardwareIp = document.getElementById("info-ip");
    const hardwareRssi = document.getElementById("info-rssi");
    if (hardwareIp) hardwareIp.innerText = data.wifi_ip;
    if (hardwareRssi) hardwareRssi.innerText = `${data.wifi_rssi} dBm`;
    
    // Update dashboard counters
    if (dashRingsToday) dashRingsToday.innerText = bellsRangToday;
    if (dashRingsWeek) dashRingsWeek.innerText = bellsRangThisWeek;
    
    // Update Weekly Progress telemetries
    const weeklyGoalPercent = document.getElementById("weekly-goal-percent");
    const weeklyGoalFill = document.getElementById("weekly-goal-fill");
    if (weeklyGoalPercent && weeklyGoalFill) {
      const percentage = Math.min(100, Math.round((bellsRangThisWeek / 30) * 100));
      weeklyGoalPercent.innerText = `${percentage}%`;
      weeklyGoalFill.style.width = `${percentage}%`;
    }
    
    // Poll hardware logs
    await pollHardwareLogs();
    
  } catch (err) {
    console.error("ESP32 server is unreachable:", err);
    if (valWifi) valWifi.innerHTML = `<span class="status-dot status-inactive"></span>Disconnected`;
    if (valCloud) {
      valCloud.innerText = "Offline";
      valCloud.style.color = "var(--color-text-muted)";
    }
  }
}

async function pollHardwareLogs() {
  try {
    const res = await fetch(`${ESP32_BASE_URL}/api/logs`);
    if (!res.ok) throw new Error("Logs fetch failed");
    const logs = await res.json();
    
    if (consoleLogs && logs && logs.length > 0) {
      consoleLogs.innerHTML = "";
      logs.forEach(log => {
        const item = document.createElement("div");
        item.className = `console-item console-${log.type}`;
        item.innerHTML = `<span class="console-time">[${log.time}]</span> <span class="console-tag tag-${log.type}">${log.type.toUpperCase()}</span> ${log.message}`;
        consoleLogs.appendChild(item);
      });
      consoleLogs.scrollTop = consoleLogs.scrollHeight;
    }
  } catch (err) {
    console.error("Failed to parse hardware logs:", err);
  }
}
