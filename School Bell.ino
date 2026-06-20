/*
  ESP32 Automatic School Bell System Web Server & REST API
  Hosts the glassmorphic Admin Portal, manages bell schedule configurations,
  syncs time via NTP, and triggers relay GPIOs.
*/

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <time.h>

// PIN CONFIGURATIONS
#define RELAY_PIN 23

// FALLBACK ACCESS POINT CONFIGURATIONS
const char* ap_ssid = "School_Bell_AP";
const char* ap_password = "Password123";

// Wi-Fi Connection Defaults (Configured by User or over API)
String wifi_ssid = "Your_WiFi_SSID";
String wifi_password = "Your_WiFi_Password";

// System State Variables
String currentMode = "general";
int bellDuration = 10; // seconds
bool ntpSyncEnabled = true;
bool isBellRinging = false;
unsigned long bellStartTime = 0;

// Analytics
int ringsToday = 0;
int ringsThisWeek = 25; // Preseeded baseline
int lastRingDay = -1;
int lastRingWeek = -1;

// Web Server
WebServer server(80);

// DNS Server for Captive Portal
const byte DNS_PORT = 53;
DNSServer dnsServer;

// In-Memory Notification Logs (Maximum 20)
struct SystemLog {
  String time;
  String message;
  String type;
};
SystemLog systemLogs[20];
int logCount = 0;

// Struct to represent a single scheduled alarm time
struct AlarmTime {
  String time;
  bool days[7]; // Mon-Sun index (0 = Mon, 6 = Sun)
};

// Schedules list (vector equivalent or dynamic sized lists)
// Simple arrays for safety: max 20 alarms per mode
#define MAX_ALARMS 20
AlarmTime schedule_general[MAX_ALARMS];
int generalAlarmCount = 0;

AlarmTime schedule_exam[MAX_ALARMS];
int examAlarmCount = 0;

AlarmTime schedule_holiday[MAX_ALARMS];
int holidayAlarmCount = 0;

// Government Holidays 2026 List
struct Holiday {
  const char* date;
  const char* name;
};
const int TOTAL_HOLIDAYS = 11;
Holiday governmentHolidays[TOTAL_HOLIDAYS] = {
  {"2026-01-01", "New Year's Day"},
  {"2026-01-26", "Republic Day"},
  {"2026-03-17", "Maha Shivratri"},
  {"2026-03-25", "Holi Festival"},
  {"2026-04-14", "Ambedkar Jayanti"},
  {"2026-05-01", "Labor Day / May Day"},
  {"2026-06-25", "Bakrid / Eid al-Adha"},
  {"2026-08-15", "Independence Day"},
  {"2026-10-02", "Gandhi Jayanti"},
  {"2026-11-08", "Diwali Festival"},
  {"2026-12-25", "Christmas Day"}
};

// Manual Time Override State
bool timeOverridden = false;
unsigned long overrideEpoch = 0;
unsigned long overrideMillis = 0;
String manualDayOfWeek = "";

