    let currentUser = null, accessToken = null, selectedFile = null;

    async function track(eventType, eventData = {}) {
      if (!currentUser) return;
      try { await fetch('/api/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser.id, eventType, eventData }) }); } catch (e) {}
    }

    function showBadgeNotification(badge) {
      const notif = document.getElementById('badgeNotification');
      document.getElementById('badgeNotifIcon').textContent = badge.icon;
      document.getElementById('badgeNotifTitle').textContent = badge.name;
      document.getElementById('badgeNotifDesc').textContent = badge.desc;
      notif.classList.add('show');
      setTimeout(() => notif.classList.remove('show'), 3000);
    }

    function showTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
      document.getElementById('signupForm').style.display = tab === 'signup' ? 'block' : 'none';
    }

    function formatTime(s) { return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; }

    document.getElementById('signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('signupName').value, email: document.getElementById('signupEmail').value, password: document.getElementById('signupPassword').value, role: document.getElementById('signupRole').value }) });
      const data = await res.json();
      if (data.error) document.getElementById('error').textContent = data.error;
      else { document.getElementById('success').textContent = 'Created!'; showTab('login'); }
    });

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('loginEmail').value, password: document.getElementById('loginPassword').value }) });
      const data = await res.json();
      if (data.error) document.getElementById('error').textContent = data.error;
      else { currentUser = data.user; accessToken = data.session.access_token; localStorage.setItem('token', accessToken); localStorage.setItem('user', JSON.stringify(currentUser)); showDashboard(); }
    });

    function showDashboard() {
      document.getElementById('authSection').classList.remove('active');
      document.getElementById('dashboard').classList.add('active');
      document.getElementById('userName').textContent = currentUser.name;
      document.getElementById('userRole').textContent = currentUser.role;
      loadPendingRequests();
      if (currentUser.role === 'coach') {
        document.getElementById('coachSection').style.display = 'block';
        loadCoachDashboard();
        loadCoachLeaderboard();
        loadOutgoingInvites();
      } else {
        document.getElementById('swimmerSection').style.display = 'block';
        if (!currentUser.coach_id) {
          document.getElementById('noCoachBanner').style.display = 'block';
        } else {
          document.getElementById('coachName').textContent = '(with coach)';
        }
        loadGroups(); loadSettings(); loadSwimmerLeaderboard();
        loadAchievements();
        loadTrainingPlan();
        loadInsights();
        loadGoals();
        loadTimes();
        loadFeedback(); loadCoachFeedback(); loadCoachBadges(); loadMeets(); loadWatchWorkouts();
      }
    }

    // ========== APPROVAL FLOW ==========
    async function loadPendingRequests() {
      const res = await fetch(`/api/requests/incoming/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById('incomingRequests');
      if (!data.requests?.length) {
        document.getElementById('pendingRequestsSection').style.display = 'none';
        return;
      }
      document.getElementById('pendingRequestsSection').style.display = 'block';
      container.innerHTML = data.requests.map(r => `
        <div class="request-card">
          <div class="request-header">
            <div>
              <div class="request-name">${r.from.name}</div>
              <div class="request-type">${r.type === 'swimmer_to_coach' ? '🏊 Swimmer wants to join' : '👨‍🏫 Coach invites you'}</div>
            </div>
            <span class="status-badge status-pending">Pending</span>
          </div>
          <div class="request-actions">
            <button class="btn btn-success btn-small" onclick="respondRequest('${r.id}', 'accept')">Accept</button>
            <button class="btn btn-danger btn-small" onclick="respondRequest('${r.id}', 'reject')">Reject</button>
          </div>
        </div>
      `).join('');
    }

    async function respondRequest(requestId, action) {
      const res = await fetch('/api/requests/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId, action }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        if (action === 'accept') {
          // Refresh user data
          const userRes = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: currentUser.email, password: '---' }) });
          // Just reload to get fresh data
          location.reload();
        } else {
          loadPendingRequests();
        }
      }
    }

    // Coach: Invite swimmer
    document.getElementById('inviteSwimmerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('inviteEmail').value;
      const res = await fetch('/api/requests/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coachId: currentUser.id, swimmerEmail: email }) });
      const data = await res.json();
      const status = document.getElementById('inviteStatus');
      if (data.error) status.innerHTML = `<span class="error">${data.error}</span>`;
      else {
        status.innerHTML = `<span class="success">Invite sent to ${data.swimmer.name}!</span>`;
        document.getElementById('inviteEmail').value = '';
        loadOutgoingInvites();
      }
    });

    async function loadOutgoingInvites() {
      const res = await fetch(`/api/requests/outgoing/${currentUser.id}`);
      const data = await res.json();
      if (!data.requests?.length) {
        document.getElementById('pendingInvites').style.display = 'none';
        return;
      }
      document.getElementById('pendingInvites').style.display = 'block';
      document.getElementById('outgoingInvitesList').innerHTML = data.requests.map(r => `
        <div class="request-card">
          <div class="request-name">${r.to.name}</div>
          <div class="request-type">${r.to.email}</div>
          <span class="status-badge status-pending">Awaiting response</span>
        </div>
      `).join('');
    }

    // Swimmer: Find coach
    function showFindCoach() {
      document.getElementById('findCoachSection').style.display = 'block';
      document.getElementById('noCoachBanner').style.display = 'none';
      loadOutgoingSwimmerRequests();
    }

    function hideFindCoach() {
      document.getElementById('findCoachSection').style.display = 'none';
      if (!currentUser.coach_id) document.getElementById('noCoachBanner').style.display = 'block';
    }

    async function searchCoaches() {
      const query = document.getElementById('coachSearchInput').value;
      if (query.length < 2) {
        document.getElementById('coachResults').style.display = 'none';
        return;
      }
      const res = await fetch(`/api/coaches/search?query=${encodeURIComponent(query)}`);
      const data = await res.json();
      const container = document.getElementById('coachResults');
      if (!data.coaches?.length) {
        container.innerHTML = '<div style="padding:12px;color:#94a3b8;">No coaches found</div>';
      } else {
        container.innerHTML = data.coaches.map(c => `
          <div class="coach-result-item" onclick="sendJoinRequest('${c.id}', '${c.name}')">
            <div class="name">${c.name}</div>
            <div class="email">${c.email}</div>
          </div>
        `).join('');
      }
      container.style.display = 'block';
    }

    async function sendJoinRequest(coachId, coachName) {
      const res = await fetch('/api/requests/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fromId: currentUser.id, toId: coachId, type: 'swimmer_to_coach' }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        alert(`Request sent to ${coachName}!`);
        document.getElementById('coachSearchInput').value = '';
        document.getElementById('coachResults').style.display = 'none';
        loadOutgoingSwimmerRequests();
      }
    }

    async function loadOutgoingSwimmerRequests() {
      const res = await fetch(`/api/requests/outgoing/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById('outgoingRequests');
      if (!data.requests?.length) {
        container.innerHTML = '';
        return;
      }
      container.innerHTML = '<h4 style="margin:16px 0 8px;color:#94a3b8;">Pending Requests</h4>' + data.requests.map(r => `
        <div class="request-card">
          <div class="request-name">${r.to.name}</div>
          <span class="status-badge status-pending">Pending</span>
        </div>
      `).join('');
    }

    // ========== EXISTING FUNCTIONS ==========
    async function loadAchievements() {
      const res = await fetch(`/api/achievements/${currentUser.id}`);
      const data = await res.json();
      document.getElementById('currentStreak').textContent = data.streak.current_streak || 0;
      document.getElementById('longestStreak').textContent = data.streak.longest_streak || 0;
      const ch = data.challenge;
      const pct = Math.min(100, (ch.progress / ch.target) * 100);
      document.getElementById('weeklyChallenge').innerHTML = `<h4 style="color:#0ea5e9;margin-bottom:8px;">🎯 Weekly Challenge</h4><div style="font-weight:600;">${ch.name}</div><div style="font-size:0.85rem;color:#94a3b8;margin-bottom:10px;">${ch.desc}</div><div style="background:rgba(255,255,255,0.1);border-radius:10px;height:8px;overflow:hidden;"><div style="background:linear-gradient(90deg,#0ea5e9,#22c55e);height:100%;width:${pct}%;"></div></div><div style="display:flex;justify-content:space-between;margin-top:8px;font-size:0.8rem;color:#94a3b8;"><span>${ch.progress}/${ch.target}</span><span>${ch.completed ? '✅ Complete!' : 'In Progress'}</span></div>`;
      document.getElementById('badgesGrid').innerHTML = data.all.map(b => `<div class="badge-item ${b.earned ? 'earned' : 'locked'}"><div class="badge-icon">${b.icon}</div><div class="badge-name">${b.name}</div></div>`).join('');
    }

    async function loadCoachDashboard() {
      const res = await fetch(`/api/coach/dashboard/${currentUser.id}`);
      const data = await res.json();
      document.getElementById('totalSwimmers').textContent = data.summary.total;
      document.getElementById('aheadCount').textContent = data.summary.ahead;
      document.getElementById('behindCount').textContent = data.summary.behind;
      document.getElementById('noGoalsCount').textContent = data.summary.noGoals;
      const list = document.getElementById('coachSwimmersList');
      if (!data.swimmers.length) { list.innerHTML = '<p class="empty-state">No swimmers yet</p>'; return; }
      list.innerHTML = data.swimmers.map(s => `<div class="swimmer-detail-card ${s.status}"><div class="swimmer-detail-header"><h4>${s.name}</h4><span class="status-badge status-${s.status}">${s.status === 'ahead' ? '✓' : s.status === 'behind' ? '↓' : '-'}</span></div><div class="swimmer-detail-stats"><span>Goals <strong>${s.goalsAhead}/${s.goalsCount}</strong></span><span>Sessions <strong>${s.sessionsThisMonth}</strong></span><span>🔥 <strong>${s.streak}</strong></span></div><button class="btn btn-small btn-primary" style="margin-top:8px;" onclick="showCommentSection('${s.id}', '${s.name}')">💬 Comment</button><button class="btn btn-small btn-success" style="margin-top:8px;margin-left:4px;" onclick="showAwardBadge('${s.id}', '${s.name}')">🏅 Award</button></div>`).join('');
    }

    async function loadCoachLeaderboard() {
      const res = await fetch(`/api/leaderboard/${currentUser.id}`);
      const data = await res.json();
      track('leaderboard_view', { role: 'coach' });
      const c = document.getElementById('coachLeaderboard');
      if (!data.enabled || !data.leaderboard.length) { c.innerHTML = '<p class="empty-state">Add swimmers to see leaderboard</p>'; return; }
      c.innerHTML = data.leaderboard.map(s => `<div class="leaderboard-entry ${s.rank <= 3 ? 'rank-' + s.rank : ''}"><div class="rank-badge ${s.rank > 3 ? 'default' : ''}">${s.rank}</div><div class="leaderboard-info"><div class="leaderboard-name">${s.name}</div><div class="leaderboard-stats"><span>📈${s.improvementPct > 0 ? '+' : ''}${s.improvementPct}%</span><span>🎯${s.goalCompletionRate}%</span></div></div><div class="leaderboard-score"><div class="score">${s.compositeScore}</div></div></div>`).join('');
    }

    async function loadSwimmerLeaderboard() {
      if (!currentUser.coach_id) return;
      const res = await fetch(`/api/leaderboard/${currentUser.coach_id}`);
      const data = await res.json();
      track('leaderboard_view', { role: 'swimmer' });
      if (!data.enabled || !data.leaderboard.length) return;
      const me = data.leaderboard.find(s => s.id === currentUser.id);
      if (!me) return;
      document.getElementById('myRankSection').style.display = 'block';
      document.getElementById('myRank').textContent = `#${me.rank}`;
      document.getElementById('myDelta').textContent = me.deltaFromTop > 0 ? `${me.deltaFromTop} pts from #1` : '🥇 Leading!';
      document.getElementById('myDelta').className = `delta ${me.deltaFromTop > 0 ? 'behind' : 'top'}`;
      document.getElementById('myImprovement').textContent = `${me.improvementPct > 0 ? '+' : ''}${me.improvementPct}%`;
      document.getElementById('myImprovement').className = `value ${me.improvementPct > 0 ? 'positive' : ''}`;
      document.getElementById('myConsistency').textContent = `${me.consistencyScore}%`;
      document.getElementById('myGoalRate').textContent = `${me.goalCompletionRate}%`;
    }

    async function loadTrainingPlan() {
      const res = await fetch(`/api/training-plan/${currentUser.id}`);
      const data = await res.json();
      const c = document.getElementById('trainingPlanContent');
      if (!data.ready) { c.innerHTML = `<div style="text-align:center;padding:20px;"><h4 style="color:#ef4444;margin-bottom:12px;">Complete to unlock:</h4><div style="padding:8px;" class="${data.missing.goals ? '' : 'success'}">${data.missing.goals ? '❌' : '✅'} Set a goal</div><div style="padding:8px;" class="${data.missing.times ? '' : 'success'}">${data.missing.times ? '❌' : '✅'} Log a time</div><div style="padding:8px;" class="${data.missing.video ? '' : 'success'}">${data.missing.video ? '❌' : '✅'} Upload video</div></div>`; return; }
      const p = data.plan;
      let html = `<div class="plan-header"><div class="focus">${p.weekFocus}</div><span class="intensity-badge intensity-${p.intensity}">${p.intensity.toUpperCase()}</span></div><div class="focus-areas">${p.focusAreas.map(f => `<span class="focus-tag">${f}</span>`).join('')}</div>`;
      p.workouts.forEach(w => { html += `<div class="workout-day"><div class="day-header"><span class="day-name">${w.day}</span><span class="day-type">${w.type}</span><span style="color:#94a3b8;font-size:0.75rem;">${w.totalDistance}</span></div><div class="workout-section"><div class="section-label">Warm-up</div><div class="workout-set"><div class="set-name">${w.warmup}</div></div></div><div class="workout-section"><div class="section-label">Main</div>${w.main.map(m => `<div class="workout-set"><div class="set-name">${m.set}</div><div class="set-details">Rest: ${m.rest} | ${m.focus}</div></div>`).join('')}</div><div class="workout-section"><div class="section-label">Cool-down</div><div class="workout-set"><div class="set-name">${w.cooldown}</div></div></div></div>`; });
      html += `<div class="plan-meta"><div class="plan-meta-item"><div class="value">${p.sessionsPerWeek}</div><div class="label">Sessions</div></div><div class="plan-meta-item"><div class="value">${p.totalWeeklyDistance}</div><div class="label">Total</div></div></div>`;
      if (p.tips?.length) html += `<div style="margin-top:16px;padding:14px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.3);border-radius:10px;"><h4 style="color:#a78bfa;margin-bottom:10px;">💡 Tips</h4>${p.tips.map(t => `<div style="font-size:0.85rem;padding:4px 0;">• ${t}</div>`).join('')}</div>`;
      c.innerHTML = html;
    }

    async function loadInsights() {
      const res = await fetch(`/api/insights/${currentUser.id}`);
      const data = await res.json();
      const c = document.getElementById('insightsContent');
      if (data.totalSessions < 3) { c.innerHTML = '<p class="empty-state">Log 3+ sessions for insights</p>'; return; }
      let html = `<div class="insight-section"><h4>📈 Pace Trend</h4><div class="insight-value ${data.paceTrend.direction === 'improving' ? 'trend-up' : data.paceTrend.direction === 'declining' ? 'trend-down' : ''}">${data.paceTrend.description}</div></div>`;
      html += `<div class="insight-section"><h4>💪 Consistency</h4><div class="insight-value">${data.consistencyScore}%</div><div style="font-size:0.8rem;color:#94a3b8;">${data.consistencyDesc}</div></div>`;
      if (data.goalInsight) html += `<div class="insight-section" style="background:${data.goalInsight.status === 'achieved' ? 'rgba(34,197,94,0.1)' : 'rgba(14,165,233,0.1)'};"><div class="insight-value" style="color:${data.goalInsight.status === 'achieved' ? '#22c55e' : '#0ea5e9'};">${data.goalInsight.message}</div></div>`;
      html += `<div class="main-factor"><div class="label">Main Factor</div><div class="text">${data.rankingInsight.mainFactor}</div></div>`;
      c.innerHTML = html;
    }

    async function loadGoals() {
      const res = await fetch(`/api/goals/all/${currentUser.id}`);
      const data = await res.json();
      document.getElementById('goalsList').innerHTML = data.goals.length === 0 ? '<p class="empty-state">Set a goal to start</p>' : data.goals.map(g => `<div onclick="setActiveGoal('${g.id}')" style="background:${g.isActive ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.03)'};padding:14px;border-radius:10px;margin-bottom:10px;cursor:pointer;border:${g.isActive ? '2px solid #22c55e' : '1px solid transparent'};"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><h4>${g.stroke} ${g.distance}m</h4>${g.isActive ? '<span style="color:#22c55e;font-size:0.8rem;">✓ Active</span>' : ''}</div><div style="font-size:0.85rem;color:#94a3b8;">Target: ${formatTime(g.target_seconds)}</div></div>`).join('');
    }

    async function loadTimes() {
      const res = await fetch(`/api/times/${currentUser.id}`);
      const data = await res.json();
      document.getElementById('timesList').innerHTML = data.times.length === 0 ? '<p class="empty-state">No times logged</p>' : data.times.slice(0, 5).map(t => `<div class="time-entry"><div><div class="stroke">${t.stroke}</div><div class="details">${t.distance}m • ${t.date}</div></div><div class="time">${formatTime(t.time_seconds)}</div></div>`).join('');
    }

    async function loadFeedback() {
      const res = await fetch(`/api/video/feedback/${currentUser.id}`);
      const data = await res.json();
      document.getElementById('feedbackList').innerHTML = data.feedbacks.length === 0 ? '<p class="empty-state">Upload a video for feedback</p>' : data.feedbacks.slice(0, 2).map(f => `<div class="feedback-card"><h4>${f.stroke} • ${new Date(f.created_at).toLocaleDateString()}</h4><span class="score-badge">${f.feedback.overall_score}/10</span><div class="priority-box"><label>Focus on</label><p>${f.feedback.priority_focus}</p></div></div>`).join('');
    }

    document.getElementById('logTimeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/times', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ swimmerId: currentUser.id, stroke: document.getElementById('timeStroke').value, distance: document.getElementById('timeDistance').value, minutes: document.getElementById('timeMinutes').value, seconds: document.getElementById('timeSeconds').value }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        document.getElementById('timeMinutes').value = ''; document.getElementById('timeSeconds').value = '';
        if (data.newBadges?.length) data.newBadges.forEach(b => showBadgeNotification(b));
        loadTimes(); loadGoals(); loadGroups(); loadSettings(); loadSwimmerLeaderboard(); loadInsights(); loadTrainingPlan(); loadAchievements();
      }
    });

    document.getElementById('setGoalForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ swimmerId: currentUser.id, stroke: document.getElementById('goalStroke').value, distance: document.getElementById('goalDistance').value, targetMinutes: document.getElementById('goalMinutes').value, targetSeconds: document.getElementById('goalSeconds').value }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else {
        document.getElementById('goalMinutes').value = ''; document.getElementById('goalSeconds').value = '';
        if (data.newBadges?.length) data.newBadges.forEach(b => showBadgeNotification(b));
        loadGoals(); loadGroups(); loadSettings(); loadSwimmerLeaderboard(); loadInsights(); loadTrainingPlan(); loadAchievements();
      }
    });

    const uploadArea = document.getElementById('uploadArea');
    const videoFile = document.getElementById('videoFile');
    const uploadBtn = document.getElementById('uploadBtn');
    uploadArea.addEventListener('click', () => videoFile.click());
    videoFile.addEventListener('change', (e) => { if (e.target.files.length) { selectedFile = e.target.files[0]; document.getElementById('fileSelected').textContent = selectedFile.name; uploadBtn.disabled = false; } });

    document.getElementById('videoForm').addEventListener('submit', async (e) => {
      e.preventDefault(); if (!selectedFile) return;
      document.getElementById('uploadContainer').style.display = 'none';
      document.getElementById('processingState').style.display = 'block';
      const formData = new FormData();
      formData.append('video', selectedFile);
      formData.append('swimmerId', currentUser.id);
      formData.append('stroke', document.getElementById('videoStroke').value);
      const res = await fetch('/api/video/upload', { method: 'POST', body: formData });
      const data = await res.json();
      document.getElementById('processingState').style.display = 'none';
      document.getElementById('uploadContainer').style.display = 'block';
      if (data.error) alert(data.error);
      else {
        selectedFile = null; document.getElementById('fileSelected').textContent = ''; uploadBtn.disabled = true;
        if (data.newBadges?.length) data.newBadges.forEach(b => showBadgeNotification(b));
        loadFeedback(); loadCoachFeedback(); loadCoachBadges(); loadMeets(); loadWatchWorkouts(); loadTrainingPlan(); loadAchievements();
      }
    });

    // ========== FRIEND GROUPS ==========
    async function loadGroups() {
      const res = await fetch(`/api/groups/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById("myGroups");
      if (!data.groups?.length) {
        container.innerHTML = "<p class=\"empty-state\">No groups yet</p>";
        return;
      }
      container.innerHTML = data.groups.map(g => `<div style="background:rgba(255,255,255,0.03);padding:12px;border-radius:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;"><div><div style="font-weight:600;">${g.name}</div><div style="font-size:0.75rem;color:#94a3b8;">Code: ${g.invite_code}</div></div><button class="btn btn-primary btn-small" onclick="viewGroupLeaderboard('${g.id}', '${g.name}')">View</button></div>`).join("");
    }
    function showCreateGroup() { document.getElementById("createGroupForm").style.display = "block"; document.getElementById("joinGroupForm").style.display = "none"; }
    function showJoinGroup() { document.getElementById("joinGroupForm").style.display = "block"; document.getElementById("createGroupForm").style.display = "none"; }
    function hideGroupForms() { document.getElementById("createGroupForm").style.display = "none"; document.getElementById("joinGroupForm").style.display = "none"; }
    async function createGroup() {
      const name = document.getElementById("newGroupName").value;
      if (!name) return alert("Enter a group name");
      const res = await fetch("/api/groups/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, swimmerId: currentUser.id }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { alert(`Group created! Invite code: ${data.group.invite_code}`); document.getElementById("newGroupName").value = ""; hideGroupForms(); loadGroups(); }
    }
    async function joinGroup() {
      const code = document.getElementById("joinCode").value;
      if (!code) return alert("Enter an invite code");
      const res = await fetch("/api/groups/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, swimmerId: currentUser.id }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { alert(`Joined ${data.group.name}!`); document.getElementById("joinCode").value = ""; hideGroupForms(); loadGroups(); }
    }
    async function viewGroupLeaderboard(groupId, groupName) {
      document.getElementById("groupsSection").style.display = "none";
      document.getElementById("groupLeaderboardSection").style.display = "block";
      document.getElementById("groupLeaderboardName").textContent = groupName;
      const res = await fetch(`/api/groups/${groupId}/leaderboard`);
      const data = await res.json();
      const container = document.getElementById("groupLeaderboard");
      if (!data.leaderboard?.length) { container.innerHTML = "<p class=\"empty-state\">No members yet</p>"; return; }
      container.innerHTML = data.leaderboard.map(s => `<div class="leaderboard-entry ${s.rank <= 3 ? "rank-" + s.rank : ""}"><div class="rank-badge ${s.rank > 3 ? "default" : ""}">${s.rank}</div><div class="leaderboard-info"><div class="leaderboard-name">${s.name}</div><div class="leaderboard-stats"><span>📈${s.improvementPct > 0 ? "+" : ""}${s.improvementPct}%</span><span>🎯${s.goalRate}%</span><span>🔥${s.streak}</span></div></div><div class="leaderboard-score"><div class="score">${s.compositeScore}</div></div></div>`).join("");
    }
    function hideGroupLeaderboard() {
      document.getElementById("groupLeaderboardSection").style.display = "none";
      document.getElementById("groupsSection").style.display = "block";
    }

    // ========== COACH BATCHES ==========
    let currentBatchId = null;
    async function loadBatches() {
      const res = await fetch(`/api/batches/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById("batchesList");
      if (!data.batches?.length) { container.innerHTML = "<p class=\"empty-state\">No batches yet</p>"; return; }
      container.innerHTML = data.batches.map(b => `<div style="background:rgba(255,255,255,0.03);padding:12px;border-radius:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;"><div><div style="font-weight:600;">${b.name}</div><div style="font-size:0.75rem;color:#94a3b8;">${b.memberCount} swimmers</div></div><button class="btn btn-primary btn-small" onclick="viewBatchDetail('${b.id}', '${b.name}')">Manage</button></div>`).join("");
    }
    function showCreateBatch() { document.getElementById("createBatchForm").style.display = "block"; }
    function hideCreateBatch() { document.getElementById("createBatchForm").style.display = "none"; }
    async function createBatch() {
      const name = document.getElementById("newBatchName").value;
      if (!name) return alert("Enter a batch name");
      const res = await fetch("/api/batches/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, coachId: currentUser.id }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { document.getElementById("newBatchName").value = ""; hideCreateBatch(); loadBatches(); }
    }
    async function viewBatchDetail(batchId, batchName) {
      currentBatchId = batchId;
      document.getElementById("batchDetailName").textContent = batchName;
      document.getElementById("batchDetailSection").style.display = "block";
      await loadBatchMembers(batchId);
      await loadBatchLeaderboard(batchId);
      await loadAvailableSwimmers(batchId);
    }
    function hideBatchDetail() { document.getElementById("batchDetailSection").style.display = "none"; currentBatchId = null; }
    async function loadBatchMembers(batchId) {
      const res = await fetch(`/api/batches/${batchId}/leaderboard`);
      const data = await res.json();
      const container = document.getElementById("batchMembers");
      if (!data.leaderboard?.length) { container.innerHTML = "<p class=\"empty-state\">No swimmers in this batch</p>"; return; }
      container.innerHTML = data.leaderboard.map(s => `<div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;"><span>${s.name}</span><button class="btn btn-danger btn-small" onclick="removeFromBatch('${s.id}')">Remove</button></div>`).join("");
    }
    async function loadBatchLeaderboard(batchId) {
      const res = await fetch(`/api/batches/${batchId}/leaderboard`);
      const data = await res.json();
      const container = document.getElementById("batchLeaderboard");
      if (!data.leaderboard?.length) { container.innerHTML = "<p class=\"empty-state\">Add swimmers to see leaderboard</p>"; return; }
      container.innerHTML = data.leaderboard.map(s => `<div class="leaderboard-entry ${s.rank <= 3 ? "rank-" + s.rank : ""}"><div class="rank-badge ${s.rank > 3 ? "default" : ""}">${s.rank}</div><div class="leaderboard-info"><div class="leaderboard-name">${s.name}</div><div class="leaderboard-stats"><span>📈${s.improvementPct > 0 ? "+" : ""}${s.improvementPct}%</span><span>🎯${s.goalRate}%</span><span>🔥${s.streak}</span></div></div><div class="leaderboard-score"><div class="score">${s.compositeScore}</div></div></div>`).join("");
    }
    async function loadAvailableSwimmers(batchId) {
      const res = await fetch(`/api/batches/${batchId}/available/${currentUser.id}`);
      const data = await res.json();
      const select = document.getElementById("addSwimmerSelect");
      select.innerHTML = "<option value=\"\">Add swimmer...</option>" + (data.available || []).map(s => `<option value="${s.id}">${s.name}</option>`).join("");
    }
    async function addSwimmerToBatch() {
      const swimmerId = document.getElementById("addSwimmerSelect").value;
      if (!swimmerId || !currentBatchId) return alert("Select a swimmer");
      const res = await fetch("/api/batches/add-swimmer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: currentBatchId, swimmerId }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { await loadBatchMembers(currentBatchId); await loadBatchLeaderboard(currentBatchId); await loadAvailableSwimmers(currentBatchId); loadBatches(); }
    }
    async function removeFromBatch(swimmerId) {
      if (!currentBatchId) return;
      const res = await fetch("/api/batches/remove-swimmer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ batchId: currentBatchId, swimmerId }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { await loadBatchMembers(currentBatchId); await loadBatchLeaderboard(currentBatchId); await loadAvailableSwimmers(currentBatchId); loadBatches(); }
    }

    // ========== SETTINGS ==========
    async function loadSettings() {
      const res = await fetch(`/api/settings/${currentUser.id}`);
      const data = await res.json();
      const toggle = document.getElementById("leaderboardToggle");
      const slider = document.getElementById("toggleSlider");
      if (toggle && data.settings) {
        toggle.checked = data.settings.showOnLeaderboard;
        updateToggleStyle(data.settings.showOnLeaderboard);
      }
    }
    function updateToggleStyle(isOn) {
      const slider = document.getElementById("toggleSlider");
      const toggle = document.getElementById("leaderboardToggle");
      if (slider && toggle) {
        slider.style.transform = isOn ? "translateX(22px)" : "translateX(0)";
        toggle.parentElement.querySelector("span").style.background = isOn ? "#22c55e" : "#475569";
      }
    }
    async function toggleLeaderboardVisibility() {
      const toggle = document.getElementById("leaderboardToggle");
      const isOn = toggle.checked;
      updateToggleStyle(isOn);
      const res = await fetch("/api/settings/leaderboard-visibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ swimmerId: currentUser.id, showOnLeaderboard: isOn }) });
      const data = await res.json();
      if (data.error) { alert(data.error); toggle.checked = !isOn; updateToggleStyle(!isOn); }
    }

    // ========== COACH COMMENTS ==========
    let currentCommentSwimmerId = null;
    function showCommentSection(swimmerId, swimmerName) {
      currentCommentSwimmerId = swimmerId;
      document.getElementById("commentSwimmerName").textContent = swimmerName;
      document.getElementById("swimmerCommentSection").style.display = "block";
      loadSwimmerTimesForComment(swimmerId);
    }
    function hideCommentSection() {
      document.getElementById("swimmerCommentSection").style.display = "none";
      currentCommentSwimmerId = null;
    }
    async function loadSwimmerTimesForComment(swimmerId) {
      const res = await fetch(`/api/comments/swimmer-times/${swimmerId}`);
      const data = await res.json();
      const container = document.getElementById("swimmerTimesForComment");
      if (!data.times?.length) { container.innerHTML = "<p class=\"empty-state\">No times logged</p>"; return; }
      container.innerHTML = data.times.map(t => `<div style="background:rgba(255,255,255,0.03);padding:12px;border-radius:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;"><span style="font-weight:600;">${t.stroke} ${t.distance}m</span><span style="color:#0ea5e9;">${formatTime(t.time_seconds)}</span></div><div style="font-size:0.75rem;color:#94a3b8;">${t.date}</div>${t.comments?.length ? t.comments.map(c => `<div style="margin-top:8px;padding:8px;background:rgba(34,197,94,0.1);border-radius:6px;font-size:0.85rem;">${c.reaction || ""} ${c.comment || ""}</div>`).join("") : ""}</div>`).join("");
    }
    async function addReaction(emoji) {
      if (!currentCommentSwimmerId) return;
      const res = await fetch("/api/comments/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coachId: currentUser.id, swimmerId: currentCommentSwimmerId, reaction: emoji }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { alert("Reaction sent!"); loadSwimmerTimesForComment(currentCommentSwimmerId); }
    }
    async function addComment() {
      if (!currentCommentSwimmerId) return;
      const comment = document.getElementById("coachCommentText").value;
      if (!comment) return alert("Enter a comment");
      const res = await fetch("/api/comments/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coachId: currentUser.id, swimmerId: currentCommentSwimmerId, comment }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { document.getElementById("coachCommentText").value = ""; alert("Comment sent!"); loadSwimmerTimesForComment(currentCommentSwimmerId); }
    }
    async function loadCoachFeedback() {
      const res = await fetch(`/api/comments/swimmer/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById("coachFeedbackList");
      if (!data.comments?.length) { container.innerHTML = "<p class=\"empty-state\">No feedback yet</p>"; return; }
      container.innerHTML = data.comments.map(c => `<div style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);padding:12px;border-radius:10px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;margin-bottom:4px;"><span style="font-weight:600;color:#22c55e;">${c.coach?.name || "Coach"}</span><span style="font-size:0.75rem;color:#94a3b8;">${new Date(c.created_at).toLocaleDateString()}</span></div>${c.reaction ? `<div style="font-size:1.5rem;">${c.reaction}</div>` : ""}${c.comment ? `<p style="margin-top:4px;">${c.comment}</p>` : ""}${c.time ? `<div style="font-size:0.75rem;color:#94a3b8;margin-top:4px;">On: ${c.time.stroke} ${c.time.distance}m - ${formatTime(c.time.time_seconds)}</div>` : ""}</div>`).join("");
    }

    // ========== MANUAL COACH BADGES ==========
    let currentBadgeSwimmerId = null;
    let selectedBadgeIcon = null;
    let selectedBadgeName = null;
    const badgeLibrary = [
      {icon: "🌟", name: "Star Performer"},
      {icon: "🏆", name: "Champion"},
      {icon: "🚀", name: "Most Improved"},
      {icon: "💎", name: "Diamond Effort"},
      {icon: "🎯", name: "Goal Crusher"},
      {icon: "⚡", name: "Speed Demon"},
      {icon: "🦈", name: "Shark"},
      {icon: "🔥", name: "On Fire"},
      {icon: "💪", name: "Strong Work"},
      {icon: "🥇", name: "Gold Standard"}
    ];
    function showAwardBadge(swimmerId, swimmerName) {
      currentBadgeSwimmerId = swimmerId;
      selectedBadgeIcon = null;
      selectedBadgeName = null;
      document.getElementById("badgeSwimmerName").textContent = swimmerName;
      document.getElementById("awardBadgeSection").style.display = "block";
      document.getElementById("selectedBadgePreview").style.display = "none";
      document.getElementById("badgeMessage").value = "";
      const container = document.getElementById("badgeOptions");
      container.innerHTML = badgeLibrary.map(b => `<button class="btn btn-small" style="font-size:1.2rem;" onclick="selectBadge('${b.icon}', '${b.name}')">${b.icon}</button>`).join("");
    }
    function hideAwardBadge() {
      document.getElementById("awardBadgeSection").style.display = "none";
      currentBadgeSwimmerId = null;
    }
    function selectBadge(icon, name) {
      selectedBadgeIcon = icon;
      selectedBadgeName = name;
      document.getElementById("selectedBadgePreview").style.display = "block";
      document.getElementById("selectedBadgeIcon").textContent = icon;
      document.getElementById("selectedBadgeName").textContent = name;
    }
    async function awardBadge() {
      if (!currentBadgeSwimmerId || !selectedBadgeIcon) return alert("Select a badge first");
      const message = document.getElementById("badgeMessage").value;
      const res = await fetch("/api/coach-badges/award", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coachId: currentUser.id, swimmerId: currentBadgeSwimmerId, badgeName: selectedBadgeName, badgeIcon: selectedBadgeIcon, message }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { alert("Badge awarded!"); hideAwardBadge(); }
    }
    async function loadCoachBadges() {
      const res = await fetch(`/api/coach-badges/swimmer/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById("coachBadgesList");
      if (!container) return;
      if (!data.badges?.length) { container.innerHTML = "<p class=\"empty-state\">No coach badges yet</p>"; return; }
      container.innerHTML = data.badges.map(b => `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);padding:12px;border-radius:10px;margin-bottom:8px;"><div style="display:flex;align-items:center;gap:10px;"><span style="font-size:2rem;">${b.badge_icon}</span><div><div style="font-weight:600;color:#fbbf24;">${b.badge_name}</div><div style="font-size:0.75rem;color:#94a3b8;">From ${b.coach?.name || "Coach"} • ${new Date(b.created_at).toLocaleDateString()}</div></div></div>${b.message ? `<p style="margin-top:8px;font-size:0.9rem;">${b.message}</p>` : ""}</div>`).join("");
    }

    // ========== MEET RESULTS TRACKER ==========
    let currentMeetId = null;
    async function loadMeets() {
      const res = await fetch(`/api/meets/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById("meetsList");
      if (!data.meets?.length) { container.innerHTML = "<p class=\"empty-state\">No meets yet</p>"; return; }
      container.innerHTML = data.meets.map(m => `<div style="background:rgba(255,255,255,0.03);padding:12px;border-radius:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;"><div><div style="font-weight:600;">${m.name}</div><div style="font-size:0.75rem;color:#94a3b8;">${m.date} • ${m.resultCount} races</div></div><button class="btn btn-primary btn-small" onclick="viewMeetDetail('${m.id}', '${m.name}')">View</button></div>`).join("");
    }
    function showAddMeet() { document.getElementById("addMeetSection").style.display = "block"; }
    function hideAddMeet() { document.getElementById("addMeetSection").style.display = "none"; }
    async function createMeet() {
      const name = document.getElementById("meetName").value;
      const date = document.getElementById("meetDate").value;
      const location = document.getElementById("meetLocation").value;
      if (!name || !date) return alert("Enter meet name and date");
      const res = await fetch("/api/meets/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, date, location, swimmerId: currentUser.id }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { hideAddMeet(); viewMeetDetail(data.meet.id, data.meet.name); loadMeets(); }
    }
    async function viewMeetDetail(meetId, meetName) {
      currentMeetId = meetId;
      document.getElementById("meetDetailName").textContent = meetName;
      document.getElementById("meetDetailSection").style.display = "block";
      document.getElementById("addMeetSection").style.display = "none";
      await loadMeetResults(meetId);
    }
    function hideMeetDetail() { document.getElementById("meetDetailSection").style.display = "none"; currentMeetId = null; }
    async function loadMeetResults(meetId) {
      const res = await fetch(`/api/meets/${meetId}/results/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById("meetResultsList");
      if (!data.results?.length) { container.innerHTML = "<p class=\"empty-state\">No races logged yet</p>"; return; }
      container.innerHTML = data.results.map(r => `<div style="background:rgba(255,255,255,0.03);padding:12px;border-radius:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;"><div><div style="font-weight:600;">${r.stroke} ${r.distance}m ${r.medal ? (r.medal === "gold" ? "🥇" : r.medal === "silver" ? "🥈" : "🥉") : ""}</div><div style="font-size:0.75rem;color:#94a3b8;">${r.place ? "Place: " + r.place : ""} ${r.is_pb ? "⭐ PB!" : ""}</div></div><div style="font-size:1.2rem;font-weight:700;color:#0ea5e9;">${formatTime(r.time_seconds)}</div></div>`).join("");
    }
    async function addRaceResult() {
      if (!currentMeetId) return alert("No meet selected");
      const stroke = document.getElementById("raceStroke").value;
      const distance = document.getElementById("raceDistance").value;
      const minutes = document.getElementById("raceMinutes").value || 0;
      const seconds = document.getElementById("raceSeconds").value || 0;
      const place = document.getElementById("racePlace").value;
      const medal = document.getElementById("raceMedal").value;
      if (!minutes && !seconds) return alert("Enter a time");
      const res = await fetch("/api/meets/add-result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meetId: currentMeetId, swimmerId: currentUser.id, stroke, distance, minutes, seconds, place, medal }) });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { if (data.isPB) alert("🎉 New Personal Best!"); document.getElementById("raceMinutes").value = ""; document.getElementById("raceSeconds").value = ""; document.getElementById("racePlace").value = ""; loadMeetResults(currentMeetId); loadMeets(); loadTimes(); loadGoals(); }
    }

    function logout() {
      track('logout', {});
      localStorage.removeItem('token'); localStorage.removeItem('user'); currentUser = null;
      document.getElementById('dashboard').classList.remove('active');
      document.getElementById('authSection').classList.add('active');
      document.getElementById('coachSection').style.display = 'none';
      document.getElementById('swimmerSection').style.display = 'none';
    }

    async function setActiveGoal(goalId) {
      const res = await fetch('/api/goals/set-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swimmerId: currentUser.id, goalId })
      });
      const data = await res.json();
      if (data.error) alert(data.error);
      else { loadGoals(); loadTrainingPlan(); }
    }

    // ========== APPLE WATCH ==========
    async function generateWatchCode() {
      if (!currentUser) return alert("Please log in");
      const res = await fetch("/api/watch/generate-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swimmerId: currentUser.id })
      });
      const data = await res.json();
      if (data.code) {
        document.getElementById("watchCode").style.display = "block";
        document.getElementById("watchCode").innerHTML = `Your code: <span style="color:#00bcd4">${data.code}</span><br><small>Enter this on your Apple Watch (expires in 10 min)</small>`;
      }
    }

    async function loadWatchWorkouts() {
      if (!currentUser) return;
      const res = await fetch(`/api/watch/workouts/${currentUser.id}`);
      const data = await res.json();
      const container = document.getElementById("watchWorkouts");
      const status = document.getElementById("watchStatus");
      const btn = document.getElementById("generateCodeBtn");
      if (!data.workouts || data.workouts.length === 0) {
        if (status) status.innerHTML = "⌚ No watch linked yet";
        container.innerHTML = "<p style='color:#888'>No watch workouts yet</p>";
        return;
      }
      if (status) status.innerHTML = `✅ Watch linked &middot; ${data.workouts.length} workout${data.workouts.length === 1 ? '' : 's'} synced`;
      if (btn) btn.textContent = "Generate New Code";
      container.innerHTML = data.workouts.map(w => `
        <div style="background:#1a1a2e;padding:10px;border-radius:8px;margin-bottom:8px;position:relative;">
          <button onclick="deleteWatchWorkout('${w.id}')" title="Delete workout"
            style="position:absolute;top:6px;right:6px;background:transparent;border:none;color:#888;font-size:16px;cursor:pointer;padding:2px 6px;">✕</button>
          <div style="display:flex;justify-content:space-between;padding-right:24px;">
            <span>🏊 ${w.laps} laps (${w.distance}m)</span>
            <span style="color:#888">${new Date(w.created_at).toLocaleDateString()}</span>
          </div>
          <div style="font-size:12px;color:#888;margin-top:5px;">
            ⏱️ ${Math.floor(w.duration/60)}:${(w.duration%60).toString().padStart(2,'0')} |
            ❤️ ${Math.round(w.avg_heart_rate || 0)} bpm |
            💪 ${w.fatigue_level || 'N/A'}
          </div>
        </div>
      `).join("");
    }

    async function deleteWatchWorkout(id) {
      if (!confirm("Delete this workout?")) return;
      const res = await fetch(`/api/watch/workout/${id}`, { method: "DELETE" });
      if (res.ok) {
        loadWatchWorkouts();
      } else {
        const data = await res.json().catch(() => ({}));
        alert("Failed to delete: " + (data.error || res.status));
      }
    }

    const savedUser = localStorage.getItem('user');
    if (savedUser) { currentUser = JSON.parse(savedUser); accessToken = localStorage.getItem('token'); showDashboard(); }
