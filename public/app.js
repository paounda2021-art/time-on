// TimeOn - WFH Team Status & Attendance Pulse Logic (v2.1.0)
const TIMEON_APP_VERSION = '2.1.0';
console.log(`%c[TimeOn] Active Version: v${TIMEON_APP_VERSION}`, 'color: #0284c7; font-weight: bold; font-size: 13px;');

// Cache safety: verify version and log
(function verifyAppCache() {
  const cachedVer = localStorage.getItem('timeon_app_version');
  if (cachedVer !== TIMEON_APP_VERSION) {
    console.info(`[TimeOn] New version detected: ${TIMEON_APP_VERSION}. Cache refreshed.`);
    localStorage.setItem('timeon_app_version', TIMEON_APP_VERSION);
  }
})();

let socket = null;
let users = [];
let logs = [];
let attendanceLogs = [];
let nudges = [];
let currentUserId = localStorage.getItem('timeon_current_user_id') || 'u1';
let activeFilterDept = 'ALL';
let activeStatusFilter = 'ALL';
let currentTab = 'presence'; // 'presence' | 'attendance'
let targetNudgeUserId = null;
let heartbeatInterval = null;
let clockTickerInterval = null;

// Pagination & Layout State
let presencePage = 1;
let presencePageSize = 18; // Default 18 members per page (fits 3 rows of 6 perfectly)
let attendancePage = 1;
let attendancePageSize = 50;
let layoutMode = 'grid'; // 'grid' | 'compact' | 'list'

// Admin role check helper (Strictly IT Admin, Executives, and HR Admins)
function isUserAdmin(user) {
  if (!user) return false;
  if (user.isAdmin) return true;
  const adminCodes = [
    '07170065', '07170183', '07171111', '07170001', '07170184', '07170185', '07170209',
    '07170141', '07170110', '07170087' // ภาพิมน, อัมพิกา, ขวัญชนก
  ];
  const code = user.empCode || '';
  if (adminCodes.includes(code)) return true;
  const role = user.role || '';
  return /แอดมิน|สารสนเทศ|คอมพิวเตอร์|ผู้ดูแลระบบ|admin/i.test(role);
}

function isUserHR(user) {
  if (!user) return false;
  return ['07170185', '07170209'].includes(user.empCode) || /HR|ทรัพยากรบุคคล/i.test(user.role || '');
}

// Access restricted strictly to Admin
function isUserHRorAdmin(user) {
  return isUserAdmin(user);
}

// Get default silhouette avatar based on title prefix (คำนำหน้าชื่อ: นาย, ว่าที่ ร.ต. vs น.ส., นาง, นางสาว)
function getDefaultAvatarByName(name) {
  const n = (name || '').trim();
  if (/^(น\.ส\.|นางสาว|นาง|ด\.ญ\.)/i.test(n)) {
    return '/assets/avatar-female.svg';
  }
  return '/assets/avatar-male.svg';
}

function getUserAvatar(user) {
  if (!user) return '/assets/avatar-male.svg';
  if (user.avatar && !user.avatar.includes('images.unsplash.com')) {
    return user.avatar;
  }
  return getDefaultAvatarByName(user.name);
}

// Update UI elements visibility for Admin vs Regular Users
function updateAdminVisibility() {
  const me = getCurrentUser();
  const isAdmin = isUserAdmin(me);

  // 1. Navigation Tab Buttons: "ตารางบันทึกการลงเวลา (Attendance Log)" & "จัดการพนักงาน (Employee Management)"
  const tabBtnAttendance = document.getElementById('tabBtnAttendance');
  const tabBtnEmployees = document.getElementById('tabBtnEmployees');
  const navTabsContainer = document.getElementById('navTabsContainer');
  if (tabBtnAttendance || tabBtnEmployees) {
    if (isAdmin) {
      if (tabBtnAttendance) tabBtnAttendance.classList.remove('hidden');
      if (tabBtnEmployees) tabBtnEmployees.classList.remove('hidden');
      if (navTabsContainer) {
        navTabsContainer.className = 'grid grid-cols-1 sm:grid-cols-3 gap-2 w-full sm:w-auto';
      }
    } else {
      if (tabBtnAttendance) tabBtnAttendance.classList.add('hidden');
      if (tabBtnEmployees) tabBtnEmployees.classList.add('hidden');
      if (navTabsContainer) {
        navTabsContainer.className = 'flex items-center gap-2 w-full sm:w-auto';
      }
      // If regular user is on admin tab, redirect to presence
      if (currentTab === 'attendance' || currentTab === 'employees') {
        switchMainTab('presence');
      }
    }
  }

  // 2. Real-time Activity Timeline log section at the bottom of the page
  const timelineSection = document.getElementById('activityTimelineSection');
  if (timelineSection) {
    if (isAdmin) {
      timelineSection.classList.remove('hidden');
    } else {
      timelineSection.classList.add('hidden');
    }
  }

  // 3. Admin badge near profile name
  const adminBadge = document.getElementById('myAdminBadge');
  if (adminBadge) {
    if (isAdmin) {
      adminBadge.classList.remove('hidden');
    } else {
      adminBadge.classList.add('hidden');
    }
  }
}

// Quick switch active user by Employee Code or User ID
function quickSwitchUser(codeOrId) {
  const target = users.find(u => u.empCode === codeOrId || u.id === codeOrId);
  if (target) {
    currentUserId = target.id;
    localStorage.removeItem('timeon_logged_out');
    localStorage.setItem('timeon_is_logged_in', 'true');
    localStorage.setItem('timeon_current_user_id', currentUserId);
    renderAll();
    renderNudges();
    setTimeout(checkPendingUnreadNudges, 350);
    showToast(`สลับบัญชีผู้ใช้งานเป็น: ${target.name} (${target.role}) เรียบร้อยแล้ว`);
  } else {
    showToast('ไม่พบผู้ใช้งานนี้ในระบบ');
  }
}

// Audio context for pleasant UI feedback
let audioCtx = null;
function playNotificationSound(type = 'ping') {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'nudge') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.45);
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    }
  } catch (e) {
    // Ignore audio restriction
  }
}

// Light theme status definitions
const STATUS_META = {
  available: {
    label: '🟢 พร้อมทำงาน',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500',
    borderClass: 'border-emerald-200 hover:border-emerald-400',
    ringClass: 'ring-emerald-400',
    btnClass: 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-500/20'
  },
  busy: {
    label: '🟡 ติดประชุม / โฟกัส',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500',
    borderClass: 'border-amber-200 hover:border-amber-400',
    ringClass: 'ring-amber-400',
    btnClass: 'bg-amber-600 text-white border-amber-500 shadow-amber-500/20'
  },
  break: {
    label: '☕ พักเบรก / ทานข้าว',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    dotClass: 'bg-orange-500',
    borderClass: 'border-orange-200 hover:border-orange-400',
    ringClass: 'ring-orange-400',
    btnClass: 'bg-orange-600 text-white border-orange-500 shadow-orange-500/20'
  },
  idle: {
    label: '⏱️ ไม่อยู่ที่โต๊ะ (Idle)',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-300',
    dotClass: 'bg-slate-400',
    borderClass: 'border-slate-200',
    ringClass: 'ring-slate-300',
    btnClass: 'bg-slate-600 text-white border-slate-500'
  },
  offline: {
    label: '⚪ เลิกงาน / ออฟไลน์',
    badgeClass: 'bg-slate-100 text-slate-500 border-slate-200',
    dotClass: 'bg-slate-400',
    borderClass: 'border-slate-200',
    ringClass: 'ring-slate-200',
    btnClass: 'bg-slate-600 text-white border-slate-500'
  }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
  setupVisibilityListener();
  setupEventHandlers();
  initExportDatePickers();

  // Immediate initial clock tick
  updateLiveClock();

  // Periodic clock ticker
  clockTickerInterval = setInterval(() => {
    updateLiveClock();
    updateMyTimeInStatus();
    updateMyAttendanceLiveTime();
  }, 1000);

  // Send heartbeat every 10 seconds
  heartbeatInterval = setInterval(sendHeartbeat, 10000);
});

// Setup WebSocket Connection
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    updateConnectionStatus(true);
    sendHeartbeat();
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (err) {
      console.error('Error handling WS message:', err);
    }
  };

  socket.onclose = () => {
    updateConnectionStatus(false);
    setTimeout(initWebSocket, 3000);
  };

  socket.onerror = (err) => {
    console.warn('WebSocket encountered error:', err);
  };
}

function updateConnectionStatus(connected) {
  const indicator = document.getElementById('connectionStatus');
  const text = document.getElementById('connectionText');
  if (connected) {
    indicator.className = 'hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200';
    text.textContent = 'Realtime Connected';
  } else {
    indicator.className = 'hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200';
    text.textContent = 'กำลังเชื่อมต่อใหม่...';
  }
}

// Live Bangkok Clock
function updateLiveClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok'
  });
  const fullText = `${timeStr} น.`;

  // Update all clock elements across header and navigation bar
  const clockElements = document.querySelectorAll('#currentLiveClock, #headerLiveClock, .currentLiveClock');
  clockElements.forEach(el => {
    if (el.getAttribute('data-format') === 'short') {
      el.textContent = timeStr;
    } else {
      el.textContent = fullText;
    }
  });
}

// Handle incoming messages from Server
function handleServerMessage(msg) {
  if (msg.type === 'INIT') {
    users = msg.users || [];
    logs = msg.logs || [];
    attendanceLogs = msg.attendanceLogs || [];
    nudges = msg.nudges || [];
    populateUserSelector();
    renderAll();
    renderNudges();
    setTimeout(checkPendingUnreadNudges, 600);
    initClockInFirstPage();
  } else if (msg.type === 'STATUS_UPDATED') {
    const updatedUser = msg.user;
    const index = users.findIndex(u => u.id === updatedUser.id);
    if (index !== -1) {
      users[index] = updatedUser;
    } else {
      users.push(updatedUser);
    }

    if (msg.log) {
      logs.unshift(msg.log);
      if (logs.length > 50) logs.pop();
    }

    if (updatedUser.id === currentUserId) {
      renderMyStatus();
    }

    renderTeamGrid();
    renderStats();
    renderActivityLogs();
    renderAttendanceView();

    if (updatedUser.id !== currentUserId) {
      const meta = STATUS_META[updatedUser.status] || STATUS_META.available;
      showToast(`${updatedUser.name} เปลี่ยนสถานะเป็น ${meta.label}`);
    }
  } else if (msg.type === 'ATTENDANCE_UPDATED') {
    const updatedUser = msg.user;
    const index = users.findIndex(u => u.id === updatedUser.id);
    if (index !== -1) {
      users[index] = updatedUser;
    }

    if (msg.attendanceLog) {
      attendanceLogs.unshift(msg.attendanceLog);
      if (attendanceLogs.length > 100) attendanceLogs.pop();
    }
    if (msg.activityLog) {
      logs.unshift(msg.activityLog);
      if (logs.length > 50) logs.pop();
    }

    if (updatedUser.id === currentUserId) {
      renderMyStatus();
      playNotificationSound('ping');
    }

    renderTeamGrid();
    renderStats();
    renderActivityLogs();
    renderAttendanceView();

    const actionText = updatedUser.attendance?.status === 'checked_in' ? 'ลงเวลาเข้างาน' : 'ลงเวลาออกงาน';
    showToast(`${updatedUser.name} ได้${actionText}แล้ว (${updatedUser.attendance?.location || 'WFH'})`, 'info');
  } else if (msg.type === 'HEARTBEAT_ACK') {
    const u = users.find(user => user.id === msg.userId);
    if (u) {
      u.lastHeartbeat = msg.lastHeartbeat;
      u.isTabActive = msg.isTabActive;
    }
  } else if (msg.type === 'NUDGE_RECEIVED') {
    if (msg.nudges) {
      nudges = msg.nudges;
    } else if (msg.nudge) {
      nudges.unshift(msg.nudge);
    }
    renderNudges();
  } else if (msg.type === 'REFRESH_USERS' || msg.type === 'RESET_ATTENDANCE') {
    if (msg.users) users = msg.users;
    if (msg.logs) logs = msg.logs;
    if (msg.attendanceLogs) attendanceLogs = msg.attendanceLogs;
    populateUserSelector();
    renderAll();
    showToast('รีเฟรชข้อมูลสถานะและเวลาการทำงานเรียบร้อยแล้ว 🔄', 'info');
    if (msg.toUserId === currentUserId) {
      playNotificationSound('nudge');
      showNudgeModal(msg.fromUser, msg.message);
    }
  } else if (msg.type === 'NUDGES_UPDATED') {
    nudges = msg.nudges || [];
    renderNudges();
  } else if (msg.type === 'BREAK_EXPIRED') {
    if (msg.userId === currentUserId) {
      playNotificationSound('nudge');
      showToast('⏰ หมดเวลาพักเบรกแล้ว อย่าลืมกดกลับมา "พร้อมทำงาน" นะครับ', 'warning');
    }
  } else if (msg.type === 'PROFILE_UPDATED') {
    const updatedUser = msg.user;
    const index = users.findIndex(u => u.id === updatedUser.id);
    if (index !== -1) {
      users[index] = updatedUser;
    }
    if (msg.activityLog) {
      logs.unshift(msg.activityLog);
      if (logs.length > 50) logs.pop();
    }
    if (updatedUser.id === currentUserId) {
      renderMyStatus();
    }
    renderTeamGrid();
    renderAttendanceView();
    populateUserSelector();
    if (updatedUser.id !== currentUserId) {
      showToast(`อัปเดตข้อมูลของ ${updatedUser.name} สำเร็จ`, 'info');
    }
  } else if (msg.type === 'USER_ADDED') {
    if (msg.user) {
      const idx = users.findIndex(u => u.id === msg.user.id);
      if (idx !== -1) users[idx] = msg.user;
      else users.push(msg.user);
    }
    if (msg.activityLog) {
      logs.unshift(msg.activityLog);
      if (logs.length > 50) logs.pop();
    }
    populateUserSelector();
    renderAll();
    if (currentTab === 'employees') renderEmployeesAdminView();
    showToast(`พนักงานใหม่: ${msg.user?.name || ''} ถูกเพิ่มเข้าสู่ระบบแล้ว 🎉`, 'success');
  } else if (msg.type === 'USER_UPDATED') {
    if (msg.user) {
      const idx = users.findIndex(u => u.id === msg.user.id);
      if (idx !== -1) users[idx] = msg.user;
      else users.push(msg.user);
      if (msg.user.id === currentUserId) {
        renderMyStatus();
        updateAdminVisibility();
      }
    }
    if (msg.activityLog) {
      logs.unshift(msg.activityLog);
      if (logs.length > 50) logs.pop();
    }
    populateUserSelector();
    renderAll();
    if (currentTab === 'employees') renderEmployeesAdminView();
    showToast(`อัปเดตข้อมูลพนักงาน ${msg.user?.name || ''} เรียบร้อยแล้ว ✨`, 'info');
  } else if (msg.type === 'USER_DELETED') {
    const deletedId = msg.userId;
    users = users.filter(u => u.id !== deletedId);
    if (msg.activityLog) {
      logs.unshift(msg.activityLog);
      if (logs.length > 50) logs.pop();
    }
    populateUserSelector();
    renderAll();
    if (currentTab === 'employees') renderEmployeesAdminView();
    showToast(`ลบข้อมูลพนักงาน (${msg.deletedUser?.name || deletedId}) ออกจากระบบแล้ว`, 'warning');
  }
}