// Helper: Add Notification Logs to Memory
void addNotificationLog(String msg, String type) {
  // Shift logs down
  for (int i = 19; i > 0; i--) {
    systemLogs[i] = systemLogs[i - 1];
  }
  
  // Format current time
  time_t now;
  struct tm timeinfo;
  char timeBuf[9] = "00:00:00";
  if (getLocalTime(&now, &timeinfo)) {
    sprintf(timeBuf, "%02d:%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  }
  
  systemLogs[0] = {String(timeBuf), msg, type};
  if (logCount < 20) logCount++;
  
  Serial.printf("[%s] NOTIF (%s): %s\n", timeBuf, type.c_str(), msg.c_str());
}

// Helper: Get Day Name from Index
String getDayName(int wday) {
  // tm_wday: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  switch (wday) {
    case 0: return "Sunday";
    case 1: return "Monday";
    case 2: return "Tuesday";
    case 3: return "Wednesday";
    case 4: return "Thursday";
    case 5: return "Friday";
    case 6: return "Saturday";
    default: return "Monday";
  }
}

// Helper: Check if date string is a Holiday
String checkHolidayForDate(String dateStr) {
  for (int i = 0; i < TOTAL_HOLIDAYS; i++) {
    if (dateStr == String(governmentHolidays[i].date)) {
      return String(governmentHolidays[i].name);
    }
  }
  return "";
}

// Time Manager: Fetch Time Info
bool getLocalTime(time_t* nowOut, struct tm* timeinfo) {
  if (timeOverridden) {
    unsigned long elapsed = (millis() - overrideMillis) / 1000;
    time_t current = overrideEpoch + elapsed;
    *nowOut = current;
    localtime_r(&current, timeinfo);
    return true;
  }
  
  time_t now = time(nullptr);
  if (now < 100000) {
    return false; // Time not set yet
  }
  *nowOut = now;
  localtime_r(&now, timeinfo);
  return true;
}

// Convert String Day representation to Array Index
int dayToWdayIndex(String day) {
  if (day == "Monday") return 0;
  if (day == "Tuesday") return 1;
  if (day == "Wednesday") return 2;
  if (day == "Thursday") return 3;
  if (day == "Friday") return 4;
  if (day == "Saturday") return 5;
  if (day == "Sunday") return 6;
  return -1;
}

// Save all configurations to LittleFS File
void saveConfig() {
  File file = LittleFS.open("/config.json", "w");
  if (!file) {
    Serial.println("Failed to open config file for writing");
    return;
  }

  JsonDocument doc;
  doc["wifi_ssid"] = wifi_ssid;
  doc["wifi_password"] = wifi_password;
  doc["mode"] = currentMode;
  doc["bell_duration"] = bellDuration;
  doc["ntp_sync"] = ntpSyncEnabled;
  doc["rings_today"] = ringsToday;
  doc["rings_week"] = ringsThisWeek;
  doc["last_ring_day"] = lastRingDay;
  doc["last_ring_week"] = lastRingWeek;

  // General Schedule
  JsonArray genArr = doc.createNestedArray("sched_general");
  for (int i = 0; i < generalAlarmCount; i++) {
    JsonObject alarm = genArr.createNestedObject();
    alarm["time"] = schedule_general[i].time;
    JsonArray days = alarm.createNestedArray("days");
    const char* dayNames[] = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
    for (int d = 0; d < 7; d++) {
      if (schedule_general[i].days[d]) {
        days.add(dayNames[d]);
      }
    }
  }

  // Exam Schedule
  JsonArray examArr = doc.createNestedArray("sched_exam");
  for (int i = 0; i < examAlarmCount; i++) {
    JsonObject alarm = examArr.createNestedObject();
    alarm["time"] = schedule_exam[i].time;
    JsonArray days = alarm.createNestedArray("days");
    const char* dayNames[] = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
    for (int d = 0; d < 7; d++) {
      if (schedule_exam[i].days[d]) {
        days.add(dayNames[d]);
      }
    }
  }

  // Holiday Schedule
  JsonArray holArr = doc.createNestedArray("sched_holiday");
  for (int i = 0; i < holidayAlarmCount; i++) {
    JsonObject alarm = holArr.createNestedObject();
    alarm["time"] = schedule_holiday[i].time;
    JsonArray days = alarm.createNestedArray("days");
    const char* dayNames[] = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
    for (int d = 0; d < 7; d++) {
      if (schedule_holiday[i].days[d]) {
        days.add(dayNames[d]);
      }
    }
  }

  if (serializeJson(doc, file) == 0) {
    Serial.println("Failed to write to file");
  }
  file.close();
  Serial.println("System configuration saved successfully.");
}

// Load configurations from LittleFS File
void loadConfig() {
  if (!LittleFS.exists("/config.json")) {
    Serial.println("No config.json found. Creating default configuration...");
    
    // Seed default General Alarms
    schedule_general[0] = {"08:30:00", {true, true, true, true, true, false, false}};
    schedule_general[1] = {"10:30:00", {true, true, true, true, true, false, false}};
    schedule_general[2] = {"12:00:00", {true, true, true, true, true, false, false}};
    schedule_general[3] = {"13:30:00", {true, true, true, true, true, false, false}};
    schedule_general[4] = {"15:30:00", {true, true, true, true, true, false, false}};
    generalAlarmCount = 5;

    // Seed default Exam Alarms
    schedule_exam[0] = {"09:00:00", {true, true, true, true, true, true, false}};
    schedule_exam[1] = {"12:00:00", {true, true, true, true, true, true, false}};
    schedule_exam[2] = {"13:00:00", {true, true, true, true, true, true, false}};
    schedule_exam[3] = {"16:00:00", {true, true, true, true, true, true, false}};
    examAlarmCount = 4;
    
    holidayAlarmCount = 0;
    saveConfig();
    return;
  }

  File file = LittleFS.open("/config.json", "r");
  if (!file) {
    Serial.println("Failed to open config file for reading");
    return;
  }

  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, file);
  file.close();

  if (error) {
    Serial.println("Failed to parse config file");
    return;
  }

  if (doc.containsKey("wifi_ssid")) wifi_ssid = doc["wifi_ssid"].as<String>();
  if (doc.containsKey("wifi_password")) wifi_password = doc["wifi_password"].as<String>();
  if (doc.containsKey("mode")) currentMode = doc["mode"].as<String>();
  if (doc.containsKey("bell_duration")) bellDuration = doc["bell_duration"].as<int>();
  if (doc.containsKey("ntp_sync")) ntpSyncEnabled = doc["ntp_sync"].as<bool>();
  if (doc.containsKey("rings_today")) ringsToday = doc["rings_today"].as<int>();
  if (doc.containsKey("rings_week")) ringsThisWeek = doc["rings_week"].as<int>();
  if (doc.containsKey("last_ring_day")) lastRingDay = doc["last_ring_day"].as<int>();
  if (doc.containsKey("last_ring_week")) lastRingWeek = doc["last_ring_week"].as<int>();

  // Parse General Schedule
  generalAlarmCount = 0;
  JsonArray genArr = doc["sched_general"].as<JsonArray>();
  for (JsonObject alarm : genArr) {
    if (generalAlarmCount >= MAX_ALARMS) break;
    schedule_general[generalAlarmCount].time = alarm["time"].as<String>();
    memset(schedule_general[generalAlarmCount].days, 0, 7);
    for (String d : alarm["days"].as<JsonArray>()) {
      int idx = dayToWdayIndex(d);
      if (idx >= 0) schedule_general[generalAlarmCount].days[idx] = true;
    }
    generalAlarmCount++;
  }

  // Parse Exam Schedule
  examAlarmCount = 0;
  JsonArray examArr = doc["sched_exam"].as<JsonArray>();
  for (JsonObject alarm : examArr) {
    if (examAlarmCount >= MAX_ALARMS) break;
    schedule_exam[examAlarmCount].time = alarm["time"].as<String>();
    memset(schedule_exam[examAlarmCount].days, 0, 7);
    for (String d : alarm["days"].as<JsonArray>()) {
      int idx = dayToWdayIndex(d);
      if (idx >= 0) schedule_exam[examAlarmCount].days[idx] = true;
    }
    examAlarmCount++;
  }

  // Parse Holiday Schedule
  holidayAlarmCount = 0;
  JsonArray holArr = doc["sched_holiday"].as<JsonArray>();
  for (JsonObject alarm : holArr) {
    if (holidayAlarmCount >= MAX_ALARMS) break;
    schedule_holiday[holidayAlarmCount].time = alarm["time"].as<String>();
    memset(schedule_holiday[holidayAlarmCount].days, 0, 7);
    for (String d : alarm["days"].as<JsonArray>()) {
      int idx = dayToWdayIndex(d);
      if (idx >= 0) schedule_holiday[holidayAlarmCount].days[idx] = true;
    }
    holidayAlarmCount++;
  }

  Serial.println("System configuration loaded from LittleFS.");
}

