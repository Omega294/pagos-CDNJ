
    // Configuración Base de la API REST (Soporta protocolo file:// y servidor http://)
    const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

    // State Manager
    const state = {
      token: localStorage.getItem('cdnj_token'),
      user: JSON.parse(localStorage.getItem('cdnj_user') || 'null'),
      activeTab: 'cashier',
      searchMode: 'all', // 'all', 'rep', 'est', 'cedula'
      searchQuery: '',
      searchResults: [],
      selectedStudent: null,
      debts: [],
      selectedDebtIds: [],
      isPartial: false,
      partialAmountUSD: 0,
      exchangeRate: 36.50,
      paymentMethods: [{ method: 'CASH_USD', amount: 0, currency: 'USD', reference: '' }],
      transactions: [],
      dashboardPeriod: 'daily',
      dashboardData: null,
      dashboardLoading: false,
      activeReceiptModalId: null,
      showVoidModal: null,
      voidReason: '',
      showClosingModal: false,
      closingData: null,
      showPaymentConfirmModal: false,
      paymentCurrency: 'USD',
      paymentMethod: 'CASH_USD',
      paymentReference: '',
      paymentBank: '',
      paymentModalError: null,
      bcvRateData: null,
      rateHistoryWeek: [],
      historicalQueryDate: '',
      historicalQueryResult: null,
      tuitionRatesData: null,
      tuitionMode: 'GLOBAL',
      globalTuitionInput: 50.0,
      groupTuitionInputs: { 'Primaria': 50.0, 'Educación Básica': 50.0, 'Media y Diversificada': 50.0 },
      gradeTuitionInputs: {},
      dashboardPeriod: 'daily',
      dashboardData: null,
      studentsList: [],
      studentsGuardiansList: [],
      studentsSearchQuery: '',
      studentsStatusFilter: 'ALL',
      studentsLoading: false,
      showStudentModal: false,
      editingStudent: null,
      showBatchModal: false,
      batchPreviewRecords: [],
      batchImporting: false
    };

    function setAuth(token, user) {
      state.token = token;
      state.user = user;
      localStorage.setItem('cdnj_token', token);
      localStorage.setItem('cdnj_user', JSON.stringify(user));
      render();
    }

    function logout() {
      state.token = null;
      state.user = null;
      localStorage.removeItem('cdnj_token');
      localStorage.removeItem('cdnj_user');
      render();
    }

    function hasPermission(code) {
      if (!state.user) return false;
      if (state.user.roles.includes('SUPERADMIN') || state.user.permissions.includes('*')) return true;
      return state.user.permissions.includes(code);
    }

    async function loginDemo(username) {
      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: '123456' })
        });
        const data = await res.json();
        if (res.ok) setAuth(data.token, data.user);
      } catch (e) { console.error(e); }
    }

    // Main Render Controller
    function render() {
      const app = document.getElementById('app');
      if (!state.user) {
        app.innerHTML = renderLogin();
        lucide.createIcons();
        return;
      }

      app.innerHTML = `
        <div class="app-container">
          <!-- Sidebar -->
          <aside class="sidebar">
            <div>
              <div style="font-size:0.75rem; font-weight:700; color:#6b7280; text-transform:uppercase; margin-bottom:0.75rem; padding-left:0.5rem;">Módulo 1: Cobros</div>
              <nav style="display:flex; flex-direction:column; gap:0.4rem;">
                ${hasPermission('payments:cashier:create_payment') ? `
                  <button onclick="state.activeTab='cashier'; render();" class="btn ${state.activeTab === 'cashier' ? 'btn-primary' : 'btn-secondary'}" style="justify-content:flex-start;">
                    <i data-lucide="credit-card"></i> Panel de Cobro
                  </button>
                ` : ''}
                ${hasPermission('payments:admin:view_history') ? `
                  <button onclick="state.activeTab='admin'; loadAdminDashboard();" class="btn ${state.activeTab === 'admin' ? 'btn-primary' : 'btn-secondary'}" style="justify-content:flex-start;">
                    <i data-lucide="layout-dashboard"></i> Dashboard & Supervisión
                  </button>
                ` : ''}
                ${hasPermission('payments:config:manage_rates') ? `
                  <button onclick="state.activeTab='rates'; loadRatesData();" class="btn ${state.activeTab === 'rates' ? 'btn-primary' : 'btn-secondary'}" style="justify-content:flex-start;">
                    <i data-lucide="settings"></i> Config. Aranceles
                  </button>
                ` : ''}
                ${hasPermission('payments:admin:view_history') ? `
                  <button onclick="state.activeTab='students'; loadStudentsData();" class="btn ${state.activeTab === 'students' ? 'btn-primary' : 'btn-secondary'}" style="justify-content:flex-start;">
                    <i data-lucide="user-check"></i> Matrícula & Estudiantes
                  </button>
                ` : ''}
              </nav>
            </div>
            <div>
              <div style="font-size:0.75rem; font-weight:700; color:#6b7280; text-transform:uppercase; margin-bottom:0.75rem; padding-left:0.5rem;">Próximos Módulos</div>
              <div style="display:flex; flex-direction:column; gap:0.4rem; opacity:0.5;">
                <div class="glass-card" style="padding:0.6rem; display:flex; justify-content:space-between; font-size:0.85rem;">
                  <span><i data-lucide="graduation-cap"></i> Calificaciones</span> <i data-lucide="lock"></i>
                </div>
                <div class="glass-card" style="padding:0.6rem; display:flex; justify-content:space-between; font-size:0.85rem;">
                  <span><i data-lucide="users"></i> Matrículas</span> <i data-lucide="lock"></i>
                </div>
              </div>
            </div>
          </aside>

          <!-- Main Body -->
          <div class="main-content">
            <!-- Navbar -->
            <header class="navbar">
              <div style="display:flex; align-items:center; gap:0.75rem;">
                <div style="width:38px; height:38px; border-radius:10px; background:linear-gradient(135deg, #6366f1, #10b981); display:flex; align-items:center; justify-content:center;">
                  <i data-lucide="shield-check" color="#fff"></i>
                </div>
                <div>
                  <h1 style="font-size:1.1rem; font-weight:700;">CDNJ Modular</h1>
                  <span style="font-size:0.75rem; color:#9ca3af;">Gestión Escolar RBAC</span>
                </div>
              </div>

              <!-- Quick Demo Switcher -->
              <div style="display:flex; align-items:center; gap:0.4rem; background:rgba(11,15,25,0.7); padding:0.3rem 0.6rem; border-radius:9999px; border:1px solid rgba(255,255,255,0.1);">
                <span style="font-size:0.75rem; color:#9ca3af; font-weight:600;">Rol Demo:</span>
                <button onclick="loginDemo('cajera')" class="btn btn-sm ${state.user.username==='cajera'?'btn-accent':'btn-secondary'}" style="padding:0.15rem 0.5rem;">Cajera</button>
                <button onclick="loginDemo('admin')" class="btn btn-sm ${state.user.username==='admin'?'btn-primary':'btn-secondary'}" style="padding:0.15rem 0.5rem;">Admin</button>
                <button onclick="loginDemo('superadmin')" class="btn btn-sm ${state.user.username==='superadmin'?'btn-primary':'btn-secondary'}" style="padding:0.15rem 0.5rem; background:${state.user.username==='superadmin'?'#8b5cf6':''};">Superadmin</button>
              </div>

              <div style="display:flex; align-items:center; gap:1rem;">
                <div style="text-align:right;">
                  <div style="font-size:0.875rem; font-weight:600;">${state.user.fullName}</div>
                  <span class="badge badge-primary">${state.user.roles.join(', ')}</span>
                </div>
                <button onclick="logout()" class="btn btn-secondary btn-sm" style="color:#ef4444;"><i data-lucide="log-out"></i></button>
              </div>
            </header>

            <main class="page-body">
              ${renderTabContent()}
            </main>
          </div>
        </div>

        ${state.activeReceiptModalId ? renderReceiptModalHTML() : ''}
        ${state.showVoidModal ? renderVoidModalHTML() : ''}
        ${state.showClosingModal ? renderClosingModalHTML() : ''}
        ${state.showPaymentConfirmModal ? renderPaymentConfirmModalHTML() : ''}
        ${state.showStudentModal ? renderStudentModalHTML() : ''}
        ${state.showBatchModal ? renderBatchModalHTML() : ''}
      `;

      lucide.createIcons();
    }

    async function loginDemo(username) {
      const btnContainer = document.getElementById('login_error_box');
      if (btnContainer) btnContainer.innerHTML = '<span style="color:#818cf8;">Iniciando sesión demo...</span>';
      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: '123456' })
        });
        const data = await res.json();
        if (res.ok) {
          setAuth(data.token, data.user);
        } else {
          if (btnContainer) btnContainer.innerHTML = `<span style="color:#ef4444;">${data.message || 'Error al iniciar sesión'}</span>`;
          alert(data.message || 'Error al iniciar sesión');
        }
      } catch (e) {
        console.error('Error de red loginDemo:', e);
        if (btnContainer) btnContainer.innerHTML = `<span style="color:#ef4444;">Error de conexión con el servidor REST (${API_BASE || 'http://localhost:3000'}).</span>`;
        alert(`Error de conexión con el servidor REST. Asegúrese de ingresar mediante http://localhost:3000 o que server.py esté corriendo.`);
      }
    }

    function renderLogin() {
      return `
        <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; padding:2rem; background:radial-gradient(circle at top right, rgba(99,102,241,0.15), transparent 40%), radial-gradient(circle at bottom left, rgba(16,185,129,0.15), transparent 40%);">
          <div style="width:100%; max-width:920px; display:grid; grid-template-columns:1fr 1fr; gap:2rem; align-items:center;">
            <div>
              <div style="display:inline-flex; align-items:center; gap:0.4rem; padding:0.3rem 0.8rem; border-radius:9999px; background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3); color:#818cf8; font-size:0.8rem; font-weight:700; margin-bottom:1rem;">
                <i data-lucide="shield-check"></i> CDNJ School Platform
              </div>
              <h1 style="font-size:2.2rem; font-weight:800; line-height:1.1; margin-bottom:1rem;">Arquitectura Modular & RBAC Granular</h1>
              <p style="color:#9ca3af; font-size:0.95rem; margin-bottom:1.5rem;">
                Accede al sistema y prueba el módulo de <strong>Cobro de Mensualidades y Cierre de Caja</strong> con control de permisos estricto.
              </p>

              <div style="display:flex; flex-direction:column; gap:0.6rem;">
                <span style="font-size:0.75rem; font-weight:700; color:#6b7280; text-transform:uppercase;">Acceso Rápido Demo (1-Click):</span>
                <div onclick="loginDemo('cajera')" class="glass-card" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                  <div><strong style="color:#10b981;">Rol: CAJERA (María González)</strong><br><span style="font-size:0.8rem; color:#9ca3af;">Registrar cobros y emitir recibos</span></div>
                  <i data-lucide="arrow-right" color="#10b981"></i>
                </div>
                <div onclick="loginDemo('admin')" class="glass-card" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                  <div><strong style="color:#6366f1;">Rol: ADMINISTRADOR (Lic. Ana Martínez)</strong><br><span style="font-size:0.8rem; color:#9ca3af;">Supervisión, anulación con motivo y cierre de caja</span></div>
                  <i data-lucide="arrow-right" color="#6366f1"></i>
                </div>
                <div onclick="loginDemo('superadmin')" class="glass-card" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
                  <div><strong style="color:#a855f7;">Rol: SUPERADMIN</strong><br><span style="font-size:0.8rem; color:#9ca3af;">Control total (*)</span></div>
                  <i data-lucide="arrow-right" color="#a855f7"></i>
                </div>
              </div>
            </div>

            <div class="glass-panel" style="padding:2rem;">
              <h2 style="font-size:1.4rem; font-weight:700; margin-bottom:0.5rem;">Iniciar Sesión</h2>
              <p style="font-size:0.85rem; color:#9ca3af; margin-bottom:1.5rem;">Usa una cuenta demo o las credenciales:</p>

              <div id="login_error_box" style="font-size:0.85rem; margin-bottom:1rem; font-weight:600;"></div>

              <form onsubmit="handleLoginForm(event)">
                <div style="margin-bottom:1rem;">
                  <label style="font-size:0.8rem; font-weight:600; color:#9ca3af; text-transform:uppercase;">Usuario</label>
                  <input id="login_user" type="text" class="input-field" value="cajera" required />
                </div>
                <div style="margin-bottom:1.5rem;">
                  <label style="font-size:0.8rem; font-weight:600; color:#9ca3af; text-transform:uppercase;">Contraseña</label>
                  <input id="login_pass" type="password" class="input-field" value="123456" required />
                </div>
                <button type="submit" id="btn_submit_login" class="btn btn-primary" style="width:100%;">Acceder al Sistema</button>
              </form>
            </div>
          </div>
        </div>
      `;
    }

    async function handleLoginForm(e) {
      e.preventDefault();
      const u = document.getElementById('login_user').value;
      const p = document.getElementById('login_pass').value;
      const errBox = document.getElementById('login_error_box');
      const btn = document.getElementById('btn_submit_login');
      
      if (btn) btn.innerText = 'Ingresando...';
      if (errBox) errBox.innerHTML = '';

      try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        if (res.ok) {
          setAuth(data.token, data.user);
        } else {
          if (errBox) errBox.innerHTML = `<span style="color:#ef4444;">${data.message || 'Credenciales incorrectas'}</span>`;
          if (btn) btn.innerText = 'Acceder al Sistema';
        }
      } catch (err) {
        console.error(err);
        if (errBox) errBox.innerHTML = `<span style="color:#ef4444;">Error de conexión con el servidor REST (${API_BASE || 'http://localhost:3000'}).</span>`;
        if (btn) btn.innerText = 'Acceder al Sistema';
      }
    }

    function renderTabContent() {
      if (state.activeTab === 'cashier') {
        if (!hasPermission('payments:cashier:create_payment')) return renderDenied('payments:cashier:create_payment');
        return renderCashierPanel();
      }
      if (state.activeTab === 'admin') {
        if (!hasPermission('payments:admin:view_history')) return renderDenied('payments:admin:view_history');
        return renderAdminPanel();
      }
      if (state.activeTab === 'rates') {
        if (!hasPermission('payments:config:manage_rates')) return renderDenied('payments:config:manage_rates');
        return renderRatesPanel();
      }
      if (state.activeTab === 'students') {
        return renderStudentsPanel();
      }
    }

    function renderDenied(perm) {
      return `
        <div style="padding:4rem 2rem; text-align:center; max-width:600px; margin:0 auto;">
          <div class="glass-panel" style="padding:2.5rem;">
            <i data-lucide="lock" size="48" color="#ef4444" style="margin-bottom:1rem;"></i>
            <h2 style="font-size:1.4rem; font-weight:800; margin-bottom:0.5rem;">Acceso Restringido (RBAC Granular)</h2>
            <p style="color:#9ca3af; font-size:0.9rem; margin-bottom:1.5rem;">
              Tu usuario actual (<strong>${state.user.username}</strong>) con roles [<strong>${state.user.roles.join(', ')}</strong>] no posee el permiso <code style="color:#818cf8; background:rgba(99,102,241,0.15); padding:0.2rem 0.5rem; border-radius:4px;">${perm}</code>.
            </p>
            <p style="font-size:0.8rem; color:#6b7280;">Usa el selector de usuario en la barra superior para cambiar a Administrador.</p>
          </div>
        </div>
      `;
    }

    // Cashier Panel
    function renderCashierPanel() {
      const totalUSD = state.debts.filter(d => state.selectedDebtIds.includes(d.id)).reduce((s,d)=>s+d.amountUSD, 0);

      return `
        <div style="display:grid; grid-template-columns: 1fr 1.2fr; gap:2rem;">
          <div>
            <div class="glass-panel" style="padding:1.5rem; margin-bottom:1.5rem;">
              <h3 style="font-size:1.1rem; font-weight:700; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="search" color="#818cf8"></i> Buscar Estudiante / Representante
              </h3>
              <div style="display:flex; gap:0.35rem; margin-bottom:0.75rem; flex-wrap:wrap;">
                <button type="button" onclick="setSearchMode('all')" class="btn btn-sm ${state.searchMode==='all'?'btn-primary':'btn-secondary'}" style="font-size:0.75rem; padding:0.25rem 0.6rem;">
                  🔍 Todos
                </button>
                <button type="button" onclick="setSearchMode('rep')" class="btn btn-sm ${state.searchMode==='rep'?'btn-accent':'btn-secondary'}" style="font-size:0.75rem; padding:0.25rem 0.6rem;">
                  🪪 Cod. Rep (REP-)
                </button>
                <button type="button" onclick="setSearchMode('est')" class="btn btn-sm ${state.searchMode==='est'?'btn-primary':'btn-secondary'}" style="font-size:0.75rem; padding:0.25rem 0.6rem; background:${state.searchMode==='est'?'#8b5cf6':''}; border-color:${state.searchMode==='est'?'#8b5cf6':''};">
                  🎓 Cod. Alumno (EST-)
                </button>
                <button type="button" onclick="setSearchMode('cedula')" class="btn btn-sm ${state.searchMode==='cedula'?'btn-primary':'btn-secondary'}" style="font-size:0.75rem; padding:0.25rem 0.6rem;">
                  📄 Cédula (V-)
                </button>
              </div>

              <form onsubmit="handleSearch(event)" style="display:flex; gap:0.5rem;">
                <input id="search_input" type="text" class="input-field" oninput="handleSearchInput(event)" placeholder="${state.searchMode==='rep'?'Escribe los números (ej: 015)...':state.searchMode==='est'?'Escribe los números (ej: 0041)...':'Buscar por Nombre, Cédula o Código...'}" value="${state.searchQuery}">
                <button type="submit" class="btn btn-primary">Buscar</button>
              </form>
              
              <div style="margin-top:1rem; display:flex; flex-direction:column; gap:0.5rem; max-height:350px; overflow-y:auto;">
                ${state.searchResults.length > 0 && state.searchResults[0].guardians && state.searchResults[0].guardians[0] ? `
                  <div onclick="selectStudent('${state.searchResults[0].id}', 'ALL')" class="glass-card" style="cursor:pointer; border:2px solid #fbbf24; background:rgba(251, 191, 36, 0.15); margin-bottom:0.25rem; padding:0.75rem; border-radius:10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <div>
                        <span class="badge badge-warning" style="font-size:0.65rem; font-weight:800; text-transform:uppercase;">
                          👨‍👩‍👧‍👦 Representante Tutor (${state.searchResults.length} Representados)
                        </span>
                        <h4 style="color:#f3f4f6; font-size:0.95rem; font-weight:800; margin-top:0.2rem;">
                          ${state.searchResults[0].guardians[0].guardian.fullName}
                        </h4>
                        <span style="font-size:0.75rem; color:#9ca3af;">Código: <strong style="color:#34d399;">${state.searchResults[0].guardians[0].guardian.guardianCode}</strong> | Cédula: <strong>${state.searchResults[0].guardians[0].guardian.docId}</strong></span>
                      </div>
                      <button type="button" class="btn btn-sm btn-warning" style="font-size:0.75rem; font-weight:700; padding:0.35rem 0.65rem;">
                        💳 Ver Cobro Tutor
                      </button>
                    </div>
                  </div>
                ` : ''}

                ${state.searchResults.map(s => `
                  <div onclick="selectStudent('${s.id}', '${s.id}')" class="glass-card" style="cursor:pointer; border-color:${state.selectedStudent?.id===s.id?'#6366f1':''}; background:${state.selectedStudent?.id===s.id?'rgba(99,102,241,0.15)':''}">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                      <div>
                        <strong style="color:#f3f4f6; font-size:0.95rem;">${s.firstName} ${s.lastName}</strong>
                        <span class="badge badge-primary" style="font-size:0.7rem; margin-left:0.5rem;">Cod: ${s.studentCode}</span>
                      </div>
                      <span class="badge badge-warning">${s.debts?.length||0} Pendientes</span>
                    </div>
                    <div style="font-size:0.8rem; color:#9ca3af; margin-top:2px;">
                      Grado: <strong>${s.grade}</strong> | Cédula/ID: <strong>${s.docId || 'S/D'}</strong>
                    </div>
                    ${s.guardians[0] ? `
                      <div style="font-size:0.78rem; color:#818cf8; margin-top:6px; padding-top:4px; border-top:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between;">
                        <span>Tutor: <strong>${s.guardians[0].guardian.fullName}</strong> (${s.guardians[0].guardian.docId})</span>
                        <span style="color:#34d399; font-weight:700;">Cod: ${s.guardians[0].guardian.guardianCode}</span>
                      </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            </div>

            ${state.familyData ? `
              <div style="display:flex; flex-direction:column; gap:1rem;">
                
                ${state.familyData.representedCount > 1 ? `
                  <!-- Tarjeta Tutor & Banner Consolidado -->
                  <div class="glass-panel" style="padding:1.25rem; border:1px solid rgba(251, 191, 36, 0.4); background:rgba(251, 191, 36, 0.08); box-shadow:0 4px 20px rgba(251, 191, 36, 0.12);">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:0.75rem;">
                      <div>
                        <span class="badge badge-warning" style="font-size:0.75rem; padding:0.25rem 0.65rem; font-weight:800; text-transform:uppercase;">
                          👨‍👩‍👧‍👦 Representante (${state.familyData.representedCount} Representados)
                        </span>
                        <h3 style="color:#f3f4f6; font-size:1.15rem; font-weight:800; margin-top:0.4rem;">
                          ${state.familyData.guardian ? state.familyData.guardian.fullName : 'Representante Legal'}
                        </h3>
                        <span style="font-size:0.8rem; color:#9ca3af;">Código: <strong style="color:#34d399;">${state.familyData.guardian ? state.familyData.guardian.guardianCode : 'N/A'}</strong> | Cédula: <strong style="color:#e5e7eb;">${state.familyData.guardian ? state.familyData.guardian.docId : 'S/D'}</strong></span>
                      </div>
                      <div style="text-align:right; background:rgba(11,15,25,0.6); padding:0.6rem 0.85rem; border-radius:8px; border:1px solid rgba(251, 191, 36, 0.3);">
                        <span style="font-size:0.7rem; color:#9ca3af; text-transform:uppercase; font-weight:700;">Deuda Total Consolidada</span>
                        <h2 style="color:#fbbf24; font-size:1.35rem; font-weight:800; margin:0.1rem 0;">$${state.familyData.totalFamilyDebtUSD.toFixed(2)} USD</h2>
                        <span style="font-size:0.8rem; font-weight:700; color:#e5e7eb;">${(state.familyData.totalFamilyDebtUSD * state.exchangeRate).toLocaleString('es-VE', {minimumFractionDigits:2})} VES</span>
                      </div>
                    </div>

                    <!-- Botón para ver deudas globales si un estudiante individual estaba filtrado -->
                    ${state.selectedStudent ? `
                      <div style="margin-bottom:0.75rem;">
                        <button type="button" onclick="selectIndividualStudent('ALL')" class="btn btn-sm btn-secondary" style="width:100%; font-size:0.75rem; padding:0.4rem;">
                          👈 Volver a Ver Deuda Global de Todos los Representados
                        </button>
                      </div>
                    ` : ''}

                    <!-- Lista de Alumnos Representados (Clickable) -->
                    <div style="margin-top:0.75rem; display:flex; flex-direction:column; gap:0.5rem; border-top:1px solid rgba(255,255,255,0.08); padding-top:0.75rem;">
                      <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="font-size:0.75rem; font-weight:700; color:#9ca3af; text-transform:uppercase;">Selecciona un Representado para ver sus deudas a la derecha:</span>
                        ${state.selectedStudent ? `
                          <span class="badge badge-accent" style="font-size:0.7rem;">Estudiante: ${state.selectedStudent.firstName}</span>
                        ` : `
                          <span class="badge badge-primary" style="font-size:0.7rem;">Modo Deuda Global</span>
                        `}
                      </div>
                      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:0.5rem;">
                        ${state.familyData.students.map(st => `
                          <div onclick="selectIndividualStudent('${st.id}')" style="background:${state.selectedStudent?.id===st.id ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.03)'}; cursor:pointer; padding:0.65rem 0.75rem; border-radius:8px; border:2px solid ${state.selectedStudent?.id===st.id ? '#818cf8' : st.debts.length > 0 ? 'rgba(251,191,36,0.3)' : 'rgba(16,185,129,0.3)'}; display:flex; justify-content:space-between; align-items:center; transition:all 0.2s ease;">
                            <div>
                              <strong style="color:${state.selectedStudent?.id===st.id ? '#818cf8' : '#f3f4f6'}; font-size:0.85rem;">🎓 ${st.firstName} ${st.lastName}</strong>
                              <br><span style="font-size:0.7rem; color:#9ca3af;">${st.grade} ${st.section} (${st.studentCode})</span>
                            </div>
                            <div style="text-align:right;">
                              ${st.debts.length > 0 ? `
                                <span class="badge badge-warning" style="font-size:0.65rem;">$${st.studentTotalUSD.toFixed(2)} USD</span>
                              ` : `
                                <span class="badge badge-success" style="font-size:0.65rem;">Al día</span>
                              `}
                            </div>
                          </div>
                        `).join('')}
                      </div>
                    </div>

                    <!-- Abajo de los representados: Opciones Globales de Cobro (antes de seleccionar un estudiante específico) -->
                    ${!state.selectedStudent ? `
                      <div style="margin-top:1rem; padding:0.85rem; background:rgba(11,15,25,0.6); border:1px solid rgba(251,191,36,0.3); border-radius:10px;">
                        <span style="font-size:0.75rem; font-weight:700; color:#fbbf24; text-transform:uppercase;">Opciones de Cobro para Todos los Representados:</span>
                        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.5rem; margin-top:0.5rem;">
                          <button type="button" onclick="selectIndividualStudent('ALL'); setPaymentType(false);" class="btn btn-sm btn-accent" style="font-size:0.78rem; padding:0.6rem;">
                            💳 Cancelar Toda la Deuda de los Representados ($${state.familyData.totalFamilyDebtUSD.toFixed(2)} USD)
                          </button>
                          <button type="button" onclick="selectIndividualStudent('ALL'); setPaymentType(true);" class="btn btn-sm btn-warning" style="font-size:0.78rem; padding:0.6rem;">
                            💵 Abonar al Total de los Representados
                          </button>
                        </div>
                      </div>
                    ` : ''}

                  </div>
                ` : `
                  <!-- Tarjeta 1: Estudiante Único (Tema Púrpura) -->
                  <div class="glass-panel" style="padding:1.25rem; border:1px solid rgba(99, 102, 241, 0.4); background:rgba(99, 102, 241, 0.08); box-shadow:0 4px 20px rgba(99, 102, 241, 0.15);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
                      <h4 style="color:#818cf8; font-size:0.95rem; font-weight:700; display:flex; align-items:center; gap:0.4rem; text-transform:uppercase; letter-spacing:0.05em;">
                        <i data-lucide="graduation-cap"></i> Estudiante (Representado)
                      </h4>
                      <span class="badge badge-primary" style="font-size:0.75rem; padding:0.25rem 0.65rem;">
                        ${state.familyData.students[0].studentCode}
                      </span>
                    </div>

                    <div style="font-size:0.875rem; display:flex; flex-direction:column; gap:0.4rem;">
                      <div><span style="color:#9ca3af;">Nombre Completo:</span> <strong style="color:#f3f4f6; font-size:1rem; margin-left:0.3rem;">${state.familyData.students[0].firstName} ${state.familyData.students[0].lastName}</strong></div>
                      <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(11,15,25,0.4); padding:0.5rem 0.75rem; border-radius:6px;">
                        <span><span style="color:#9ca3af;">Cédula / ID:</span> <strong style="color:#f3f4f6;">${state.familyData.students[0].docId || 'S/D'}</strong></span>
                        <span><span style="color:#9ca3af;">Curso:</span> <strong style="color:#818cf8;">${state.familyData.students[0].grade}</strong></span>
                      </div>
                    </div>
                  </div>

                  <!-- Tarjeta 2: Representante Legal (Tema Esmeralda) -->
                  ${state.familyData.guardian ? `
                    <div class="glass-panel" style="padding:1.25rem; border:1px solid rgba(16, 185, 129, 0.4); background:rgba(16, 185, 129, 0.08); box-shadow:0 4px 20px rgba(16, 185, 129, 0.15);">
                      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
                        <h4 style="color:#34d399; font-size:0.95rem; font-weight:700; display:flex; align-items:center; gap:0.4rem; text-transform:uppercase; letter-spacing:0.05em;">
                          <i data-lucide="user-check"></i> Representante Legal (Tutor)
                        </h4>
                        <span class="badge badge-success" style="font-size:0.75rem; padding:0.25rem 0.65rem;">
                          ${state.familyData.guardian.guardianCode}
                        </span>
                      </div>

                      <div style="font-size:0.875rem; display:flex; flex-direction:column; gap:0.4rem;">
                        <div><span style="color:#9ca3af;">Nombre Completo:</span> <strong style="color:#f3f4f6; font-size:1rem; margin-left:0.3rem;">${state.familyData.guardian.fullName}</strong></div>
                        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(11,15,25,0.4); padding:0.5rem 0.75rem; border-radius:6px;">
                          <span><span style="color:#9ca3af;">Cédula:</span> <strong style="color:#f3f4f6;">${state.familyData.guardian.docId}</strong></span>
                          <span><span style="color:#9ca3af;">Teléfono:</span> <strong style="color:#34d399;">${state.familyData.guardian.phone}</strong></span>
                        </div>
                      </div>
                    </div>
                  ` : ''}
                `}

              </div>
            ` : ''}
          </div>

          <!-- Formulario de Cobro -->
          <div class="glass-panel" style="padding:1.5rem;">
            <h3 style="font-size:1.1rem; font-weight:700; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="credit-card" color="#10b981"></i> 
              ${state.selectedStudent ? `Cobro de: ${state.selectedStudent.firstName} ${state.selectedStudent.lastName}` : state.familyData && state.familyData.representedCount > 1 ? 'Formulario de Cobro Consolidado' : 'Formulario de Cobro'}
            </h3>

            ${!state.familyData ? `
              <div style="text-align:center; padding:3rem; color:#9ca3af;">Selecciona un alumno o representante para iniciar el cobro.</div>
            ` : state.debts.length === 0 ? `
              <div style="text-align:center; padding:3rem; color:#34d399;">No hay deudas pendientes registradas.</div>
            ` : `
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                <span style="font-size:0.8rem; font-weight:700; color:#9ca3af; text-transform:uppercase;">1. Conceptos a Cancelar:</span>
                <div style="display:flex; gap:0.3rem;">
                  <button type="button" onclick="selectAllDebts(true)" class="btn btn-sm btn-secondary" style="font-size:0.7rem; padding:0.2rem 0.5rem;">☑️ Todos</button>
                  <button type="button" onclick="selectAllDebts(false)" class="btn btn-sm btn-secondary" style="font-size:0.7rem; padding:0.2rem 0.5rem;">☐ Ninguno</button>
                </div>
              </div>

              <!-- Lista de Deudas filtradas (Si hay estudiante seleccionado muestra SOLO las de ese estudiante) -->
              <div style="display:flex; flex-direction:column; gap:0.5rem; margin:0.5rem 0 1rem 0; max-height:280px; overflow-y:auto; padding-right:0.25rem;">
                ${state.debts.map(d => `
                  <label class="glass-card" style="display:flex; justify-content:space-between; align-items:center; padding:0.75rem; background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:8px; cursor:pointer;">
                    <div style="display:flex; align-items:center; gap:0.5rem;">
                      <input type="checkbox" ${state.selectedDebtIds.includes(d.id)?'checked':''} onchange="toggleDebt('${d.id}')" style="accent-color:#10b981;">
                      <div>
                        <strong style="color:#f3f4f6; font-size:0.9rem;">${d.feeConcept.name}</strong>
                        ${!state.selectedStudent && d.studentName ? `<span style="font-size:0.725rem; color:#818cf8; margin-left:0.4rem;">(${d.studentName})</span>` : ''}
                        ${d.status==='PARTIAL'?'<span class="badge badge-warning" style="margin-left:0.4rem; font-size:0.65rem;">Saldo Parcial</span>':''}
                        <br><span style="font-size:0.75rem; color:#9ca3af;">Vence: ${d.dueDate}</span>
                      </div>
                    </div>
                    <strong style="color:#34d399;">$${d.amountUSD.toFixed(2)} USD</strong>
                  </label>
                `).join('')}
              </div>

              <!-- Selector de Modalidad de Pago: Total vs Abono -->
              <span style="font-size:0.8rem; font-weight:700; color:#9ca3af; text-transform:uppercase;">2. Modalidad de Pago:</span>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.6rem; margin:0.5rem 0 1rem 0;">
                <button type="button" onclick="setPaymentType(false)" class="glass-card" style="padding:0.85rem; text-align:center; border:2px solid ${!state.isPartial ? '#10b981' : 'rgba(255,255,255,0.1)'}; background:${!state.isPartial ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.02)'}; border-radius:10px; cursor:pointer; transition:all 0.2s ease;">
                  <div style="font-size:0.95rem; font-weight:800; color:${!state.isPartial ? '#34d399' : '#e5e7eb'}; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
                    💳 ${state.familyData && state.familyData.representedCount > 1 ? 'Pagar Totalidad Representados' : 'Pagar Toda la Deuda'}
                  </div>
                  <div style="font-size:0.725rem; color:#9ca3af; margin-top:0.25rem;">Liquidación Total ($${totalUSD.toFixed(2)} USD)</div>
                </button>

                <button type="button" onclick="setPaymentType(true)" class="glass-card" style="padding:0.85rem; text-align:center; border:2px solid ${state.isPartial ? '#fbbf24' : 'rgba(255,255,255,0.1)'}; background:${state.isPartial ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.02)'}; border-radius:10px; cursor:pointer; transition:all 0.2s ease;">
                  <div style="font-size:0.95rem; font-weight:800; color:${state.isPartial ? '#fbbf24' : '#e5e7eb'}; display:flex; align-items:center; justify-content:center; gap:0.4rem;">
                    💵 ${state.familyData && state.familyData.representedCount > 1 ? 'Abonar al Total Representados' : 'Abonar Parte de Deuda'}
                  </div>
                  <div style="font-size:0.725rem; color:#9ca3af; margin-top:0.25rem;">Pago Parcial Consolidado</div>
                </button>
              </div>

              ${state.isPartial ? `
                <div style="background:rgba(251, 191, 36, 0.08); border:1px solid rgba(251, 191, 36, 0.35); padding:1rem; border-radius:10px; margin-bottom:1rem;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <label style="font-size:0.8rem; font-weight:700; color:#fbbf24; text-transform:uppercase;">
                      Indique el Monto del Abono:
                    </label>
                    <span style="font-size:0.75rem; color:#9ca3af;">Deuda Seleccionada: <strong>$${totalUSD.toFixed(2)} USD</strong> (${(totalUSD * state.exchangeRate).toLocaleString('es-VE', {minimumFractionDigits:2})} VES)</span>
                  </div>

                  <!-- Entradas Simultáneas en USD y en Bs (VES) -->
                  <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem; margin-top:0.5rem;">
                    <div>
                      <label style="font-size:0.75rem; font-weight:700; color:#34d399; display:block; margin-bottom:0.25rem;">
                        💵 En Dólares (USD $):
                      </label>
                      <input type="number" id="partial_input_usd" step="0.01" max="${totalUSD}" min="0.01" class="input-field" style="font-size:1.2rem; font-weight:800; color:#34d399; background:rgba(0,0,0,0.3);" value="${state.partialAmountUSD || ''}" oninput="handlePartialUSDInput(event)" placeholder="Ej. 50.00">
                    </div>

                    <div>
                      <label style="font-size:0.75rem; font-weight:700; color:#818cf8; display:block; margin-bottom:0.25rem;">
                        🇻🇪 En Bolívares (VES Bs):
                      </label>
                      <input type="number" id="partial_input_ves" step="0.01" max="${(totalUSD * state.exchangeRate).toFixed(2)}" min="0.01" class="input-field" style="font-size:1.2rem; font-weight:800; color:#818cf8; background:rgba(0,0,0,0.3);" value="${state.partialAmountUSD ? (state.partialAmountUSD * state.exchangeRate).toFixed(2) : ''}" oninput="handlePartialVESInput(event)" placeholder="Ej. 2000.00">
                    </div>
                  </div>

                  <div style="font-size:0.725rem; color:#fbbf24; margin-top:0.45rem; font-weight:600; display:flex; align-items:center; gap:0.3rem;">
                    <span>💡 Puedes escribir el abono directamente en <strong>Bolívares (Bs)</strong> o en <strong>Dólares ($)</strong> y la conversión se calculará de forma automática.</span>
                  </div>
                  
                  <!-- Presets Rápidos -->
                  <div style="display:flex; gap:0.4rem; margin-top:0.6rem;">
                    <button type="button" onclick="setPresetPartial(0.25)" class="btn btn-sm btn-secondary" style="font-size:0.75rem; flex:1;">25% ($${(totalUSD * 0.25).toFixed(2)})</button>
                    <button type="button" onclick="setPresetPartial(0.50)" class="btn btn-sm btn-secondary" style="font-size:0.75rem; flex:1;">50% ($${(totalUSD * 0.50).toFixed(2)})</button>
                    <button type="button" onclick="setPresetPartial(0.75)" class="btn btn-sm btn-secondary" style="font-size:0.75rem; flex:1;">75% ($${(totalUSD * 0.75).toFixed(2)})</button>
                  </div>

                  <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-top:0.75rem; padding-top:0.5rem; border-top:1px solid rgba(255,255,255,0.08);">
                    <span>Monto a Abonar Hoy: <strong id="display_abono_usd" style="color:#fbbf24;">$${(state.partialAmountUSD || 0).toFixed(2)} USD</strong> (<span id="display_abono_ves" style="color:#f3f4f6;">${((state.partialAmountUSD || 0) * state.exchangeRate).toLocaleString('es-VE', {minimumFractionDigits:2})} VES</span>)</span>
                    <span>Deuda Restante Pendiente: <strong id="display_remaining_usd" style="color:#f87171;">$${Math.max(0, totalUSD - (state.partialAmountUSD || 0)).toFixed(2)} USD</strong></span>
                  </div>
                </div>
              ` : ''}

              <!-- Resumen Total a Cobrar -->
              <div style="background:rgba(11,15,25,0.8); padding:1rem; border-radius:10px; border:1px solid var(--border-color); margin-bottom:1.25rem; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <span style="font-size:0.75rem; color:#9ca3af;">Monto a Procesar (USD):</span>
                  <h2 id="display_proc_usd" style="color:${state.isPartial ? '#fbbf24' : '#34d399'}; font-size:1.6rem;">$${(state.isPartial ? (state.partialAmountUSD || 0) : totalUSD).toFixed(2)} USD</h2>
                </div>
                <div style="text-align:right;">
                  <span style="font-size:0.75rem; color:#9ca3af;">Tasa Ref: ${state.exchangeRate.toFixed(2)} VES</span>
                  <div id="display_proc_ves" style="font-size:1.1rem; font-weight:700;">${((state.isPartial ? (state.partialAmountUSD || 0) : totalUSD) * state.exchangeRate).toLocaleString('es-VE', {minimumFractionDigits:2})} VES</div>
                </div>
              </div>

              <button onclick="openPaymentConfirmModal()" class="btn ${state.isPartial ? 'btn-warning' : 'btn-accent'}" style="width:100%; font-size:1rem; padding:0.85rem;" ${totalUSD===0?'disabled':''}>
                <span id="display_btn_text">${state.isPartial ? `Confirmar Abono Parcial ($${(state.partialAmountUSD || 0).toFixed(2)} USD)` : `Confirmar Pago Total ($${totalUSD.toFixed(2)} USD)`}</span>
              </button>
            `}
          </div>
        </div>
      `;
    }

    function setSearchMode(mode) {
      state.searchMode = mode;
      let defaultVal = '';
      if (mode === 'rep') defaultVal = 'REP-';
      else if (mode === 'est') defaultVal = 'EST-2026-';
      else if (mode === 'cedula') defaultVal = 'V-';
      state.searchQuery = defaultVal;
      render();

      setTimeout(() => {
        const inp = document.getElementById('search_input');
        if (inp) {
          inp.focus();
          inp.setSelectionRange(defaultVal.length, defaultVal.length);
        }
      }, 50);
    }

    function handleSearchInput(e) {
      let val = e.target.value;
      if (state.searchMode === 'rep') {
        if (!val.toUpperCase().startsWith('REP-')) {
          const digits = val.replace(/\D/g, '');
          val = digits ? 'REP-' + digits.padStart(3, '0') : 'REP-';
          e.target.value = val;
        }
      } else if (state.searchMode === 'est') {
        if (!val.toUpperCase().startsWith('EST-2026-')) {
          const digits = val.replace(/\D/g, '');
          val = digits ? 'EST-2026-' + digits.padStart(4, '0') : 'EST-2026-';
          e.target.value = val;
        }
      } else if (state.searchMode === 'cedula') {
        if (!val.toUpperCase().startsWith('V-') && !val.toUpperCase().startsWith('CE-')) {
          const digits = val.replace(/\D/g, '');
          val = digits ? 'V-' + digits : 'V-';
          e.target.value = val;
        }
      }
      state.searchQuery = e.target.value;
    }

    async function handleSearch(e) {
      e.preventDefault();
      const q = document.getElementById('search_input').value.trim();
      state.searchQuery = q;
      if (!q) return;

      const res = await fetch(`${API_BASE}/api/payments/students/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${state.token}` }
      });
      const results = await res.json();
      state.searchResults = results;

      if (results && results.length > 0) {
        const firstGuardian = results[0].guardians && results[0].guardians[0]?.guardian;
        const allSameGuardian = firstGuardian && results.every(s => s.guardians && s.guardians[0]?.guardian?.guardianCode === firstGuardian.guardianCode);

        // Si se busca por representante o los resultados pertenecen al mismo tutor:
        // Desplegar automáticamente la Deuda Consolidada del Representante SIN seleccionar a ningún representado individual
        if (state.searchMode === 'rep' || allSameGuardian || q.toUpperCase().includes('REP-')) {
          selectRepresentativeGlobal(results[0].id);
          return;
        }
      } else {
        state.familyData = null;
        state.selectedStudent = null;
        state.debts = [];
      }
      render();
    }

    async function selectRepresentativeGlobal(id) {
      const res = await fetch(`${API_BASE}/api/payments/students/${id}/family-debts`, {
        headers: { Authorization: `Bearer ${state.token}` }
      });
      const data = await res.json();
      state.familyData = data;
      state.exchangeRate = data.exchangeRate || 36.50;

      let allDebts = [];
      if (data.students) {
        data.students.forEach(st => {
          st.debts.forEach(d => {
            allDebts.push({
              ...d,
              studentId: st.id,
              studentName: `${st.firstName} ${st.lastName}`,
              studentCode: st.studentCode,
              grade: st.grade
            });
          });
        });
      }
      state.allFamilyDebts = allDebts;
      state.debts = allDebts;
      state.selectedDebtIds = allDebts.map(d => d.id);
      state.selectedStudent = null; // IMPORTANTE: NO se selecciona ningún representado individual
      state.isPartial = false;
      state.partialAmountUSD = 0;
      render();
    }

    async function selectStudent(id, targetStudentId = null) {
      const res = await fetch(`${API_BASE}/api/payments/students/${id}/family-debts`, {
        headers: { Authorization: `Bearer ${state.token}` }
      });
      const data = await res.json();
      state.familyData = data;
      state.exchangeRate = data.exchangeRate || 36.50;

      let allDebts = [];
      if (data.students) {
        data.students.forEach(st => {
          st.debts.forEach(d => {
            allDebts.push({
              ...d,
              studentId: st.id,
              studentName: `${st.firstName} ${st.lastName}`,
              studentCode: st.studentCode,
              grade: st.grade
            });
          });
        });
      }
      state.allFamilyDebts = allDebts;

      if (targetStudentId === 'ALL') {
        state.selectedStudent = null;
        state.debts = allDebts;
      } else if (targetStudentId) {
        const st = data.students.find(s => s.id === targetStudentId);
        state.selectedStudent = st || null;
        state.debts = st ? st.debts.map(d => ({
          ...d,
          studentId: st.id,
          studentName: `${st.firstName} ${st.lastName}`,
          studentCode: st.studentCode,
          grade: st.grade
        })) : allDebts;
      } else if (data.representedCount > 1) {
        state.selectedStudent = null;
        state.debts = allDebts;
      } else {
        state.selectedStudent = data.students[0] || null;
        state.debts = allDebts;
      }

      state.selectedDebtIds = state.debts.map(d => d.id);
      state.isPartial = false;
      state.partialAmountUSD = 0;
      render();
    }

    function selectIndividualStudent(studentId) {
      if (studentId === 'ALL') {
        state.selectedStudent = null;
        state.debts = state.allFamilyDebts;
      } else {
        const st = state.familyData.students.find(s => s.id === studentId);
        state.selectedStudent = st;
        state.debts = st.debts.map(d => ({
          ...d,
          studentId: st.id,
          studentName: `${st.firstName} ${st.lastName}`,
          studentCode: st.studentCode,
          grade: st.grade
        }));
      }
      state.selectedDebtIds = state.debts.map(d => d.id);
      state.isPartial = false;
      state.partialAmountUSD = 0;
      render();
    }

    function selectAllDebts(select) {
      if (select) {
        state.selectedDebtIds = state.debts.map(d => d.id);
      } else {
        state.selectedDebtIds = [];
      }
      render();
    }

    function toggleDebt(id) {
      if (state.selectedDebtIds.includes(id)) {
        state.selectedDebtIds = state.selectedDebtIds.filter(i => i !== id);
      } else {
        state.selectedDebtIds.push(id);
      }
      render();
    }

    function setPaymentType(isPartial) {
      state.isPartial = isPartial;
      const totalUSD = state.debts.filter(d => state.selectedDebtIds.includes(d.id)).reduce((s, d) => s + d.amountUSD, 0);
      if (isPartial) {
        if (!state.partialAmountUSD || state.partialAmountUSD <= 0 || state.partialAmountUSD >= totalUSD) {
          state.partialAmountUSD = Number((totalUSD / 2).toFixed(2));
        }
      } else {
        state.partialAmountUSD = 0;
      }
      render();
    }

    function setPresetPartial(pct) {
      const totalUSD = state.debts.filter(d => state.selectedDebtIds.includes(d.id)).reduce((s, d) => s + d.amountUSD, 0);
      state.partialAmountUSD = Number((totalUSD * pct).toFixed(2));
      const rate = state.exchangeRate || 36.50;

      const inputUSD = document.getElementById('partial_input_usd');
      const inputVES = document.getElementById('partial_input_ves');
      if (inputUSD) inputUSD.value = state.partialAmountUSD.toFixed(2);
      if (inputVES) inputVES.value = (state.partialAmountUSD * rate).toFixed(2);

      updatePartialDisplayLabels();
    }

    function handlePartialUSDInput(e) {
      const valUSD = parseFloat(e.target.value) || 0;
      state.partialAmountUSD = valUSD;
      const rate = state.exchangeRate || 36.50;
      const valVES = valUSD * rate;

      const inputVES = document.getElementById('partial_input_ves');
      if (inputVES) {
        inputVES.value = valUSD > 0 ? valVES.toFixed(2) : '';
      }

      updatePartialDisplayLabels();
    }

    function handlePartialVESInput(e) {
      const valVES = parseFloat(e.target.value) || 0;
      const rate = state.exchangeRate || 36.50;
      const valUSD = Number((valVES / rate).toFixed(2));
      state.partialAmountUSD = valUSD;

      const inputUSD = document.getElementById('partial_input_usd');
      if (inputUSD) {
        inputUSD.value = valUSD > 0 ? valUSD.toFixed(2) : '';
      }

      updatePartialDisplayLabels();
    }

    function updatePartialDisplayLabels() {
      const valUSD = state.partialAmountUSD || 0;
      const rate = state.exchangeRate || 36.50;
      const valVES = valUSD * rate;

      const totalUSD = state.debts.filter(d => state.selectedDebtIds.includes(d.id)).reduce((s, d) => s + d.amountUSD, 0);
      const remaining = Math.max(0, totalUSD - valUSD);

      const displayProcUSD = document.getElementById('display_proc_usd');
      const displayProcVES = document.getElementById('display_proc_ves');
      const displayBtnText = document.getElementById('display_btn_text');
      const displayRemaining = document.getElementById('display_remaining_usd');
      const displayAbonoUSD = document.getElementById('display_abono_usd');
      const displayAbonoVES = document.getElementById('display_abono_ves');

      if (displayProcUSD) displayProcUSD.innerText = `$${valUSD.toFixed(2)} USD`;
      if (displayProcVES) displayProcVES.innerText = `${valVES.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})} VES`;
      if (displayBtnText) displayBtnText.innerText = `Confirmar Abono Parcial ($${valUSD.toFixed(2)} USD)`;
      if (displayRemaining) displayRemaining.innerText = `$${remaining.toFixed(2)} USD`;
      if (displayAbonoUSD) displayAbonoUSD.innerText = `$${valUSD.toFixed(2)} USD`;
      if (displayAbonoVES) displayAbonoVES.innerText = `${valVES.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})} VES`;
    }

    function openPaymentConfirmModal() {
      const totalUSD = state.debts.filter(d => state.selectedDebtIds.includes(d.id)).reduce((s, d) => s + d.amountUSD, 0);
      const amountToProcess = state.isPartial ? (state.partialAmountUSD || 0) : totalUSD;

      if (amountToProcess <= 0) {
        alert('Por favor ingresa un monto válido a pagar.');
        return;
      }
      if (state.isPartial && amountToProcess > totalUSD) {
        alert(`El monto a abonar ($${amountToProcess.toFixed(2)}) no puede ser mayor que la deuda total ($${totalUSD.toFixed(2)}).`);
        return;
      }

      state.showPaymentConfirmModal = true;
      state.paymentCurrency = 'USD';
      state.paymentMethod = 'CASH_USD';
      state.paymentReference = '';
      state.paymentBank = '';
      state.paymentModalError = null;
      render();
    }

    function setPaymentCurrency(curr) {
      state.paymentCurrency = curr;
      state.paymentModalError = null;
      if (curr === 'USD') {
        state.paymentMethod = 'CASH_USD';
        state.paymentReference = '';
        state.paymentBank = '';
      } else {
        state.paymentMethod = 'CASH_VES';
        state.paymentReference = '';
        state.paymentBank = '';
      }
      render();
    }

    function setPaymentMethod(method) {
      state.paymentMethod = method;
      state.paymentModalError = null;
      render();
    }

    async function confirmAndProcessPayment() {
      const totalUSD = state.debts.filter(d => state.selectedDebtIds.includes(d.id)).reduce((s, d) => s + d.amountUSD, 0);
      const amountUSD = state.isPartial ? state.partialAmountUSD : totalUSD;

      if (amountUSD <= 0) {
        state.paymentModalError = 'Por favor ingresa un monto válido a pagar.';
        render();
        return;
      }

      const method = state.paymentMethod;
      const curr = state.paymentCurrency;
      const ref = (state.paymentReference || '').trim();
      const bank = (state.paymentBank || '').trim();

      if (curr === 'VES') {
        if (method === 'PAGO_MOVIL' || method === 'PUNTO_VENTA') {
          if (!ref || ref.length !== 5 || !/^\d{5}$/.test(ref)) {
            state.paymentModalError = 'Debe ingresar exactamente los últimos 5 dígitos del comprobante.';
            render();
            return;
          }
        }

        if (method === 'PAGO_MOVIL') {
          const validBanks = ['VENEZUELA', 'BANESCO', 'BANCA AMIGA', 'MERCANTIL', 'PROVINCIAL'];
          if (!bank || !validBanks.includes(bank)) {
            state.paymentModalError = 'Debe seleccionar el banco de destino (VENEZUELA, BANESCO, BANCA AMIGA, MERCANTIL, PROVINCIAL).';
            render();
            return;
          }
        }
      }

      let methodsObj = [];
      if (curr === 'USD') {
        methodsObj = [{
          method: 'CASH_USD',
          amount: amountUSD,
          currency: 'USD'
        }];
      } else {
        const amountVES = Number((amountUSD * state.exchangeRate).toFixed(2));
        methodsObj = [{
          method: method,
          amount: amountVES,
          currency: 'VES',
          reference: ref || null,
          bank: bank || null
        }];
      }

      const activeStudentId = state.selectedStudent ? state.selectedStudent.id : (state.familyData?.students[0]?.id || '');

      try {
        const res = await fetch(`${API_BASE}/api/payments/transactions`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({
            studentId: activeStudentId,
            selectedDebtIds: state.selectedDebtIds,
            isPartial: state.isPartial,
            partialAmountUSD: state.partialAmountUSD,
            methods: methodsObj,
            exchangeRate: state.exchangeRate
          })
        });
        const data = await res.json();
        if (res.ok) {
          state.showPaymentConfirmModal = false;
          openReceiptModal(data.id);
          state.selectedStudent = null;
          state.familyData = null;
          state.debts = [];
          state.isPartial = false;
          state.partialAmountUSD = 0;
          render();
        } else {
          state.paymentModalError = data.message || 'Error al procesar el pago';
          render();
        }
      } catch (e) {
        state.paymentModalError = 'Error de comunicación con el servidor.';
        render();
      }
    }

    function renderPaymentConfirmModalHTML() {
      if (!state.showPaymentConfirmModal) return '';

      const totalUSD = state.debts.filter(d => state.selectedDebtIds.includes(d.id)).reduce((s, d) => s + d.amountUSD, 0);
      const amountUSD = state.isPartial ? (state.partialAmountUSD || 0) : totalUSD;
      const amountVES = amountUSD * state.exchangeRate;
      const banks = ['VENEZUELA', 'BANESCO', 'BANCA AMIGA', 'MERCANTIL', 'PROVINCIAL'];

      return `
        <div class="modal-overlay" onclick="state.showPaymentConfirmModal=false; render();">
          <div class="modal-content" style="max-width:560px; background:#111827; border:1px solid rgba(99,102,241,0.3); box-shadow:0 20px 40px rgba(0,0,0,0.6);" onclick="event.stopPropagation();">
            
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.75rem; margin-bottom:1.25rem;">
              <h3 style="font-size:1.15rem; font-weight:800; color:#f3f4f6; display:flex; align-items:center; gap:0.5rem; margin:0;">
                <i data-lucide="credit-card" color="#34d399"></i> Confirmación y Método de Pago
              </h3>
              <button onclick="state.showPaymentConfirmModal=false; render();" class="btn btn-secondary btn-sm" style="padding:0.25rem 0.6rem;">✕</button>
            </div>

            <div style="background:rgba(17,24,39,0.7); border:1px solid rgba(255,255,255,0.08); padding:1rem; border-radius:10px; margin-bottom:1.25rem; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <span style="font-size:0.75rem; color:#9ca3af; text-transform:uppercase; font-weight:700;">Monto a Procesar:</span>
                <div style="font-size:1.5rem; font-weight:800; color:${state.isPartial ? '#fbbf24' : '#34d399'};">$${amountUSD.toFixed(2)} USD</div>
              </div>
              <div style="text-align:right;">
                <span style="font-size:0.75rem; color:#9ca3af;">Tasa Ref: ${state.exchangeRate.toFixed(2)} VES</span>
                <div style="font-size:1.15rem; font-weight:800; color:#f3f4f6;">${amountVES.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})} VES</div>
              </div>
            </div>

            <!-- Moneda -->
            <div style="margin-bottom:1.25rem;">
              <label style="font-size:0.8rem; font-weight:700; color:#818cf8; text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:0.5rem;">
                1. Moneda de Pago:
              </label>
              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem;">
                <button type="button" onclick="setPaymentCurrency('USD')" class="glass-card" style="padding:0.85rem; text-align:center; border:2px solid ${state.paymentCurrency === 'USD' ? '#10b981' : 'rgba(255,255,255,0.1)'}; background:${state.paymentCurrency === 'USD' ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.02)'}; border-radius:10px; cursor:pointer; transition:all 0.2s ease;">
                  <div style="font-size:1.1rem; font-weight:800; color:${state.paymentCurrency === 'USD' ? '#34d399' : '#e5e7eb'};">💵 USD ($)</div>
                  <div style="font-size:0.75rem; color:#9ca3af; margin-top:0.25rem;">Dólares (Efectivo)</div>
                </button>

                <button type="button" onclick="setPaymentCurrency('VES')" class="glass-card" style="padding:0.85rem; text-align:center; border:2px solid ${state.paymentCurrency === 'VES' ? '#818cf8' : 'rgba(255,255,255,0.1)'}; background:${state.paymentCurrency === 'VES' ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.02)'}; border-radius:10px; cursor:pointer; transition:all 0.2s ease;">
                  <div style="font-size:1.1rem; font-weight:800; color:${state.paymentCurrency === 'VES' ? '#818cf8' : '#e5e7eb'};">🇻🇪 VES (Bs)</div>
                  <div style="font-size:0.75rem; color:#9ca3af; margin-top:0.25rem;">Bolívares Digitales</div>
                </button>
              </div>
            </div>

            <!-- Forma de Pago -->
            <div style="margin-bottom:1.25rem;">
              <label style="font-size:0.8rem; font-weight:700; color:#818cf8; text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:0.5rem;">
                2. Forma de Pago:
              </label>

              ${state.paymentCurrency === 'USD' ? `
                <div style="padding:0.85rem; background:rgba(16,185,129,0.1); border:1px dashed #10b981; border-radius:10px; color:#34d399; font-weight:700; display:flex; align-items:center; gap:0.5rem;">
                  <i data-lucide="check-circle-2"></i> Efectivo USD (Seleccionado automáticamente)
                </div>
              ` : `
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:0.5rem;">
                  <button type="button" onclick="setPaymentMethod('CASH_VES')" class="glass-card" style="padding:0.75rem 0.5rem; text-align:center; border:2px solid ${state.paymentMethod === 'CASH_VES' ? '#34d399' : 'rgba(255,255,255,0.1)'}; background:${state.paymentMethod === 'CASH_VES' ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.02)'}; border-radius:8px; cursor:pointer;">
                    <div style="font-size:0.85rem; font-weight:800; color:${state.paymentMethod === 'CASH_VES' ? '#34d399' : '#e5e7eb'};">💵 Efectivo</div>
                  </button>

                  <button type="button" onclick="setPaymentMethod('PAGO_MOVIL')" class="glass-card" style="padding:0.75rem 0.5rem; text-align:center; border:2px solid ${state.paymentMethod === 'PAGO_MOVIL' ? '#fbbf24' : 'rgba(255,255,255,0.1)'}; background:${state.paymentMethod === 'PAGO_MOVIL' ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.02)'}; border-radius:8px; cursor:pointer;">
                    <div style="font-size:0.85rem; font-weight:800; color:${state.paymentMethod === 'PAGO_MOVIL' ? '#fbbf24' : '#e5e7eb'};">📱 Pago Móvil</div>
                  </button>

                  <button type="button" onclick="setPaymentMethod('PUNTO_VENTA')" class="glass-card" style="padding:0.75rem 0.5rem; text-align:center; border:2px solid ${state.paymentMethod === 'PUNTO_VENTA' ? '#60a5fa' : 'rgba(255,255,255,0.1)'}; background:${state.paymentMethod === 'PUNTO_VENTA' ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.02)'}; border-radius:8px; cursor:pointer;">
                    <div style="font-size:0.85rem; font-weight:800; color:${state.paymentMethod === 'PUNTO_VENTA' ? '#60a5fa' : '#e5e7eb'};">💳 Punto Venta</div>
                  </button>
                </div>
              `}
            </div>

            <!-- Campos Adicionales -->
            ${(state.paymentCurrency === 'VES' && (state.paymentMethod === 'PAGO_MOVIL' || state.paymentMethod === 'PUNTO_VENTA')) ? `
              <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); padding:1rem; border-radius:10px; margin-bottom:1.25rem;">
                
                ${state.paymentMethod === 'PAGO_MOVIL' ? `
                  <div style="margin-bottom:0.85rem;">
                    <label style="font-size:0.78rem; font-weight:700; color:#fbbf24; text-transform:uppercase; display:block; margin-bottom:0.35rem;">
                      Banco de Destino (Requerido):
                    </label>
                    <select id="confirm_payment_bank" class="input-field" style="width:100%; font-size:0.9rem;" onchange="state.paymentBank=this.value; state.paymentModalError=null;">
                      <option value="">-- Seleccione Banco --</option>
                      ${banks.map(b => `<option value="${b}" ${state.paymentBank === b ? 'selected' : ''}>${b}</option>`).join('')}
                    </select>
                  </div>
                ` : ''}

                <div>
                  <label style="font-size:0.78rem; font-weight:700; color:#60a5fa; text-transform:uppercase; display:block; margin-bottom:0.35rem;">
                    Últimos 5 dígitos del comprobante / referencia (Requerido):
                  </label>
                  <input type="text" id="confirm_payment_ref" maxlength="5" class="input-field" placeholder="Ej. 12345" style="width:100%; font-size:1.1rem; letter-spacing:0.15em; font-weight:700;" value="${state.paymentReference || ''}" oninput="state.paymentReference=this.value.replace(/\\D/g,'').slice(0,5); state.paymentModalError=null;">
                  <span style="font-size:0.7rem; color:#9ca3af; margin-top:0.2rem; display:block;">Ingrese exactamente los 5 números del voucher.</span>
                </div>

              </div>
            ` : ''}

            ${state.paymentModalError ? `
              <div style="padding:0.75rem; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); border-radius:8px; color:#f87171; font-size:0.85rem; font-weight:600; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="alert-triangle"></i> ${state.paymentModalError}
              </div>
            ` : ''}

            <div style="display:flex; justify-content:flex-end; gap:0.75rem; border-top:1px solid rgba(255,255,255,0.1); padding-top:1rem;">
              <button onclick="state.showPaymentConfirmModal=false; render();" class="btn btn-secondary" style="padding:0.65rem 1.25rem;">Cancelar</button>
              <button onclick="confirmAndProcessPayment()" class="btn btn-accent" style="padding:0.65rem 1.5rem; font-weight:700;">
                Confirmar y Registrar Pago
              </button>
            </div>

          </div>
        </div>
      `;
    }

    // Admin Dashboard & History Panel
    async function loadAdminDashboard(period = null) {
      if (period) state.dashboardPeriod = period;
      if (!state.dashboardPeriod) state.dashboardPeriod = 'daily';
      state.dashboardLoading = true;
      render();
      try {
        const [dashRes, txRes] = await Promise.all([
          fetch(`${API_BASE}/api/payments/dashboard-summary?period=${state.dashboardPeriod}`, {
            headers: { Authorization: `Bearer ${state.token}` }
          }),
          fetch(`${API_BASE}/api/payments/transactions`, {
            headers: { Authorization: `Bearer ${state.token}` }
          })
        ]);
        if (dashRes.ok) {
          state.dashboardData = await dashRes.json();
        }
        if (txRes.ok) {
          const txData = await txRes.json();
          state.transactions = txData.transactions || [];
        }
      } catch (err) {
        console.error('Error al cargar dashboard de administración:', err);
      } finally {
        state.dashboardLoading = false;
        render();
      }
    }

    async function loadTransactions() {
      return loadAdminDashboard();
    }

    async function goToChargeRepresentative(repId) {
      state.activeTab = 'cashier';
      render();
      await selectRepresentativeGlobal(repId);
    }

    function renderAdminPanel() {
      if (!state.dashboardData && !state.dashboardLoading) {
        loadAdminDashboard();
      }

      const dash = state.dashboardData;
      const rate = dash?.exchangeRate || state.exchangeRate || 36.50;
      const fin = dash?.financials || { incomeUSD: 0, incomeVES: 0, incomeVESinUSD: 0, totalCollectedUSD: 0, receiptsCount: 0 };
      const delinquency = dash?.delinquency || { totalStudents: 0, delinquentStudents: 0, onTimeStudents: 0, delinquencyPct: 0, totalDelinquentUSD: 0, totalDelinquentVES: 0, byLevel: [], topDelinquents: [] };
      const currentPeriod = state.dashboardPeriod || 'daily';

      return `
        <div>
          <!-- Dashboard Header -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
            <div>
              <h2 style="font-size:1.6rem; font-weight:800; color:#f9fafb; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="layout-dashboard" style="color:#818cf8;"></i> Dashboard General & Morosidad
              </h2>
              <p style="color:#9ca3af; font-size:0.85rem; margin-top:0.2rem;">Cierre financiero, flujo multimoneda ($/Bs) y control de morosidad institucional.</p>
            </div>
            
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <!-- Selector Temporal -->
              <div style="background:rgba(17,24,39,0.8); border:1px solid rgba(255,255,255,0.1); border-radius:0.75rem; padding:0.25rem; display:flex; gap:0.25rem;">
                <button onclick="loadAdminDashboard('daily')" class="btn btn-sm ${currentPeriod==='daily'?'btn-primary':'btn-secondary'}" style="border-radius:0.5rem; font-size:0.8rem;">
                  <i data-lucide="calendar"></i> Diario (Hoy)
                </button>
                <button onclick="loadAdminDashboard('weekly')" class="btn btn-sm ${currentPeriod==='weekly'?'btn-primary':'btn-secondary'}" style="border-radius:0.5rem; font-size:0.8rem;">
                  <i data-lucide="calendar-range"></i> Semanal (Esta Semana)
                </button>
                <button onclick="loadAdminDashboard('monthly')" class="btn btn-sm ${currentPeriod==='monthly'?'btn-primary':'btn-secondary'}" style="border-radius:0.5rem; font-size:0.8rem;">
                  <i data-lucide="calendar-days"></i> Mensual (Este Mes)
                </button>
              </div>

              ${hasPermission('payments:admin:close_box') ? `
                <button onclick="openClosingModal()" class="btn btn-accent" style="box-shadow:0 4px 12px rgba(245,158,11,0.2);"><i data-lucide="calculator"></i> Cierre de Caja</button>
              ` : ''}
            </div>
          </div>

          ${state.dashboardLoading ? `
            <div class="glass-panel" style="padding:3rem; text-align:center; color:#9ca3af;">
              <i data-lucide="loader-2" class="spin" style="width:2.5rem; height:2.5rem; color:#818cf8; margin-bottom:1rem;"></i>
              <p style="font-weight:600;">Cargando indicadores financieros y morosidad...</p>
            </div>
          ` : `

          <!-- Bloque 1: Cierre e Ingresos Multimoneda -->
          <div style="margin-bottom:2rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
              <h3 style="font-size:1.1rem; font-weight:700; color:#e5e7eb; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="coins" style="color:#34d399;"></i> Cierre e Ingresos (${dash?.periodLabel || 'Período Actual'})
              </h3>
              <span style="font-size:0.8rem; color:#9ca3af;">Tasa BCV aplicable: <strong style="color:#38bdf8;">${rate.toFixed(2)} Bs/$</strong></span>
            </div>

            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:1.25rem;">
              <!-- Gran Total USD -->
              <div class="glass-panel" style="padding:1.25rem; border-left:4px solid #10b981; background:linear-gradient(135deg, rgba(16,185,129,0.05), rgba(17,24,39,0.8));">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <span style="font-size:0.75rem; color:#9ca3af; font-weight:700; text-transform:uppercase;">TOTAL RECAUDADO (EQUIV. USD)</span>
                  <div style="background:rgba(16,185,129,0.2); padding:0.4rem; border-radius:0.5rem; color:#10b981;">
                    <i data-lucide="wallet"></i>
                  </div>
                </div>
                <h2 style="color:#10b981; font-size:2rem; font-weight:800; margin-top:0.5rem;">$${fin.totalCollectedUSD.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USD</h2>
                <div style="font-size:0.8rem; color:#9ca3af; margin-top:0.25rem;">
                  <strong>${fin.receiptsCount}</strong> recibos auditados procesados
                </div>
              </div>

              <!-- Ingresos en USD -->
              <div class="glass-panel" style="padding:1.25rem; border-left:4px solid #06b6d4; background:linear-gradient(135deg, rgba(6,182,212,0.05), rgba(17,24,39,0.8));">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <span style="font-size:0.75rem; color:#9ca3af; font-weight:700; text-transform:uppercase;">ENTRADA EN DÓLARES ($)</span>
                  <div style="background:rgba(6,182,212,0.2); padding:0.4rem; border-radius:0.5rem; color:#06b6d4;">
                    <i data-lucide="dollar-sign"></i>
                  </div>
                </div>
                <h2 style="color:#38bdf8; font-size:2rem; font-weight:800; margin-top:0.5rem;">$${fin.incomeUSD.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USD</h2>
                <div style="font-size:0.8rem; color:#9ca3af; margin-top:0.25rem;">Efectivo divisa directa</div>
              </div>

              <!-- Ingresos en Bolívares -->
              <div class="glass-panel" style="padding:1.25rem; border-left:4px solid #818cf8; background:linear-gradient(135deg, rgba(129,140,248,0.05), rgba(17,24,39,0.8));">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                  <span style="font-size:0.75rem; color:#9ca3af; font-weight:700; text-transform:uppercase;">ENTRADA EN BOLÍVARES (Bs)</span>
                  <div style="background:rgba(129,140,248,0.2); padding:0.4rem; border-radius:0.5rem; color:#818cf8;">
                    <i data-lucide="landmark"></i>
                  </div>
                </div>
                <h2 style="color:#818cf8; font-size:2rem; font-weight:800; margin-top:0.5rem;">Bs. ${fin.incomeVES.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})}</h2>
                <div style="font-size:0.8rem; color:#9ca3af; margin-top:0.25rem;">
                  Equivalente a <strong style="color:#a5b4fc;">$${fin.incomeVESinUSD.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USD</strong>
                </div>
              </div>
            </div>
          </div>

          <!-- Bloque 2: Resumen Morosidad Institucional -->
          <div style="margin-bottom:2rem;">
            <h3 style="font-size:1.1rem; font-weight:700; color:#e5e7eb; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="alert-triangle" style="color:#f43f5e;"></i> Morosidad Institucional Global
            </h3>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.25rem;">
              <!-- KPI % Morosidad -->
              <div class="glass-panel" style="padding:1.25rem; border-left:4px solid #f43f5e;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-size:0.75rem; color:#9ca3af; font-weight:700; text-transform:uppercase;">ÍNDICE DE MOROSIDAD GLOBAL</span>
                  <span class="badge ${delinquency.delinquencyPct > 50 ? 'badge-danger' : delinquency.delinquencyPct > 20 ? 'badge-warning' : 'badge-success'}" style="font-size:0.85rem; padding:0.3rem 0.6rem;">
                    ${delinquency.delinquencyPct.toFixed(1)}% Morosos
                  </span>
                </div>
                <div style="display:flex; align-items:baseline; gap:1rem; margin-top:0.75rem;">
                  <h2 style="color:#f43f5e; font-size:2.2rem; font-weight:800;">${delinquency.delinquencyPct.toFixed(1)}%</h2>
                  <span style="color:#9ca3af; font-size:0.9rem;">
                    <strong style="color:#f87171;">${delinquency.delinquentStudents}</strong> estudiantes morosos de <strong>${delinquency.totalStudents}</strong> inscritos
                  </span>
                </div>

                <!-- Barra de progreso -->
                <div style="width:100%; height:8px; background:rgba(255,255,255,0.1); border-radius:4px; margin-top:1rem; overflow:hidden; display:flex;">
                  <div style="width:${delinquency.delinquencyPct}%; background:#f43f5e; transition:width 0.5s ease;"></div>
                  <div style="width:${100 - delinquency.delinquencyPct}%; background:#10b981; transition:width 0.5s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:0.75rem; color:#9ca3af; margin-top:0.4rem;">
                  <span><i data-lucide="circle-alert" style="width:12px; height:12px; color:#f43f5e;"></i> Morosos (${delinquency.delinquentStudents})</span>
                  <span><i data-lucide="check-circle" style="width:12px; height:12px; color:#10b981;"></i> Al Día (${delinquency.onTimeStudents})</span>
                </div>
              </div>

              <!-- KPI Total Deuda Pendiente -->
              <div class="glass-panel" style="padding:1.25rem; border-left:4px solid #fbbf24;">
                <span style="font-size:0.75rem; color:#9ca3af; font-weight:700; text-transform:uppercase;">TOTAL CARTERA VENCIDA POR COBRAR</span>
                <div style="margin-top:0.5rem;">
                  <h2 style="color:#fbbf24; font-size:2rem; font-weight:800;">$${delinquency.totalDelinquentUSD.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USD</h2>
                  <p style="color:#9ca3af; font-size:1.1rem; font-weight:600; margin-top:0.2rem;">
                    Bs. ${delinquency.totalDelinquentVES.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})}
                  </p>
                </div>
                <p style="color:#9ca3af; font-size:0.8rem; margin-top:0.5rem;">Monto acumulado por mensualidades e inscripciones pendientes en el colegio.</p>
              </div>
            </div>
          </div>

          <!-- Bloque 3: Morosidad por Nivel Educativo -->
          <div style="margin-bottom:2rem;">
            <h3 style="font-size:1.1rem; font-weight:700; color:#e5e7eb; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="graduation-cap" style="color:#a855f7;"></i> Morosidad por Nivel Educativo
            </h3>

            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:1.25rem;">
              ${(delinquency.byLevel || []).map(lvl => {
                const vesAmt = (lvl.amountUSD || 0) * rate;
                return `
                <div class="glass-panel" style="padding:1.25rem;">
                  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                    <h4 style="font-weight:700; color:#f3f4f6; font-size:1rem;">${lvl.level}</h4>
                    <span class="badge badge-warning">
                      ${lvl.studentsCount} est.
                    </span>
                  </div>
                  
                  <div style="font-size:1.4rem; font-weight:800; color:#a855f7; margin:0.25rem 0;">
                    $${(lvl.amountUSD || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USD
                  </div>
                  <div style="font-size:0.85rem; color:#9ca3af; font-weight:600;">
                    Bs. ${vesAmt.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})}
                  </div>

                  <div style="margin-top:0.75rem; padding-top:0.75rem; border-top:1px solid rgba(255,255,255,0.05); font-size:0.8rem; color:#9ca3af;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:0.25rem;">
                      <span>Estudiantes Morosos: <strong style="color:#f87171;">${lvl.studentsCount}</strong></span>
                    </div>
                  </div>
                </div>
              `;}).join('')}
            </div>
          </div>

          <!-- Bloque 4: Top 10 Representantes Morosos -->
          <div style="margin-bottom:2rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
              <h3 style="font-size:1.1rem; font-weight:700; color:#e5e7eb; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="users" style="color:#ec4899;"></i> Top 10 Representantes con Mayor Morosidad
              </h3>
              <span style="font-size:0.8rem; color:#9ca3af;">Ordenados por monto total pendiente de pago</span>
            </div>

            <div class="table-container">
              <table class="custom-table">
                <thead>
                  <tr>
                    <th style="width:50px;">#</th>
                    <th>Representante</th>
                    <th>Cédula</th>
                    <th>Teléfono</th>
                    <th>Representados</th>
                    <th>Deuda Total USD</th>
                    <th>Deuda Total VES</th>
                    <th style="text-align:right;">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  ${(delinquency.topDelinquents || []).length === 0 ? `
                    <tr><td colspan="8" style="text-align:center; padding:2rem; color:#9ca3af;">No se encontraron representantes morosos.</td></tr>
                  ` : (delinquency.topDelinquents || []).map((rep, index) => {
                    const repVES = (rep.totalDebtUSD || 0) * rate;
                    return `
                    <tr>
                      <td style="font-weight:700; color:#9ca3af;">${index + 1}</td>
                      <td style="font-weight:700; color:#f3f4f6;">${rep.fullName}</td>
                      <td><span class="badge badge-neutral" style="font-family:monospace;">${rep.docId}</span></td>
                      <td style="font-size:0.85rem; color:#9ca3af;">${rep.phone || 'N/A'}</td>
                      <td>
                        <span class="badge badge-warning" style="font-weight:700;">${rep.representedCount} estudiante(s)</span>
                      </td>
                      <td style="font-weight:800; color:#f43f5e;">
                        $${(rep.totalDebtUSD || 0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})} USD
                      </td>
                      <td style="font-weight:600; color:#fbbf24;">
                        Bs. ${repVES.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})}
                      </td>
                      <td style="text-align:right;">
                        <button onclick="goToChargeRepresentative('${rep.id}')" class="btn btn-primary btn-sm" style="display:inline-flex; align-items:center; gap:0.3rem;">
                          <i data-lucide="credit-card"></i> Ir a Cobrar
                        </button>
                      </td>
                    </tr>
                  `;}).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Bloque 5: Historial Auditado de Transacciones -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
              <h3 style="font-size:1.1rem; font-weight:700; color:#e5e7eb; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="history" style="color:#6366f1;"></i> Historial Auditado de Recibos y Transacciones
              </h3>
              <span style="font-size:0.8rem; color:#9ca3af;">Total recibos: ${state.transactions.length}</span>
            </div>

            <div class="table-container">
              <table class="custom-table">
                <thead>
                  <tr>
                    <th>Nro. Recibo</th>
                    <th>Fecha</th>
                    <th>Estudiante</th>
                    <th>Monto USD</th>
                    <th>Cajera</th>
                    <th>Estado</th>
                    <th style="text-align:right;">Acciones Permiso RBAC</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.transactions.length === 0 ? `
                    <tr><td colspan="7" style="text-align:center; padding:2rem; color:#9ca3af;">No hay transacciones registradas.</td></tr>
                  ` : state.transactions.map(tx => `
                    <tr style="opacity:${tx.status==='VOIDED'?0.6:1}">
                      <td style="font-weight:700; color:#818cf8;">${tx.receiptNumber}</td>
                      <td>${new Date(tx.createdAt).toLocaleDateString()} ${new Date(tx.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
                      <td>${tx.paymentItems[0]?.debt?.student?.firstName || 'N/A'} ${tx.paymentItems[0]?.debt?.student?.lastName || ''}</td>
                      <td style="font-weight:700; color:#34d399;">$${tx.totalUSD.toFixed(2)} USD</td>
                      <td>${tx.processedBy?.fullName}</td>
                      <td><span class="badge ${tx.status==='VOIDED'?'badge-danger':'badge-success'}">${tx.status}</span></td>
                      <td style="text-align:right;">
                        <button onclick="openReceiptModal('${tx.id}')" class="btn btn-secondary btn-sm"><i data-lucide="eye"></i> Ver</button>
                        ${tx.status !== 'VOIDED' && hasPermission('payments:admin:void_receipt') ? `
                          <button onclick="state.showVoidModal='${tx.id}'; render();" class="btn btn-danger btn-sm"><i data-lucide="ban"></i> Anular</button>
                        ` : ''}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          `}
        </div>
      `;
    }

    // Modal Anulación
    function renderVoidModalHTML() {
      return `
        <div class="modal-overlay" onclick="state.showVoidModal=null; render();">
          <div class="modal-content" onclick="event.stopPropagation();">
            <h3 style="color:#ef4444; margin-bottom:1rem;">Anulación de Recibo Auditada</h3>
            <p style="font-size:0.85rem; color:#9ca3af; margin-bottom:1rem;">Ingrese el motivo justificado para proceder con la anulación:</p>
            <textarea id="void_reason" class="textarea-field" rows="3" placeholder="Motivo obligatorio..."></textarea>
            <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
              <button onclick="state.showVoidModal=null; render();" class="btn btn-secondary">Cancelar</button>
              <button onclick="confirmVoid()" class="btn btn-danger">Confirmar Anulación</button>
            </div>
          </div>
        </div>
      `;
    }

    async function confirmVoid() {
      const reason = document.getElementById('void_reason').value;
      const res = await fetch(`${API_BASE}/api/payments/transactions/${state.showVoidModal}/void`, {
        method: 'POST',
        headers: {'Content-Type':'application/json', Authorization: `Bearer ${state.token}`},
        body: JSON.stringify({ reason })
      });
      if(res.ok) {
        state.showVoidModal = null;
        loadTransactions();
      } else {
        const d = await res.json();
        alert(d.message || 'Error');
      }
    }

    async function openReceiptModal(id) {
      state.activeReceiptModalId = id;
      state.activeReceiptData = null;
      state.emailNotificationMessage = null;
      render();
      try {
        const res = await fetch(`${API_BASE}/api/payments/receipts/${id}`, {
          headers: { Authorization: `Bearer ${state.token}` }
        });
        const data = await res.json();
        state.activeReceiptData = data;
        render();
      } catch (e) {
        console.error('Error cargando recibo:', e);
      }
    }

    async function emailReceiptOnly(id) {
      try {
        const res = await fetch(`${API_BASE}/api/payments/receipts/${id}/send-email`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${state.token}` }
        });
        const data = await res.json();
        if (data.success) {
          state.emailNotificationMessage = `Comprobante digital enviado exitosamente al correo del representante: ${data.email}`;
          render();
        }
      } catch (e) {
        console.error(e);
      }
    }

    function printAndEmailReceipt(id) {
      emailReceiptOnly(id);
      window.print();
    }

    // Modal Receipt
    function renderReceiptModalHTML() {
      if (!state.activeReceiptModalId) return '';
      const r = state.activeReceiptData;

      if (!r) {
        return `
          <div class="modal-overlay">
            <div class="modal-content" style="text-align:center; padding:3rem;">
              <div style="font-size:1.1rem; color:#9ca3af;">Cargando comprobante oficial de pago...</div>
            </div>
          </div>
        `;
      }

      const isVoided = r.status === 'VOIDED';
      const firstItem = r.paymentItems[0]?.debt;
      const student = firstItem?.student;
      const guardian = student?.guardians[0]?.guardian;

      return `
        <div class="modal-overlay" onclick="state.activeReceiptModalId=null; state.activeReceiptData=null; render();">
          <div class="modal-content" style="max-width:700px;" onclick="event.stopPropagation();">
            
            <!-- Acciones Superiores -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
              <h3 style="font-size:1.1rem; color:#f3f4f6; font-weight:700;">Comprobante Oficial de Pago</h3>
              <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                <button onclick="printAndEmailReceipt('${r.id}')" class="btn btn-primary btn-sm" style="background:linear-gradient(135deg, #10b981, #059669); border:none;">
                  <i data-lucide="printer"></i> Imprimir & Enviar al Correo
                </button>
                <button onclick="emailReceiptOnly('${r.id}')" class="btn btn-secondary btn-sm" style="color:#818cf8;">
                  <i data-lucide="mail"></i> Solo Enviar Correo
                </button>
                <button onclick="state.activeReceiptModalId=null; state.activeReceiptData=null; render();" class="btn btn-secondary btn-sm">✕</button>
              </div>
            </div>

            ${state.emailNotificationMessage ? `
              <div style="padding:0.75rem 1rem; background:rgba(16, 185, 129, 0.15); border:1px solid rgba(16, 185, 129, 0.3); border-radius:8px; color:#34d399; font-size:0.85rem; font-weight:600; margin-bottom:1rem; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="check-circle-2"></i> ${state.emailNotificationMessage}
              </div>
            ` : ''}

            <!-- Plantilla Imprimible del Recibo -->
            <div class="receipt-printable" style="position:relative; border:${isVoided?'3px red dashed':'1px #e5e7eb solid'};">
              ${isVoided ? `
                <div style="position:absolute; top:40%; left:50%; transform:translate(-50%, -50%) rotate(-20deg); border:5px solid #ef4444; color:#ef4444; font-size:2.5rem; font-weight:900; padding:0.5rem 2rem; border-radius:12px; opacity:0.85; pointer-events:none;">
                  ANULADO
                </div>
              ` : ''}

              <!-- Encabezado del Colegio -->
              <div style="display:flex; justify-content:space-between; border-bottom:2px solid #111827; padding-bottom:0.75rem; margin-bottom:0.75rem;">
                <div>
                  <h2 style="font-size:1.15rem; font-weight:800; margin:0; color:#111827;">UNIDAD EDUCATIVA CDNJ</h2>
                  <p style="font-size:0.75rem; margin:2px 0;">RIF: J-30492019-2 | Tel: (0212) 555-0199</p>
                  <p style="font-size:0.75rem; margin:0;">Av. Principal de Los Palos Grandes, Caracas</p>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:1.1rem; font-weight:800; color:#4f46e5;">${r.receiptNumber}</div>
                  <p style="font-size:0.75rem; margin:2px 0;">Fecha: ${new Date(r.createdAt).toLocaleString()}</p>
                  <p style="font-size:0.75rem; margin:0;">Atendido por: ${r.processedBy?.fullName}</p>
                </div>
              </div>

              <!-- Info Alumno y Representante -->
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem; background:#f9fafb; padding:0.65rem; border-radius:6px; font-size:0.8rem; margin-bottom:0.75rem;">
                <div>
                  <strong>Estudiante:</strong> ${student ? `${student.firstName} ${student.lastName}` : 'N/A'}<br>
                  <strong>Grado/Curso:</strong> ${student?.grade || 'N/A'}<br>
                  <strong>Código Estudiantil:</strong> ${student?.studentCode || 'N/A'}
                </div>
                <div>
                  <strong>Representante:</strong> ${guardian?.fullName || 'N/A'}<br>
                  <strong>Cédula / DNI:</strong> ${guardian?.docId || 'N/A'}<br>
                  <strong>Correo Registrado:</strong> <span style="color:#2563eb; font-weight:700;">${guardian?.email || 'representante@gmail.com'}</span>
                </div>
              </div>

              <!-- Tabla de Detalle -->
              <table style="width:100%; font-size:0.8rem; border-collapse:collapse; margin-bottom:0.75rem;">
                <thead>
                  <tr style="border-bottom:1px solid #111827; text-align:left;">
                    <th style="padding:0.4rem 0;">Concepto de Cobro</th>
                    <th style="text-align:right; padding:0.4rem 0;">Monto (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  ${r.paymentItems.map(item => `
                    <tr style="border-bottom:1px #e5e7eb solid;">
                      <td style="padding:0.4rem 0;">${item.debt?.feeConcept?.name}</td>
                      <td style="text-align:right; padding:0.4rem 0;">$${item.amountPaidUSD.toFixed(2)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <!-- Totales y Tasa -->
              <div style="display:flex; justify-content:space-between; align-items:center; border-top:2px solid #111827; padding-top:0.5rem;">
                <div>
                  <span style="font-size:0.75rem;">Tasa Ref: <strong>${r.exchangeRate.toFixed(2)} VES/USD</strong></span>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:1.15rem; font-weight:800; color:#111827;">Total: $${r.totalUSD.toFixed(2)} USD</div>
                  <div style="font-size:0.85rem; color:#4b5563;">Equivalente: ${r.totalLocal.toLocaleString('es-VE', {minimumFractionDigits:2})} VES</div>
                </div>
              </div>

              <!-- Métodos de Pago -->
              <div style="margin-top:0.75rem; background:#f3f4f6; padding:0.5rem 0.75rem; border-radius:6px; font-size:0.75rem; color:#111827;">
                <strong>Método de Pago Utilizado:</strong>
                <ul style="margin:0.25rem 0 0 1rem; padding:0;">
                  ${r.methods.map(m => {
                    let label = m.method;
                    if (m.method === 'CASH_USD') label = 'Efectivo USD';
                    else if (m.method === 'CASH_VES') label = 'Efectivo Bolívares (VES)';
                    else if (m.method === 'PAGO_MOVIL') label = 'Pago Móvil';
                    else if (m.method === 'PUNTO_VENTA') label = 'Punto de Venta';
                    
                    let extra = [];
                    if (m.bank) extra.push(`Banco: ${m.bank}`);
                    if (m.reference) extra.push(`Ref: ${m.reference}`);
                    const extraText = extra.length > 0 ? ` (${extra.join(' | ')})` : '';

                    return `<li><strong>${label}</strong>: ${m.currency === 'USD' ? `$${m.amount.toFixed(2)} USD` : `${m.amount.toLocaleString('es-VE', {minimumFractionDigits:2})} VES`}${extraText}</li>`;
                  }).join('')}
                </ul>
              </div>

            </div>
          </div>
        </div>
      `;
    }

    // Modal Closing
    async function openClosingModal() {
      const res = await fetch(`${API_BASE}/api/payments/cash-closing/summary`, {
        headers: { Authorization: `Bearer ${state.token}` }
      });
      state.closingData = await res.json();
      state.showClosingModal = true;
      render();
    }

    function renderClosingModalHTML() {
      return `
        <div class="modal-overlay" onclick="state.showClosingModal=false; render();">
          <div class="modal-content" onclick="event.stopPropagation();">
            <h3 style="color:#10b981; margin-bottom:1rem;">Cierre de Caja Diario</h3>
            <div style="background:rgba(11,15,25,0.6); padding:1rem; border-radius:8px; margin-bottom:1rem;">
              <div>Total USD en Caja: <strong>$${state.closingData?.totalCashUSD.toFixed(2)} USD</strong></div>
              <div>Gran Total Consolidado: <strong>$${state.closingData?.grandTotalUSD.toFixed(2)} USD</strong></div>
            </div>
            <button onclick="confirmClosing()" class="btn btn-accent" style="width:100%;">Generar Registro de Cierre</button>
          </div>
        </div>
      `;
    }

    async function confirmClosing() {
      const res = await fetch(`${API_BASE}/api/payments/cash-closing`, {
        method: 'POST',
        headers: {'Content-Type':'application/json', Authorization:`Bearer ${state.token}`},
        body: JSON.stringify({ notes: 'Cierre de caja diario ejecutado.' })
      });
      if (res.ok) {
        alert('Cierre generado exitosamente.');
        state.showClosingModal = false;
        render();
      }
    }

    // Rates & Tuition Panel Integration
    async function loadTuitionRatesData() {
      try {
        const res = await fetch(`${API_BASE}/api/payments/tuition-rates`, {
          headers: { Authorization: `Bearer ${state.token}` }
        });
        const data = await res.json();
        state.tuitionRatesData = data;
        state.globalTuitionInput = data.globalAmountUSD || 50.0;
        if (data.groupSummary) {
          state.groupTuitionInputs = { ...data.groupSummary };
        }
        if (data.rates) {
          const gMap = {};
          data.rates.forEach(r => { gMap[r.gradeCode] = r.amountUSD; });
          state.gradeTuitionInputs = gMap;
        }
      } catch (e) {
        console.error('Error cargando tarifas de mensualidad:', e);
      }
    }

    async function saveTuitionRates(mode) {
      let payload = { mode };
      if (mode === 'GLOBAL') {
        payload.globalAmountUSD = parseFloat(document.getElementById('tuition_global_input')?.value) || state.globalTuitionInput;
      } else if (mode === 'GROUP') {
        payload.groupAmountsUSD = {
          'Primaria': parseFloat(document.getElementById('tuition_group_primaria')?.value) || 50.0,
          'Educación Básica': parseFloat(document.getElementById('tuition_group_basica')?.value) || 50.0,
          'Media y Diversificada': parseFloat(document.getElementById('tuition_group_media')?.value) || 50.0,
        };
      } else if (mode === 'GRADE') {
        const gradeMap = {};
        if (state.tuitionRatesData?.rates) {
          state.tuitionRatesData.rates.forEach(r => {
            const inp = document.getElementById(`tuition_grade_${r.gradeCode.replace(/\s+/g, '_')}`);
            gradeMap[r.gradeCode] = parseFloat(inp?.value) || r.amountUSD;
          });
        }
        payload.gradeAmountsUSD = gradeMap;
      }

      try {
        const res = await fetch(`${API_BASE}/api/payments/tuition-rates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          alert('✅ Tarifas de Mensualidad actualizadas exitosamente en el sistema.');
          loadTuitionRatesData();
        } else {
          alert(data.message || 'Error al actualizar las tarifas');
        }
      } catch (e) {
        console.error(e);
        alert('Error al conectar con el servidor.');
      }
    }

    async function loadRatesData() {
      state.loadingRates = true;
      render();
      try {
        const resBCV = await fetch(`${API_BASE}/api/payments/rates/bcv`, {
          headers: { Authorization: `Bearer ${state.token}` }
        });
        const bcvData = await resBCV.json();
        state.bcvRateData = bcvData;

        const resHist = await fetch(`${API_BASE}/api/payments/rates/history`, {
          headers: { Authorization: `Bearer ${state.token}` }
        });
        const histData = await resHist.json();
        state.rateHistoryWeek = histData.weekHistory || [];
        if (histData.currentRate) {
          state.exchangeRate = histData.currentRate;
        }

        await loadTuitionRatesData();
      } catch (e) {
        console.error('Error cargando tasas:', e);
      } finally {
        state.loadingRates = false;
        render();
      }
    }

    async function applyRate(rate, source = 'BCV') {
      if (!rate || rate <= 0) return;
      try {
        const res = await fetch(`${API_BASE}/api/payments/rates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ exchangeRate: rate, source: source })
        });
        const data = await res.json();
        if (res.ok) {
          state.exchangeRate = rate;
          alert(`✅ Tasa de cambio del sistema actualizada a ${rate.toFixed(2)} VES/USD (Fuente: ${source})`);
          loadRatesData();
        } else {
          alert(data.message || 'Error al actualizar la tasa');
        }
      } catch (e) {
        console.error(e);
        alert('Error al conectar con el servidor.');
      }
    }

    async function lookupHistoricalRate(dateStr) {
      if (!dateStr) return;
      state.historicalQueryDate = dateStr;
      render();
      try {
        const res = await fetch(`${API_BASE}/api/payments/rates/history?date=${encodeURIComponent(dateStr)}`, {
          headers: { Authorization: `Bearer ${state.token}` }
        });
        const data = await res.json();
        state.historicalQueryResult = data.single;
        render();
      } catch (e) {
        console.error(e);
      }
    }

    function renderRatesPanel() {
      const bcvRate = state.bcvRateData?.bcvRate;

      return `
        <div style="max-width:920px; margin:0 auto;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
            <div>
              <h2 style="font-size:1.5rem; font-weight:800; color:#f3f4f6; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="settings" color="#818cf8"></i> Configuración de Aranceles, Mensualidades y Tasa BCV
              </h2>
              <p style="color:#9ca3af; font-size:0.85rem; margin-top:0.25rem;">
                Gestión de tarifas de mensualidad por grado, tasa del Banco Central de Venezuela e histórico.
              </p>
            </div>
            <button onclick="loadRatesData()" class="btn btn-secondary btn-sm" style="display:flex; align-items:center; gap:0.4rem;">
              <i data-lucide="refresh-cw"></i> ${state.loadingRates ? 'Cargando Datos...' : 'Actualizar Datos'}
            </button>
          </div>

          <!-- SECCIÓN 1: Configuración de Mensualidad por Grado y Nivel (NUEVA FUNCIONALIDAD) -->
          <div class="glass-panel" style="padding:1.5rem; margin-bottom:1.5rem; border:1px solid rgba(99,102,241,0.3); background:rgba(99,102,241,0.04);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
              <div>
                <h3 style="font-size:1.2rem; font-weight:800; color:#818cf8; display:flex; align-items:center; gap:0.5rem; margin:0;">
                  <i data-lucide="graduation-cap"></i> Tarifas de Mensualidad por Grado y Nivel
                </h3>
                <p style="font-size:0.85rem; color:#9ca3af; margin-top:0.2rem;">
                  Selecciona la modalidad para definir la mensualidad (Global, por Nivel/Grupo o por Grado y Año).
                </p>
              </div>
            </div>

            <!-- Selector de Modo de Configuración -->
            <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:0.75rem; margin-bottom:1.25rem;">
              <button type="button" onclick="state.tuitionMode='GLOBAL'; render();" class="glass-card" style="padding:0.85rem; text-align:center; border:2px solid ${state.tuitionMode === 'GLOBAL' ? '#10b981' : 'rgba(255,255,255,0.1)'}; background:${state.tuitionMode === 'GLOBAL' ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.02)'}; border-radius:10px; cursor:pointer;">
                <div style="font-size:0.95rem; font-weight:800; color:${state.tuitionMode === 'GLOBAL' ? '#34d399' : '#e5e7eb'};">🌐 Mensualidad Única</div>
                <div style="font-size:0.725rem; color:#9ca3af; margin-top:0.25rem;">Mismo precio para todos los grados</div>
              </button>

              <button type="button" onclick="state.tuitionMode='GROUP'; render();" class="glass-card" style="padding:0.85rem; text-align:center; border:2px solid ${state.tuitionMode === 'GROUP' ? '#fbbf24' : 'rgba(255,255,255,0.1)'}; background:${state.tuitionMode === 'GROUP' ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.02)'}; border-radius:10px; cursor:pointer;">
                <div style="font-size:0.95rem; font-weight:800; color:${state.tuitionMode === 'GROUP' ? '#fbbf24' : '#e5e7eb'};">🏫 Por Nivel / Grupo</div>
                <div style="font-size:0.725rem; color:#9ca3af; margin-top:0.25rem;">Primaria, Básica y Media</div>
              </button>

              <button type="button" onclick="state.tuitionMode='GRADE'; render();" class="glass-card" style="padding:0.85rem; text-align:center; border:2px solid ${state.tuitionMode === 'GRADE' ? '#60a5fa' : 'rgba(255,255,255,0.1)'}; background:${state.tuitionMode === 'GRADE' ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.02)'}; border-radius:10px; cursor:pointer;">
                <div style="font-size:0.95rem; font-weight:800; color:${state.tuitionMode === 'GRADE' ? '#60a5fa' : '#e5e7eb'};">✏️ Por Grado y Año</div>
                <div style="font-size:0.725rem; color:#9ca3af; margin-top:0.25rem;">Precio individual por cada año</div>
              </button>
            </div>

            <!-- Formularios según Modo Seleccionado -->
            ${state.tuitionMode === 'GLOBAL' ? `
              <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:1.25rem; border-radius:10px;">
                <h4 style="font-size:0.9rem; font-weight:700; color:#34d399; margin-bottom:0.5rem;">Configuración Global de Mensualidad Única</h4>
                <p style="font-size:0.8rem; color:#9ca3af; margin-bottom:1rem;">Se aplicará el mismo costo mensual a todos los estudiantes (1er Grado a 5to Año).</p>
                
                <div style="display:flex; gap:1rem; align-items:center;">
                  <div>
                    <label style="font-size:0.78rem; font-weight:700; color:#9ca3af; display:block; margin-bottom:0.35rem;">Precio Mensualidad USD ($):</label>
                    <input type="number" id="tuition_global_input" step="0.01" min="0" class="input-field" style="font-size:1.3rem; font-weight:800; color:#34d399; width:220px; background:rgba(0,0,0,0.4);" value="${state.globalTuitionInput || 50.0}">
                  </div>
                  <button onclick="saveTuitionRates('GLOBAL')" class="btn btn-accent" style="margin-top:1.2rem; padding:0.75rem 1.5rem; font-weight:700;">
                    💾 Aplicar Mensualidad Única
                  </button>
                </div>
              </div>
            ` : state.tuitionMode === 'GROUP' ? `
              <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:1.25rem; border-radius:10px;">
                <h4 style="font-size:0.9rem; font-weight:700; color:#fbbf24; margin-bottom:0.5rem;">Configuración por Nivel Educativo / Grupo</h4>
                <p style="font-size:0.8rem; color:#9ca3af; margin-bottom:1rem;">Asigna un monto específico para cada uno de los 3 niveles del colegio:</p>

                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:1rem; margin-bottom:1.25rem;">
                  <div style="background:rgba(0,0,0,0.3); padding:1rem; border-radius:8px; border:1px solid rgba(251,191,36,0.3);">
                    <label style="font-size:0.8rem; font-weight:800; color:#fbbf24; display:block; margin-bottom:0.35rem;">🎨 Primaria</label>
                    <span style="font-size:0.7rem; color:#9ca3af; display:block; margin-bottom:0.5rem;">1er Grado a 6to Grado</span>
                    <input type="number" id="tuition_group_primaria" step="0.01" class="input-field" style="font-size:1.2rem; font-weight:800; color:#fbbf24;" value="${state.groupTuitionInputs['Primaria'] || 50.0}">
                  </div>

                  <div style="background:rgba(0,0,0,0.3); padding:1rem; border-radius:8px; border:1px solid rgba(129,140,248,0.3);">
                    <label style="font-size:0.8rem; font-weight:800; color:#818cf8; display:block; margin-bottom:0.35rem;">📘 Educación Básica</label>
                    <span style="font-size:0.7rem; color:#9ca3af; display:block; margin-bottom:0.5rem;">1er a 3er Año (7mo - 9no)</span>
                    <input type="number" id="tuition_group_basica" step="0.01" class="input-field" style="font-size:1.2rem; font-weight:800; color:#818cf8;" value="${state.groupTuitionInputs['Educación Básica'] || 50.0}">
                  </div>

                  <div style="background:rgba(0,0,0,0.3); padding:1rem; border-radius:8px; border:1px solid rgba(52,211,153,0.3);">
                    <label style="font-size:0.8rem; font-weight:800; color:#34d399; display:block; margin-bottom:0.35rem;">🎓 Media y Diversificada</label>
                    <span style="font-size:0.7rem; color:#9ca3af; display:block; margin-bottom:0.5rem;">4to Año y 5to Año</span>
                    <input type="number" id="tuition_group_media" step="0.01" class="input-field" style="font-size:1.2rem; font-weight:800; color:#34d399;" value="${state.groupTuitionInputs['Media y Diversificada'] || 50.0}">
                  </div>
                </div>

                <div style="display:flex; justify-content:flex-end;">
                  <button onclick="saveTuitionRates('GROUP')" class="btn btn-warning" style="padding:0.75rem 1.5rem; font-weight:700;">
                    💾 Aplicar Precios por Nivel
                  </button>
                </div>
              </div>
            ` : `
              <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:1.25rem; border-radius:10px;">
                <h4 style="font-size:0.9rem; font-weight:700; color:#60a5fa; margin-bottom:0.5rem;">Configuración Individual por Grado y Año</h4>
                <p style="font-size:0.8rem; color:#9ca3af; margin-bottom:1rem;">Especifica el precio exacto de la mensualidad para cada grado:</p>

                <!-- Bloque Primaria -->
                <h5 style="color:#fbbf24; font-size:0.85rem; font-weight:700; text-transform:uppercase; margin-bottom:0.5rem;">🎨 Primaria (1er a 6to Grado)</h5>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:0.75rem; margin-bottom:1.25rem;">
                  ${['1er Grado', '2do Grado', '3er Grado', '4to Grado', '5to Grado', '6to Grado'].map(g => `
                    <div style="background:rgba(0,0,0,0.3); padding:0.6rem 0.75rem; border-radius:6px;">
                      <label style="font-size:0.75rem; font-weight:700; color:#e5e7eb;">${g}:</label>
                      <input type="number" id="tuition_grade_${g.replace(/\s+/g, '_')}" step="0.01" class="input-field" style="font-size:1rem; font-weight:800; color:#fbbf24; margin-top:0.2rem;" value="${state.gradeTuitionInputs[g] || 50.0}">
                    </div>
                  `).join('')}
                </div>

                <!-- Bloque Básica -->
                <h5 style="color:#818cf8; font-size:0.85rem; font-weight:700; text-transform:uppercase; margin-bottom:0.5rem;">📘 Educación Básica (1er a 3er Año / 7mo - 9no Grado)</h5>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:0.75rem; margin-bottom:1.25rem;">
                  ${['1er Año', '2do Año', '3er Año'].map(g => `
                    <div style="background:rgba(0,0,0,0.3); padding:0.6rem 0.75rem; border-radius:6px;">
                      <label style="font-size:0.75rem; font-weight:700; color:#e5e7eb;">${g} (${g==='1er Año'?'7mo':g==='2do Año'?'8vo':'9no'} Grado):</label>
                      <input type="number" id="tuition_grade_${g.replace(/\s+/g, '_')}" step="0.01" class="input-field" style="font-size:1rem; font-weight:800; color:#818cf8; margin-top:0.2rem;" value="${state.gradeTuitionInputs[g] || 50.0}">
                    </div>
                  `).join('')}
                </div>

                <!-- Bloque Media -->
                <h5 style="color:#34d399; font-size:0.85rem; font-weight:700; text-transform:uppercase; margin-bottom:0.5rem;">🎓 Media y Diversificada (4to y 5to Año)</h5>
                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:0.75rem; margin-bottom:1.25rem;">
                  ${['4to Año', '5to Año'].map(g => `
                    <div style="background:rgba(0,0,0,0.3); padding:0.6rem 0.75rem; border-radius:6px;">
                      <label style="font-size:0.75rem; font-weight:700; color:#e5e7eb;">${g}:</label>
                      <input type="number" id="tuition_grade_${g.replace(/\s+/g, '_')}" step="0.01" class="input-field" style="font-size:1rem; font-weight:800; color:#34d399; margin-top:0.2rem;" value="${state.gradeTuitionInputs[g] || 50.0}">
                    </div>
                  `).join('')}
                </div>

                <div style="display:flex; justify-content:flex-end;">
                  <button onclick="saveTuitionRates('GRADE')" class="btn btn-primary" style="padding:0.75rem 1.5rem; font-weight:700;">
                    💾 Guardar Precios por Grado
                  </button>
                </div>
              </div>
            `}
          </div>

          <!-- SECCIÓN 2: Tasa de Cambio BCV en Vivo -->
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1.25rem; margin-bottom:1.5rem;">
            
            <!-- Card Tasa Activa -->
            <div class="glass-panel" style="padding:1.35rem; border:1px solid rgba(16,185,129,0.3); background:rgba(16,185,129,0.05); display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <span style="font-size:0.75rem; color:#34d399; font-weight:700; text-transform:uppercase;">Tasa Activa en Sistema CDNJ</span>
                <h2 style="color:#34d399; font-size:2rem; font-weight:900; margin:0.3rem 0;">${state.exchangeRate.toFixed(2)} VES/USD</h2>
                <p style="font-size:0.75rem; color:#9ca3af; margin:0;">Esta es la tasa de cambio vigente aplicada a todos los cobros.</p>
              </div>
            </div>

            <!-- Card Tasa BCV Hoy -->
            <div class="glass-panel" style="padding:1.35rem; border:1px solid rgba(99,102,241,0.3); background:rgba(99,102,241,0.05); display:flex; flex-direction:column; justify-content:space-between;">
              <div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-size:0.75rem; color:#818cf8; font-weight:700; text-transform:uppercase;">🏛️ Tasa Oficial BCV del Día</span>
                  <span class="badge badge-primary" style="font-size:0.65rem;">API DolarAPI Oficial</span>
                </div>
                <h2 style="color:#818cf8; font-size:2rem; font-weight:900; margin:0.3rem 0;">
                  ${bcvRate ? bcvRate.toFixed(2) : state.exchangeRate.toFixed(2)} VES/USD
                </h2>
                <p style="font-size:0.725rem; color:#9ca3af; margin:0;">
                  Fecha de Actualización BCV: <strong>${state.bcvRateData?.date || 'Hoy'}</strong>
                </p>
              </div>

              ${bcvRate ? `
                <button onclick="applyRate(${bcvRate}, 'BCV')" class="btn btn-accent" style="margin-top:0.85rem; width:100%; font-weight:700; background:linear-gradient(135deg, #10b981, #059669); border:none; padding:0.75rem;">
                  ⚡ Trabajar con la Tasa Oficial del BCV (${bcvRate.toFixed(2)} VES)
                </button>
              ` : ''}
            </div>

          </div>

          <!-- SECCIÓN 3: Ajuste Manual de Tasa -->
          <div class="glass-panel" style="padding:1.25rem; margin-bottom:1.5rem;">
            <h4 style="font-size:0.95rem; font-weight:700; color:#f3f4f6; margin-bottom:0.75rem;">Modificar Tasa Manualmente</h4>
            <div style="display:flex; gap:0.75rem; align-items:center;">
              <input id="rate_manual_input" type="number" step="0.01" class="input-field" value="${state.exchangeRate}" style="font-size:1.1rem; font-weight:700; max-width:250px;">
              <button onclick="const r=parseFloat(document.getElementById('rate_manual_input').value); if(r>0) applyRate(r, 'MANUAL');" class="btn btn-primary">
                Guardar Tasa Manual
              </button>
            </div>
          </div>

          <!-- SECCIÓN 4: Registros de la Semana (Lunes a Viernes) -->
          <div class="glass-panel" style="padding:1.35rem; margin-bottom:1.5rem;">
            <h3 style="font-size:1.1rem; font-weight:800; color:#f3f4f6; margin-bottom:0.5rem; display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="calendar"></i> Registros de la Semana (Lunes a Viernes)
            </h3>
            <p style="font-size:0.85rem; color:#9ca3af; margin-bottom:1rem;">Histórico oficial de tasas para los días hábiles de la semana laboral:</p>

            <div class="table-container">
              <table class="custom-table">
                <thead>
                  <tr>
                    <th>Día</th>
                    <th>Fecha</th>
                    <th>Tasa Oficial (VES / USD)</th>
                    <th>Origen</th>
                    <th style="text-align:right;">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  ${(state.rateHistoryWeek || []).map(item => `
                    <tr>
                      <td style="font-weight:700; color:#818cf8;">${item.dayName}</td>
                      <td>${item.date}</td>
                      <td style="font-weight:800; color:#34d399; font-size:1rem;">${item.rate ? item.rate.toFixed(2) : '36.50'} VES</td>
                      <td><span class="badge ${item.source==='BCV'?'badge-success':'badge-secondary'}">${item.source}</span></td>
                      <td style="text-align:right;">
                        <button onclick="applyRate(${item.rate}, '${item.source}')" class="btn btn-secondary btn-sm" style="font-size:0.75rem;">
                          Usar esta Tasa
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- SECCIÓN 5: Consulta de Fecha Antigua por Calendario -->
          <div class="glass-panel" style="padding:1.35rem;">
            <h3 style="font-size:1.1rem; font-weight:800; color:#f3f4f6; margin-bottom:0.5rem; display:flex; align-items:center; gap:0.5rem;">
              <i data-lucide="clock"></i> Consultar Tasa de Fecha Antigua (Calendario)
            </h3>
            <p style="font-size:0.85rem; color:#9ca3af; margin-bottom:1rem;">Selecciona cualquier fecha antigua en el calendario para consultar o aplicar la tasa histórica:</p>

            <div style="display:flex; gap:0.75rem; align-items:center; margin-bottom:1rem;">
              <input type="date" id="rate_calendar_input" class="input-field" style="max-width:220px; font-weight:700;" value="${state.historicalQueryDate || ''}" onchange="lookupHistoricalRate(this.value)">
              <button onclick="lookupHistoricalRate(document.getElementById('rate_calendar_input').value)" class="btn btn-secondary">
                <i data-lucide="search"></i> Consultar Fecha
              </button>
            </div>

            ${state.historicalQueryDate ? `
              <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); padding:1rem; border-radius:10px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <span style="font-size:0.75rem; color:#9ca3af; text-transform:uppercase; font-weight:700;">Tasa Registrada para ${state.historicalQueryDate}:</span>
                  <div style="font-size:1.4rem; font-weight:800; color:${state.historicalQueryResult?.rate ? '#34d399' : '#fbbf24'}; margin-top:0.25rem;">
                    ${state.historicalQueryResult?.rate ? `${state.historicalQueryResult.rate.toFixed(2)} VES/USD` : 'No hay registro previo'}
                  </div>
                  ${state.historicalQueryResult?.source ? `<span class="badge badge-primary" style="font-size:0.7rem;">Origen: ${state.historicalQueryResult.source}</span>` : ''}
                </div>
                
                ${state.historicalQueryResult?.rate ? `
                  <button onclick="applyRate(${state.historicalQueryResult.rate}, '${state.historicalQueryResult.source}')" class="btn btn-accent">
                    Trabajar con esta Tasa (${state.historicalQueryResult.rate.toFixed(2)} VES)
                  </button>
                ` : ''}
              </div>
            ` : ''}

    // =========================================================================
    // MODULO DE GESTION DE MATRICULA Y ESTUDIANTES / REPRESENTADOS
    // =========================================================================
    async function loadStudentsData() {
      state.studentsLoading = true;
      render();
      try {
        const q = encodeURIComponent(state.studentsSearchQuery || '');
        const status = state.studentsStatusFilter || 'ALL';
        const [stRes, gRes] = await Promise.all([
          fetch(`${API_BASE}/api/students/manage?status=${status}&q=${q}`, {
            headers: { Authorization: `Bearer ${state.token}` }
          }),
          fetch(`${API_BASE}/api/students/guardians`, {
            headers: { Authorization: `Bearer ${state.token}` }
          })
        ]);
        if (stRes.ok) {
          const data = await stRes.json();
          state.studentsList = data.students || [];
        }
        if (gRes.ok) {
          const gData = await gRes.json();
          state.studentsGuardiansList = gData.guardians || [];
        }
      } catch (err) {
        console.error("Error cargando estudiantes y representados:", err);
      } finally {
        state.studentsLoading = false;
        render();
      }
    }

    function renderStudentsPanel() {
      if (!state.studentsList.length && !state.studentsLoading && state.studentsSearchQuery === '') {
        loadStudentsData();
      }

      return `
        <div>
          <!-- Header -->
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; flex-wrap:wrap; gap:1rem;">
            <div>
              <h2 style="font-size:1.6rem; font-weight:800; color:#f9fafb; display:flex; align-items:center; gap:0.5rem;">
                <i data-lucide="user-check" style="color:#818cf8;"></i> Gestión de Matrícula y Estudiantes
              </h2>
              <p style="color:#9ca3af; font-size:0.85rem; margin-top:0.2rem;">Administración de representados, códigos únicos automáticos, estado (activo/congelado) e importación masiva.</p>
            </div>

            <div style="display:flex; align-items:center; gap:0.75rem;">
              <button onclick="openBatchModal()" class="btn btn-secondary" style="border:1px solid rgba(129,140,248,0.4);">
                <i data-lucide="upload"></i> Carga Masiva (CSV / Excel)
              </button>
              <button onclick="openStudentModal()" class="btn btn-primary" style="box-shadow:0 4px 12px rgba(99,102,241,0.3);">
                <i data-lucide="user-plus"></i> + Nuevo Representado
              </button>
            </div>
          </div>

          <!-- Filtros y Búsqueda -->
          <div class="glass-panel" style="padding:1.25rem; margin-bottom:1.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
              <!-- Input de Búsqueda -->
              <div style="position:relative; flex:1; min-width:280px;">
                <input type="text" class="input-field" placeholder="Buscar por nombre, cédula, código único (EST-2026-XXXX) o representante..."
                       value="${state.studentsSearchQuery || ''}"
                       oninput="state.studentsSearchQuery=this.value; loadStudentsData();"
                       style="padding-left:2.5rem;">
                <i data-lucide="search" style="position:absolute; left:0.8rem; top:50%; transform:translateY(-50%); color:#9ca3af; width:1.1rem;"></i>
              </div>

              <!-- Filtro de Estado -->
              <div style="display:flex; gap:0.5rem; align-items:center;">
                <span style="font-size:0.8rem; color:#9ca3af; font-weight:700;">Filtrar Estado:</span>
                <button onclick="state.studentsStatusFilter='ALL'; loadStudentsData();" class="btn btn-sm ${state.studentsStatusFilter==='ALL'?'btn-primary':'btn-secondary'}" style="font-size:0.8rem;">
                  Todos
                </button>
                <button onclick="state.studentsStatusFilter='ACTIVE'; loadStudentsData();" class="btn btn-sm ${state.studentsStatusFilter==='ACTIVE'?'btn-primary':'btn-secondary'}" style="font-size:0.8rem;">
                  🟢 Activos
                </button>
                <button onclick="state.studentsStatusFilter='FROZEN'; loadStudentsData();" class="btn btn-sm ${state.studentsStatusFilter==='FROZEN'?'btn-primary':'btn-secondary'}" style="font-size:0.8rem;">
                  ❄️ Congelados
                </button>
                <button onclick="state.studentsStatusFilter='INACTIVE'; loadStudentsData();" class="btn btn-sm ${state.studentsStatusFilter==='INACTIVE'?'btn-primary':'btn-secondary'}" style="font-size:0.8rem;">
                  🔴 Inactivos
                </button>
              </div>
            </div>
          </div>

          ${state.studentsLoading ? `
            <div class="glass-panel" style="padding:3rem; text-align:center; color:#9ca3af;">
              <i data-lucide="loader-2" class="spin" style="width:2.5rem; height:2.5rem; color:#818cf8; margin-bottom:1rem;"></i>
              <p style="font-weight:600;">Cargando lista de representados y matrícula...</p>
            </div>
          ` : `

          <!-- Tabla de Estudiantes -->
          <div class="table-container">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>Código Único</th>
                  <th>Estudiante</th>
                  <th>Cédula Est.</th>
                  <th>Grado / Sección</th>
                  <th>Representante</th>
                  <th>Cédula Rep.</th>
                  <th>Teléfono</th>
                  <th>Estado</th>
                  <th style="text-align:right;">Acciones</th>
                </tr>
              </thead>
              <tbody>
                ${state.studentsList.length === 0 ? `
                  <tr><td colspan="9" style="text-align:center; padding:2.5rem; color:#9ca3af;">No se encontraron representados registradas con los filtros indicados.</td></tr>
                ` : state.studentsList.map(s => `
                  <tr style="opacity:${s.status==='INACTIVE'?0.5:1};">
                    <td style="font-weight:700;"><span class="badge badge-neutral" style="font-family:monospace; color:#818cf8;">${s.studentCode}</span></td>
                    <td style="font-weight:700; color:#f3f4f6;">${s.fullName}</td>
                    <td>${s.docId ? `<span class="badge badge-neutral">${s.docId}</span>` : '<span style="color:#6b7280;">N/A</span>'}</td>
                    <td><span class="badge badge-primary">${s.grade} (${s.section || 'A'})</span></td>
                    <td style="font-weight:600; color:#e5e7eb;">${s.guardian?.fullName || 'N/A'}</td>
                    <td>${s.guardian?.docId ? `<span class="badge badge-neutral">${s.guardian.docId}</span>` : '<span style="color:#6b7280;">N/A</span>'}</td>
                    <td style="font-size:0.85rem; color:#9ca3af;">${s.guardian?.phone || 'N/A'}</td>
                    <td>
                      ${s.status === 'ACTIVE' ? `<span class="badge badge-success">🟢 ACTIVO</span>` : ''}
                      ${s.status === 'FROZEN' ? `<span class="badge" style="background:rgba(56,189,248,0.2); color:#38bdf8; border:1px solid #38bdf8;">❄️ CONGELADO</span>` : ''}
                      ${s.status === 'INACTIVE' ? `<span class="badge badge-danger">🔴 INACTIVO</span>` : ''}
                    </td>
                    <td style="text-align:right;">
                      <div style="display:flex; gap:0.3rem; justify-content:flex-end;">
                        <button onclick="openStudentModal('${s.id}')" class="btn btn-secondary btn-sm" title="Editar"><i data-lucide="edit-3"></i></button>
                        <button onclick="toggleStudentStatus('${s.id}', '${s.status === 'FROZEN' ? 'ACTIVE' : 'FROZEN'}')"
                                class="btn btn-sm ${s.status === 'FROZEN' ? 'btn-success' : 'btn-accent'}"
                                title="${s.status === 'FROZEN' ? 'Descongelar Estudiante' : 'Congelar Estudiante'}">
                          <i data-lucide="${s.status === 'FROZEN' ? 'play-circle' : 'snowflake'}"></i> ${s.status === 'FROZEN' ? 'Descongelar' : 'Congelar'}
                        </button>
                        ${s.status !== 'INACTIVE' ? `
                          <button onclick="deleteStudent('${s.id}')" class="btn btn-danger btn-sm" title="Inactivar / Eliminar"><i data-lucide="trash-2"></i></button>
                        ` : ''}
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          `}
        </div>
      `;
    }

    function openStudentModal(studentId = null) {
      if (studentId) {
        state.editingStudent = state.studentsList.find(s => s.id === studentId) || null;
      } else {
        state.editingStudent = null;
      }
      state.showStudentModal = true;
      render();
    }

    async function saveStudentForm() {
      const firstName = document.getElementById('st_first_name')?.value?.trim();
      const lastName = document.getElementById('st_last_name')?.value?.trim();
      const docId = document.getElementById('st_doc_id')?.value?.trim();
      const grade = document.getElementById('st_grade')?.value;
      const section = document.getElementById('st_section')?.value || 'A';
      const status = document.getElementById('st_status')?.value || 'ACTIVE';

      const guardianSelect = document.getElementById('st_guardian_select')?.value;
      const repDocId = document.getElementById('rep_doc_id')?.value?.trim();
      const repName = document.getElementById('rep_name')?.value?.trim();
      const repPhone = document.getElementById('rep_phone')?.value?.trim();
      const repEmail = document.getElementById('rep_email')?.value?.trim();

      if (!firstName || !grade) {
        alert("Por favor ingrese el nombre del estudiante y seleccione su grado.");
        return;
      }

      let payload = {
        studentId: state.editingStudent?.id || null,
        firstName,
        lastName,
        docId,
        grade,
        section,
        status
      };

      if (guardianSelect && guardianSelect !== 'NEW') {
        payload.guardianId = guardianSelect;
      } else {
        if (!repName) {
          alert("Por favor ingrese el nombre del representante.");
          return;
        }
        payload.guardian = {
          docId: repDocId,
          fullName: repName,
          phone: repPhone,
          email: repEmail
        };
      }

      try {
        const res = await fetch(`${API_BASE}/api/students/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
          state.showStudentModal = false;
          state.editingStudent = null;
          loadStudentsData();
        } else {
          alert(data.error || "Error al guardar representado.");
        }
      } catch (err) {
        console.error("Error guardando estudiante:", err);
        alert("Error de conexión al guardar.");
      }
    }

    async function toggleStudentStatus(studentId, newStatus) {
      const actionLabel = newStatus === 'FROZEN' ? 'Congelar' : newStatus === 'ACTIVE' ? 'Activar/Descongelar' : 'Inactivar';
      if (!confirm(`¿Está seguro de cambiar el estado del estudiante a: ${actionLabel}?`)) return;

      try {
        const res = await fetch(`${API_BASE}/api/students/toggle-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ studentId, status: newStatus })
        });
        if (res.ok) {
          loadStudentsData();
        } else {
          const d = await res.json();
          alert(d.error || "Error actualizando estado.");
        }
      } catch (err) {
        console.error("Error al actualizar estado:", err);
      }
    }

    async function deleteStudent(studentId) {
      if (!confirm("¿Está seguro de inactivar/eliminar este registro de matricula?")) return;

      try {
        const res = await fetch(`${API_BASE}/api/students/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ studentId })
        });
        if (res.ok) {
          loadStudentsData();
        } else {
          const d = await res.json();
          alert(d.error || "Error eliminando estudiante.");
        }
      } catch (err) {
        console.error("Error al eliminar estudiante:", err);
      }
    }

    function openBatchModal() {
      state.showBatchModal = true;
      state.batchPreviewRecords = [];
      render();
    }

    function downloadBatchTemplate() {
      const csvContent = "data:text/csv;charset=utf-8," + 
        "Cedula_Representante,Nombre_Representante,Telefono,Correo,Nombre_Estudiante,Apellido_Estudiante,Cedula_Estudiante,Grado,Seccion\n" +
        "V-14266349,Patricia Mendoza,+58 424-1776920,patricia@gmail.com,Gabriel,Mendoza,V-32145678,1ro Grado,A\n" +
        "V-18844631,Alejandro Paredes,+58 414-3512649,alejandro@gmail.com,Lucía,Paredes,V-32987654,2do Grado,A";
      
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "plantilla_importacion_estudiantes.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    function handleBatchFileSelect(event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      const filename = file.name.toLowerCase();

      if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
        reader.onload = function(e) {
          try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet);
            state.batchPreviewRecords = jsonData;
            render();
          } catch (err) {
            console.error("Error leyendo archivo Excel:", err);
            alert("Error al procesar el archivo Excel. Asegúrese de que sea un formato válido.");
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        // Plain CSV fallback
        reader.onload = function(e) {
          try {
            const text = e.target.result;
            const lines = text.split('\n').map(l => l.trim()).filter(l => l);
            if (lines.length <= 1) {
              alert("El archivo CSV está vacío o no contiene filas de datos.");
              return;
            }
            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            const records = [];
            for (let i = 1; i < lines.length; i++) {
              const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
              if (values.length >= 2) {
                let rec = {};
                headers.forEach((h, idx) => {
                  rec[h] = values[idx] || '';
                });
                records.push(rec);
              }
            }
            state.batchPreviewRecords = records;
            render();
          } catch (err) {
            console.error("Error leyendo CSV:", err);
            alert("Error al leer el archivo CSV.");
          }
        };
        reader.readAsText(file);
      }
    }

    async function confirmBatchImport() {
      if (!state.batchPreviewRecords || state.batchPreviewRecords.length === 0) {
        alert("No hay registros en la vista previa para importar.");
        return;
      }

      state.batchImporting = true;
      render();

      try {
        const res = await fetch(`${API_BASE}/api/students/batch-import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ records: state.batchPreviewRecords })
        });
        const data = await res.json();
        if (res.ok) {
          alert(`🎉 ${data.message}`);
          state.showBatchModal = false;
          state.batchPreviewRecords = [];
          loadStudentsData();
        } else {
          alert(data.error || "Error en la importación masiva.");
        }
      } catch (err) {
        console.error("Error al importar lote:", err);
        alert("Error de red durante la importación.");
      } finally {
        state.batchImporting = false;
        render();
      }
    }

    function renderStudentModalHTML() {
      const s = state.editingStudent;
      const isEdit = !!s;

      return `
        <div class="modal-overlay" onclick="state.showStudentModal=false; render();">
          <div class="modal-content" style="max-width:650px;" onclick="event.stopPropagation();">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem;">
              <h3 style="font-size:1.25rem; font-weight:800; color:#f3f4f6;">
                ${isEdit ? 'Editar Registro de Representado / Estudiante' : 'Nuevo Registro de Representado'}
              </h3>
              <button onclick="state.showStudentModal=false; render();" class="btn btn-secondary btn-sm">✕</button>
            </div>

            <!-- Datos del Estudiante -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:1rem; border-radius:10px; margin-bottom:1rem;">
              <h4 style="font-size:0.9rem; font-weight:700; color:#818cf8; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.4rem;">
                <i data-lucide="graduation-cap"></i> Información del Estudiante (Representado)
              </h4>

              <div style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem;">
                <div>
                  <label class="input-label">Nombres *</label>
                  <input type="text" id="st_first_name" class="input-field" value="${s ? s.firstName : ''}" placeholder="Ej. Carlos Eduardo">
                </div>
                <div>
                  <label class="input-label">Apellidos</label>
                  <input type="text" id="st_last_name" class="input-field" value="${s ? s.lastName : ''}" placeholder="Ej. Pérez Rivas">
                </div>
                <div>
                  <label class="input-label">Cédula Estudiante (opcional)</label>
                  <input type="text" id="st_doc_id" class="input-field" value="${s ? s.docId : ''}" placeholder="Ej. V-31234567">
                </div>
                <div>
                  <label class="input-label">Grado Escolar *</label>
                  <select id="st_grade" class="select-field">
                    ${ALL_GRADES.map(g => `
                      <option value="${g.name}" ${s && s.grade === g.name ? 'selected' : ''}>${g.name}</option>
                    `).join('')}
                  </select>
                </div>
                <div>
                  <label class="input-label">Sección</label>
                  <input type="text" id="st_section" class="input-field" value="${s ? s.section || 'A' : 'A'}">
                </div>
                <div>
                  <label class="input-label">Estado de Matrícula</label>
                  <select id="st_status" class="select-field">
                    <option value="ACTIVE" ${s && s.status === 'ACTIVE' ? 'selected' : ''}>🟢 Activo</option>
                    <option value="FROZEN" ${s && s.status === 'FROZEN' ? 'selected' : ''}>❄️ Congelado</option>
                    <option value="INACTIVE" ${s && s.status === 'INACTIVE' ? 'selected' : ''}>🔴 Inactivo</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Datos del Representante -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); padding:1rem; border-radius:10px; margin-bottom:1.25rem;">
              <h4 style="font-size:0.9rem; font-weight:700; color:#34d399; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.4rem;">
                <i data-lucide="user"></i> Información del Representante Legal
              </h4>

              <div style="margin-bottom:0.75rem;">
                <label class="input-label">Asignar Representante</label>
                <select id="st_guardian_select" class="select-field" onchange="
                  const isNew = this.value === 'NEW';
                  document.getElementById('new_rep_fields').style.display = isNew ? 'grid' : 'none';
                ">
                  <option value="NEW">+ Registrar Nuevo Representante</option>
                  ${(state.studentsGuardiansList || []).map(g => `
                    <option value="${g.id}" ${s && s.guardian && s.guardian.id === g.id ? 'selected' : ''}>
                      ${g.fullName} (${g.docId}) - Cod: ${g.guardianCode}
                    </option>
                  `).join('')}
                </select>
              </div>

              <div id="new_rep_fields" style="display:grid; grid-template-columns: 1fr 1fr; gap:0.75rem;">
                <div>
                  <label class="input-label">Cédula Representante *</label>
                  <input type="text" id="rep_doc_id" class="input-field" value="${s && s.guardian ? s.guardian.docId : ''}" placeholder="Ej. V-14266349">
                </div>
                <div>
                  <label class="input-label">Nombre Completo *</label>
                  <input type="text" id="rep_name" class="input-field" value="${s && s.guardian ? s.guardian.fullName : ''}" placeholder="Ej. Juan Pérez">
                </div>
                <div>
                  <label class="input-label">Teléfono de Contacto</label>
                  <input type="text" id="rep_phone" class="input-field" value="${s && s.guardian ? s.guardian.phone : ''}" placeholder="Ej. +58 412 1234567">
                </div>
                <div>
                  <label class="input-label">Correo Electrónico</label>
                  <input type="email" id="rep_email" class="input-field" value="${s && s.guardian ? s.guardian.email : ''}" placeholder="Ej. representante@gmail.com">
                </div>
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
              <button onclick="state.showStudentModal=false; render();" class="btn btn-secondary">Cancelar</button>
              <button onclick="saveStudentForm()" class="btn btn-primary">
                <i data-lucide="check-circle"></i> Guardar Representado
              </button>
            </div>
          </div>
        </div>
      `;
    }

    function renderBatchModalHTML() {
      const records = state.batchPreviewRecords || [];

      return `
        <div class="modal-overlay" onclick="state.showBatchModal=false; render();">
          <div class="modal-content" style="max-width:850px;" onclick="event.stopPropagation();">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.25rem;">
              <div>
                <h3 style="font-size:1.3rem; font-weight:800; color:#f3f4f6; display:flex; align-items:center; gap:0.5rem;">
                  <i data-lucide="upload" style="color:#818cf8;"></i> Carga Masiva de Representados y Estudiantes
                </h3>
                <p style="font-size:0.85rem; color:#9ca3af; margin-top:0.2rem;">Importa la base de datos completa desde un archivo CSV o Excel (.xlsx).</p>
              </div>
              <button onclick="state.showBatchModal=false; render();" class="btn btn-secondary btn-sm">✕</button>
            </div>

            <!-- Botones descargas y file dropzone -->
            <div style="display:flex; gap:1rem; align-items:center; margin-bottom:1.25rem; flex-wrap:wrap;">
              <button onclick="downloadBatchTemplate()" class="btn btn-secondary" style="border:1px dashed #818cf8; color:#818cf8;">
                <i data-lucide="download"></i> Descargar Plantilla CSV Ejemplo
              </button>
              
              <label class="btn btn-primary" style="cursor:pointer;">
                <i data-lucide="file-spreadsheet"></i> Seleccionar Archivo (CSV / Excel)
                <input type="file" accept=".csv, .xlsx, .xls" style="display:none;" onchange="handleBatchFileSelect(event)">
              </label>
            </div>

            ${records.length > 0 ? `
              <div style="margin-bottom:1rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                  <span style="font-size:0.85rem; font-weight:700; color:#34d399;">
                    ✓ ${records.length} filas detectadas en el archivo:
                  </span>
                  <span style="font-size:0.75rem; color:#9ca3af;">Los códigos únicos (EST-2026-XXXX / REP-2026-XXXX) se generarán automáticamente.</span>
                </div>

                <div class="table-container" style="max-height:300px; overflow-y:auto;">
                  <table class="custom-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Cédula Rep.</th>
                        <th>Representante</th>
                        <th>Teléfono</th>
                        <th>Estudiante</th>
                        <th>Grado</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${records.slice(0, 50).map((r, idx) => `
                        <tr>
                          <td>${idx + 1}</td>
                          <td style="font-weight:700; color:#818cf8;">${r.Cedula_Representante || r.cedula_representante || r.repDocId || 'N/A'}</td>
                          <td>${r.Nombre_Representante || r.nombre_representante || r.repName || 'N/A'}</td>
                          <td>${r.Telefono || r.telefono || r.repPhone || 'N/A'}</td>
                          <td style="font-weight:700; color:#34d399;">${r.Nombre_Estudiante || r.nombre_estudiante || r.studentFirstName || ''} ${r.Apellido_Estudiante || r.apellido_estudiante || ''}</td>
                          <td><span class="badge badge-primary">${r.Grado || r.grado || r.grade || '1ro Grado'}</span></td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
                ${records.length > 50 ? `<div style="font-size:0.75rem; color:#9ca3af; margin-top:0.4rem; text-align:center;">... y ${records.length - 50} registros adicionales</div>` : ''}
              </div>
            ` : `
              <div class="glass-panel" style="padding:2.5rem; text-align:center; border:2px dashed rgba(255,255,255,0.15); margin-bottom:1.25rem;">
                <i data-lucide="file-up" style="width:3rem; height:3rem; color:#6b7280; margin-bottom:0.75rem;"></i>
                <p style="color:#e5e7eb; font-weight:700; margin-bottom:0.25rem;">Arrastre o seleccione un archivo CSV o Excel aquí</p>
                <p style="color:#9ca3af; font-size:0.8rem;">El sistema mapeará automáticamente los nombres de columnas y registrará los datos.</p>
              </div>
            `}

            <div style="display:flex; justify-content:flex-end; gap:0.75rem;">
              <button onclick="state.showBatchModal=false; render();" class="btn btn-secondary">Cancelar</button>
              ${records.length > 0 ? `
                <button onclick="confirmBatchImport()" class="btn btn-accent" ${state.batchImporting ? 'disabled' : ''}>
                  ${state.batchImporting ? '<i data-lucide="loader-2" class="spin"></i> Importando...' : `<i data-lucide="check"></i> Confirmar e Importar ${records.length} Registros`}
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }

    // Initial Trigger
    render();
  