// Send Heartbeat to server
function sendHeartbeat() {
  if (socket && socket.readyState === WebSocket.OPEN && currentUserId) {
    socket.send(JSON.stringify({
      type: 'HEARTBEAT',
      userId: currentUserId,
      isTabActive: !document.hidden
    }));
  }
}

function setupVisibilityListener() {
  document.addEventListener('visibilitychange', () => {
    const indicator = document.getElementById('tabStateIndicator');
    const isHidden = document.hidden;
    if (isHidden) {
      if (indicator) indicator.textContent = '⏸️ ย่อหน้าจอไว้ (Tab Inactive)';
    } else {
      if (indicator) indicator.textContent = '👀 หน้าจอกำลังทำงาน';
    }
    sendHeartbeat();
  });
}

function setupEventHandlers() {
  const userSelector = document.getElementById('userSelector');
  if (userSelector) {
    userSelector.addEventListener('change', (e) => {
      currentUserId = e.target.value;
      localStorage.setItem('timeon_current_user_id', currentUserId);
      renderAll();
      sendHeartbeat();
      showToast(`สลับโปรไฟล์เป็น: ${getCurrentUser()?.name}`);
    });
  }

  const resetBtn = document.getElementById('resetDemoBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      showConfirmToast('คุณต้องการรีเซ็ตข้อมูลตัวอย่างกลับเป็นค่าเริ่มต้น (97 คน) หรือไม่?', async () => {
        try {
          await fetch('/api/reset-demo', { method: 'POST' });
          showToast('รีเซ็ตข้อมูลเรียบร้อยแล้ว (97 คน)', 'success');
        } catch (err) {
          console.error(err);
          showToast('เกิดข้อผิดพลาดในการรีเซ็ตข้อมูล', 'error');
        }
      }, {
        confirmText: 'ยืนยันรีเซ็ต',
        cancelText: 'ยกเลิก',
        isDanger: true,
        icon: 'rotate-ccw'
      });
    });
  }

  const noteInput = document.getElementById('noteInput');
  if (noteInput) {
    noteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveNote();
      }
    });
  }
}

function getCurrentUser() {
  return users.find(u => u.id === currentUserId) || users[0];
}

function populateUserSelector() {
  const userSelector = document.getElementById('userSelector');
  if (!userSelector) return;
  userSelector.innerHTML = '';

  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `[${u.empCode || 'ID'}] ${u.name} (${u.nickname}) - ${u.role}`;
    if (u.id === currentUserId) opt.selected = true;
    userSelector.appendChild(opt);
  });
}

// Tab Switching (Presence vs Attendance vs Employees)
function switchMainTab(tab) {
  const me = getCurrentUser();
  const isAdmin = isUserAdmin(me);

  // If not admin, strictly keep on presence tab
  if ((tab === 'attendance' || tab === 'employees') && !isAdmin) {
    tab = 'presence';
  }

  currentTab = tab;
  localStorage.setItem('timeon_current_tab', tab);
  const viewPresence = document.getElementById('viewPresence');
  const viewAttendance = document.getElementById('viewAttendance');
  const viewEmployees = document.getElementById('viewEmployees');
  const btnPres = document.getElementById('tabBtnPresence');
  const btnAtt = document.getElementById('tabBtnAttendance');
  const btnEmp = document.getElementById('tabBtnEmployees');

  // Hide all views first
  if (viewPresence) viewPresence.classList.add('hidden');
  if (viewAttendance) viewAttendance.classList.add('hidden');
  if (viewEmployees) viewEmployees.classList.add('hidden');

  const inactiveBtnClass = 'px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-white hover:bg-sky-50 text-slate-600 border border-slate-200 transition flex items-center justify-center gap-1.5 cursor-pointer';
  const activeBtnClass = 'px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-sky-600 text-white shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer';

  if (btnPres) btnPres.className = inactiveBtnClass;
  if (btnAtt) btnAtt.className = (isAdmin ? '' : 'hidden ') + inactiveBtnClass;
  if (btnEmp) btnEmp.className = (isAdmin ? '' : 'hidden ') + inactiveBtnClass;

  if (tab === 'presence') {
    if (viewPresence) viewPresence.classList.remove('hidden');
    if (btnPres) btnPres.className = activeBtnClass;
  } else if (tab === 'attendance') {
    if (viewAttendance) viewAttendance.classList.remove('hidden');
    if (btnAtt) btnAtt.className = activeBtnClass;
    renderAttendanceView();
  } else if (tab === 'employees') {
    if (viewEmployees) viewEmployees.classList.remove('hidden');
    if (btnEmp) btnEmp.className = activeBtnClass;
    renderEmployeesAdminView();
  }
  if (window.lucide) window.lucide.createIcons();
}

// Layout Mode Switcher ('grid' | 'compact' | 'list')
function setLayoutMode(mode) {
  layoutMode = mode;
  ['grid', 'compact', 'list'].forEach(m => {
    const cap = m.charAt(0).toUpperCase() + m.slice(1);
    const btn = document.getElementById(`btnLayout${cap}`);
    if (btn) {
      if (m === mode) {
        btn.className = 'px-2.5 py-1 rounded-lg font-bold bg-white text-sky-700 shadow-sm border border-slate-200 transition flex items-center gap-1';
      } else {
        btn.className = 'px-2.5 py-1 rounded-lg font-medium text-slate-600 hover:text-sky-700 transition flex items-center gap-1';
      }
    }
  });

  const grid = document.getElementById('teamGrid');
  grid.classList.remove('layout-compact', 'layout-list');
  if (mode === 'compact') {
    grid.classList.add('layout-compact');
  } else if (mode === 'list') {
    grid.classList.add('layout-list');
  }

  renderTeamGrid();
}

// Page Size Change for Presence Grid
function changePresencePageSize(val) {
  presencePageSize = val === 'ALL' ? 'ALL' : parseInt(val);
  presencePage = 1;

  // Update quick button text
  const btnText = document.getElementById('btnViewAllPresenceText');
  if (btnText) {
    if (presencePageSize === 'ALL') {
      btnText.textContent = 'แสดงแบบ 18 คน / หน้า';
    } else {
      btnText.textContent = `ดูทั้งหมด (${users.length} คน)`;
    }
  }

  renderTeamGrid();
}

function toggleViewAllPresence() {
  const sel = document.getElementById('presencePageSizeSelect');
  if (presencePageSize === 'ALL') {
    presencePageSize = 18;
    if (sel) sel.value = '18';
  } else {
    presencePageSize = 'ALL';
    if (sel) sel.value = 'ALL';
  }
  presencePage = 1;

  const btnText = document.getElementById('btnViewAllPresenceText');
  if (btnText) {
    btnText.textContent = presencePageSize === 'ALL' ? 'แสดงแบบ 18 คน / หน้า' : `ดูทั้งหมด (${users.length} คน)`;
  }

  renderTeamGrid();
}

function goToPresencePage(p) {
  presencePage = p;
  renderTeamGrid();
  document.getElementById('teamGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Page Size Change for Attendance Timesheet
function changeAttendancePageSize(val) {
  attendancePageSize = val === 'ALL' ? 'ALL' : parseInt(val);
  attendancePage = 1;
  renderAttendanceView();
}

function goToAttendancePage(p) {
  attendancePage = p;
  renderAttendanceView();
}

// Render everything
function renderAll() {
  updateAdminVisibility();
  updateLiveClock();
  renderMyStatus();
  renderStats();
  renderTeamGrid();
  renderActivityLogs();
  renderAttendanceView();
  renderNudges();

  // Restore active tab
  const savedTab = localStorage.getItem('timeon_current_tab') || currentTab || 'presence';
  if (savedTab === 'attendance' && isUserAdmin(getCurrentUser())) {
    switchMainTab('attendance');
  } else if (savedTab === 'employees' && isUserAdmin(getCurrentUser())) {
    switchMainTab('employees');
  } else {
    switchMainTab('presence');
  }

  if (window.lucide) window.lucide.createIcons();
}

// Render Section 1: My Personal Status & Attendance
function renderMyStatus() {
  const me = getCurrentUser();
  if (!me) return;

  const nameEl = document.getElementById('myName');
  if (nameEl) nameEl.textContent = me.name;
  const roleEl = document.getElementById('myRoleTag');
  if (roleEl) roleEl.textContent = me.role || '-';
  document.getElementById('myAvatar').src = getUserAvatar(me);

  const empCodeBadge = document.getElementById('myEmpCodeBadge');
  if (empCodeBadge) empCodeBadge.textContent = `รหัส: ${me.empCode || '-'}`;

  const deptText = document.getElementById('myDepartmentText');
  if (deptText) deptText.textContent = me.department || '-';

  const phoneText = document.getElementById('myPhoneText');
  if (phoneText) phoneText.textContent = `📞 ${me.phone || '02-211-7300'}`;

  const emailText = document.getElementById('myEmailText');
  if (emailText) emailText.textContent = `✉️ ${me.email || '-'}`;

  const meta = STATUS_META[me.status] || STATUS_META.available;
  const badgeDot = document.getElementById('myStatusBadgeDot');
  badgeDot.className = `absolute -bottom-1 -right-1 w-5 h-5 rounded-full border-2 border-white ${meta.dotClass}`;

  const noteInput = document.getElementById('noteInput');
  if (document.activeElement !== noteInput) {
    noteInput.value = me.note || '';
  }

  ['available', 'busy', 'break', 'offline'].forEach(st => {
    const cap = st.charAt(0).toUpperCase() + st.slice(1);
    const btn = document.getElementById(`btnStatus${cap}`);
    if (!btn) return;

    if (me.status === st) {
      btn.className = `flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs transition border shadow-sm ring-2 ${STATUS_META[st].btnClass} ${STATUS_META[st].ringClass}`;
    } else {
      btn.className = `flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl font-semibold text-xs transition border border-slate-200 bg-white text-slate-600 hover:bg-sky-50 hover:text-sky-700 shadow-sm`;
    }
  });

  const att = me.attendance || { status: 'not_checked_in', location: 'WFH' };
  const attBadge = document.getElementById('myAttendanceBadge');
  const btnToggle = document.getElementById('btnAttendanceToggle');
  const btnText = document.getElementById('btnAttendanceText');
  const locSelect = document.getElementById('workLocationSelect');
  const checkInText = document.getElementById('myCheckInTimeText');
  const checkOutText = document.getElementById('myCheckOutTimeText');

  locSelect.value = att.location || 'WFH';
  checkInText.textContent = att.checkInTime ? `${att.checkInTime} น.` : '-';
  checkOutText.textContent = att.checkOutTime ? `${att.checkOutTime} น.` : '-';

  if (att.status === 'checked_in') {
    attBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200';
    attBadge.textContent = `เข้างานแล้ว (${att.location})`;

    btnToggle.className = 'px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md transition flex items-center gap-1.5 bg-rose-600 hover:bg-rose-500';
    btnText.textContent = 'ลงเวลาเลิกงาน (Check-Out)';
  } else if (att.status === 'checked_out') {
    attBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200';
    attBadge.textContent = 'เลิกงานแล้ว';

    btnToggle.className = 'px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md transition flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500';
    btnText.textContent = 'ลงเวลาเข้างานใหม่';
  } else {
    attBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200';
    attBadge.textContent = 'ยังไม่ได้ลงเวลา';

    btnToggle.className = 'px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md transition flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500';
    btnText.textContent = 'ลงเวลาเข้างาน (Check-In)';
  }

  updateMyTimeInStatus();
  updateMyAttendanceLiveTime();
}

function updateMyAttendanceLiveTime() {
  const me = getCurrentUser();
  if (!me || !me.attendance) return;

  const att = me.attendance;
  const hoursText = document.getElementById('myTotalWorkHoursText');
  if (!hoursText) return;

  if (att.status === 'checked_in' && att.checkInTimestamp) {
    const diffMs = Math.max(0, Date.now() - att.checkInTimestamp);
    const mins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(mins / 60);
    hoursText.textContent = `${hrs} ชม. ${mins % 60} นาที`;
  } else if (att.status === 'checked_out' && att.checkInTimestamp && att.checkOutTimestamp) {
    const diffMs = Math.max(0, att.checkOutTimestamp - att.checkInTimestamp);
    const mins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(mins / 60);
    hoursText.textContent = `${hrs} ชม. ${mins % 60} นาที (สำเร็จ)`;
  } else {
    hoursText.textContent = '-';
  }
}

function updateMyTimeInStatus() {
  const me = getCurrentUser();
  if (!me) return;

  const diffMs = Math.max(0, Date.now() - (me.statusChangedAt || Date.now()));
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);

  let timeStr = '';
  if (hrs > 0) {
    timeStr = `อยู่ในสถานะนี้: ${hrs} ชม. ${mins % 60} นาที`;
  } else if (mins > 0) {
    timeStr = `อยู่ในสถานะนี้: ${mins} นาที`;
  } else {
    timeStr = 'เพิ่งเปลี่ยนสถานะเมื่อสักครู่';
  }

  if (me.status === 'break' && me.breakUntil) {
    const leftMs = me.breakUntil - Date.now();
    if (leftMs > 0) {
      const leftMin = Math.ceil(leftMs / 60000);
      timeStr += ` (เหลือเบรก ~${leftMin} น.)`;
    }
  }

  const el = document.getElementById('myTimeInStatus');
  if (el) el.textContent = timeStr;
}

// Location Change: พอเลือก WFH ให้บันทึกเวลาปฏิบัติงานเลย
function handleWorkLocationChange(location) {
  const me = getCurrentUser();
  if (!me) return;

  const att = me.attendance || { status: 'not_checked_in' };

  if (location === 'WFH') {
    // When WFH is chosen: Record attendance immediately!
    if (att.status !== 'checked_in') {
      clockInCurrentWithLocation('WFH');
    } else {
      // If already checked in, switch location to WFH
      me.attendance.location = 'WFH';
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'CHECK_IN',
          userId: me.id,
          location: 'WFH',
          note: 'ปฏิบัติงานที่บ้าน (WFH)'
        }));
      }
      showToast(`เปลี่ยนสถานที่ปฏิบัติงานเป็น WFH เรียบร้อยแล้ว 🏠`, 'info');
    }
  } else if (location === 'Office') {
    if (att.status !== 'checked_in') {
      clockInCurrentWithLocation('Office');
    } else {
      me.attendance.location = 'Office';
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'CHECK_IN',
          userId: me.id,
          location: 'Office',
          note: 'สลับมาปฏิบัติงานที่สำนักงาน'
        }));
      }
      showToast(`เปลี่ยนสถานที่ปฏิบัติงานเป็น Office 🏢`, 'info');
    }
  }
}