// Set up CORS preflight headers
void sendCORSHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE, PUT");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// REST Endpoint: OPTIONS (preflight CORS)
void handleOptions() {
  sendCORSHeaders();
  server.send(204);
}

// REST Endpoint: POST /api/login
void handleLogin() {
  sendCORSHeaders();
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Body missing\"}");
    return;
  }
  
  String body = server.arg("plain");
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, body);
  
  if (error) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Malformed JSON\"}");
    return;
  }
  
  String user = doc["username"].as<String>();
  String pass = doc["password"].as<String>();
  
  if (user == "admin" && pass == "admin123") {
    server.send(200, "application/json", "{\"status\":\"success\",\"message\":\"Authenticated\"}");
  } else {
    server.send(401, "application/json", "{\"status\":\"error\",\"message\":\"Unauthorized\"}");
  }
}

// REST Endpoint: GET /api/status
void handleStatus() {
  sendCORSHeaders();
  
  time_t now;
  struct tm timeinfo;
  char timeBuf[9] = "00:00:00";
  char dateBuf[11] = "2026-06-19";
  String dayStr = "Friday";
  
  if (getLocalTime(&now, &timeinfo)) {
    sprintf(timeBuf, "%02d:%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    sprintf(dateBuf, "%04d-%02d-%02d", timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday);
    dayStr = timeOverridden ? manualDayOfWeek : getDayName(timeinfo.tm_wday);
  }
  
  JsonDocument doc;
  doc["time"] = String(timeBuf);
  doc["date"] = String(dateBuf);
  doc["day"] = dayStr;
  doc["ntp_sync"] = ntpSyncEnabled;
  doc["mode"] = currentMode;
  doc["bell_status"] = isBellRinging ? "RINGING" : "SILENT";
  doc["bell_duration"] = bellDuration;
  doc["relay_pin_state"] = digitalRead(RELAY_PIN);
  
  // Wi-Fi Diagnostic info
  if (WiFi.status() == WL_CONNECTED) {
    doc["wifi_ssid"] = WiFi.SSID();
    doc["wifi_rssi"] = WiFi.RSSI();
    doc["wifi_ip"] = WiFi.localIP().toString();
    doc["esp32_status"] = "ONLINE";
  } else {
    doc["wifi_ssid"] = "ESP32 AP fallback";
    doc["wifi_rssi"] = -50;
    doc["wifi_ip"] = WiFi.softAPIP().toString();
    doc["esp32_status"] = "AP_MODE";
  }
  
  doc["rings_today"] = ringsToday;
  doc["rings_week"] = ringsThisWeek;
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// REST Endpoint: POST /api/control
void handleControl() {
  sendCORSHeaders();
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Body missing\"}");
    return;
  }
  
  JsonDocument doc;
  deserializeJson(doc, server.arg("plain"));
  String action = doc["action"].as<String>();
  
  if (action == "ring") {
    isBellRinging = true;
    bellStartTime = millis();
    digitalWrite(RELAY_PIN, HIGH);
    
    ringsToday++;
    ringsThisWeek++;
    saveConfig();
    
    addNotificationLog("Manual ring command triggered.", "success");
    server.send(200, "application/json", "{\"status\":\"success\",\"bell_status\":\"RINGING\"}");
  } else if (action == "stop") {
    isBellRinging = false;
    digitalWrite(RELAY_PIN, LOW);
    addNotificationLog("Bell manually silenced.", "danger");
    server.send(200, "application/json", "{\"status\":\"success\",\"bell_status\":\"SILENT\"}");
  } else {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid action\"}");
  }
}

// REST Endpoint: GET /api/schedule
void handleGetSchedule() {
  sendCORSHeaders();
  
  JsonDocument doc;
  
  // General
  JsonArray genArr = doc.createNestedArray("general");
  for (int i = 0; i < generalAlarmCount; i++) {
    JsonObject alarm = genArr.createNestedObject();
    alarm["time"] = schedule_general[i].time;
    JsonArray days = alarm.createNestedArray("days");
    const char* dayNames[] = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
    for (int d = 0; d < 7; d++) {
      if (schedule_general[i].days[d]) days.add(dayNames[d]);
    }
  }

  // Exam
  JsonArray examArr = doc.createNestedArray("exam");
  for (int i = 0; i < examAlarmCount; i++) {
    JsonObject alarm = examArr.createNestedObject();
    alarm["time"] = schedule_exam[i].time;
    JsonArray days = alarm.createNestedArray("days");
    const char* dayNames[] = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
    for (int d = 0; d < 7; d++) {
      if (schedule_exam[i].days[d]) days.add(dayNames[d]);
    }
  }

  // Holiday
  JsonArray holArr = doc.createNestedArray("holiday");
  for (int i = 0; i < holidayAlarmCount; i++) {
    JsonObject alarm = holArr.createNestedObject();
    alarm["time"] = schedule_holiday[i].time;
    JsonArray days = alarm.createNestedArray("days");
    const char* dayNames[] = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"};
    for (int d = 0; d < 7; d++) {
      if (schedule_holiday[i].days[d]) days.add(dayNames[d]);
    }
  }
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// REST Endpoint: POST /api/schedule
void handlePostSchedule() {
  sendCORSHeaders();
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Body missing\"}");
    return;
  }
  
  JsonDocument doc;
  DeserializationError error = deserializeJson(doc, server.arg("plain"));
  if (error) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid JSON\"}");
    return;
  }
  
  String mode = doc["mode"].as<String>();
  JsonArray arr = doc["schedule"].as<JsonArray>();
  
  if (mode == "general") {
    generalAlarmCount = 0;
    for (JsonObject alarm : arr) {
      if (generalAlarmCount >= MAX_ALARMS) break;
      schedule_general[generalAlarmCount].time = alarm["time"].as<String>();
      memset(schedule_general[generalAlarmCount].days, 0, 7);
      for (String d : alarm["days"].as<JsonArray>()) {
        int idx = dayToWdayIndex(d);
        if (idx >= 0) schedule_general[generalAlarmCount].days[idx] = true;
      }
      generalAlarmCount++;
    }
  } else if (mode == "exam") {
    examAlarmCount = 0;
    for (JsonObject alarm : arr) {
      if (examAlarmCount >= MAX_ALARMS) break;
      schedule_exam[examAlarmCount].time = alarm["time"].as<String>();
      memset(schedule_exam[examAlarmCount].days, 0, 7);
      for (String d : alarm["days"].as<JsonArray>()) {
        int idx = dayToWdayIndex(d);
        if (idx >= 0) schedule_exam[examAlarmCount].days[idx] = true;
      }
      examAlarmCount++;
    }
  } else if (mode == "holiday") {
    holidayAlarmCount = 0;
    for (JsonObject alarm : arr) {
      if (holidayAlarmCount >= MAX_ALARMS) break;
      schedule_holiday[holidayAlarmCount].time = alarm["time"].as<String>();
      memset(schedule_holiday[holidayAlarmCount].days, 0, 7);
      for (String d : alarm["days"].as<JsonArray>()) {
        int idx = dayToWdayIndex(d);
        if (idx >= 0) schedule_holiday[holidayAlarmCount].days[idx] = true;
      }
      holidayAlarmCount++;
    }
  } else {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Unknown mode\"}");
    return;
  }
  
  saveConfig();
  addNotificationLog("Schedules updated in " + mode + " mode.", "info");
  server.send(200, "application/json", "{\"status\":\"success\"}");
}