// 1-Click Clock-in (Default WFH)
function clockInCurrentWithLocation(location = 'WFH') {
  const me = getCurrentUser();
  if (!me) return;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'CHECK_IN',
      userId: me.id,
      location: location,
      note: `ลงเวลาปฏิบัติงาน (${location}) ทันที`
    }));
  } else {
    fetch('/api/attendance/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: me.id, location: location, note: `ลงเวลาปฏิบัติงาน (${location})` })
    });
  }

  playNotificationSound('ping');
  showToast(`🏠 บันทึกเวลาปฏิบัติงาน ${location} สำหรับ ${me.name} เรียบร้อยแล้ว!`, 'success');
}

// Attendance Button Click Handler (Check-In / Check-Out)
function handleAttendanceButtonClick() {
  const me = getCurrentUser();
  if (!me) return;

  const att = me.attendance || { status: 'not_checked_in' };
  const loc = document.getElementById('workLocationSelect').value;

  if (att.status === 'checked_in') {
    showConfirmToast('คุณต้องการลงเวลาเลิกงาน (Check-Out) ตอนนี้ใช่หรือไม่?', () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'CHECK_OUT',
          userId: me.id,
          note: 'ลงเวลาเลิกงานตามปกติ'
        }));
      }
      playNotificationSound('ping');
      showToast('กำลังลงเวลาเลิกงาน... 👋', 'info');
    }, {
      confirmText: 'ยืนยันเลิกงาน',
      cancelText: 'ยกเลิก',
      isDanger: true,
      icon: 'log-out'
    });
  } else {
    clockInCurrentWithLocation(loc);
  }
}

// Change My Status Action
function changeStatus(newStatus, customNote = null, breakMinutes = null) {
  const me = getCurrentUser();
  if (!me) return;

  playNotificationSound('ping');

  const note = customNote !== null ? customNote : (document.getElementById('noteInput').value.trim() || me.note);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'UPDATE_STATUS',
      userId: me.id,
      status: newStatus,
      note: note,
      breakMinutes: breakMinutes
    }));
  }

  showToast(`อัปเดตสถานะเป็น "${STATUS_META[newStatus]?.label || newStatus}" แล้ว`);
}

function saveNote() {
  const me = getCurrentUser();
  if (!me) return;
  const note = document.getElementById('noteInput').value.trim();
  changeStatus(me.status, note);
}

function setQuickNote(text) {
  document.getElementById('noteInput').value = text;
  const me = getCurrentUser();
  changeStatus(me.status, text);
}

function setQuickBreak(minutes) {
  const note = minutes >= 60 ? 'ทานข้าวกลางวัน (1 ชม.) 🍱' : `พักเบรก ${minutes} นาที ☕`;
  document.getElementById('noteInput').value = note;
  changeStatus('break', note, minutes);
}