// REST Endpoint: POST /api/mode
void handlePostMode() {
  sendCORSHeaders();
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Body missing\"}");
    return;
  }
  
  JsonDocument doc;
  deserializeJson(doc, server.arg("plain"));
  String mode = doc["mode"].as<String>();
  
  if (mode == "general" || mode == "exam" || mode == "holiday") {
    currentMode = mode;
    saveConfig();
    
    String modeName = (mode == "general") ? "General Mode" : ((mode == "exam") ? "Exam Mode" : "Holiday Mode");
    addNotificationLog("System switched to " + modeName + ".", "info");
    server.send(200, "application/json", "{\"status\":\"success\",\"mode\":\"" + mode + "\"}");
  } else {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Invalid mode\"}");
  }
}

// REST Endpoint: POST /api/time
void handlePostTime() {
  sendCORSHeaders();
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Body missing\"}");
    return;
  }
  
  JsonDocument doc;
  deserializeJson(doc, server.arg("plain"));
  
  ntpSyncEnabled = doc["ntp_sync"].as<bool>();
  
  if (!ntpSyncEnabled) {
    // User configured manual date/time
    String timeStr = doc["time"].as<String>(); // HH:MM:SS
    String dateStr = doc["date"].as<String>(); // YYYY-MM-DD
    manualDayOfWeek = doc["day"].as<String>();
    
    int hour, minute, second;
    int year, month, day;
    sscanf(timeStr.c_str(), "%d:%d:%d", &hour, &minute, &second);
    sscanf(dateStr.c_str(), "%d-%d-%d", &year, &month, &day);
    
    struct tm t;
    t.tm_year = year - 1900;
    t.tm_mon = month - 1;
    t.tm_mday = day;
    t.tm_hour = hour;
    t.tm_min = minute;
    t.tm_sec = second;
    t.tm_isdst = -1;
    
    overrideEpoch = mktime(&t);
    overrideMillis = millis();
    timeOverridden = true;
    
    addNotificationLog("Clock updated manually to " + timeStr + " (" + manualDayOfWeek + ").", "warning");
  } else {
    timeOverridden = false;
    configTime(5.5 * 3600, 0, "pool.ntp.org"); // Sync back to IST (UTC+5.5)
    addNotificationLog("NTP time synchronization re-enabled.", "success");
  }
  
  saveConfig();
  server.send(200, "application/json", "{\"status\":\"success\"}");
}