// Render Stats Counters
function renderStats() {
  document.getElementById('countTotal').textContent = users.length;
  document.getElementById('countAvailable').textContent = users.filter(u => u.status === 'available').length;
  document.getElementById('countBusy').textContent = users.filter(u => u.status === 'busy').length;
  document.getElementById('countBreak').textContent = users.filter(u => u.status === 'break').length;
  document.getElementById('countOffline').textContent = users.filter(u => u.status === 'offline' || u.status === 'idle').length;

  const btnViewAll = document.getElementById('btnViewAllPresenceText');
  if (btnViewAll && presencePageSize !== 'ALL') {
    btnViewAll.textContent = `ดูทั้งหมด (${users.length} คน)`;
  }

  // Update counts in department dropdowns
  const counts = {};
  users.forEach(u => {
    counts[u.department] = (counts[u.department] || 0) + 1;
  });

  const optionsData = [
    { val: 'ALL', label: `🏢 ทั้งหมด (ทุกหน่วยงาน - ${users.length} คน)` },
    { val: 'ผู้บริหาร (ระดับ 11, 10)', label: `👑 ผู้บริหาร (ระดับ 11, 10) (${counts['ผู้บริหาร (ระดับ 11, 10)'] || 0} คน)` },
    { val: 'ฝ่ายตรวจสอบภายใน', label: `🔍 1. ฝ่ายตรวจสอบภายใน (${counts['ฝ่ายตรวจสอบภายใน'] || 0} คน)` },
    { val: 'สำนักงานเลขานุการผู้อำนวยการ', label: `📝 2. สำนักงานเลขานุการผู้อำนวยการ (${counts['สำนักงานเลขานุการผู้อำนวยการ'] || 0} คน)` },
    { val: 'สำนักงานอำนวยการ', label: `🏛️ 3. สำนักงานอำนวยการ (${counts['สำนักงานอำนวยการ'] || 0} คน)` },
    { val: 'ฝ่ายบริหารและพัฒนาองค์กร', label: `👥 4. ฝ่ายบริหารและพัฒนาองค์กร (${counts['ฝ่ายบริหารและพัฒนาองค์กร'] || 0} คน)` },
    { val: 'ฝ่ายบัญชีการเงิน', label: `💰 5. ฝ่ายบัญชีการเงิน (${counts['ฝ่ายบัญชีการเงิน'] || 0} คน)` },
    { val: 'ฝ่ายยุทธศาสตร์การพัฒนา', label: `📈 6. ฝ่ายยุทธศาสตร์การพัฒนา (${counts['ฝ่ายยุทธศาสตร์การพัฒนา'] || 0} คน)` },
    { val: 'ฝ่ายสินเชื่อ', label: `💳 7. ฝ่ายสินเชื่อ (${counts['ฝ่ายสินเชื่อ'] || 0} คน)` },
    { val: 'ฝ่ายส่งเสริมและโครงการพิเศษ', label: `🎯 8. ฝ่ายส่งเสริมและโครงการพิเศษ (${counts['ฝ่ายส่งเสริมและโครงการพิเศษ'] || 0} คน)` },
    { val: 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1', label: `⚓ 9. ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1 (${counts['ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1'] || 0} คน)` },
    { val: 'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2', label: `⚓ 10. ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2 (${counts['ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2'] || 0} คน)` },
    { val: 'สำนักงานบริหารหนี้', label: `📑 11. สำนักงานบริหารหนี้ (${counts['สำนักงานบริหารหนี้'] || 0} คน)` }
  ];

  document.querySelectorAll('.dept-select, #deptSelect, #deptSelectMobile').forEach(sel => {
    const curVal = sel.value || activeFilterDept;
    sel.innerHTML = optionsData
      .map(d => `<option value="${d.val}" ${d.val === curVal ? 'selected' : ''}>${d.label}</option>`)
      .join('');
  });

  // Update quick all button
  const quickAllBtn = document.getElementById('quickAllBtn');
  if (quickAllBtn) {
    quickAllBtn.textContent = `ทั้งหมด (${users.length})`;
    if (activeFilterDept === 'ALL') {
      quickAllBtn.className = '2xl:hidden px-3 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white shadow-xs transition flex items-center gap-1.5 shrink-0';
    } else {
      quickAllBtn.className = '2xl:hidden px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-sky-50 text-slate-700 border border-slate-200 shadow-xs transition flex items-center gap-1.5 shrink-0';
    }
  }

  // Also update desktop filter pills with counts (เรียง 1-11 ตาม รายชื่อหน่วยงาน69.txt)
  const deptLabels = {
    'ALL': `ทั้งหมด (${users.length} คน)`,
    'ผู้บริหาร (ระดับ 11, 10)': `👑 ผู้บริหาร (ระดับ 11, 10) (${counts['ผู้บริหาร (ระดับ 11, 10)'] || 0})`,
    'ฝ่ายตรวจสอบภายใน': `1. ฝ่ายตรวจสอบภายใน (${counts['ฝ่ายตรวจสอบภายใน'] || 0})`,
    'สำนักงานเลขานุการผู้อำนวยการ': `2. สำนักงานเลขานุการผู้อำนวยการ (${counts['สำนักงานเลขานุการผู้อำนวยการ'] || 0})`,
    'สำนักงานอำนวยการ': `3. สำนักงานอำนวยการ (${counts['สำนักงานอำนวยการ'] || 0})`,
    'ฝ่ายบริหารและพัฒนาองค์กร': `4. ฝ่ายบริหารและพัฒนาองค์กร (${counts['ฝ่ายบริหารและพัฒนาองค์กร'] || 0})`,
    'ฝ่ายบัญชีการเงิน': `5. ฝ่ายบัญชีการเงิน (${counts['ฝ่ายบัญชีการเงิน'] || 0})`,
    'ฝ่ายยุทธศาสตร์การพัฒนา': `6. ฝ่ายยุทธศาสตร์การพัฒนา (${counts['ฝ่ายยุทธศาสตร์การพัฒนา'] || 0})`,
    'ฝ่ายสินเชื่อ': `7. ฝ่ายสินเชื่อ (${counts['ฝ่ายสินเชื่อ'] || 0})`,
    'ฝ่ายส่งเสริมและโครงการพิเศษ': `8. ฝ่ายส่งเสริมและโครงการพิเศษ (${counts['ฝ่ายส่งเสริมและโครงการพิเศษ'] || 0})`,
    'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1': `9. ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1 (${counts['ฝ่ายสะพานปลาและท่าเทียบเรือประมง 1'] || 0})`,
    'ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2': `10. ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2 (${counts['ฝ่ายสะพานปลาและท่าเทียบเรือประมง 2'] || 0})`,
    'สำนักงานบริหารหนี้': `11. สำนักงานบริหารหนี้ (${counts['สำนักงานบริหารหนี้'] || 0})`
  };

  document.querySelectorAll('#deptFilterContainer .dept-btn').forEach(btn => {
    const dept = btn.getAttribute('data-dept');
    if (deptLabels[dept]) {
      btn.textContent = deptLabels[dept];
    }
  });
}

// Render Team Cards Grid with 50/page pagination and View All
function renderTeamGrid() {
  const grid = document.getElementById('teamGrid');
  grid.innerHTML = '';

  const searchVal = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const toggle = document.getElementById('onlyAvailableToggle');
  const onlyAvailable = toggle ? toggle.checked : true;

  const filtered = users.filter(u => {
    if (activeFilterDept !== 'ALL' && u.department !== activeFilterDept) return false;

    // Status filter
    if (onlyAvailable) {
      if (u.status !== 'available') return false;
    } else if (activeStatusFilter !== 'ALL') {
      if (activeStatusFilter === 'offline') {
        if (u.status !== 'offline' && u.status !== 'idle') return false;
      } else {
        if (u.status !== activeStatusFilter) return false;
      }
    }

    if (searchVal) {
      const matchName = (u.name || '').toLowerCase().includes(searchVal);
      const matchNick = (u.nickname || '').toLowerCase().includes(searchVal);
      const matchRole = (u.role || '').toLowerCase().includes(searchVal);
      const matchDept = (u.department || '').toLowerCase().includes(searchVal);
      const matchNote = (u.note || '').toLowerCase().includes(searchVal);
      const matchCode = (u.empCode || '').toLowerCase().includes(searchVal);
      if (!matchName && !matchNick && !matchRole && !matchDept && !matchNote && !matchCode) return false;
    }
    return true;
  });

  const totalFiltered = filtered.length;
  document.getElementById('presenceTotalCount').textContent = totalFiltered;

  if (totalFiltered === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-slate-400 bg-white rounded-2xl border border-sky-100">
        <i data-lucide="users" class="w-10 h-10 mx-auto mb-2 text-slate-300"></i>
        <p class="text-sm">ไม่พบเพื่อนร่วมทีมที่ตรงกับเงื่อนไขการค้นหา</p>
      </div>
    `;
    document.getElementById('presenceRangeText').textContent = '0 - 0';
    document.getElementById('presencePaginationBtns').innerHTML = '';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Calculate slice range based on presencePageSize
  let displayUsers = [];
  let startIndex = 0;
  let endIndex = totalFiltered;

  if (presencePageSize === 'ALL') {
    displayUsers = filtered;
    startIndex = 0;
    endIndex = totalFiltered;
    document.getElementById('presenceRangeText').textContent = `1 - ${totalFiltered} (ทั้งหมด)`;
  } else {
    const size = parseInt(presencePageSize) || 50;
    const totalPages = Math.ceil(totalFiltered / size) || 1;
    if (presencePage > totalPages) presencePage = totalPages;
    if (presencePage < 1) presencePage = 1;

    startIndex = (presencePage - 1) * size;
    endIndex = Math.min(startIndex + size, totalFiltered);
    displayUsers = filtered.slice(startIndex, endIndex);

    document.getElementById('presenceRangeText').textContent = `${startIndex + 1} - ${endIndex}`;
  }

  // Render pagination buttons
  renderPresencePaginationControls(totalFiltered);

  // Render cards
  displayUsers.forEach(u => {
    const isMe = u.id === currentUserId;
    const meta = STATUS_META[u.status] || STATUS_META.available;

    const diffMs = Math.max(0, Date.now() - (u.statusChangedAt || Date.now()));
    const mins = Math.floor(diffMs / 60000);
    const hrs = Math.floor(mins / 60);
    let durationStr = hrs > 0 ? `${hrs} ชม. ${mins % 60} น.` : `${mins} นาที`;

    const hbDiff = Math.max(0, Math.floor((Date.now() - (u.lastHeartbeat || 0)) / 1000));
    let hbText = hbDiff < 15 ? 'Active' : `${hbDiff}s ago`;
    let hbBadgeClass = hbDiff < 25 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200';

    const att = u.attendance || { status: 'not_checked_in', location: 'WFH' };
    let attBadgeHtml = '';
    // STRICT RULE: Only show check-in / check-out time if user is NOT offline and is actually checked in!
    if (u.status !== 'offline' && att.status === 'checked_in' && att.checkInTime) {
      attBadgeHtml = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">เข้า ${att.checkInTime}</span>`;
    } else if (u.status !== 'offline' && att.status === 'checked_out' && att.checkOutTime) {
      attBadgeHtml = `<span class="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">ออก ${att.checkOutTime}</span>`;
    } else {
      attBadgeHtml = `<span class="px-2 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-400 border border-slate-200">ยังไม่ลงเวลา</span>`;
    }

    // Clean online status: only show pulse badge if actively open, no raw seconds
    let hbBadgeHtml = '';
    if (u.status !== 'offline' && hbDiff < 60) {
      hbBadgeHtml = `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200" title="กำลังใช้งาน"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>ออนไลน์</span>`;
    }

    let cleanNote = u.note || '';
    if (u.status === 'offline') {
      cleanNote = '<span class="text-slate-400 italic">ยังไม่เข้าปฏิบัติงาน</span>';
    } else if (!cleanNote) {
      cleanNote = '<span class="text-slate-400 italic">ไม่มีบันทึก</span>';
    }

    const card = document.createElement('div');
    card.className = `glass-card rounded-xl p-2.5 sm:p-3 flex flex-col justify-between border ${meta.borderClass} relative overflow-hidden ${isMe ? 'ring-2 ring-sky-500/50 bg-sky-50/20' : ''}`;

    if (layoutMode === 'list') {
      card.innerHTML = `
        <div class="flex items-center gap-2.5 w-full sm:w-auto">
          <div class="relative shrink-0">
            <img src="${getUserAvatar(u)}" alt="${u.name}" class="w-8 h-8 rounded-lg object-cover ring-2 ${meta.ringClass}">
            <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${meta.dotClass}"></span>
          </div>
          <div>
            <div class="flex items-center gap-1">
              <h4 class="text-xs font-bold text-slate-800">${u.name}</h4>
              <span class="text-[10px] text-slate-400">(${u.nickname})</span>
              ${isMe ? '<span class="px-1 py-0.1 rounded text-[9px] bg-sky-100 text-sky-800 font-bold">คุณ</span>' : ''}
            </div>
            <p class="text-[10px] text-slate-500">${u.role} • ${u.department}</p>
          </div>
        </div>

        <div class="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end text-xs">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.badgeClass}">
            <span class="w-1.5 h-1.5 rounded-full ${meta.dotClass}"></span>
            <span>${meta.label}</span>
          </span>
          <span class="text-[11px] text-slate-600 hidden md:inline truncate max-w-xs">${u.status === 'offline' ? 'ยังไม่เข้าปฏิบัติงาน' : (u.note || '-')}</span>
          ${attBadgeHtml}
          ${hbBadgeHtml}
          ${!isMe ? `
            <button onclick="openSendNudgeModal('${u.id}', '${u.name}')" class="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-500 text-amber-700 hover:text-white font-bold transition flex items-center gap-1 border border-amber-200 text-xs shadow-2xs cursor-pointer" title="ส่งสัญญาณสะกิด">
              <i data-lucide="bell" class="w-3.5 h-3.5 text-amber-600"></i>
              <span>สะกิด</span>
            </button>
          ` : ''}
        </div>
      `;
    } else {
      card.innerHTML = `
        <div>
          <!-- Card Header (Compact) -->
          <div class="flex items-start justify-between gap-1.5 mb-1.5">
            <div class="flex items-center gap-2 min-w-0">
              <div class="relative shrink-0">
                <img src="${getUserAvatar(u)}" alt="${u.name}" class="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover ring-2 ${meta.ringClass}">
                <span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white ${meta.dotClass}"></span>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-1">
                  <h4 class="text-xs font-bold text-slate-800 truncate" title="${u.name}">${u.name}</h4>
                  ${isMe ? '<span class="px-1 rounded text-[9px] bg-sky-100 text-sky-800 font-bold shrink-0">คุณ</span>' : ''}
                </div>
                <div class="flex items-center gap-1 text-[10px] text-slate-400">
                  <span>(${u.nickname})</span>
                  <span>•</span>
                  <span class="truncate" title="${u.role}">${u.role}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Status badge pill (Single line) -->
          <div class="mb-1.5">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${meta.badgeClass} w-full justify-center">
              <span class="w-1.5 h-1.5 rounded-full ${meta.dotClass} ${u.status === 'available' ? 'animate-pulse' : ''}"></span>
              <span class="truncate">${meta.label}</span>
            </span>
          </div>

          <!-- Note / Task Description (Compact 1-2 lines) -->
          <div class="bg-slate-50/90 border border-slate-200/60 rounded-lg p-1.5 mb-2 min-h-[36px]" title="${u.status === 'offline' ? 'ยังไม่เข้าปฏิบัติงาน' : (u.note || '')}">
            <p class="text-[11px] text-slate-600 line-clamp-2 leading-tight font-medium">
              ${cleanNote}
            </p>
          </div>
        </div>

        <!-- Card Footer (Compact) -->
        <div class="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
          <div class="flex items-center gap-1">
            ${attBadgeHtml}
            ${hbBadgeHtml}
          </div>

          <!-- Action: Nudge -->
          ${!isMe ? `
            <button onclick="openSendNudgeModal('${u.id}', '${u.name}')" class="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-500 text-amber-800 hover:text-white font-bold transition flex items-center gap-1 border border-amber-300 shadow-2xs hover:shadow-xs cursor-pointer" title="ส่งสัญญาณสะกิดเพื่อนร่วมงาน">
              <i data-lucide="bell" class="w-3.5 h-3.5 text-amber-600"></i>
              <span class="text-[11px]">สะกิด</span>
            </button>
          ` : (u.status !== 'offline' && att.status === 'checked_in') ? `
            <span class="text-[11px] text-sky-700 font-bold bg-sky-50 px-2 py-0.5 rounded-md border border-sky-100">⏱️ ${durationStr}</span>
          ` : ''}
        </div>
      `;
    }

    grid.appendChild(card);
  });

  if (window.lucide) window.lucide.createIcons();
}

// Presence Pagination Controls Generator
function renderPresencePaginationControls(totalCount) {
  const container = document.getElementById('presencePaginationBtns');
  if (!container) return;
  container.innerHTML = '';

  if (presencePageSize === 'ALL' || totalCount <= presencePageSize) {
    container.innerHTML = `<span class="px-3 py-1 rounded-lg bg-sky-50 text-sky-700 font-bold text-xs border border-sky-200">แสดงครบทั้งหมดแล้ว</span>`;
    return;
  }

  const size = parseInt(presencePageSize) || 50;
  const totalPages = Math.ceil(totalCount / size);

  // Prev Button
  const prevBtn = document.createElement('button');
  prevBtn.className = `px-2.5 py-1 rounded-lg border font-bold transition text-xs ${presencePage > 1 ? 'bg-white hover:bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'}`;
  prevBtn.textContent = '◀ ก่อนหน้า';
  prevBtn.disabled = presencePage <= 1;
  prevBtn.onclick = () => goToPresencePage(presencePage - 1);
  container.appendChild(prevBtn);

  // Numbered pills
  for (let p = 1; p <= totalPages; p++) {
    const pageBtn = document.createElement('button');
    if (p === presencePage) {
      pageBtn.className = 'w-7 h-7 rounded-lg bg-sky-600 text-white font-bold text-xs shadow-sm';
    } else {
      pageBtn.className = 'w-7 h-7 rounded-lg bg-white hover:bg-sky-50 text-slate-700 border border-slate-200 font-bold text-xs transition';
    }
    pageBtn.textContent = p;
    pageBtn.onclick = () => goToPresencePage(p);
    container.appendChild(pageBtn);
  }

  // Next Button
  const nextBtn = document.createElement('button');
  nextBtn.className = `px-2.5 py-1 rounded-lg border font-bold transition text-xs ${presencePage < totalPages ? 'bg-white hover:bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'}`;
  nextBtn.textContent = 'ถัดไป ▶';
  nextBtn.disabled = presencePage >= totalPages;
  nextBtn.onclick = () => goToPresencePage(presencePage + 1);
  container.appendChild(nextBtn);
}

// Render Attendance View (Table & Counters) with 50/page pagination - Restricted to HR & Admin
function renderAttendanceView() {
  const me = getCurrentUser();
  const isAuthorized = isUserHRorAdmin(me);

  const restrictedScreen = document.getElementById('attendanceRestrictedScreen');
  const authorizedContainer = document.getElementById('attendanceAuthorizedContainer');

  if (!isAuthorized) {
    if (restrictedScreen) restrictedScreen.classList.remove('hidden');
    if (authorizedContainer) authorizedContainer.classList.add('hidden');

    const userInfoEl = document.getElementById('restrictedCurrentUserInfo');
    if (userInfoEl && me) {
      userInfoEl.innerHTML = `
        <div class="flex items-center gap-2.5">
          <img src="${getUserAvatar(me)}" class="w-9 h-9 rounded-xl object-cover ring-1 ring-slate-300">
          <div>
            <div class="font-bold text-slate-800 text-xs">${me.name} (${me.nickname})</div>
            <div class="text-[11px] text-slate-500">${me.role} • ${me.department}</div>
            <div class="text-[10px] text-slate-400 font-mono">รหัสพนักงาน: ${me.empCode || '-'}</div>
          </div>
        </div>
        <span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700">
          👤 พนักงานทั่วไป
        </span>
      `;
    }
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // User is authorized (HR or Admin)
  if (restrictedScreen) restrictedScreen.classList.add('hidden');
  if (authorizedContainer) authorizedContainer.classList.remove('hidden');

  // Update authorized role badge
  const authRoleBadge = document.getElementById('attendanceAuthorizedRoleBadge');
  if (authRoleBadge && me) {
    const isHrDept = isUserHR(me);
    const roleText = isHrDept
      ? 'ฝ่ายบริหารและพัฒนาองค์กร (HR)'
      : 'ผู้ดูแลระบบคอมพิวเตอร์และสารสนเทศ (System Admin)';
    authRoleBadge.innerHTML = `
      <span>ผู้เข้าใช้งาน: <b class="text-white underline">${me.name}</b> (${roleText}) — รหัสพนักงาน: <b>${me.empCode || '-'}</b></span>
    `;
  }

  const tbody = document.getElementById('attendanceTableBody');
  if (!tbody) return;

  tbody.innerHTML = '';

  let countIn = 0;
  let countOut = 0;
  let countWFH = 0;
  let countOffice = 0;

  users.forEach(u => {
    const att = u.attendance || { status: 'not_checked_in', location: 'WFH' };
    if (att.status === 'checked_in') {
      countIn++;
      if (att.location === 'Office') countOffice++;
      else countWFH++;
    } else if (att.status === 'checked_out') {
      countOut++;
    }
  });

  const elCountIn = document.getElementById('attCountCheckedIn');
  if (elCountIn) elCountIn.textContent = countIn;
  const elCountWFH = document.getElementById('attCountWFH');
  if (elCountWFH) elCountWFH.textContent = countWFH;
  const elCountOffice = document.getElementById('attCountOffice');
  if (elCountOffice) elCountOffice.textContent = countOffice;
  const elCountOut = document.getElementById('attCountCheckedOut');
  if (elCountOut) elCountOut.textContent = countOut;

  // Pagination for attendance
  const totalUsers = users.length;
  const elTotalCount = document.getElementById('attendanceTotalCount');
  if (elTotalCount) elTotalCount.textContent = totalUsers;

  let displayUsers = [];
  let startIndex = 0;
  let endIndex = totalUsers;

  if (attendancePageSize === 'ALL') {
    displayUsers = users;
    const elRangeText = document.getElementById('attendanceRangeText');
    if (elRangeText) elRangeText.textContent = `1 - ${totalUsers} (ทั้งหมด)`;
  } else {
    const size = parseInt(attendancePageSize) || 50;
    const totalPages = Math.ceil(totalUsers / size) || 1;
    if (attendancePage > totalPages) attendancePage = totalPages;
    if (attendancePage < 1) attendancePage = 1;

    startIndex = (attendancePage - 1) * size;
    endIndex = Math.min(startIndex + size, totalUsers);
    displayUsers = users.slice(startIndex, endIndex);

    const elRangeText = document.getElementById('attendanceRangeText');
    if (elRangeText) elRangeText.textContent = `${startIndex + 1} - ${endIndex}`;
  }

  // Render pagination buttons for attendance
  renderAttendancePaginationControls(totalUsers);

  // Render table rows
  displayUsers.forEach(u => {
    const att = u.attendance || { status: 'not_checked_in', location: 'WFH' };

    let hoursStr = '-';
    if (att.checkInTimestamp) {
      const endTs = att.checkOutTimestamp || Date.now();
      const diffMs = Math.max(0, endTs - att.checkInTimestamp);
      const mins = Math.floor(diffMs / 60000);
      const hrs = Math.floor(mins / 60);
      hoursStr = `${hrs} ชม. ${mins % 60} นาที`;
    }

    let statusBadge = '';
    if (att.status === 'checked_in') {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">🟢 เข้างานแล้ว</span>';
    } else if (att.status === 'checked_out') {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">⚪ ออกงานแล้ว</span>';
    } else {
      statusBadge = '<span class="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">🟡 ยังไม่ลงเวลา</span>';
    }

    const workDate = att.checkInTimestamp
      ? new Date(att.checkInTimestamp).toLocaleDateString('th-TH', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'Asia/Bangkok'
        })
      : new Date().toLocaleDateString('th-TH', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'Asia/Bangkok'
        });

    const tr = document.createElement('tr');
    tr.className = 'hover:bg-sky-50/50 transition';
    tr.innerHTML = `
      <td class="py-3 px-3 font-bold flex items-center gap-2">
        <img src="${getUserAvatar(u)}" class="w-7 h-7 rounded-lg object-cover ring-1 ring-sky-200 shrink-0">
        <div class="truncate">
          <div class="text-slate-800 font-bold text-xs">${u.name}</div>
          <div class="text-slate-400 font-normal text-[11px]">${u.role} (${u.nickname})</div>
        </div>
      </td>
      <td class="py-3 px-3 font-mono font-bold text-sky-800 text-xs">${u.empCode || '-'}</td>
      <td class="py-3 px-3 text-slate-600 font-medium text-xs">${u.department}</td>
      <td class="py-3 px-3 font-mono text-slate-700 text-xs whitespace-nowrap">${workDate}</td>
      <td class="py-3 px-3">
        <span class="px-2 py-0.5 rounded-lg text-[11px] font-bold ${att.location === 'Office' ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-sky-50 text-sky-700 border border-sky-200'}">
          ${att.location === 'Office' ? '🏢 Office' : '🏠 WFH'}
        </span>
      </td>
      <td class="py-3 px-3 font-mono font-bold text-slate-800 text-xs">${att.checkInTime ? att.checkInTime + ' น.' : '-'}</td>
      <td class="py-3 px-3 font-mono font-bold text-slate-800 text-xs">${att.checkOutTime ? att.checkOutTime + ' น.' : '-'}</td>
      <td class="py-3 px-3 font-bold text-sky-700 text-xs">${hoursStr}</td>
      <td class="py-3 px-3">${statusBadge}</td>
      <td class="py-3 px-3 text-slate-500 text-xs truncate max-w-xs">${att.note || '-'}</td>
    `;
    tbody.appendChild(tr);
  });

  // Render attendance history logs
  const attLogContainer = document.getElementById('attendanceHistoryLogsList');
  if (attLogContainer) {
    if (attendanceLogs.length === 0) {
      attLogContainer.innerHTML = '<p class="text-slate-400 text-center py-3">ยังไม่มีประวัติการลงเวลา</p>';
    } else {
      attLogContainer.innerHTML = attendanceLogs.slice(0, 15).map(log => {
        const timeAgo = formatTimeAgo(log.timestamp);
        const isCheckIn = log.action === 'check_in';
        return `
          <div class="flex items-center justify-between gap-3 py-2 px-3 rounded-xl bg-slate-50 border border-slate-200/80">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] font-bold ${isCheckIn ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}">
                ${isCheckIn ? '🟢 Check-In' : '⚪ Check-Out'}
              </span>
              <span class="font-bold text-slate-800 text-xs">${log.userName}</span>
              <span class="text-slate-500 text-xs">เวลา ${log.time} น. (${log.location || 'WFH'})</span>
              ${log.note ? `<span class="text-slate-400 text-[11px]">"${log.note}"</span>` : ''}
            </div>
            <span class="text-slate-400 font-mono text-[11px]">${timeAgo}</span>
          </div>
        `;
      }).join('');
    }
  }

  if (window.lucide) window.lucide.createIcons();
}

// Attendance Pagination Controls Generator
function renderAttendancePaginationControls(totalCount) {
  const container = document.getElementById('attendancePaginationBtns');
  if (!container) return;
  container.innerHTML = '';

  if (attendancePageSize === 'ALL' || totalCount <= attendancePageSize) {
    container.innerHTML = `<span class="px-3 py-1 rounded-lg bg-sky-50 text-sky-700 font-bold text-xs border border-sky-200">แสดงครบทั้งหมดแล้ว</span>`;
    return;
  }

  const size = parseInt(attendancePageSize) || 50;
  const totalPages = Math.ceil(totalCount / size);

  // Prev Button
  const prevBtn = document.createElement('button');
  prevBtn.className = `px-2.5 py-1 rounded-lg border font-bold transition text-xs ${attendancePage > 1 ? 'bg-white hover:bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'}`;
  prevBtn.textContent = '◀ ก่อนหน้า';
  prevBtn.disabled = attendancePage <= 1;
  prevBtn.onclick = () => goToAttendancePage(attendancePage - 1);
  container.appendChild(prevBtn);

  // Numbered pills
  for (let p = 1; p <= totalPages; p++) {
    const pageBtn = document.createElement('button');
    if (p === attendancePage) {
      pageBtn.className = 'w-7 h-7 rounded-lg bg-sky-600 text-white font-bold text-xs shadow-sm';
    } else {
      pageBtn.className = 'w-7 h-7 rounded-lg bg-white hover:bg-sky-50 text-slate-700 border border-slate-200 font-bold text-xs transition';
    }
    pageBtn.textContent = p;
    pageBtn.onclick = () => goToAttendancePage(p);
    container.appendChild(pageBtn);
  }

  // Next Button
  const nextBtn = document.createElement('button');
  nextBtn.className = `px-2.5 py-1 rounded-lg border font-bold transition text-xs ${attendancePage < totalPages ? 'bg-white hover:bg-sky-50 text-sky-700 border-sky-200' : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'}`;
  nextBtn.textContent = 'ถัดไป ▶';
  nextBtn.disabled = attendancePage >= totalPages;
  nextBtn.onclick = () => goToAttendancePage(attendancePage + 1);
  container.appendChild(nextBtn);
}

// Thai Buddhist Era Months & Date Formatter
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

function formatThaiDateBE(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const beYear = y + 543;
  return `${d} ${THAI_MONTHS_SHORT[m]} ${beYear}`;
}

function updateThaiDatePreview() {
  const sEl = document.getElementById('exportStartDate');
  const eEl = document.getElementById('exportEndDate');
  const txtEl = document.getElementById('thaiDateRangeText');
  if (!txtEl || !sEl || !eEl) return;

  const s = sEl.value;
  const e = eEl.value;

  if (!s && !e) {
    txtEl.textContent = 'ทั้งหมด (ทุกช่วงเวลา)';
  } else if (s && !e) {
    txtEl.textContent = `ตั้งแต่ ${formatThaiDateBE(s)}`;
  } else if (!s && e) {
    txtEl.textContent = `ถึง ${formatThaiDateBE(e)}`;
  } else if (s === e) {
    txtEl.textContent = `${formatThaiDateBE(s)} (1 วัน)`;
  } else {
    txtEl.textContent = `${formatThaiDateBE(s)} - ${formatThaiDateBE(e)}`;
  }
}

function setExportPreset(preset) {
  const sEl = document.getElementById('exportStartDate');
  const eEl = document.getElementById('exportEndDate');
  if (!sEl || !eEl) return;

  const now = new Date();
  const toDateInputStr = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (preset === 'today') {
    const todayStr = toDateInputStr(now);
    sEl.value = todayStr;
    eEl.value = todayStr;
  } else if (preset === '7days') {
    const past = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    sEl.value = toDateInputStr(past);
    eEl.value = toDateInputStr(now);
  } else if (preset === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    sEl.value = toDateInputStr(firstDay);
    eEl.value = toDateInputStr(now);
  } else if (preset === 'all') {
    sEl.value = '';
    eEl.value = '';
  }
  updateThaiDatePreview();
}

function initExportDatePickers() {
  const sEl = document.getElementById('exportStartDate');
  const eEl = document.getElementById('exportEndDate');
  if (sEl && eEl && !sEl.value && !eEl.value) {
    setExportPreset('month'); // default to current month
  } else {
    updateThaiDatePreview();
  }
}

// Export Attendance Table (Excel / CSV) with Thai Date Range
async function exportAttendanceWithDates(format) {
  const me = getCurrentUser();
  if (!isUserHRorAdmin(me)) {
    showToast('เฉพาะเจ้าหน้าที่ฝ่ายบริหารและพัฒนาองค์กร (HR) และผู้ดูแลระบบเท่านั้นที่มีสิทธิ์ส่งออกข้อมูล', 'warning');
    return;
  }

  const sEl = document.getElementById('exportStartDate');
  const eEl = document.getElementById('exportEndDate');
  const startDate = sEl ? sEl.value : '';
  const endDate = eEl ? eEl.value : '';

  const formatLabel = format === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)';
  showToast(`📊 กำลังจัดเตรียมไฟล์ ${formatLabel}...`);

  try {
    let url = `/api/attendance/export?format=${encodeURIComponent(format)}&userId=${encodeURIComponent(me.id)}`;
    if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
    if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;

    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || 'ไม่สามารถดาวน์โหลดไฟล์ได้', 'error');
      return;
    }

    const blob = await res.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;

    let dateTag = 'All';
    if (startDate && endDate) dateTag = `${startDate}_to_${endDate}`;
    else if (startDate) dateTag = `from_${startDate}`;
    else if (endDate) dateTag = `until_${endDate}`;

    a.download = `FMO_Attendance_${dateTag}.${format}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
    showToast(`ดาวน์โหลดรายงาน ${formatLabel} เรียบร้อยแล้ว 🎉`, 'success');
  } catch (err) {
    console.error('Export failed:', err);
    showToast(`เกิดข้อผิดพลาดในการดาวน์โหลด ${formatLabel}`, 'error');
  }
}

async function exportAttendanceExcel() {
  return exportAttendanceWithDates('xlsx');
}

async function exportAttendanceCSV() {
  return exportAttendanceWithDates('csv');
}

// Render Activity Logs
function renderActivityLogs() {
  const container = document.getElementById('activityLogsList');
  if (!container) return;

  if (logs.length === 0) {
    container.innerHTML = '<p class="text-slate-400 text-center py-4">ยังไม่มีความเคลื่อนไหวในขณะนี้</p>';
    return;
  }

  container.innerHTML = logs.slice(0, 15).map(log => {
    const timeAgo = formatTimeAgo(log.timestamp);
    const toMeta = STATUS_META[log.toStatus] || STATUS_META.available;

    let icon = '🔄';
    let badge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold border ${toMeta.badgeClass}">${toMeta.label}</span>`;

    if (log.type === 'auto_idle') icon = '⏱️';
    else if (log.type === 'auto_offline') icon = '💤';
    else if (log.type === 'resumed_active') icon = '🟢';
    else if (log.type === 'attendance_checkin') {
      icon = '📌';
      badge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">Check-In</span>`;
    } else if (log.type === 'attendance_checkout') {
      icon = '👋';
      badge = `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-200 text-slate-700">Check-Out</span>`;
    }

    return `
      <div class="flex items-center justify-between gap-3 py-2 px-3 rounded-xl bg-slate-50/70 border border-slate-200/80 hover:border-sky-300 transition">
        <div class="flex items-center gap-2 overflow-hidden">
          <span class="text-sm shrink-0">${icon}</span>
          <span class="font-bold text-slate-800 shrink-0">${log.userName}</span>
          ${badge}
          ${log.note ? `<span class="text-slate-600 text-xs truncate max-w-xs pl-1">"${log.note}"</span>` : ''}
        </div>
        <span class="text-slate-400 font-mono text-[11px] shrink-0">${timeAgo}</span>
      </div>
    `;
  }).join('');
}