// REST Endpoint: POST /api/duration
void handlePostDuration() {
  sendCORSHeaders();
  if (server.hasArg("plain") == false) {
    server.send(400, "application/json", "{\"status\":\"error\",\"message\":\"Body missing\"}");
    return;
  }
  
  JsonDocument doc;
  deserializeJson(doc, server.arg("plain"));
  bellDuration = doc["duration"].as<int>();
  
  saveConfig();
  addNotificationLog("Bell duration updated to " + String(bellDuration) + " seconds.", "info");
  server.send(200, "application/json", "{\"status\":\"success\"}");
}

// REST Endpoint: GET /api/logs
void handleGetLogs() {
  sendCORSHeaders();
  
  JsonDocument doc;
  JsonArray logsArr = doc.to<JsonArray>();
  for (int i = 0; i < logCount; i++) {
    JsonObject entry = logsArr.createNestedObject();
    entry["time"] = systemLogs[i].time;
    entry["message"] = systemLogs[i].message;
    entry["type"] = systemLogs[i].type;
  }
  
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// Serving Static Files from LittleFS
bool handleStaticFile(String path) {
  if (path.endsWith("/")) path += "index.html";
  String contentType = "text/plain";
  if (path.endsWith(".html")) contentType = "text/html";
  else if (path.endsWith(".css")) contentType = "text/css";
  else if (path.endsWith(".js")) contentType = "application/javascript";
  else if (path.endsWith(".png")) contentType = "image/png";
  else if (path.endsWith(".ico")) contentType = "image/x-icon";
  
  if (LittleFS.exists(path)) {
    File file = LittleFS.open(path, "r");
    server.streamFile(file, contentType);
    file.close();
    return true;
  }
  return false;
}


void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  if (event == ARDUINO_EVENT_WIFI_AP_STACONNECTED) {
    Serial.println("Wi-Fi Client connected to ESP32 softAP.");
  } else if (event == ARDUINO_EVENT_WIFI_AP_STADISCONNECTED) {
    Serial.println("Wi-Fi Client disconnected from ESP32 softAP.");
  } else if (event == ARDUINO_EVENT_WIFI_AP_STAIPASSIGNED) {
    Serial.println("DHCP IP Address successfully assigned to client.");
  }
}

void setup() {
  Serial.begin(115200);
  
  // Set up relay control pin
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  
  // Mount LittleFS
  if (!LittleFS.begin(true)) {
    Serial.println("An Error has occurred while mounting LittleFS");
  } else {
    Serial.println("LittleFS filesystem mounted successfully.");
  }
  
  // Load Configurations
  loadConfig();
  
  // Configure Access Point Mode exclusively
  WiFi.onEvent(onWiFiEvent);
  Serial.println("Starting Access Point...");
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap_ssid, ap_password);
  Serial.print("Access Point started! SSID: ");
  Serial.print(ap_ssid);
  Serial.print(" | IP Address: ");
  Serial.println(WiFi.softAPIP());

  // Start DNS Server to redirect all domain requests to ESP32 IP
  dnsServer.start(DNS_PORT, "*", WiFi.softAPIP());
  Serial.println("DNS Server started for captive portal redirect.");

  // REST API Endpoints Routing
  server.on("/api/login", HTTP_POST, handleLogin);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/control", HTTP_POST, handleControl);
  server.on("/api/schedule", HTTP_GET, handleGetSchedule);
  server.on("/api/schedule", HTTP_POST, handlePostSchedule);
  server.on("/api/mode", HTTP_POST, handlePostMode);
  server.on("/api/time", HTTP_POST, handlePostTime);
  server.on("/api/duration", HTTP_POST, handlePostDuration);
  server.on("/api/logs", HTTP_GET, handleGetLogs);
  
  // CORS Options
  server.on("/api/login", HTTP_OPTIONS, handleOptions);
  server.on("/api/status", HTTP_OPTIONS, handleOptions);
  server.on("/api/control", HTTP_OPTIONS, handleOptions);
  server.on("/api/schedule", HTTP_OPTIONS, handleOptions);
  server.on("/api/mode", HTTP_OPTIONS, handleOptions);
  server.on("/api/time", HTTP_OPTIONS, handleOptions);
  server.on("/api/duration", HTTP_OPTIONS, handleOptions);
  server.on("/api/logs", HTTP_OPTIONS, handleOptions);
  
  // Default fallback static file routing & captive portal redirection
  server.onNotFound([]() {
    // Try to serve static file from LittleFS
    if (handleStaticFile(server.uri())) {
      return;
    }
    
    // If the file is not found, redirect to the portal root "/"
    String localIP = WiFi.softAPIP().toString();
    Serial.print("Redirecting request ");
    Serial.print(server.uri());
    Serial.print(" from host ");
    Serial.print(server.hostHeader());
    Serial.println(" to portal root.");
    
    server.sendHeader("Location", "http://" + localIP + "/", true);
    server.send(302, "text/plain", ""); // HTTP 302 Redirect
  });
  
  // Start server
  server.begin();
  Serial.println("HTTP Web Server running. Ready for dashboard connections.");
  addNotificationLog("ESP32 System initialized successfully.", "success");
}

void checkScheduledAlarms() {
  time_t now;
  struct tm timeinfo;
  if (!getLocalTime(&now, &timeinfo)) return;

  // Only compare once per second (when seconds change)
  static int lastSec = -1;
  if (timeinfo.tm_sec == lastSec) return;
  lastSec = timeinfo.tm_sec;
  
  // Reset ringsToday on new day
  if (lastRingDay != timeinfo.tm_mday) {
    ringsToday = 0;
    lastRingDay = timeinfo.tm_mday;
    saveConfig();
  }

  // Reset ringsThisWeek on Monday
  if (timeinfo.tm_wday == 1 && lastRingWeek != timeinfo.tm_yday / 7) {
    ringsThisWeek = 0;
    lastRingWeek = timeinfo.tm_yday / 7;
    saveConfig();
  }

  char dateStr[11];
  sprintf(dateStr, "%04d-%02d-%02d", timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday);
  
  // Check if holiday
  String holidayName = checkHolidayForDate(String(dateStr));
  if (holidayName != "") {
    if (timeinfo.tm_sec == 0 && timeinfo.tm_min == 0 && timeinfo.tm_hour == 8) { // Alert at 8:00 AM
      addNotificationLog("Auto bells muted today for Holiday: " + holidayName + ".", "warning");
    }
    return; // Skip matching
  }

  char currentTimeStr[9];
  sprintf(currentTimeStr, "%02d:%02d:%02d", timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  
  // Get active schedule list
  AlarmTime* activeSchedule = nullptr;
  int activeCount = 0;
  
  if (currentMode == "general") {
    activeSchedule = schedule_general;
    activeCount = generalAlarmCount;
  } else if (currentMode == "exam") {
    activeSchedule = schedule_exam;
    activeCount = examAlarmCount;
  } else if (currentMode == "holiday") {
    activeSchedule = schedule_holiday;
    activeCount = holidayAlarmCount;
  }

  if (activeSchedule == nullptr || activeCount == 0) return;

  // Scan and trigger
  for (int i = 0; i < activeCount; i++) {
    if (activeSchedule[i].time == String(currentTimeStr)) {
      // Index day mapping (tm_wday: 0 = Sun, 1 = Mon, ..., 6 = Sat)
      // Mon-Sun array mapping: index 0 = Mon, 6 = Sun
      int checkIdx = (timeinfo.tm_wday == 0) ? 6 : (timeinfo.tm_wday - 1);
      
      if (activeSchedule[i].days[checkIdx]) {
        Serial.printf("[!] ALARM MATCH: Triggering bell at %s\n", currentTimeStr);
        
        isBellRinging = true;
        bellStartTime = millis();
        digitalWrite(RELAY_PIN, HIGH);
        
        ringsToday++;
        ringsThisWeek++;
        saveConfig();
        
        addNotificationLog("Scheduled bell successfully rang (" + String(currentTimeStr) + ").", "success");
      }
    }
  }
}

void loop() {
  // Process DNS requests for captive portal
  dnsServer.processNextRequest();
  
  server.handleClient();
  
  // Non-blocking Auto-shutoff relay logic
  if (isBellRinging) {
    if (millis() - bellStartTime >= (bellDuration * 1000)) {
      isBellRinging = false;
      digitalWrite(RELAY_PIN, LOW);
      addNotificationLog("Bell duration expired. silenced.", "info");
    }
  }
  
  // Run Alarm matching checks
  checkScheduledAlarms();
}