function formatTimeAgo(timestamp) {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 20) return 'เมื่อสักครู่';
  if (diffSec < 60) return `${diffSec} วินาทีที่แล้ว`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr} ชม. ที่แล้ว`;
}

// Department Filters
function filterDept(dept) {
  activeFilterDept = dept;
  presencePage = 1;

  // Sync all dropdowns
  document.querySelectorAll('.dept-select, #deptSelect, #deptSelectMobile').forEach(sel => {
    if (sel.value !== dept) {
      sel.value = dept;
    }
  });

  // Update quick all button style
  const quickAllBtn = document.getElementById('quickAllBtn');
  if (quickAllBtn) {
    if (dept === 'ALL') {
      quickAllBtn.className = '2xl:hidden px-3 py-2 rounded-xl text-xs font-bold bg-sky-600 text-white shadow-xs transition flex items-center gap-1.5 shrink-0';
    } else {
      quickAllBtn.className = '2xl:hidden px-3 py-2 rounded-xl text-xs font-bold bg-white hover:bg-sky-50 text-slate-700 border border-slate-200 shadow-xs transition flex items-center gap-1.5 shrink-0';
    }
  }

  // Sync desktop buttons
  document.querySelectorAll('.dept-btn').forEach(btn => {
    const bDept = btn.getAttribute('data-dept') || btn.textContent.trim();
    if (bDept === dept || (dept === 'ALL' && bDept === 'ALL')) {
      btn.className = 'dept-btn active px-3 py-1.5 rounded-xl text-xs font-bold bg-sky-600 text-white shadow-sm transition shrink-0';
    } else {
      btn.className = 'dept-btn px-3 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-sky-50 text-slate-600 border border-slate-200 transition shrink-0';
    }
  });

  renderTeamGrid();
}

// Status Filter (Clickable from Stat Counter Cards)
function filterByStatus(status) {
  activeStatusFilter = status;
  presencePage = 1;
  const toggle = document.getElementById('onlyAvailableToggle');
  if (toggle) {
    toggle.checked = (status === 'available');
  }
  renderTeamGrid();
}

function applyFilters() {
  const toggle = document.getElementById('onlyAvailableToggle');
  if (toggle && toggle.checked) {
    activeStatusFilter = 'available';
  } else {
    activeStatusFilter = 'ALL';
  }
  presencePage = 1;
  renderTeamGrid();
}

// Nudge Modal (Receiving)
function showNudgeModal(fromUser, message) {
  if (!fromUser) return;
  const nameEl = document.getElementById('nudgeSenderName');
  if (nameEl) nameEl.textContent = `${fromUser.name} (${fromUser.nickname || ''})`;
  const msgEl = document.getElementById('nudgeMessageText');
  if (msgEl) msgEl.textContent = `"${message}"`;
  const modal = document.getElementById('nudgeModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  if (window.lucide) window.lucide.createIcons();
}

function closeNudgeModal() {
  const modal = document.getElementById('nudgeModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  markAllNudgesAsRead();
}

function respondNudgeAvailable() {
  closeNudgeModal();
  changeStatus('available', 'พร้อมคุยแล้วครับ/ค่ะ 🟢');
  markAllNudgesAsRead();
}

function toggleNudgeDropdown() {
  const dd = document.getElementById('nudgeDropdown');
  if (dd) {
    dd.classList.toggle('hidden');
    if (!dd.classList.contains('hidden')) {
      renderNudges();
    }
  }
}

// Close dropdown if clicked outside
document.addEventListener('click', (e) => {
  const dd = document.getElementById('nudgeDropdown');
  const btn = document.getElementById('btnHeaderNudgeBell');
  if (dd && !dd.classList.contains('hidden')) {
    if (btn && !btn.contains(e.target) && !dd.contains(e.target)) {
      dd.classList.add('hidden');
    }
  }
});

function markAllNudgesAsRead() {
  const me = getCurrentUser();
  if (!me) return;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'READ_NUDGES',
      userId: me.id
    }));
  }

  nudges.forEach(n => {
    if (n.toUserId === me.id) n.read = true;
  });
  renderNudges();
}

function renderNudges() {
  const me = getCurrentUser();
  if (!me) return;

  const myNudges = (nudges || []).filter(n => n.toUserId === me.id);
  const unreadCount = myNudges.filter(n => !n.read).length;

  const badge = document.getElementById('nudgeUnreadBadge');
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = unreadCount;
      badge.classList.remove('hidden');
      badge.classList.add('flex');
    } else {
      badge.classList.add('hidden');
      badge.classList.remove('flex');
    }
  }

  const container = document.getElementById('nudgeListContainer');
  if (container) {
    if (myNudges.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6 text-slate-400">
          <i data-lucide="bell-off" class="w-6 h-6 mx-auto mb-1 opacity-50"></i>
          <span>ยังไม่มีการสะกิดถึงคุณ</span>
        </div>
      `;
    } else {
      container.innerHTML = myNudges.map(n => {
        const timeAgo = formatTimeAgo(n.timestamp);
        return `
          <div class="p-2.5 rounded-xl border ${n.read ? 'bg-slate-50 border-slate-200' : 'bg-sky-50/90 border-sky-300 ring-1 ring-sky-200'} space-y-1.5 transition">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <img src="${getUserAvatar(n.fromUser)}" class="w-6 h-6 rounded-lg object-cover ring-1 ring-sky-300 shrink-0">
                <b class="text-slate-800 text-xs">${n.fromUser.name}</b>
                <span class="text-[10px] text-slate-400">(${n.fromUser.nickname})</span>
              </div>
              <span class="text-[10px] font-mono text-slate-400 shrink-0">${timeAgo}</span>
            </div>
            <p class="text-xs text-slate-700 bg-white/90 p-2 rounded-lg border border-slate-100">
              "${n.message}"
            </p>
            <div class="flex items-center justify-end gap-1.5 pt-0.5">
              <button onclick="respondNudgeAvailable()" class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[10px] transition flex items-center gap-1 shadow-xs cursor-pointer">
                <span>🟢 ตอบกลับว่าว่างทันที</span>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }
    if (window.lucide) window.lucide.createIcons();
  }
}

function checkPendingUnreadNudges() {
  const modalClockIn = document.getElementById('modalClockInByCode');
  if (modalClockIn && !modalClockIn.classList.contains('hidden')) {
    // If the clock-in modal is open, wait until user enters dashboard
    return;
  }
  const me = getCurrentUser();
  if (!me) return;

  const unreadNudges = (nudges || []).filter(n => n.toUserId === me.id && !n.read);
  if (unreadNudges.length > 0) {
    const latest = unreadNudges[0];
    showNudgeModal(latest.fromUser, latest.message);
    playNotificationSound('nudge');
  }
}

// Nudge Modal (Sending)
function openSendNudgeModal(userId, userName) {
  targetNudgeUserId = userId;
  document.getElementById('targetTeammateName').textContent = `ส่งการแจ้งเตือนถึง: ${userName}`;
  document.getElementById('sendNudgeInput').value = '';
  document.getElementById('sendNudgeModal').classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function closeSendNudgeModal() {
  document.getElementById('sendNudgeModal').classList.add('hidden');
  targetNudgeUserId = null;
}

function setNudgeInput(msg) {
  document.getElementById('sendNudgeInput').value = msg;
}

function confirmSendNudge() {
  if (!targetNudgeUserId) return;
  const msg = document.getElementById('sendNudgeInput').value.trim() || 'ขอคุยปรึกษางานสั้นๆ สัก 5 นาที สะดวกไหมครับ/ค่ะ? 😊';

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'SEND_NUDGE',
      fromUserId: currentUserId,
      toUserId: targetNudgeUserId,
      message: msg
    }));
  }

  closeSendNudgeModal();
  showToast('ส่งสัญญาณสะกิดเพื่อนร่วมงานเรียบร้อยแล้ว 🔔');
}

// Toast Notifications
function showToast(text, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');

  let typeStyles = 'bg-white text-slate-800 border-sky-200 shadow-md';
  let iconHtml = '<i data-lucide="info" class="w-4 h-4 text-sky-600 shrink-0"></i>';

  if (type === 'success') {
    typeStyles = 'bg-emerald-600 text-white border-emerald-700 shadow-emerald-600/30 shadow-lg';
    iconHtml = '<i data-lucide="check-circle-2" class="w-4 h-4 text-white shrink-0"></i>';
  } else if (type === 'error') {
    typeStyles = 'bg-rose-600 text-white border-rose-700 shadow-rose-600/30 shadow-lg';
    iconHtml = '<i data-lucide="alert-triangle" class="w-4 h-4 text-white shrink-0"></i>';
  } else if (type === 'warning') {
    typeStyles = 'bg-amber-500 text-white border-amber-600 shadow-amber-500/30 shadow-lg';
    iconHtml = '<i data-lucide="alert-circle" class="w-4 h-4 text-white shrink-0"></i>';
  }

  toast.className = `p-3.5 rounded-2xl text-xs font-bold pointer-events-auto flex items-center gap-2.5 border transition-all transform translate-y-2 opacity-0 duration-200 max-w-[380px] leading-snug ${typeStyles}`;
  toast.innerHTML = `${iconHtml}<span>${text}</span>`;
  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 250);
  }, 4500);
}

// Confirmation Toast (Interactive Confirm replacing native browser confirm popups)
function showConfirmToast(message, onConfirm, options = {}) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'p-4 rounded-2xl shadow-2xl bg-white border border-sky-200 text-slate-800 text-xs font-semibold pointer-events-auto flex flex-col gap-3 min-w-[290px] max-w-[360px] transform translate-y-2 opacity-0 transition-all duration-200 ring-4 ring-sky-500/10';

  const confirmText = options.confirmText || 'ยืนยัน';
  const cancelText = options.cancelText || 'ยกเลิก';
  const isDanger = options.isDanger !== false;
  const confirmBtnClass = isDanger
    ? 'px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-xs transition'
    : 'px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs shadow-xs transition';

  toast.innerHTML = `
    <div class="flex items-start gap-2.5">
      <div class="p-2 rounded-xl ${isDanger ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-600'} shrink-0">
        <i data-lucide="${options.icon || 'alert-circle'}" class="w-4 h-4"></i>
      </div>
      <div class="flex-1 text-slate-800 leading-snug font-bold text-xs pt-0.5">${message}</div>
    </div>
    <div class="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
      <button type="button" class="btn-cancel px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs transition">${cancelText}</button>
      <button type="button" class="btn-confirm ${confirmBtnClass}">${confirmText}</button>
    </div>
  `;

  container.appendChild(toast);
  if (window.lucide) window.lucide.createIcons();

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  const dismiss = () => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 250);
  };

  const autoDismissTimer = setTimeout(dismiss, 15000);

  toast.querySelector('.btn-cancel').onclick = () => {
    clearTimeout(autoDismissTimer);
    dismiss();
    if (options.onCancel) options.onCancel();
  };

  toast.querySelector('.btn-confirm').onclick = () => {
    clearTimeout(autoDismissTimer);
    dismiss();
    if (typeof onConfirm === 'function') onConfirm();
  };
}

// ==========================================
// 🔑 Clock-in by Employee ID Modal Logic (หน้าแรก)
// ==========================================
let selectedModalUser = null;

// Initial First Page Loader
function initClockInFirstPage() {
  const modal = document.getElementById('modalClockInByCode');
  if (!modal) return;

  const isLoggedOut = localStorage.getItem('timeon_logged_out') === 'true';
  const savedUserId = localStorage.getItem('timeon_current_user_id');

  // If user is already active/logged in, keep modal hidden and do NOT prompt on refresh
  if (savedUserId && !isLoggedOut) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    return;
  }

  // Otherwise, user is explicitly logged out or first visit: show the clock-in modal
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  const input = document.getElementById('modalEmpCodeInput');
  if (input) {
    input.value = '';
    handleModalEmpCodeInput('');
    setTimeout(() => {
      input.focus();
    }, 150);
  }
  if (window.lucide) window.lucide.createIcons();
}

function openClockInModal(clearInput = false) {
  const modal = document.getElementById('modalClockInByCode');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  const input = document.getElementById('modalEmpCodeInput');
  if (input) {
    if (clearInput) {
      input.value = '';
      handleModalEmpCodeInput('');
    } else {
      const me = getCurrentUser();
      input.value = me?.empCode || '';
      handleModalEmpCodeInput(input.value);
    }
    setTimeout(() => {
      input.focus();
      input.select();
    }, 120);
  }
  if (window.lucide) window.lucide.createIcons();
}

function logoutToClockIn() {
  localStorage.setItem('timeon_logged_out', 'true');
  localStorage.removeItem('timeon_is_logged_in');
  clearModalEmpCodeInput();
  openClockInModal(true);
  showToast('ออกจากระบบเรียบร้อยแล้ว กรุณากรอกรหัสพนักงานเพื่อลงเวลาหรือเข้าใช้งานใหม่', 'info');
}

function closeClockInModal() {
  const modal = document.getElementById('modalClockInByCode');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  setTimeout(checkPendingUnreadNudges, 250);
}

function clearModalEmpCodeInput() {
  const input = document.getElementById('modalEmpCodeInput');
  if (input) {
    input.value = '';
    handleModalEmpCodeInput('');
    input.focus();
  }
}

function handleModalEnterKey() {
  const input = document.getElementById('modalEmpCodeInput');
  const code = (input ? input.value : '').trim();
  let targetUser = selectedModalUser;
  if (!targetUser && code) {
    targetUser = users.find(u => 
      u.empCode === code || 
      u.empCode === code.padStart(8, '0') || 
      (code.length >= 3 && u.empCode.endsWith(code)) ||
      u.name.includes(code)
    );
  }
  if (!targetUser) return;
  if (targetUser.attendance?.status === 'checked_in') {
    loginAndEnterDashboard();
  } else {
    executeClockInByCode('WFH');
  }
}

function handleModalEmpCodeInput(val) {
  const clean = (val || '').trim();
  const card = document.getElementById('modalEmpPreviewCard');
  const btnWFH = document.getElementById('modalBtnWFH');
  const btnWFHText = document.getElementById('modalBtnWFHText');

  if (!card) return;

  if (!clean) {
    selectedModalUser = null;
    const btnEnterText = document.getElementById('btnModalEnterDashboardText');
    if (btnEnterText) btnEnterText.textContent = 'เข้าสู่หน้าจอแดชบอร์ด เพื่อแสดงสถานะการทำงาน';
    if (btnWFHText) btnWFHText.textContent = '🏠 บันทึกเวลา WFH ทันที';
    if (btnWFH) btnWFH.setAttribute('onclick', "executeClockInByCode('WFH')");
    card.innerHTML = `
      <div class="text-center text-xs text-slate-400">
        <i data-lucide="user-check" class="w-6 h-6 mx-auto mb-1 opacity-40"></i>
        <span>กรุณาพิมพ์รหัสพนักงานเพื่อแสดงข้อมูล...</span>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Find candidate in users
  const user = users.find(u => 
    u.empCode === clean || 
    u.empCode === clean.padStart(8, '0') || 
    (clean.length >= 3 && u.empCode.endsWith(clean)) ||
    u.name.includes(clean)
  );

  if (user) {
    selectedModalUser = user;
    const btnEnterText = document.getElementById('btnModalEnterDashboardText');
    if (btnEnterText) btnEnterText.textContent = `เข้าสู่ระบบของ ${user.name} เพื่อแสดงสถานะการทำงาน`;

    const isCheckedIn = user.attendance?.status === 'checked_in';
    const statusText = isCheckedIn 
      ? `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">🟢 เข้างานแล้ว (${user.attendance.location || 'WFH'} ${user.attendance.checkInTime || ''} น.)</span>`
      : `<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">🟡 ยังไม่ลงเวลาเข้างาน</span>`;

    if (isCheckedIn) {
      if (btnWFHText) btnWFHText.textContent = `🚀 เข้าสู่ระบบของ ${user.name} ทันที`;
      if (btnWFH) btnWFH.setAttribute('onclick', 'loginAndEnterDashboard()');
    } else {
      if (btnWFHText) btnWFHText.textContent = '🏠 บันทึกเวลา WFH ทันที';
      if (btnWFH) btnWFH.setAttribute('onclick', "executeClockInByCode('WFH')");
    }

    card.innerHTML = `
      <div class="w-full flex items-center gap-3">
        <img src="${getUserAvatar(user)}" class="w-12 h-12 rounded-xl object-cover ring-2 ring-sky-300 shadow-sm shrink-0">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <b class="text-slate-800 text-sm">${user.name}</b>
            <span class="text-xs text-slate-500">(${user.nickname})</span>
            <span class="text-xs text-sky-700 font-bold bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200 font-mono">รหัส: ${user.empCode}</span>
          </div>
          <div class="text-xs text-slate-500 truncate">${user.role} • ${user.department}</div>
          <div class="mt-1">${statusText}</div>
        </div>
      </div>
    `;
  } else {
    selectedModalUser = null;
    const btnEnterText = document.getElementById('btnModalEnterDashboardText');
    if (btnEnterText) btnEnterText.textContent = 'เข้าสู่หน้าจอแดชบอร์ด เพื่อแสดงสถานะการทำงาน';
    if (btnWFHText) btnWFHText.textContent = '🏠 บันทึกเวลา WFH ทันที';
    if (btnWFH) btnWFH.setAttribute('onclick', "executeClockInByCode('WFH')");
    card.innerHTML = `
      <div class="text-center text-xs text-rose-500 py-1">
        <i data-lucide="alert-circle" class="w-5 h-5 mx-auto mb-0.5 text-rose-400"></i>
        <span>ไม่พบพนักงานที่ตรงกับรหัส "${clean}"</span>
      </div>
    `;
  }
  if (window.lucide) window.lucide.createIcons();
}

function loginAndEnterDashboard() {
  const input = document.getElementById('modalEmpCodeInput');
  const code = (input ? input.value : '').trim();

  let targetUser = selectedModalUser;
  if (!targetUser && code) {
    targetUser = users.find(u => 
      u.empCode === code || 
      u.empCode === code.padStart(8, '0') || 
      (code.length >= 3 && u.empCode.endsWith(code)) ||
      u.name.includes(code)
    );
  }

  // Always close modal first to prevent blocking
  closeClockInModal();

  if (targetUser) {
    currentUserId = targetUser.id;
    localStorage.removeItem('timeon_logged_out');
    localStorage.setItem('timeon_is_logged_in', 'true');
    localStorage.setItem('timeon_current_user_id', currentUserId);

    const userSel = document.getElementById('userSelector');
    if (userSel) userSel.value = currentUserId;

    try {
      renderAll();
      renderNudges();
      sendHeartbeat();
      playNotificationSound('ping');
    } catch (e) {
      console.warn('Render warning on login:', e);
    }

    showToast(`เข้าสู่ระบบของ ${targetUser.name} เรียบร้อยแล้ว พร้อมอัปเดตสถานะการทำงาน 🟢`, 'success');
    setTimeout(() => {
      checkPendingUnreadNudges();
    }, 400);
  }
}

async function executeClockInByCode(location = 'WFH') {
  const input = document.getElementById('modalEmpCodeInput');
  const code = (input ? input.value : '').trim();

  let targetUser = selectedModalUser;
  if (!targetUser && code) {
    targetUser = users.find(u => 
      u.empCode === code || 
      u.empCode === code.padStart(8, '0') || 
      (code.length >= 3 && u.empCode.endsWith(code)) ||
      u.name.includes(code)
    );
  }

  if (!targetUser) {
    showToast('กรุณากรอกรหัสพนักงานที่ถูกต้อง', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/attendance/clock-in-by-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empCode: targetUser.empCode,
        location: location,
        note: `ลงเวลาเข้างาน ${location} ด้วยรหัสพนักงาน`
      })
    });
    const data = await res.json();
    if (data.success) {
      currentUserId = targetUser.id;
      localStorage.removeItem('timeon_logged_out');
      localStorage.setItem('timeon_is_logged_in', 'true');
      localStorage.setItem('timeon_current_user_id', currentUserId);
      
      const userSel = document.getElementById('userSelector');
      if (userSel) userSel.value = currentUserId;

      renderAll();
      renderNudges();
      sendHeartbeat();
      playNotificationSound('ping');
      closeClockInModal();
      showToast(`🏠 บันทึกเวลาปฏิบัติงาน ${location} ของ ${targetUser.name} สำเร็จ! (${data.timeStr} น.)`, 'success');
      setTimeout(() => {
        checkPendingUnreadNudges();
      }, 400);
    } else {
      showToast(data.error || 'เกิดข้อผิดพลาดในการลงเวลา', 'error');
    }
  } catch (err) {
    console.error('Error clocking in by code:', err);
    showToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
  }
}

async function executeClockOutByCode() {
  const input = document.getElementById('modalEmpCodeInput');
  const code = (input ? input.value : '').trim();

  let targetUser = selectedModalUser;
  if (!targetUser && code) {
    targetUser = users.find(u => 
      u.empCode === code || 
      u.empCode === code.padStart(8, '0') || 
      (code.length >= 3 && u.empCode.endsWith(code)) ||
      u.name.includes(code)
    );
  }

  if (!targetUser) {
    showToast('กรุณากรอกรหัสพนักงานที่ถูกต้อง', 'warning');
    return;
  }

  showConfirmToast(`คุณต้องการลงเวลาเลิกงานให้ ${targetUser.name} ใช่หรือไม่?`, async () => {
    try {
      const res = await fetch('/api/attendance/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: targetUser.id,
          note: 'ลงเวลาเลิกงานด้วยรหัสพนักงาน'
        })
      });
      const data = await res.json();
      if (data.success) {
        currentUserId = targetUser.id;
        localStorage.removeItem('timeon_logged_out');
        localStorage.setItem('timeon_is_logged_in', 'true');
        localStorage.setItem('timeon_current_user_id', currentUserId);
        renderAll();
        closeClockInModal();
        playNotificationSound('ping');
        showToast(`🚪 บันทึกเวลาเลิกงานของ ${targetUser.name} เรียบร้อยแล้ว`, 'success');
      } else {
        showToast(data.error || 'เกิดข้อผิดพลาดในการลงเวลา', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
    }
  }, {
    confirmText: 'ยืนยันเลิกงาน',
    cancelText: 'ยกเลิก',
    isDanger: true,
    icon: 'log-out'
  });
}

// ==========================================
// ✏️ Edit Personal Profile & Photo Logic
// ==========================================
let pendingAvatarDataUrl = null;

function openEditProfileModal() {
  const me = getCurrentUser();
  if (!me) return;

  const modal = document.getElementById('modalEditProfile');
  if (!modal) return;

  pendingAvatarDataUrl = getUserAvatar(me);

  document.getElementById('editProfilePreviewAvatar').src = getUserAvatar(me);
  document.getElementById('editProfileEmpCode').value = me.empCode || '-';
  document.getElementById('editProfileName').value = me.name || '';
  document.getElementById('editProfileNickname').value = me.nickname || '';
  document.getElementById('editProfileRole').value = me.role || '';
  document.getElementById('editProfileDepartment').value = me.department || 'ฝ่ายบริหารและพัฒนาองค์กร';
  document.getElementById('editProfilePhone').value = me.phone || '';
  document.getElementById('editProfileEmail').value = me.email || '';

  modal.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function closeEditProfileModal() {
  const modal = document.getElementById('modalEditProfile');
  if (modal) modal.classList.add('hidden');
  pendingAvatarDataUrl = null;
}

function handleProfilePhotoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('กรุณาเลือกไฟล์รูปภาพ (JPG, PNG, WebP)', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    const rawDataUrl = e.target.result;
    
    // Scale down image in canvas to max 400x400 for speed and small payload
    const img = new Image();
    img.onload = () => {
      const maxDim = 400;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
      pendingAvatarDataUrl = optimizedDataUrl;
      document.getElementById('editProfilePreviewAvatar').src = optimizedDataUrl;
      showToast('อัปโหลดรูปภาพตัวอย่างแล้ว กด "บันทึก" เพื่อยืนยัน', 'info');
    };
    img.src = rawDataUrl;
  };
  reader.readAsDataURL(file);
}

function resetDefaultAvatar() {
  const me = getCurrentUser();
  const defAvatar = getDefaultAvatarByName(me?.name);
  pendingAvatarDataUrl = defAvatar;
  document.getElementById('editProfilePreviewAvatar').src = defAvatar;
  showToast('เลือกใช้รูปตั้งต้นตามเพศเรียบร้อยแล้ว กด "บันทึก" เพื่อยืนยัน', 'info');
}

async function saveUserProfile(event) {
  event.preventDefault();
  const me = getCurrentUser();
  if (!me) return;

  const name = (document.getElementById('editProfileName')?.value || '').trim();
  const nickname = (document.getElementById('editProfileNickname')?.value || '').trim();
  const role = (document.getElementById('editProfileRole')?.value || '').trim();
  const department = (document.getElementById('editProfileDepartment')?.value || '').trim();
  const phone = (document.getElementById('editProfilePhone')?.value || '').trim();
  const email = (document.getElementById('editProfileEmail')?.value || '').trim();

  // Validate all required fields
  if (!name) {
    showToast('กรุณากรอก "ชื่อ-นามสกุล" (*)', 'warning');
    document.getElementById('editProfileName')?.focus();
    return;
  }
  if (!nickname) {
    showToast('กรุณากรอก "ชื่อเล่น" (*)', 'warning');
    document.getElementById('editProfileNickname')?.focus();
    return;
  }
  if (!role) {
    showToast('กรุณากรอก "ตำแหน่งงาน" (*)', 'warning');
    document.getElementById('editProfileRole')?.focus();
    return;
  }
  if (!department) {
    showToast('กรุณาเลือก "ฝ่าย / สำนัก" (*)', 'warning');
    document.getElementById('editProfileDepartment')?.focus();
    return;
  }
  if (!phone) {
    showToast('กรุณากรอก "เบอร์โทรศัพท์ / ภายใน" (*)', 'warning');
    document.getElementById('editProfilePhone')?.focus();
    return;
  }
  if (!email) {
    showToast('กรุณากรอก "อีเมลติดต่อ" (*)', 'warning');
    document.getElementById('editProfileEmail')?.focus();
    return;
  }

  const saveBtn = document.getElementById('saveProfileBtn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span>กำลังบันทึก...</span>`;
  }

  const payload = {
    userId: me.id,
    avatar: pendingAvatarDataUrl || getUserAvatar(me),
    name,
    nickname,
    role,
    department,
    phone,
    email
  };

  try {
    const res = await fetch('/api/user/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      closeEditProfileModal();
      Object.assign(me, data.user);
      renderAll();
      populateUserSelector();
      playNotificationSound('ping');
      showToast('บันทึกข้อมูลส่วนตัวและรูปโปรไฟล์เรียบร้อยแล้ว ✅', 'success');
    } else {
      showToast(data.error || 'เกิดข้อผิดพลาดในการบันทึก', 'error');
    }
  } catch (err) {
    console.error('Error saving profile:', err);
    showToast(err.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i data-lucide="save" class="w-3.5 h-3.5"></i><span>บันทึกข้อมูลส่วนตัว</span>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// ==========================================
// EMPLOYEE MANAGEMENT (ADMIN CRUD)
// ==========================================

let currentEditAdminAvatarBase64 = null;

function renderEmployeesAdminView() {
  const me = getCurrentUser();
  if (!isUserAdmin(me)) return;

  const totalEl = document.getElementById('adminEmpTotalCount');
  const adminEl = document.getElementById('adminEmpAdminCount');
  const regularEl = document.getElementById('adminEmpRegularCount');
  const tableBody = document.getElementById('adminEmployeesTableBody');

  const totalCount = users.length;
  const adminCount = users.filter(u => isUserAdmin(u)).length;
  const regularCount = totalCount - adminCount;

  if (totalEl) totalEl.textContent = totalCount;
  if (adminEl) adminEl.textContent = adminCount;
  if (regularEl) regularEl.textContent = regularCount;

  if (!tableBody) return;

  const searchInput = document.getElementById('adminEmpSearchInput');
  const deptFilter = document.getElementById('adminEmpDeptFilter');
  const query = (searchInput?.value || '').toLowerCase().trim();
  const selectedDept = deptFilter?.value || 'ALL';

  const filteredUsers = users.filter(u => {
    if (selectedDept !== 'ALL' && u.department !== selectedDept) {
      return false;
    }
    if (!query) return true;
    const qName = (u.name || '').toLowerCase();
    const qNick = (u.nickname || '').toLowerCase();
    const qCode = (u.empCode || '').toLowerCase();
    const qRole = (u.role || '').toLowerCase();
    const qDept = (u.department || '').toLowerCase();
    const qPhone = (u.phone || '').toLowerCase();
    return qName.includes(query) || qNick.includes(query) || qCode.includes(query) || qRole.includes(query) || qDept.includes(query) || qPhone.includes(query);
  });

  if (filteredUsers.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="py-12 text-center text-slate-400">
          <div class="flex flex-col items-center justify-center gap-2">
            <i data-lucide="users" class="w-8 h-8 text-slate-300"></i>
            <span class="text-xs font-semibold">ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไขการค้นหา</span>
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tableBody.innerHTML = filteredUsers.map((u, idx) => {
    const isSelf = u.id === me.id;
    const isAdmin = isUserAdmin(u);
    const meta = STATUS_META[u.status] || STATUS_META.available;
    const avatarUrl = getUserAvatar(u);
    const isExecutive = (u.department || '').includes('ผู้บริหาร');

    const deptBadgeClass = isExecutive
      ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold'
      : 'bg-sky-50 text-sky-800 border-sky-200 font-medium';

    return `
      <tr class="hover:bg-sky-50/50 transition border-b border-slate-100 text-xs">
        <td class="p-3 font-semibold">
          <div class="flex items-center gap-2.5">
            <span class="text-slate-400 font-mono text-[11px] w-6 shrink-0">${idx + 1}</span>
            <img src="${avatarUrl}" alt="${u.name}" class="w-8 h-8 rounded-xl object-cover border border-slate-200 shrink-0">
            <div>
              <div class="font-bold text-slate-800 flex items-center gap-1.5 flex-wrap">
                <span>${u.name}</span>
                ${u.nickname ? `<span class="text-sky-700 font-bold">(${u.nickname})</span>` : ''}
                ${isAdmin ? '<span class="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300">👑 Admin</span>' : ''}
                ${isSelf ? '<span class="px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">(คุณ)</span>' : ''}
              </div>
              <div class="text-[11px] text-slate-400">${u.email || '-'}</div>
            </div>
          </div>
        </td>
        <td class="p-3">
          <span class="font-mono font-bold text-sky-800 bg-sky-50/80 px-2 py-0.5 rounded border border-sky-200 text-[11px]">
            ${u.empCode || '-'}
          </span>
        </td>
        <td class="p-3 font-medium text-slate-700">
          ${u.role || '-'}
        </td>
        <td class="p-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[11px] border ${deptBadgeClass}">
            ${u.department || '-'}
          </span>
        </td>
        <td class="p-3 text-slate-600 text-[11px]">
          ${u.phone ? `<div>📞 ${u.phone}</div>` : '<span class="text-slate-400">-</span>'}
        </td>
        <td class="p-3">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full ${meta.dotColor || 'bg-slate-400'}"></span>
            <span class="font-bold text-slate-700 text-[11px]">${meta.label || 'พร้อมทำงาน'}</span>
          </div>
          <span class="text-[10px] text-slate-400 font-mono">${u.attendance?.location || 'WFH'}</span>
        </td>
        <td class="p-3 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="openAdminEditEmployeeModal('${u.id}')" title="แก้ไขข้อมูลพนักงาน" class="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold border border-sky-200 transition flex items-center gap-1 cursor-pointer">
              <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
              <span>แก้ไข</span>
            </button>
            ${isSelf ? `
              <span class="px-2 py-1 text-[11px] text-slate-400 font-medium bg-slate-100 rounded-lg">ตัวเอง</span>
            ` : `
              <button onclick="confirmDeleteEmployee('${u.id}')" title="ลบข้อมูลพนักงานออกจากฐานข้อมูล" class="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold border border-rose-200 transition flex items-center gap-1 cursor-pointer">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                <span>ลบ</span>
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

function filterEmployeesAdminTable() {
  renderEmployeesAdminView();
}

// Add Employee Modal Handlers
function openAddEmployeeModal() {
  const me = getCurrentUser();
  if (!isUserAdmin(me)) {
    showToast('เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถเพิ่มพนักงานได้', 'warning');
    return;
  }
  const form = document.getElementById('addEmployeeForm');
  if (form) form.reset();
  const modal = document.getElementById('addEmployeeModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  setTimeout(() => document.getElementById('addEmpCode')?.focus(), 100);
}

function closeAddEmployeeModal() {
  const modal = document.getElementById('addEmployeeModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

async function submitAddEmployee(e) {
  if (e) e.preventDefault();
  const me = getCurrentUser();
  if (!isUserAdmin(me)) {
    showToast('เฉพาะผู้ดูแลระบบเท่านั้นที่มีสิทธิ์ดำเนินการ', 'warning');
    return;
  }

  const empCode = (document.getElementById('addEmpCode')?.value || '').trim();
  const nickname = (document.getElementById('addEmpNickname')?.value || '').trim();
  const name = (document.getElementById('addEmpName')?.value || '').trim();
  const role = (document.getElementById('addEmpRole')?.value || '').trim();
  const department = document.getElementById('addEmpDepartment')?.value || 'ฝ่ายบริหารและพัฒนาองค์กร';
  const phone = (document.getElementById('addEmpPhone')?.value || '').trim();
  const email = (document.getElementById('addEmpEmail')?.value || '').trim();
  const location = document.getElementById('addEmpLocation')?.value || 'WFH';
  const isAdmin = document.getElementById('addEmpIsAdmin')?.checked || false;

  if (!empCode || !name || !nickname || !role) {
    showToast('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน', 'warning');
    return;
  }

  const submitBtn = document.getElementById('submitAddEmpBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>กำลังบันทึก...</span>`;
  }

  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminUserId: me.id,
        empCode,
        name,
        nickname,
        role,
        department,
        phone,
        email,
        location,
        isAdmin
      })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || 'ไม่สามารถเพิ่มพนักงานใหม่ได้', 'error');
      return;
    }

    closeAddEmployeeModal();
    showToast(`เพิ่มพนักงานใหม่ ${name} สำเร็จแล้ว 🎉`, 'success');
  } catch (err) {
    console.error('submitAddEmployee error:', err);
    showToast('เกิดข้อผิดพลาดในการเพิ่มพนักงาน', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="user-check" class="w-4 h-4"></i><span>ยืนยันเพิ่มพนักงาน</span>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// Edit Employee Modal Handlers
function openAdminEditEmployeeModal(userId) {
  const me = getCurrentUser();
  if (!isUserAdmin(me)) {
    showToast('เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถแก้ไขข้อมูลพนักงานได้', 'warning');
    return;
  }

  const u = users.find(x => x.id === userId);
  if (!u) {
    showToast('ไม่พบข้อมูลพนักงาน', 'error');
    return;
  }

  document.getElementById('adminEditEmpId').value = u.id;
  document.getElementById('adminEditEmpCode').value = u.empCode || '';
  document.getElementById('adminEditNickname').value = u.nickname || '';
  document.getElementById('adminEditName').value = u.name || '';
  document.getElementById('adminEditRole').value = u.role || '';
  document.getElementById('adminEditDepartment').value = u.department || 'ฝ่ายบริหารและพัฒนาองค์กร';
  document.getElementById('adminEditPhone').value = u.phone || '';
  document.getElementById('adminEditEmail').value = u.email || '';
  document.getElementById('adminEditStatus').value = u.status || 'available';
  document.getElementById('adminEditIsAdmin').checked = isUserAdmin(u);

  currentEditAdminAvatarBase64 = u.avatar || null;
  const avatarPreview = document.getElementById('adminEditAvatarPreview');
  if (avatarPreview) {
    avatarPreview.src = getUserAvatar(u);
  }

  const modal = document.getElementById('adminEditEmployeeModal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeAdminEditEmployeeModal() {
  const modal = document.getElementById('adminEditEmployeeModal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  currentEditAdminAvatarBase64 = null;
}

function handleAdminAvatarUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    showToast('ไฟล์รูปภาพมีขนาดใหญ่เกิน 2MB กรุณาเลือกไฟล์ขนาดเล็กลง', 'warning');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(evt) {
    const dataUrl = evt.target.result;
    currentEditAdminAvatarBase64 = dataUrl;
    const preview = document.getElementById('adminEditAvatarPreview');
    if (preview) preview.src = dataUrl;
    showToast('อัปโหลดตัวอย่างรูปใหม่เรียบร้อย', 'info');
  };
  reader.readAsDataURL(file);
}

function resetAdminAvatarToDefault() {
  const name = document.getElementById('adminEditName')?.value || '';
  currentEditAdminAvatarBase64 = '';
  const preview = document.getElementById('adminEditAvatarPreview');
  if (preview) {
    preview.src = getDefaultAvatarByName(name);
  }
  showToast('รีเซ็ตรูปภาพเป็นแบบตั้งต้นแล้ว', 'info');
}

async function submitAdminEditEmployee(e) {
  if (e) e.preventDefault();
  const me = getCurrentUser();
  if (!isUserAdmin(me)) {
    showToast('เฉพาะผู้ดูแลระบบเท่านั้นที่มีสิทธิ์ดำเนินการ', 'warning');
    return;
  }

  const id = document.getElementById('adminEditEmpId')?.value;
  const empCode = (document.getElementById('adminEditEmpCode')?.value || '').trim();
  const nickname = (document.getElementById('adminEditNickname')?.value || '').trim();
  const name = (document.getElementById('adminEditName')?.value || '').trim();
  const role = (document.getElementById('adminEditRole')?.value || '').trim();
  const department = document.getElementById('adminEditDepartment')?.value || 'ฝ่ายบริหารและพัฒนาองค์กร';
  const phone = (document.getElementById('adminEditPhone')?.value || '').trim();
  const email = (document.getElementById('adminEditEmail')?.value || '').trim();
  const status = document.getElementById('adminEditStatus')?.value || 'available';
  const isAdmin = document.getElementById('adminEditIsAdmin')?.checked || false;

  if (!id || !empCode || !name || !nickname || !role) {
    showToast('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน', 'warning');
    return;
  }

  const submitBtn = document.getElementById('submitAdminEditEmpBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>กำลังบันทึก...</span>`;
  }

  try {
    const payload = {
      adminUserId: me.id,
      empCode,
      name,
      nickname,
      role,
      department,
      phone,
      email,
      status,
      isAdmin
    };
    if (currentEditAdminAvatarBase64 !== null) {
      payload.avatar = currentEditAdminAvatarBase64;
    }

    const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || 'ไม่สามารถแก้ไขข้อมูลพนักงานได้', 'error');
      return;
    }

    closeAdminEditEmployeeModal();
    showToast(`อัปเดตข้อมูลพนักงาน ${name} สำเร็จแล้ว ✨`, 'success');
  } catch (err) {
    console.error('submitAdminEditEmployee error:', err);
    showToast('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="save" class="w-4 h-4"></i><span>บันทึกการแก้ไข</span>`;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// Delete Employee Handler
async function confirmDeleteEmployee(userId) {
  const me = getCurrentUser();
  if (!isUserAdmin(me)) {
    showToast('เฉพาะผู้ดูแลระบบเท่านั้นที่สามารถลบพนักงานได้', 'warning');
    return;
  }

  if (userId === me.id) {
    showToast('ไม่สามารถลบบัญชีผู้ดูแลระบบของตัวเองได้', 'error');
    return;
  }

  const target = users.find(u => u.id === userId);
  if (!target) {
    showToast('ไม่พบข้อมูลพนักงานที่ต้องการลบ', 'error');
    return;
  }

  const confirmMsg = `⚠️ คุณต้องการลบข้อมูลพนักงานใช่หรือไม่?\n\nรหัส: ${target.empCode || '-'}\nชื่อ: ${target.name} (${target.nickname})\nตำแหน่ง: ${target.role || '-'}\nฝ่าย: ${target.department || '-'}\n\n* ข้อมูลจะถูกลบออกจากฐานข้อมูล SQLite ทันทีและไม่สามารถกู้คืนได้`;
  if (!window.confirm(confirmMsg)) {
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}?adminUserId=${encodeURIComponent(me.id)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      showToast(data.error || 'ไม่สามารถลบข้อมูลพนักงานได้', 'error');
      return;
    }
    showToast(`ลบข้อมูลพนักงาน ${target.name} เรียบร้อยแล้ว`, 'warning');
  } catch (err) {
    console.error('confirmDeleteEmployee error:', err);
    showToast('เกิดข้อผิดพลาดในการลบพนักงาน', 'error');
  }
}
