/* * MediaWiki 批量管理工具 v20.4
 * 原始开发：Claude & Gemini & ChatGPT & DeepSeek & Doubao
 * 发布者：PandaFiredoge
*/

(function () {
    'use strict';

    // =========================================================
    //  集中状态管理
    // =========================================================
    const State = {
        isRunning: false,
        isPaused: false,
        stopSignal: false,
        btnCreated: false,
        resizeBound: false,
        lastHiddenMode: 'closed',
        // [BUG-05] FAB 位置保存/恢复
        _fabOrigLeft: null,
        _fabOrigTop: null,
        _fabOrigRight: null,
        _fabOrigBottom: null,
        _fabWasMoved: false,
        // [BUG-10] 守护重入标志
        _guardRunning: false
    };

    const siteNamespaces = mw.config.get('wgFormattedNamespaces');
    const api = new mw.Api();

    mw.loader.using(['mediawiki.api', 'mediawiki.util', 'mediawiki.user', 'mediawiki.Title', 'mediawiki.notification']).then(function () {
        $(function () { startUp(); });
    });

    async function startUp() {
        const userGroups = mw.config.get('wgUserGroups');
        const allowedGroups = ['sysop', 'bureaucrat', 'util', 'interface-admin', 'steward'];
        if (!userGroups || !userGroups.some(g => allowedGroups.includes(g))) return;

        addGlobalStyles();
        createFloatingButton();
        createToolWindow();
        createModalContainer();
        bindUnloadProtector();

        // [BUG-10] 守护悬浮球，添加重入保护标志，防止并发重建
        setInterval(() => {
            if (State._guardRunning) return;
            if (!document.getElementById('mw-batch-tool-btn')) {
                State._guardRunning = true;
                State.btnCreated = false;
                createFloatingButton();
                State._guardRunning = false;
            }
        }, 2000);

        console.log('MediaWiki 批量管理工具 v20.4 已启动');
    }

    function bindUnloadProtector() {
        window.addEventListener('beforeunload', (e) => {
            if (State.isRunning) {
                e.preventDefault();
                e.returnValue = '有批量任务正在执行中，离开页面将导致任务中断！';
                return e.returnValue;
            }
        });
    }

    function setTaskState(running) {
        State.isRunning = running;
        if (!running) updateDynamicIsland(false);
    }

    function escapeHTML(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // [BUG-02][BUG-03] 可中断式 sleep：每 100ms 检查一次 stopSignal
    async function sleepWithStop(ms) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            if (State.stopSignal) return;
            await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())));
        }
    }

    // [BUG-01] 动态获取当前 wiki 的模板命名空间所有别名（ID=10）
    function getTemplateNamespacePrefixes() {
        const nsIds = mw.config.get('wgNamespaceIds');
        return Object.keys(nsIds)
            .filter(k => nsIds[k] === 10)
            .map(k => k.toLowerCase().replace(/_/g, ' '));
    }

    // =========================================================
    //  FLUENT DESIGN STYLES
    // =========================================================
    function addGlobalStyles() {
        if (document.getElementById('mw-batch-tool-styles')) return;
        const style = document.createElement('style');
        style.id = 'mw-batch-tool-styles';

        const lightVars = `--fd-bg-acrylic: rgba(243, 243, 243, 0.85); --fd-bg-header: rgba(225, 225, 225, 0.78); --fd-bg-tabs: rgba(235, 235, 235, 0.7); --fd-text-primary: rgba(0, 0, 0, 0.9); --fd-text-secondary: rgba(0, 0, 0, 0.6); --fd-border-light: rgba(0, 0, 0, 0.08); --fd-btn-bg: rgba(0, 0, 0, 0.04); --fd-btn-hover: rgba(0, 0, 0, 0.18); --fd-input-bg: rgba(255, 255, 255, 0.7); --fd-input-border: rgba(0, 0, 0, 0.2); --fd-accent: #0078d4; --fd-accent-hover: #2b88d8; --fd-reveal-glow: rgba(0, 0, 0, 0.15); --fd-reveal-border: rgba(0, 0, 0, 0.30); --fd-modal-bg: rgba(243, 243, 243, 0.95); --fd-scrollbar: rgba(0, 0, 0, 0.2); --fd-success: #107c10; --fd-warning: #d83b01; --fd-error: #e81123; --fd-shimmer-bg: rgba(0, 0, 0, 0.06); --fd-panel-bg: rgba(0, 0, 0, 0.025); --fd-log-bg: rgba(255, 255, 255, 0.6);`;
        const darkVars = `--fd-bg-acrylic: rgba(25, 25, 28, 0.94); --fd-bg-header: rgba(8, 16, 42, 0.78); --fd-bg-tabs: rgba(18, 18, 22, 0.7); --fd-text-primary: rgba(255, 255, 255, 0.88); --fd-text-secondary: rgba(255, 255, 255, 0.45); --fd-border-light: rgba(255, 255, 255, 0.07); --fd-btn-bg: rgba(255, 255, 255, 0.055); --fd-btn-hover: rgba(255, 255, 255, 0.25); --fd-input-bg: rgba(255, 255, 255, 0.04); --fd-input-border: rgba(255, 255, 255, 0.09); --fd-accent: #0078d4; --fd-accent-hover: #1484d6; --fd-reveal-glow: rgba(255, 255, 255, 0.25); --fd-reveal-border: rgba(255, 255, 255, 0.50); --fd-modal-bg: rgba(28, 28, 33, 0.97); --fd-scrollbar: rgba(255, 255, 255, 0.18); --fd-success: #6fcf97; --fd-warning: #f2c94c; --fd-error: #ff7675; --fd-shimmer-bg: rgba(255, 255, 255, 0.08); --fd-panel-bg: rgba(255, 255, 255, 0.025); --fd-log-bg: rgba(0, 0, 0, 0.32);`;

        style.textContent = `
:root, html.skin-theme-clientpref-light { ${lightVars} }
@media (prefers-color-scheme: dark) { :root { ${darkVars} } }
html.skin-theme-clientpref-night { ${darkVars} }
#mw-batch-tool-btn { position: fixed; z-index: 9990 !important; height: 52px; width: 52px; border-radius: 4px; background: var(--fd-accent); color: #fff; cursor: pointer; box-shadow: 0 4px 20px rgba(0,120,212,0.55), 0 2px 6px rgba(0,0,0,0.4); user-select: none; border: none; display: flex !important; align-items: center; justify-content: center; transition: width 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.12s ease, background 0.1s ease; overflow: hidden; touch-action: none; }
#mw-batch-tool-btn:hover { background: var(--fd-accent-hover); box-shadow: 0 8px 28px rgba(0,120,212,0.65), 0 4px 10px rgba(0,0,0,0.4); }
#mw-batch-tool-btn:active { transform: scale(0.96); box-shadow: 0 2px 8px rgba(0,120,212,0.4); transition: transform 0.1s, box-shadow 0.1s; }
#mw-batch-tool-btn::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle 42px at var(--rx,50%) var(--ry,50%), rgba(255,255,255,0.28) 0%, transparent 100%); opacity: 0; transition: opacity 0.15s; pointer-events: none; z-index: 1;}
#mw-batch-tool-btn.reveal-active::before { opacity: 1; }
@keyframes min-badge-pulse { 0% { box-shadow: 0 0 0 0 rgba(111, 207, 151, 0.8); } 70% { box-shadow: 0 0 0 6px rgba(111, 207, 151, 0); } 100% { box-shadow: 0 0 0 0 rgba(111, 207, 151, 0); } }
#mw-batch-tool-btn.is-minimized:not(.is-expanded)::after { content: ''; position: absolute; top: 10px; right: 10px; width: 10px; height: 10px; background: #6fcf97; border-radius: 50%; z-index: 3; pointer-events: none; border: 2px solid var(--fd-accent); box-sizing: border-box; animation: min-badge-pulse 2s infinite; }
.fab-content { display: flex; align-items: center; width: 100%; height: 100%; position: relative; z-index: 2; justify-content: center; box-sizing: border-box; }
.fab-icon { font-size: 22px; line-height: 1; flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin: 0; padding: 0; }
.fab-text { font-size: 13px; font-weight: 600; font-family: 'Segoe UI', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; opacity: 0; width: 0; display: none; transition: opacity 0.2s, width 0.3s; }
.fab-progress-fill { position: absolute; bottom: 0; left: 0; height: 4px; background: rgba(255,255,255,0.9); width: 0%; transition: width 0.3s; z-index: 1; border-radius: 0 0 0 4px; }
#mw-batch-tool-btn.is-expanded { width: 200px; justify-content: flex-start; }
#mw-batch-tool-btn.is-expanded .fab-content { justify-content: flex-start; padding-left: 14px; gap: 12px; }
#mw-batch-tool-btn.is-expanded .fab-text { opacity: 1; width: 140px; flex: 1; display: block; }
#mw-batch-tool-btn.is-expanded .fab-progress-fill { border-radius: 0 0 4px 4px; }
#mw-batch-tool-window { position: fixed; top: 8%; left: 0; right: 0; margin: 0 auto; width: 900px; min-width: 480px; min-height: 400px; max-width: 98vw; max-height: 94vh; background: var(--fd-bg-acrylic); backdrop-filter: blur(48px) saturate(160%); -webkit-backdrop-filter: blur(48px) saturate(160%); border-radius: 4px; box-shadow: 0 48px 96px rgba(0,0,0,0.4), 0 12px 28px rgba(0,0,0,0.25), 0 0 0 1px var(--fd-border-light), inset 0 1px 0 rgba(255,255,255,0.06); z-index: 9990; display: none; flex-direction: column; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 13px; color: var(--fd-text-primary); overflow: hidden; transform-origin: top left; }
#mw-batch-tool-window .tool-header { padding: 10px 18px; background: var(--fd-bg-header); border-bottom: 1px solid var(--fd-border-light); font-weight: 600; font-size: 13px; cursor: move; display: flex; justify-content: space-between; align-items: center; position: relative; overflow: hidden; flex-shrink: 0; touch-action: none; }
#mw-batch-tool-window .tool-header-title { display: flex; align-items: center; gap: 10px; color: var(--fd-text-primary); pointer-events: none; }
#mw-batch-tool-window .tool-header-ver { font-size: 10.5px; font-weight: 400; color: var(--fd-text-secondary); margin-left: 6px; }
#mw-batch-tool-window .tool-header-controls { display: flex; gap: 2px; }
#mw-batch-tool-window .tool-ctrl-btn { width: 34px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 2px; font-size: 12px; color: var(--fd-text-secondary); transition: background 0.1s, color 0.1s; z-index: 1; flex-shrink: 0; }
#mw-batch-tool-window .tool-ctrl-btn:hover { background: var(--fd-btn-hover); color: var(--fd-text-primary); }
#mw-batch-tool-window .tool-ctrl-btn.close-btn:hover { background: #e81123; color: #fff; }
#mw-batch-tool-window .tool-tabs { display: flex; background: var(--fd-bg-tabs); border-bottom: 1px solid var(--fd-border-light); padding: 0 8px; gap: 2px; position: relative; flex-shrink: 0; overflow-x: auto; scrollbar-width: none; }
#mw-batch-tool-window .tool-tab { padding: 10px 18px 9px; cursor: pointer; color: var(--fd-text-secondary); font-size: 12.5px; border-radius: 3px 3px 0 0; position: relative; overflow: hidden; transition: color 0.18s; border-bottom: 2px solid transparent; white-space: nowrap; flex-shrink: 0; }
#mw-batch-tool-window .tool-tab:hover, #mw-batch-tool-window .tool-tab.active { color: var(--fd-text-primary); }
#mw-batch-tool-window .tool-tab.active { font-weight: 600; border-bottom: 2px solid var(--fd-accent); }
#tab-slide-indicator { position: absolute; bottom: 0; left: 0; height: 2px; background: var(--fd-accent); box-shadow: 0 0 6px rgba(0,120,212,0.7); transition: left 0.26s cubic-bezier(0.15,0.85,0.45,1), width 0.26s cubic-bezier(0.15,0.85,0.45,1); pointer-events: none; }
#mw-batch-tool-window .tool-body { padding: 18px 20px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; scrollbar-width: thin; scrollbar-color: var(--fd-scrollbar) transparent; position: relative; min-height: 0; }
#mw-batch-tool-window .tool-body::-webkit-scrollbar, #modal-overlay ::-webkit-scrollbar { width: 5px; }
#mw-batch-tool-window .tool-body::-webkit-scrollbar-thumb, #modal-overlay ::-webkit-scrollbar-thumb { background: var(--fd-scrollbar); border-radius: 3px; }
#mw-batch-tool-window .tab-content { display: none; flex-direction: column; flex: 1; }
#mw-batch-tool-window .tab-content.active { display: flex; }
@keyframes fluent-in-from-right { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: translateX(0); } }
@keyframes fluent-in-from-left { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: translateX(0); } }
#mw-batch-tool-window .tab-content.anim-in-right { animation: fluent-in-from-right 0.24s cubic-bezier(0.15,0.85,0.45,1) both; }
#mw-batch-tool-window .tab-content.anim-in-left  { animation: fluent-in-from-left  0.24s cubic-bezier(0.15,0.85,0.45,1) both; }
.fluid-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 10px; }
.fluid-flex-wrap { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; }
#mw-batch-tool-window .list-util-bar, #modal-overlay .list-util-bar { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#mw-batch-tool-window textarea.tool-textarea, #mw-batch-tool-window .tool-input, #modal-overlay textarea.tool-textarea, #modal-overlay .tool-input { width: 100%; padding: 7px 10px; background: var(--fd-input-bg); border: 1px solid var(--fd-input-border); border-radius: 2px; color: var(--fd-text-primary); font-size: 13px; font-family: 'Segoe UI',sans-serif; margin-bottom: 10px; outline: none; transition: border-color 0.15s, box-shadow 0.15s; box-sizing: border-box; }
#mw-batch-tool-window textarea.tool-textarea, #modal-overlay textarea.tool-textarea { flex: 1; min-height: 120px; font-family: 'Cascadia Code',monospace; resize: vertical; }
#mw-batch-tool-window textarea.tool-textarea:focus, #mw-batch-tool-window .tool-input:focus, #modal-overlay textarea.tool-textarea:focus, #modal-overlay .tool-input:focus { border-color: var(--fd-accent); box-shadow: 0 0 0 1px var(--fd-accent) inset; }
#mw-batch-tool-window .mw-ui-button, #modal-overlay .mw-ui-button, #mw-batch-tool-window .list-util-btn, #modal-overlay .list-util-btn { cursor: pointer; font-weight: 600; font-family: 'Segoe UI',sans-serif; border-radius: 2px; border: 1px solid var(--fd-border-light); background: var(--fd-btn-bg); color: var(--fd-text-primary); display: inline-flex; align-items: center; justify-content: center; position: relative; overflow: hidden; transition: background 0.1s, transform 0.06s; box-sizing: border-box; }
#mw-batch-tool-window .mw-ui-button, #modal-overlay .mw-ui-button { padding: 0 16px; height: 32px; font-size: 12px; }
#mw-batch-tool-window .list-util-btn, #modal-overlay .list-util-btn { height: 24px; min-width: 50px; padding: 0 10px; font-size: 11px; }
#mw-batch-tool-window .mw-ui-button:hover, #mw-batch-tool-window .list-util-btn:hover, #modal-overlay .mw-ui-button:hover, #modal-overlay .list-util-btn:hover { background: var(--fd-btn-hover); }
#mw-batch-tool-window .mw-ui-button:active, #mw-batch-tool-window .list-util-btn:active, #modal-overlay .mw-ui-button:active, #modal-overlay .list-util-btn:active { transform: scale(0.965); }
.fluent-reveal-layer { position: absolute; inset: 0; opacity: 0; transition: opacity 0.13s; pointer-events: none; background: radial-gradient(circle 80px at var(--rx,50%) var(--ry,50%), var(--fd-reveal-glow) 0%, transparent 100%); }
.mw-ui-button:hover .fluent-reveal-layer, .list-util-btn:hover .fluent-reveal-layer, .tool-tab:hover .fluent-reveal-layer { opacity: 1; }
#mw-batch-tool-window .mw-ui-progressive, #modal-overlay .mw-ui-progressive { background: var(--fd-accent) !important; color: #fff !important; border-color: transparent !important; }
#mw-batch-tool-window .mw-ui-progressive:hover, #modal-overlay .mw-ui-progressive:hover { background: var(--fd-accent-hover) !important; }
#mw-batch-tool-window .mw-ui-destructive, #modal-overlay .mw-ui-destructive { background: var(--fd-error) !important; color: #fff !important; border-color: transparent !important; }
#mw-batch-tool-window .mw-ui-destructive:hover, #modal-overlay .mw-ui-destructive:hover { filter: brightness(0.9); }
#mw-batch-tool-window .filter-section, #modal-overlay .filter-section { border: 1px solid var(--fd-border-light); padding: 14px; border-radius: 2px; background: var(--fd-panel-bg); margin-bottom: 12px; display: flex; flex-direction: column; }
#mw-batch-tool-window .filter-label, #modal-overlay .filter-label { font-size: 11px; font-weight: 600; margin-bottom: 8px; display: block; color: var(--fd-text-secondary); text-transform: uppercase; }
#mw-batch-tool-window .input-hint, #modal-overlay .input-hint { font-size: 10px; color: var(--fd-error); font-weight: 400; margin-left: 5px; text-transform: none; }
#mw-batch-tool-window .tool-btn-group, #modal-overlay .tool-btn-group { display: flex; flex-wrap: wrap; gap: 7px; margin-top: auto; }
#mw-batch-tool-window .tool-btn-group .mw-ui-button { flex: 1 1 120px; }
#mw-batch-tool-window .fluent-divider, #modal-overlay .fluent-divider { height: 1px; background: var(--fd-border-light); margin: 14px 0; width: 100%; }
#mw-batch-tool-window .options-bar { background: var(--fd-panel-bg); border: 1px solid var(--fd-border-light); padding: 11px 14px; border-radius: 2px; display: flex; gap: 20px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; font-size: 12.5px; }
#mw-batch-tool-window .options-bar label { color: var(--fd-text-primary); cursor: pointer; display: flex; align-items: center; gap: 6px; }
#mw-batch-tool-window .options-bar input[type=checkbox] { accent-color: var(--fd-accent); }
#mw-batch-tool-window .options-bar .bot-label { color: var(--fd-accent); font-weight: 600; }
@keyframes modal-fluent-open { from { opacity: 0; transform: translateY(14px) scale(0.975); } to { opacity: 1; transform: translateY(0) scale(1); } }
#modal-overlay { display: none; position: fixed; z-index: 99995; left: 0; top: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.52); backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px); align-items: center; justify-content: center; }
#modal-box { background: var(--fd-modal-bg); backdrop-filter: blur(40px) saturate(160%); -webkit-backdrop-filter: blur(40px) saturate(160%); padding: 28px; border-radius: 4px; width: 570px; max-width: 92%; position: relative; color: var(--fd-text-primary); box-shadow: 0 28px 64px rgba(0,0,0,0.6), 0 0 0 1px var(--fd-border-light); animation: modal-fluent-open 0.22s cubic-bezier(0.15,0.85,0.45,1) both; }
#mw-batch-tool-window #status-area, #modal-overlay #status-area { margin-top: auto; padding-top: 16px; display: none; }
#mw-batch-tool-window #progress-text, #modal-overlay #progress-text { text-align: center; font-size: 11px; color: var(--fd-text-secondary); margin-bottom: 6px; }
#mw-batch-tool-window .progress-container, #modal-overlay .progress-container { height: 2px; background: var(--fd-shimmer-bg); margin: 12px 0 8px; border-radius: 1px; overflow: hidden; }
#mw-batch-tool-window .progress-bar, #modal-overlay .progress-bar { height: 100%; background: var(--fd-accent); width: 0%; transition: width 0.32s; border-radius: 1px; box-shadow: 0 0 8px rgba(0,120,212,0.5); position: relative; }
.progress-bar.shimmer { background: linear-gradient(90deg, var(--fd-accent) 25%, #60b5f9 50%, var(--fd-accent) 75%); background-size: 200% 100%; animation: fluent-shimmer 1.5s linear infinite; }
@keyframes fluent-shimmer { from { background-position: -200% 0; } to { background-position: 200% 0; } }
#mw-batch-tool-window #deletion-results, #modal-overlay #deletion-results { height: 160px; resize: vertical; overflow-y: auto; border: 1px solid var(--fd-border-light); padding: 10px 12px; font-size: 11.5px; background: var(--fd-log-bg); margin-top: 8px; line-height: 1.75; font-family: 'Cascadia Code',monospace; border-radius: 2px; color: var(--fd-text-primary); }
#mw-batch-tool-window #btn-pause, #modal-overlay #btn-pause { background: var(--fd-warning) !important; color: #fff !important; }
#mw-batch-tool-window .cleanup-option, #modal-overlay .cleanup-option { font-size: 12.5px; display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--fd-text-primary); margin-bottom: 8px; }
#mw-batch-tool-window .cleanup-option input[type=checkbox], #modal-overlay .cleanup-option input[type=checkbox] { accent-color: var(--fd-accent); cursor: pointer; }
#mw-batch-tool-window .sub-option, #modal-overlay .sub-option { margin-left: 22px; margin-top: -4px; margin-bottom: 10px; border-left: 2px solid var(--fd-border-light); padding-left: 12px; }
#mw-batch-tool-window #export-log-btn, #modal-overlay #export-log-btn { font-size: 11px; color: var(--fd-accent); text-decoration: none; font-weight: 600; }
#mw-batch-tool-window .section-label-row, #modal-overlay .section-label-row { margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
#mw-batch-tool-window .section-label, #modal-overlay .section-label { font-weight: 600; font-size: 11px; color: var(--fd-text-secondary); text-transform: uppercase; }
#modal-overlay .modal-title-text { font-weight: 700; font-size: 17px; color: var(--fd-error); margin-bottom: 14px; border-bottom: 1px solid var(--fd-border-light); padding-bottom: 12px; }
.fluent-resizer { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; z-index: 99990; touch-action: none; }
.fluent-resizer::after { content: ''; position: absolute; right: 5px; bottom: 5px; width: 6px; height: 6px; border-right: 2px solid var(--fd-text-secondary); border-bottom: 2px solid var(--fd-text-secondary); pointer-events: none; opacity: 0.6; }
`;
        document.head.appendChild(style);
    }

    // =========================================================
    //  DOM ENGINE & HELPERS
    // =========================================================
    function applyRevealToButtons(container) {
        container.querySelectorAll('.mw-ui-button, .list-util-btn, .tool-tab').forEach(btn => {
            if (btn.querySelector('.fluent-reveal-layer')) return;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '';
            const layer = document.createElement('div');
            layer.className = 'fluent-reveal-layer';
            const textSpan = document.createElement('span');
            textSpan.className = 'fluent-btn-text';
            textSpan.style.cssText = 'position:relative; z-index:1; pointer-events:none; display:flex; align-items:center; gap:6px;';
            textSpan.innerHTML = originalHTML;
            btn.append(layer, textSpan);
            if (!btn._revealBound) {
                btn._revealBound = true;
                const updateGlow = (clientX, clientY) => {
                    const r = btn.getBoundingClientRect();
                    btn.style.setProperty('--rx', (clientX - r.left) + 'px');
                    btn.style.setProperty('--ry', (clientY - r.top) + 'px');
                };
                btn.addEventListener('mousemove', e => { updateGlow(e.clientX, e.clientY); btn.classList.add('reveal-active'); });
                btn.addEventListener('mouseleave', () => btn.classList.remove('reveal-active'));
                btn.addEventListener('touchstart', e => { updateGlow(e.touches[0].clientX, e.touches[0].clientY); btn.classList.add('reveal-active'); }, { passive: true });
                btn.addEventListener('touchmove', e => updateGlow(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
                btn.addEventListener('touchend', () => btn.classList.remove('reveal-active'));
            }
        });
    }

    function uiLog(msg, type = 'success') {
        const logArea = document.getElementById('deletion-results');
        const cMap = { success: 'var(--fd-success)', error: 'var(--fd-error)', warning: 'var(--fd-warning)', info: 'var(--fd-accent)' };
        const iMap = { success: '[✓]', error: '[✗]', warning: '[!]', info: '[i]' };
        logArea.insertAdjacentHTML('beforeend', `<div style="color:${cMap[type] || cMap.info}">${iMap[type] || iMap.info} ${escapeHTML(msg)}</div>`);
        logArea.scrollTop = logArea.scrollHeight;
    }

    function uiProgress(pct, text) {
        document.getElementById('progress-bar').style.width = pct + '%';
        document.getElementById('progress-text').innerText = text;
        updateDynamicIsland(State.isRunning, pct, text);
    }

    // [BUG-05] 修复：任务期间强制移动悬浮球位置后，任务结束可恢复原始位置
    function updateDynamicIsland(isActive, pct = 0, text = '') {
        const fab = document.getElementById('mw-batch-tool-btn');
        if (!fab) return;
        const fabText = fab.querySelector('.fab-text');
        const fabBar  = fab.querySelector('.fab-progress-fill');

        if (isActive) {
            fab.classList.remove('is-minimized');
            if (!fab.classList.contains('is-expanded')) {
                fab.classList.add('is-expanded');
                const rect = fab.getBoundingClientRect();
                if (rect.left > window.innerWidth - 220) {
                    // 仅首次移动时保存原始位置
                    if (!State._fabWasMoved) {
                        State._fabOrigLeft   = fab.style.left;
                        State._fabOrigTop    = fab.style.top;
                        State._fabOrigRight  = fab.style.right;
                        State._fabOrigBottom = fab.style.bottom;
                        State._fabWasMoved = true;
                    }
                    fab.style.top    = rect.top + 'px';
                    fab.style.right  = 'auto';
                    fab.style.bottom = 'auto';
                    fab.style.left   = Math.max(0, window.innerWidth - 220) + 'px';
                }
            }
            if (fabText) {
                fabText.style.display = 'block';
                const label = text.length > 24 ? text.substring(0, 24) + '…' : text;
                fabText.innerText = `${pct}% - ${label}`;
            }
            if (fabBar) fabBar.style.width = pct + '%';
        } else {
            fab.classList.remove('is-expanded');
            // 恢复被程序修改的悬浮球原始位置
            if (State._fabWasMoved) {
                fab.style.left   = State._fabOrigLeft;
                fab.style.top    = State._fabOrigTop;
                fab.style.right  = State._fabOrigRight;
                fab.style.bottom = State._fabOrigBottom;
                State._fabWasMoved = false;
            }
            if (fabBar) fabBar.style.width = '0%';
            setTimeout(() => { if (fabText && !State.isRunning) fabText.style.display = 'none'; }, 300);
        }
    }

    function clampFabPosition() {
        const btn = document.getElementById('mw-batch-tool-btn');
        if (!btn) return;
        if (!btn.style.left && btn.style.right) {
            const rect = btn.getBoundingClientRect();
            btn.style.left   = rect.left + 'px';
            btn.style.top    = rect.top  + 'px';
            btn.style.right  = 'auto';
            btn.style.bottom = 'auto';
        }
        const w = btn.offsetWidth  || 52;
        const h = btn.offsetHeight || 52;
        const maxLeft = Math.max(0, window.innerWidth  - w);
        const maxTop  = Math.max(0, window.innerHeight - h);
        const currentLeft = parseFloat(btn.style.left);
        const currentTop  = parseFloat(btn.style.top);
        if (!isNaN(currentLeft)) btn.style.left = Math.max(0, Math.min(currentLeft, maxLeft)) + 'px';
        if (!isNaN(currentTop))  btn.style.top  = Math.max(0, Math.min(currentTop,  maxTop))  + 'px';
    }

    function createFloatingButton() {
        if (State.btnCreated) return;
        State.btnCreated = true;
        const btn = document.createElement('div');
        btn.id = 'mw-batch-tool-btn';
        btn.innerHTML = `<div class="fab-content"><span class="fab-icon">🔨</span><span class="fab-text"></span></div><div class="fab-progress-fill"></div>`;
        try {
            const storedPos = localStorage.getItem('mw-batch-btn-pos');
            if (storedPos) {
                const pos = JSON.parse(storedPos);
                btn.style.left   = pos.left; btn.style.top = pos.top;
                btn.style.right  = 'auto';   btn.style.bottom = 'auto';
            } else { btn.style.right = '25px'; btn.style.bottom = '80px'; }
        } catch (e) {
            localStorage.removeItem('mw-batch-btn-pos');
            btn.style.right = '25px'; btn.style.bottom = '80px';
        }
        if (State.lastHiddenMode === 'minimized') btn.classList.add('is-minimized');
        document.body.appendChild(btn);

        requestAnimationFrame(clampFabPosition);
        if (!State.resizeBound) { window.addEventListener('resize', clampFabPosition); State.resizeBound = true; }

        const updateGlow = (clientX, clientY) => {
            const r = btn.getBoundingClientRect();
            btn.style.setProperty('--rx', (clientX - r.left) + 'px');
            btn.style.setProperty('--ry', (clientY - r.top)  + 'px');
        };

        let isDragging = false, startX, startY, startLeft, startTop;
        const onMove = (e) => {
            const clientX = e.clientX ?? e.touches[0].clientX;
            const clientY = e.clientY ?? e.touches[0].clientY;
            const dx = clientX - startX, dy = clientY - startY;
            if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 5) {
                isDragging = true; btn.style.right = 'auto'; btn.style.bottom = 'auto';
            }
            if (isDragging) {
                e.preventDefault();
                const maxLeft = Math.max(0, window.innerWidth  - btn.offsetWidth);
                const maxTop  = Math.max(0, window.innerHeight - btn.offsetHeight);
                btn.style.left = Math.max(0, Math.min(startLeft + dx, maxLeft)) + 'px';
                btn.style.top  = Math.max(0, Math.min(startTop  + dy, maxTop))  + 'px';
            }
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
            if (!isDragging) toggleWindow();
            else {
                try { localStorage.setItem('mw-batch-btn-pos', JSON.stringify({ left: btn.style.left, top: btn.style.top })); } catch (e) { }
                // [BUG-05] 用户手动拖拽后重置保存的原始位置（以新位置为基准）
                if (State._fabWasMoved) {
                    State._fabOrigLeft   = btn.style.left;
                    State._fabOrigTop    = btn.style.top;
                    State._fabOrigRight  = 'auto';
                    State._fabOrigBottom = 'auto';
                }
            }
            setTimeout(() => isDragging = false, 50);
            btn.classList.remove('reveal-active');
        };

        const onDown = (e) => {
            startX = e.clientX ?? e.touches[0].clientX; startY = e.clientY ?? e.touches[0].clientY;
            const rect = btn.getBoundingClientRect();
            startLeft = rect.left; startTop = rect.top;
            isDragging = false;
            updateGlow(startX, startY); btn.classList.add('reveal-active');
            document.addEventListener('mousemove', onMove, { passive: false }); document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
        };
        btn.addEventListener('mousedown', onDown);
        btn.addEventListener('touchstart', onDown, { passive: false });
    }

    function toggleWindow() {
        const win = document.getElementById('mw-batch-tool-window');
        if (win.style.display === 'none' || win.style.display === '') restoreWindow(); else minimizeWindow();
    }

    function restoreWindow() {
        const win = document.getElementById('mw-batch-tool-window');
        const btn = document.getElementById('mw-batch-tool-btn');
        if (win.style.display !== 'none' && win.style.display !== '') return;
        btn.classList.remove('is-minimized');
        win.style.opacity = '0'; win.style.display = 'flex';
        win.getAnimations().forEach(a => a.cancel());

        if (State.lastHiddenMode === 'minimized') {
            win.style.transformOrigin = 'top left';
            const winRect = win.getBoundingClientRect(), btnRect = btn.getBoundingClientRect();
            win.style.opacity = '';
            const tx = btnRect.left - winRect.left, ty = btnRect.top - winRect.top;
            const sx = btnRect.width / winRect.width, sy = btnRect.height / winRect.height;
            win.animate([
                { opacity: 0, transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`, borderRadius: '4px' },
                { opacity: 1, transform: `translate(0, 0) scale(1)`, borderRadius: '4px' }
            ], { duration: 250, easing: 'cubic-bezier(0.15, 0.85, 0.3, 1)' });
        } else {
            win.style.transformOrigin = 'center center';
            win.style.opacity = '';
            win.animate([{ opacity: 0, transform: `scale(0.96)` }, { opacity: 1, transform: `scale(1)` }], { duration: 150, easing: 'ease-out' });
        }
        requestAnimationFrame(() => updateTabIndicator(currentTabIdx));
    }

    function minimizeWindow() {
        const win = document.getElementById('mw-batch-tool-window');
        const btn = document.getElementById('mw-batch-tool-btn');
        if (win.style.display === 'none') return;
        State.lastHiddenMode = 'minimized'; btn.classList.add('is-minimized');
        win.getAnimations().forEach(a => a.cancel()); win.style.transformOrigin = 'top left';
        const winRect = win.getBoundingClientRect(), btnRect = btn.getBoundingClientRect();
        const tx = btnRect.left - winRect.left, ty = btnRect.top - winRect.top;
        const sx = btnRect.width / winRect.width, sy = btnRect.height / winRect.height;

        const anim = win.animate([
            { opacity: 1, transform: `translate(0, 0) scale(1)`, borderRadius: '4px' },
            { opacity: 0, transform: `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`, borderRadius: '4px' }
        ], { duration: 250, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)', fill: 'forwards' });
        anim.onfinish = () => { win.style.display = 'none'; anim.cancel(); };
    }

    function closeWindow() {
        if (State.isRunning) {
            if (!confirm('⚠ 任务正在执行中！\n强制关闭将终止当前任务并断开网络连接。\n是否确认强行关闭？')) return;
            State.stopSignal = true;
        }
        const win = document.getElementById('mw-batch-tool-window');
        const btn = document.getElementById('mw-batch-tool-btn');
        if (win.style.display === 'none') return;
        State.lastHiddenMode = 'closed'; btn.classList.remove('is-minimized');
        win.getAnimations().forEach(a => a.cancel()); win.style.transformOrigin = 'center center';

        const anim = win.animate([
            { opacity: 1, transform: `scale(1)` }, { opacity: 0, transform: `scale(0.96)` }
        ], { duration: 150, easing: 'ease-out', fill: 'forwards' });
        anim.onfinish = () => { win.style.display = 'none'; anim.cancel(); };
    }

    // =========================================================
    //  CORE API HELPERS
    // =========================================================
    function getBotParam(type) {
        if (!document.getElementById('global-bot-mode')?.checked) return {};
        return (type === 'rollback') ? { markbot: 1 } : { bot: 1 };
    }

    function unifyApiError(code, result) {
        let errCode = 'unknown';
        let errInfo = '未知错误';
        let xhr = null;

        if (code && typeof code.getResponseHeader === 'function') {
            xhr = code;
            errCode = 'http';
            errInfo = `HTTP ${code.status}: ${code.statusText}`;
        } else if (typeof code === 'string') {
            errCode = code;
            errInfo = result?.error?.info || result?.info || code;
            if (result && result.xhr) xhr = result.xhr;
        } else if (code && code.status !== undefined) {
            errCode = 'http';
            errInfo = `HTTP ${code.status}: ${code.statusText}`;
            xhr = code;
        } else if (code && code.code) {
            errCode = code.code;
            errInfo = code.info || code.message || errCode;
        }
        return { code: errCode, info: errInfo, xhr: xhr, result: result };
    }

    async function mwApiPost(params, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const req = api.post(Object.assign({ format: 'json', maxlag: 5 }, params));
            const timer = setTimeout(() => {
                if (typeof req.abort === 'function') req.abort();
                reject({ code: 'timeout', info: '网络请求超时 (30s)' });
            }, timeout);

            req.done(res => {
                clearTimeout(timer); resolve(res);
            }).fail((code, result, jqXHR) => {
                clearTimeout(timer);
                if (jqXHR && typeof jqXHR.getResponseHeader === 'function') {
                    if (!result) result = { xhr: jqXHR };
                    else if (typeof result === 'object' && !result.xhr) result.xhr = jqXHR;
                } else if (code && typeof code.getResponseHeader === 'function') {
                    if (!result) result = { xhr: code };
                }
                reject(unifyApiError(code, result));
            });
        });
    }

    async function mwApiPostWithToken(tokenType, params, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const req = api.postWithToken(tokenType, Object.assign({ format: 'json', maxlag: 5 }, params));
            const timer = setTimeout(() => {
                if (typeof req.abort === 'function') req.abort();
                reject({ code: 'timeout', info: '网络请求超时 (30s)' });
            }, timeout);

            req.done(res => {
                clearTimeout(timer); resolve(res);
            }).fail((code, result, jqXHR) => {
                clearTimeout(timer);
                if (jqXHR && typeof jqXHR.getResponseHeader === 'function') {
                    if (!result) result = { xhr: jqXHR };
                    else if (typeof result === 'object' && !result.xhr) result.xhr = jqXHR;
                } else if (code && typeof code.getResponseHeader === 'function') {
                    if (!result) result = { xhr: code };
                }
                reject(unifyApiError(code, result));
            });
        });
    }

    // [BUG-02] 修复：在循环内检查 stopSignal，长时间拉取可被中断
    async function apiQueryAll(params, mapFn) {
        let resArr = [], cont = {}, iter = 0, lastContStr = '';
        while (iter++ < 3000) {
            if (State.stopSignal) break; // [BUG-02] 检查停止信号
            try {
                const reqParams = Object.assign({ action: 'query' }, params);
                Object.keys(cont).forEach(k => { reqParams[k] = cont[k]; });

                const res = await mwApiPost(reqParams);
                if (!res?.query) break;
                resArr = resArr.concat((res.query[params.list] || []).map(mapFn));
                if (!res.continue) break;
                const currentContStr = JSON.stringify(res.continue);
                if (currentContStr === lastContStr) break;
                lastContStr = currentContStr;
                cont = res.continue;
            } catch (e) {
                if (e.code === 'maxlag' || e.code === 'ratelimited') {
                    console.warn(`[Batch Tool] apiQueryAll 命中限速 (${e.code})，等待 5 秒...`);
                    await sleepWithStop(5000); // [BUG-02] 限速等待也可中断
                    if (State.stopSignal) break;
                    iter--;
                    continue;
                }
                console.error('API Error in apiQueryAll:', e);
                break;
            }
        }
        if (iter >= 3000) mw.notify('API 拉取达到最大限制保护，数据可能被截断', { type: 'warn' });
        return resArr;
    }

    function expandList(list) {
        const syncTalk = document.getElementById('sync-to-talk')?.checked;
        const syncSubj = document.getElementById('sync-to-subj')?.checked;
        if (!syncTalk && !syncSubj) return list;

        const expanded = [];
        const seen = new Set();
        for (const title of list) {
            if (!seen.has(title)) { seen.add(title); expanded.push(title); }
            const tObj = mw.Title.newFromText(title);
            if (!tObj) continue;

            if (syncTalk && !tObj.isTalkPage()) {
                const talkPage = tObj.getTalkPage();
                if (talkPage) {
                    const t = talkPage.getPrefixedText();
                    if (!seen.has(t)) { seen.add(t); expanded.push(t); }
                }
            }
            if (syncSubj && tObj.isTalkPage()) {
                const subjPage = tObj.getSubjectPage();
                if (subjPage) {
                    const t = subjPage.getPrefixedText();
                    if (!seen.has(t)) { seen.add(t); expanded.push(t); }
                }
            }
        }
        return expanded;
    }

    function createToolWindow() {
        const win = document.createElement('div'); win.id = 'mw-batch-tool-window';
        let nsOptions = `<option value="ALL">— 全部命名空间 —</option>`;
        Object.entries(siteNamespaces).forEach(([id, name]) => { nsOptions += `<option value="${id}">${name || '(主空间)'}</option>`; });

        win.innerHTML = `
<div class="tool-header" id="mw-tool-drag-handle">
    <div class="tool-header-title"><span class="tool-header-icon">🔨</span>批量管理工具<span class="tool-header-ver">v20.4 Fixed</span></div>
    <div class="tool-header-controls">
        <div class="tool-ctrl-btn" id="mw-batch-tool-min" title="最小化到悬浮球">─</div>
        <div class="tool-ctrl-btn close-btn" id="mw-batch-tool-close" title="强行关闭">✕</div>
    </div>
</div>
<div class="tool-tabs" id="tool-tabs-row">
    <div class="tool-tab active" data-tab="tab-import">1. 页面获取</div>
    <div class="tool-tab" data-tab="tab-filter">2. 智能筛选</div>
    <div class="tool-tab" data-tab="tab-edit">3. 内容编辑</div>
    <div class="tool-tab" data-tab="tab-basic">4. 执行操作/防御</div>
    <div id="tab-slide-indicator"></div>
</div>
<div class="tool-body">
    <div class="section-label-row">
        <span class="section-label">当前待处理列表</span>
        <div class="list-util-bar">
            <button class="list-util-btn" id="list-dedupe">去重</button>
            <button class="list-util-btn" id="list-sort">排序</button>
            <button class="list-util-btn mw-ui-destructive" id="list-clear">清空</button>
        </div>
    </div>
    <textarea id="pages-to-process" class="tool-textarea" placeholder="每行一个条目标题..."></textarea>
    <div id="tab-import" class="tab-content active">
        <div class="filter-section" style="margin-top:14px;">
            <label class="filter-label">命名空间过滤器</label>
            <select id="import-ns-select" class="tool-input" style="margin-bottom:0;">${nsOptions}</select>
        </div>
        <div class="tool-btn-group">
            <button class="mw-ui-button" id="btn-import-cat">分类导入</button>
            <button class="mw-ui-button" id="btn-import-pfx">前缀导入</button>
            <button class="mw-ui-button" id="btn-import-link">链入导入</button>
            <button class="mw-ui-button" id="btn-import-user">贡献导入 (换行分割 ID)</button>
            <button class="mw-ui-button" id="btn-import-recent">最近更改</button>
            <button class="mw-ui-button mw-ui-progressive" id="btn-import-regex">全站正则搜索</button>
        </div>
    </div>
    <div id="tab-filter" class="tab-content">
        <div class="fluid-grid">
            <div class="filter-section"><label class="filter-label">重定向过滤</label><select id="filter-redir-type" class="tool-input"><option value="all">不限</option><option value="only-redir">仅重定向</option><option value="no-redir">仅非重定向</option></select></div>
            <div class="filter-section"><label class="filter-label">字节数 (少于)</label><input type="number" id="filter-size-less" class="tool-input"></div>
            <div class="filter-section"><label class="filter-label">闲置天数 (超过最后一次编辑)</label><input type="number" id="filter-days-more" class="tool-input"></div>
            <div class="filter-section"><label class="filter-label">指定页面创建者</label><input type="text" id="filter-creator" class="tool-input"></div>
        </div>
        <button id="btn-do-filter" class="mw-ui-button mw-ui-progressive" style="width:100%; height:38px; margin-top:10px;">筛选列表（覆盖模式）</button>
    </div>
    <div id="tab-edit" class="tab-content">
        <div class="filter-section" style="margin-top:10px;">
            <label class="filter-label">批量插入内容</label>
            <div class="fluid-grid" style="margin-top:0;">
                <textarea id="edit-prepend-text" class="tool-textarea" style="min-height:50px; margin-bottom:10px;" placeholder="页首插入..."></textarea>
                <textarea id="edit-append-text"  class="tool-textarea" style="min-height:50px; margin-bottom:10px;" placeholder="页尾插入..."></textarea>
            </div>
            <button id="btn-do-edit" class="mw-ui-button mw-ui-progressive" style="width:100%;">执行双向修改</button>
        </div>
        <div class="fluid-grid">
            <div class="filter-section"><label class="filter-label">移除模板 <span class="input-hint">不含 {{}}，安全模式</span></label>
                <input type="text" id="rm-template-name" class="tool-input"><button id="btn-rm-template" class="mw-ui-button" style="width:100%;">安全移除指定模板</button>
            </div>
            <div class="filter-section"><label class="filter-label">移除分类 <span class="input-hint">不含 [[]] 及 Category: / 分类:</span></label>
                <input type="text" id="rm-category-name" class="tool-input"><button id="btn-rm-category" class="mw-ui-button" style="width:100%;">移除指定分类</button>
            </div>
        </div>
    </div>
    <div id="tab-basic" class="tab-content">
        <div class="options-bar">
            <label><input type="checkbox" id="sync-to-talk"> 关联处理讨论页</label>
            <label><input type="checkbox" id="sync-to-subj"> 关联处理主条目</label>
            <label class="bot-label"><input type="checkbox" id="global-bot-mode"> 🤖 机器人模式（隐藏记录）</label>
        </div>
        <div class="fluid-flex-wrap" style="margin-bottom:14px;">
            <div style="flex: 1 1 240px;"><label class="filter-label">操作理由 (Summary)</label><input type="text" id="common-reason" value="批量站务处理" class="tool-input" style="margin-bottom:0;"></div>
            <div style="flex: 1 1 100px;"><label class="filter-label">速率 (秒/条)</label><input type="number" id="process-rate" value="1.0" step="0.1" min="0" class="tool-input" style="margin-bottom:0;"></div>
        </div>
        <div class="fluent-divider"></div>
        <div class="tool-btn-group">
            <button id="btn-start-delete" class="mw-ui-button mw-ui-destructive">批量删除页面</button>
            <button id="btn-undelete" class="mw-ui-button">批量恢复页面</button>
            <button id="btn-batch-protect" class="mw-ui-button">批量保护页面</button>
        </div>
        <div style="margin-top:10px;">
            <button id="btn-deep-cleanup" class="mw-ui-button mw-ui-destructive" style="width:100%; height:44px; font-size:13px; letter-spacing:0.3px;">⚠ 破坏者联合清理防御</button>
        </div>
    </div>
    <div id="status-area">
        <div class="progress-container"><div id="progress-bar" class="progress-bar"></div></div>
        <div id="progress-text">准备中...</div>
        <div class="section-label-row">
            <span class="section-label">实时报告</span>
            <div style="display:flex; gap:8px; align-items:center;">
                <button id="btn-pause" class="mw-ui-button" style="height:24px; padding:0 12px; display:none;">暂停</button>
                <button id="btn-stop"  class="mw-ui-button mw-ui-destructive" style="height:24px; padding:0 12px; display:none;">停止</button>
                <a href="javascript:void(0)" id="export-log-btn">[导出报告]</a>
            </div>
        </div>
        <div id="deletion-results"></div>
    </div>
</div>
<div class="fluent-resizer"></div>`;
        document.body.appendChild(win);
        applyRevealToButtons(win);
        document.getElementById('mw-batch-tool-min').onclick = () => minimizeWindow();
        document.getElementById('mw-batch-tool-close').onclick = () => closeWindow();
        bindEvents();
        makeDraggable(document.getElementById('mw-tool-drag-handle'), win);
        makeResizable(win);
        requestAnimationFrame(() => updateTabIndicator(0));
    }

    let currentTabIdx = 0;
    function updateTabIndicator(idx) {
        const tabs = document.querySelectorAll('.tool-tab');
        const indicator = document.getElementById('tab-slide-indicator');
        if (!indicator || !tabs[idx]) return;
        indicator.style.left  = tabs[idx].offsetLeft + 'px';
        indicator.style.width = tabs[idx].offsetWidth + 'px';
    }

    function makeDraggable(handle, win) {
        let offset = { x: 0, y: 0 };
        const onMove = (e) => {
            const clientX = e.clientX ?? e.touches[0].clientX; const clientY = e.clientY ?? e.touches[0].clientY;
            const maxX = Math.max(0, window.innerWidth  - win.offsetWidth);
            const maxY = Math.max(0, window.innerHeight - 30);
            win.style.left = Math.max(0, Math.min(clientX - offset.x, maxX)) + 'px';
            win.style.top  = Math.max(0, Math.min(clientY - offset.y, maxY)) + 'px';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
        };
        const onDown = (e) => {
            if (e.target.closest('.tool-tab') || e.target.closest('.tool-header-controls')) return;
            const rect = win.getBoundingClientRect();
            win.style.margin = '0'; win.style.right = 'auto'; win.style.transform = 'none';
            win.style.left = rect.left + 'px'; win.style.top = rect.top + 'px';
            offset.x = (e.clientX ?? e.touches[0].clientX) - rect.left; offset.y = (e.clientY ?? e.touches[0].clientY) - rect.top;
            document.addEventListener('mousemove', onMove, { passive: false }); document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
        };
        handle.onmousedown = onDown; handle.addEventListener('touchstart', onDown, { passive: false });
    }

    // [BUG-06] 修复：拖拽调整窗口大小时同步更新 tab 指示器位置
    function makeResizable(win) {
        const resizer = win.querySelector('.fluent-resizer');
        let startX, startY, startWidth, startHeight;
        const onMove = (e) => {
            win.style.width  = Math.max(480, startWidth  + ((e.clientX ?? e.touches[0].clientX) - startX)) + 'px';
            win.style.height = Math.max(400, startHeight + ((e.clientY ?? e.touches[0].clientY) - startY)) + 'px';
            updateTabIndicator(currentTabIdx); // [BUG-06]
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
        };
        const onDown = (e) => {
            e.preventDefault();
            const rect = win.getBoundingClientRect();
            if (win.style.margin !== '0px' && win.style.margin !== '0') {
                win.style.margin = '0'; win.style.right = 'auto'; win.style.transform = 'none';
                win.style.left = rect.left + 'px'; win.style.top = rect.top + 'px';
            }
            startX = e.clientX ?? e.touches[0].clientX; startY = e.clientY ?? e.touches[0].clientY;
            startWidth = rect.width; startHeight = rect.height;
            document.addEventListener('mousemove', onMove, { passive: false }); document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
        };
        resizer.addEventListener('mousedown', onDown); resizer.addEventListener('touchstart', onDown, { passive: false });
    }

    function maskWikitextBlocks(text) {
        const masks = [];
        const regex = /<(nowiki|pre|source|syntaxhighlight|math|gallery)[^>]*>[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi;
        const masked = text.replace(regex, match => { const placeholder = `\x00BLOCK${masks.length}\x00`; masks.push(match); return placeholder; });
        return { masked, masks };
    }

    function unmaskWikitextBlocks(text, masks) {
        return text.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => masks[parseInt(i)]);
    }

    // [BUG-01] 修复：动态检测模板命名空间别名，兼容所有语言的 wiki
    function removeWikitextTemplateSafe(text, tmplName) {
        const { masked, masks } = maskWikitextBlocks(text);
        let result = masked;
        const normalizedName = tmplName.toLowerCase().replace(/_/g, ' ');
        const tmplPrefixes = getTemplateNamespacePrefixes();
        const targetPrefixes = [
            normalizedName,
            ...tmplPrefixes.map(p => `${p}:${normalizedName}`)
        ];

        let startIndex = 0;
        while ((startIndex = result.toLowerCase().indexOf('{{', startIndex)) !== -1) {
            let depth = 2; let endIndex = -1;
            for (let i = startIndex + 2; i < result.length - 1; i++) {
                if (result[i] === '{' && result[i + 1] === '{') { depth += 2; i++; }
                else if (result[i] === '}' && result[i + 1] === '}') {
                    depth -= 2; i++;
                    if (depth === 0) { endIndex = i; break; }
                }
            }
            if (endIndex !== -1) {
                const block = result.substring(startIndex, endIndex + 1);
                const innerContent = block.substring(2, block.length - 2).trim();
                const firstPart = innerContent.split('|')[0].trim().toLowerCase().replace(/_/g, ' ');
                if (targetPrefixes.includes(firstPart)) result = result.substring(0, startIndex) + result.substring(endIndex + 1);
                else startIndex += 2;
            } else startIndex += 2;
        }
        return unmaskWikitextBlocks(result, masks).trim();
    }

    function bindEvents() {
        document.querySelectorAll('.tool-tab').forEach((tab, newIdx) => {
            tab.onclick = function () {
                if (newIdx === currentTabIdx) return;
                const direction = newIdx > currentTabIdx ? 'right' : 'left';
                document.querySelectorAll('.tool-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active', 'anim-in-right', 'anim-in-left'); });
                this.classList.add('active'); updateTabIndicator(newIdx);
                const newContent = document.getElementById(this.dataset.tab);
                newContent.classList.add('active'); void newContent.offsetWidth;
                newContent.classList.add(direction === 'right' ? 'anim-in-right' : 'anim-in-left');
                currentTabIdx = newIdx;
            };
        });

        document.getElementById('btn-import-cat').onclick   = () => customPrompt('分类导入', '分类名 (不含 Category:)', async (v) => appendPages(await smartImport('categorymembers', { cmtitle: 'Category:' + v })));
        document.getElementById('btn-import-pfx').onclick   = () => customPrompt('前缀导入', '标题前缀', async (v) => appendPages(await smartImport('allpages', { apprefix: v || '' })));
        document.getElementById('btn-import-link').onclick  = () => customPrompt('链入导入', '标题', async (v) => appendPages(await smartImport('backlinks', { bltitle: v })));
        document.getElementById('btn-import-user').onclick  = () => customPrompt('贡献导入', '用户名 (一行一个):', async (v) => appendPages(await smartImport('usercontribs', { ucuser: v })), true);
        document.getElementById('btn-import-recent').onclick = async () => appendPages(await smartImport('recentchanges', {}));

        // [BUG-09] 修复：分离正则语法错误与网络异常的处理逻辑
        document.getElementById('btn-import-regex').onclick = () => customPrompt('全站搜索', '输入正则', async (v) => {
            // 先独立校验正则，给出明确的语法错误提示
            let rx;
            try {
                rx = new RegExp(v, 'i');
            } catch (e) {
                mw.notify(`正则表达式语法错误：${e.message}`, { type: 'error' });
                return;
            }

            if (!confirm('全站扫描耗时极长，已采用流式处理降低内存占用。\n确认继续？')) return;

            try {
                mw.notify('正在流式检索标题库...');
                setTaskState(true); State.stopSignal = false;
                document.getElementById('status-area').style.display = 'block';
                document.getElementById('progress-bar').classList.add('shimmer');

                let cont = {}, matchCount = 0, scanCount = 0;
                const nsSelect = document.getElementById('import-ns-select').value;
                const ids = (nsSelect === 'ALL') ? Object.keys(siteNamespaces).filter(id => parseInt(id) >= 0) : [nsSelect];

                for (let i = 0; i < ids.length; i++) {
                    if (State.stopSignal) break;
                    let nsIter = 0; cont = {};
                    while (nsIter++ < 2000) {
                        if (State.stopSignal) break;
                        try {
                            const p = Object.assign({ action: 'query', list: 'allpages', aplimit: 'max', apnamespace: ids[i] }, cont);
                            const res = await mwApiPost(p);
                            if (!res?.query?.allpages) break;
                            const chunk = res.query.allpages.map(p => p.title);
                            scanCount += chunk.length;
                            const matched = chunk.filter(t => rx.test(t));
                            if (matched.length > 0) { appendPages(matched); matchCount += matched.length; }
                            uiProgress(Math.round(((i + 1) / ids.length) * 100), `NS:${siteNamespaces[ids[i]] || ids[i]} - 已扫描 ${scanCount} 页...`);
                            if (!res.continue) break;
                            cont = res.continue;
                        } catch (e) {
                            if (e.code === 'maxlag' || e.code === 'ratelimited') {
                                await sleepWithStop(5000); // [BUG-03]
                                if (State.stopSignal) break;
                                nsIter--; continue;
                            }
                            throw e;
                        }
                    }
                }
                if (!State.stopSignal) mw.notify(`扫描完成，共扫描 ${scanCount} 页，找到 ${matchCount} 个匹配。`);
            } catch (e) {
                // [BUG-09] 此处只会捕获网络/API 异常
                mw.notify(`扫描过程发生网络异常：${e.info || e.code || e.message || '未知错误'}`, { type: 'error' });
            } finally {
                setTaskState(false);
                document.getElementById('progress-bar').classList.remove('shimmer');
            }
        });

        document.getElementById('list-dedupe').onclick = () => { document.getElementById('pages-to-process').value = [...new Set(getList())].join('\n'); };
        document.getElementById('list-sort').onclick   = () => { document.getElementById('pages-to-process').value = getList().sort().join('\n'); };
        document.getElementById('list-clear').onclick  = () => { if (confirm('清空列表？')) document.getElementById('pages-to-process').value = ''; };

        document.getElementById('btn-do-edit').onclick = () => {
            const list = getList(); const pr = document.getElementById('edit-prepend-text').value; const ap = document.getElementById('edit-append-text').value;
            if (!list.length || (!pr && !ap)) return mw.notify('无内容');
            startBatchProcess(list, async (t) => {
                let p = Object.assign({ action: 'edit', title: t, nocreate: true, summary: getReason() }, getBotParam('edit'));
                if (pr) p.prependtext = pr.endsWith('\n') ? pr : pr + '\n';
                if (ap) p.appendtext  = ap.startsWith('\n') ? ap : '\n' + ap;
                await mwApiPostWithToken('csrf', p);
            }, '首尾修改');
        };

        document.getElementById('btn-rm-template').onclick = () => {
            const val = document.getElementById('rm-template-name').value.trim(); if (!val) return;
            startBatchProcess(getList(), async (t) => {
                const res = await mwApiPost({ action: 'query', prop: 'revisions', titles: t, rvprop: 'content', rvslots: 'main' });
                const page = Object.values(res.query.pages)[0]; if (!page?.revisions?.[0]) return;
                const oldText = page.revisions[0].slots ? page.revisions[0].slots.main['*'] : page.revisions[0]['*'];
                if (typeof oldText !== 'string') return;
                const newT = removeWikitextTemplateSafe(oldText, val);
                if (oldText !== newT) await mwApiPostWithToken('csrf', Object.assign({ action: 'edit', title: t, nocreate: true, text: newT, summary: `移除模板 ${val}` }, getBotParam('edit')));
            }, '移除模板');
        };

        document.getElementById('btn-rm-category').onclick = () => {
            const val = document.getElementById('rm-category-name').value.trim(); if (!val) return;
            const catIds = Object.keys(mw.config.get('wgNamespaceIds')).filter(k => mw.config.get('wgNamespaceIds')[k] === 14);
            const catPrefixesStr = catIds.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '[ _]+')).join('|');
            const escapedVal = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ _]/g, '[ _]+');
            const rx = new RegExp(`\\[\\[\\s*(?::?\\s*(?:${catPrefixesStr})\\s*[：:]+\\s*)${escapedVal}\\s*(\\|[^\\]]*)?\\]\\]`, 'gi');
            startBatchProcess(getList(), async (t) => {
                const res = await mwApiPost({ action: 'query', prop: 'revisions', titles: t, rvprop: 'content', rvslots: 'main' });
                const page = Object.values(res.query.pages)[0]; if (!page?.revisions?.[0]) return;
                const oldText = page.revisions[0].slots ? page.revisions[0].slots.main['*'] : page.revisions[0]['*'];
                if (typeof oldText !== 'string') return;
                const newT = oldText.replace(rx, '');
                if (oldText !== newT) await mwApiPostWithToken('csrf', Object.assign({ action: 'edit', title: t, nocreate: true, text: newT, summary: `移除分类 ${val}` }, getBotParam('edit')));
            }, '移除分类');
        };

        document.getElementById('btn-start-delete').onclick = async () => {
            const list = getList(); if (!list.length || !confirm(`确认删除这 ${list.length} 个项目？`)) return;
            startBatchProcess(expandList(list), async (t) => await mwApiPostWithToken('csrf', Object.assign({ action: 'delete', title: t, reason: getReason() }, getBotParam('edit'))));
        };

        document.getElementById('btn-undelete').onclick = () => {
            const list = getList(); if (!list.length) return;
            startBatchProcess(expandList(list), async (t) => await mwApiPostWithToken('csrf', Object.assign({ action: 'undelete', title: t, reason: getReason() }, getBotParam('edit'))));
        };

        // [FEAT-01] 修复：批量保护支持选择期限，不再硬编码 infinite
        document.getElementById('btn-batch-protect').onclick = () => {
            const list = getList(); if (!list.length) return;
            showProtectModal(list);
        };

        document.getElementById('btn-deep-cleanup').onclick = showDeepCleanupModal;
        document.getElementById('btn-do-filter').onclick    = executeFilter;
        document.getElementById('btn-pause').onclick = function () {
            State.isPaused = !State.isPaused;
            const txtSpan = this.querySelector('.fluent-btn-text');
            if (txtSpan) txtSpan.textContent = State.isPaused ? '继续' : '暂停';
        };
        document.getElementById('btn-stop').onclick  = () => { State.stopSignal = true; State.isPaused = false; };
        document.getElementById('export-log-btn').onclick = exportLogReport;
    }

    // [FEAT-01] 批量保护弹窗，支持自定义期限
    function showProtectModal(list) {
        const area = document.getElementById('modal-content-area');
        const expiryOptions = [
            { value: 'infinite', label: '永久' },
            { value: '1 day',    label: '1 天' },
            { value: '3 days',   label: '3 天' },
            { value: '1 week',   label: '1 周' },
            { value: '2 weeks',  label: '2 周' },
            { value: '1 month',  label: '1 个月' },
            { value: '3 months', label: '3 个月' },
            { value: '6 months', label: '6 个月' },
            { value: '1 year',   label: '1 年' }
        ];
        const expiryOpts = expiryOptions.map(o => `<option value="${escapeHTML(o.value)}">${escapeHTML(o.label)}</option>`).join('');
        area.innerHTML = `
<div style="font-weight:700;font-size:15px;color:var(--fd-text-primary);margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--fd-border-light);">批量保护</div>
<label class="filter-label">保护等级 <span style="font-weight:400;text-transform:none;font-size:11px;">(格式: edit=sysop|move=sysop)</span></label>
<input type="text" id="protect-level-input" class="tool-input" value="edit=sysop|move=sysop" placeholder="edit=sysop|move=sysop">
<label class="filter-label" style="margin-top:4px;">保护期限</label>
<select id="protect-expiry-input" class="tool-input">${expiryOpts}</select>
<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;">
    <button class="mw-ui-button" id="modal-cancel">取消</button>
    <button class="mw-ui-button mw-ui-progressive" id="modal-ok">确定</button>
</div>`;
        applyRevealToButtons(area);
        const overlay = document.getElementById('modal-overlay');
        overlay.style.display = 'flex';

        const close = () => { overlay.style.display = 'none'; };
        document.getElementById('modal-cancel').onclick = close;
        document.getElementById('modal-ok').onclick = () => {
            const trimmed = document.getElementById('protect-level-input').value.trim();
            const expiry  = document.getElementById('protect-expiry-input').value;
            close();
            if (!trimmed) { mw.notify('保护参数不能为空', { type: 'error' }); return; }
            const validPattern = /^[a-z]+=[a-z0-9_-]+(\|[a-z]+=[a-z0-9_-]+)*$/i;
            if (!validPattern.test(trimmed)) { mw.notify('保护参数格式有误，正确示例：edit=extended-confirmed|move=sysop', { type: 'error' }); return; }
            startBatchProcess(expandList(list), async (t) => await mwApiPostWithToken('csrf', Object.assign({ action: 'protect', title: t, protections: trimmed, expiry, reason: getReason() }, getBotParam('edit'))));
        };
    }

    function showDeepCleanupModal() {
        if (State.isRunning) return mw.notify('后台有任务正在运行或处于暂停状态，请先彻底停止再启动！', { type: 'error' });
        const area = document.getElementById('modal-content-area');
        area.innerHTML = `
<div class="modal-title-text">⚠ 联合清理防御面板</div>
<label class="filter-label">目标用户/IP 名单（一行一个）</label>
<textarea id="cleanup-users" class="tool-textarea" style="height:80px; margin-bottom:14px;"></textarea>
<div class="filter-section">
    <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px; flex-wrap:wrap;">
        <span style="font-size:12px; color:var(--fd-text-secondary);">封禁期限</span>
        <select id="blk-expiry" class="tool-input" style="width:140px; margin-bottom:0;">
            <option value="infinite">永久 (infinite)</option><option value="1 day">1 天</option><option value="3 days">3 天</option>
            <option value="1 week">1 周</option><option value="2 weeks">2 周</option><option value="1 month">1 个月</option>
            <option value="3 months">3 个月</option><option value="6 months">6 个月</option><option value="1 year">1 年</option>
        </select>
        <label class="cleanup-option" style="margin-bottom:0; color:var(--fd-error);"><input type="checkbox" id="blk-circuit-breaker" checked> 封禁失败熔断</label>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:14px; margin-bottom:10px;">
        <label class="cleanup-option"><input type="checkbox" id="blk-autoblock" checked> 自动封禁(针对账号)</label>
        <label class="cleanup-option"><input type="checkbox" id="blk-nocreate" checked> 禁创号</label>
        <label class="cleanup-option"><input type="checkbox" id="blk-noemail"> 禁电邮</label>
        <label class="cleanup-option"><input type="checkbox" id="blk-notalk"> 禁讨论页</label>
    </div>
    <div class="fluent-divider"></div>
    <label class="cleanup-option"><input type="checkbox" id="do-rollback" checked> <b>回退编辑 (Rollback)</b></label>
    <div class="sub-option"><label class="cleanup-option" style="color:var(--fd-text-secondary);"><input type="checkbox" id="rb-markbot" checked> 标记机器人</label></div>
    <label class="cleanup-option"><input type="checkbox" id="do-undo-move" checked> <b>还原更名操作 (Undo Move)</b></label>
    <label class="cleanup-option"><input type="checkbox" id="do-del-new" checked> <b>无条件删除新建页面</b></label>
    <div class="sub-option"><label class="cleanup-option" style="color:var(--fd-text-secondary);"><input type="checkbox" id="del-sync-assoc"> 包含关联页</label></div>
</div>
<div style="display:flex; gap:10px; justify-content:flex-end; margin-top:4px;">
    <button class="mw-ui-button" id="modal-btn-cancel">取消</button>
    <button class="mw-ui-button mw-ui-destructive" id="btn-cleanup-confirm" style="padding:0 28px;">执行联合清理防御</button>
</div>`;

        applyRevealToButtons(area);
        document.getElementById('modal-overlay').style.display = 'flex';
        document.getElementById('modal-btn-cancel').onclick = () => { document.getElementById('modal-overlay').style.display = 'none'; };

        document.getElementById('btn-cleanup-confirm').onclick = async () => {
            if (State.isRunning) { mw.notify('有后台任务正在执行，请先彻底停止！', { type: 'error' }); return; }

            const users = document.getElementById('cleanup-users').value.split('\n')
                .map(u => u.trim().replace(/^(?:User|用户|使用者|用戶):/i, ''))
                .filter(u => u);
            if (!users.length || !confirm(`确认启动针对 ${users.length} 个用户的防御清理？`)) return;

            let rawExp = document.getElementById('blk-expiry').value.trim().toLowerCase();
            let expiry = (['infinite', 'infinity', 'forever', ''].includes(rawExp)) ? 'indefinite' : rawExp;

            const useBreaker    = document.getElementById('blk-circuit-breaker').checked;
            const blockNoCreate = document.getElementById('blk-nocreate').checked;
            const blockNoEmail  = document.getElementById('blk-noemail').checked;
            const blockNoTalk   = document.getElementById('blk-notalk').checked;
            const blockAutoBlock = document.getElementById('blk-autoblock').checked;
            const optUndoMove   = document.getElementById('do-undo-move').checked;
            const optRollback   = document.getElementById('do-rollback').checked;
            const rbFlags       = document.getElementById('rb-markbot').checked ? { markbot: 1 } : {};
            const optDelNew     = document.getElementById('do-del-new').checked;
            const optDelSync    = document.getElementById('del-sync-assoc').checked;
            const commonReason  = `联合处理：${getReason()}`;

            document.getElementById('modal-overlay').style.display = 'none';
            document.getElementById('status-area').style.display = 'block';
            document.getElementById('btn-pause').style.display = 'inline-flex';
            document.getElementById('btn-stop').style.display  = 'inline-flex';
            document.getElementById('progress-bar').classList.remove('shimmer');
            document.getElementById('deletion-results').innerHTML = '';
            uiLog('>>> 联合清理防御程序启动', 'info');

            setTaskState(true); State.stopSignal = false; State.isPaused = false;

            try {
                for (let uIdx = 0; uIdx < users.length; uIdx++) {
                    const user = users[uIdx];
                    if (State.stopSignal) break;
                    uiProgress(Math.round(((uIdx) / users.length) * 100), `联防清理: ${user}`);
                    uiLog(`[处理进程: ${user}]`, 'info');

                    while (State.isPaused) { await new Promise(r => setTimeout(r, 500)); if (State.stopSignal) break; }
                    if (State.stopSignal) break;

                    try {
                        let blockOK = false;
                        const bParams = { action: 'block', user, expiry, reason: commonReason, reblock: 1, nocreate: blockNoCreate, noemail: blockNoEmail, allowusertalk: !blockNoTalk };
                        if (mw.util.isIPAddress(user, true)) delete bParams.autoblock; else bParams.autoblock = blockAutoBlock;

                        try {
                            await mwApiPostWithToken('csrf', bParams); blockOK = true; uiLog('封禁成功', 'success');
                        } catch (e) {
                            if (e.code === 'alreadyblocked') { blockOK = true; uiLog('用户已封禁', 'info'); }
                            else {
                                uiLog(`封禁失败: ${e.info || e.code}`, 'error');
                                if (!useBreaker && confirm(`用户[${user}] 封禁失败。是否强制继续？`)) blockOK = true;
                            }
                        }

                        if (!blockOK) continue;
                        if (State.stopSignal) break;
                        while (State.isPaused) { await new Promise(r => setTimeout(r, 500)); if (State.stopSignal) break; }

                        const contribs = await apiQueryAll({ list: 'usercontribs', ucuser: user, uclimit: 'max' }, i => i);

                        if (optUndoMove && !State.stopSignal) {
                            const moves = await apiQueryAll({ list: 'logevents', letype: 'move', leuser: user, lelimit: 'max' }, i => i);
                            await executeBatch(moves, async (m) => {
                                if (!m.params || !m.params.target_title) {
                                    throw { code: 'hiddenlog', info: '目标日志内容已被系统隐藏' };
                                }
                                try {
                                    await mwApiPostWithToken('csrf', Object.assign({ action: 'move', from: m.params.target_title, to: m.title, noredirect: true, movetalk: true, reason: '还原更名' }, getBotParam('edit')));
                                } catch (e) {
                                    if (!['articleexists', 'cantmove', 'protectedpage', 'missingtitle', 'selfmove', 'hiddenlog'].includes(e.code)) throw e;
                                }
                            }, `还原移动 ${user}`, false, false, true);
                        }

                        if (State.stopSignal) break;

                        if (optRollback && !State.stopSignal) {
                            const titles = [...new Set(contribs.map(i => i.title))];
                            await executeBatch(titles, async (t) => {
                                try { await mwApiPostWithToken('csrf', Object.assign({ action: 'rollback', title: t, user, summary: '回退贡献' }, rbFlags));
                                } catch (e) { if (!['rollbackfail', 'alreadyrolled', 'onlyauthor'].includes(e.code)) throw e; }
                            }, `回退编辑 ${user}`, false, false, true);
                        }

                        if (State.stopSignal) break;

                        if (optDelNew && !State.stopSignal) {
                            const newPages = contribs.filter(i => i.new !== undefined).map(i => i.title);
                            if (newPages.length) {
                                const finalDel = [];
                                for (let i = 0; i < newPages.length; i += 50) {
                                    if (State.stopSignal) break;
                                    const chunk = newPages.slice(i, i + 50);
                                    try {
                                        const res = await mwApiPost({ action: 'query', titles: chunk.join('|'), prop: 'revisions', rvprop: 'user', rvlimit: 1, rvdir: 'newer' });
                                        if (!res?.query?.pages) continue;
                                        Object.values(res.query.pages).forEach(p => {
                                            if (p.revisions?.[0]?.user === user) {
                                                finalDel.push(p.title);
                                                if (optDelSync) {
                                                    const tObj = mw.Title.newFromText(p.title);
                                                    if (tObj) {
                                                        const assocPage = tObj.isTalkPage() ? tObj.getSubjectPage() : tObj.getTalkPage();
                                                        if (assocPage) finalDel.push(assocPage.getPrefixedText());
                                                    }
                                                }
                                            }
                                        });
                                    } catch (e) { console.warn(`[Batch Tool] Deep Cleanup 批处理查询异常:`, e); }
                                }
                                if (!State.stopSignal) {
                                    await executeBatch([...new Set(finalDel)], async (t) => await mwApiPostWithToken('csrf', Object.assign({ action: 'delete', title: t, reason: '联合处理：无条件清理页面' }, getBotParam('edit'))), `删除项 ${user}`, false, false, true);
                                }
                            }
                        }
                    } catch (userErr) {
                        uiLog(`用户 ${user} 深度处理时发生异常跳过: ${userErr.info || userErr.code || '未知'}`, 'error');
                    }
                }
                if (!State.stopSignal) { uiProgress(100, `联合清理防御完成`); mw.notify('任务圆满结束'); }
                else { mw.notify('任务已手动停止', { type: 'warn' }); }
            } finally {
                document.getElementById('btn-pause').style.display = 'none';
                document.getElementById('btn-stop').style.display  = 'none';
                setTaskState(false);
            }
        };
    }

    // [BUG-04][BUG-08] 修复：移除死参数 managedExternally；ucnamespace 改为显式条件赋值
    async function smartImport(listType, params) {
        if (State.isRunning) { mw.notify('请先停止当前运行的任务', { type: 'error' }); return []; }
        const nsSelect = document.getElementById('import-ns-select').value;
        let total = [];
        document.getElementById('status-area').style.display = 'block';
        const pBar = document.getElementById('progress-bar');
        State.stopSignal = false;
        pBar.classList.add('shimmer');
        setTaskState(true);

        try {
            if (listType === 'usercontribs') {
                const users = (params.ucuser || '').split('\n').map(u => u.replace(/^(?:User|用户|使用者|用戶):/i, '').trim()).filter(u => u);
                for (let i = 0; i < users.length; i++) {
                    if (State.stopSignal) break;
                    uiProgress(0, `正在抓取记录: ${users[i]}`);
                    // [BUG-08] 显式条件赋值，避免传入 undefined
                    const queryParams = { list: 'usercontribs', uclimit: 'max', ucuser: users[i] };
                    if (nsSelect !== 'ALL') queryParams.ucnamespace = nsSelect;
                    const chunk = await apiQueryAll(queryParams, i => i.title);
                    total.push(...chunk);
                }
                return total;
            }

            if (['categorymembers', 'backlinks', 'recentchanges'].includes(listType)) {
                const p = Object.assign({ list: listType }, params);
                if (listType === 'recentchanges') {
                    p.rclimit = 'max'; p.rcprop = 'title|user|timestamp';
                    if (!document.getElementById('global-bot-mode').checked) p.rcshow = '!bot';
                } else if (listType === 'categorymembers') p.cmlimit = 'max';
                else if (listType === 'backlinks') p.bllimit = 'max';
                else p.limit = 'max';

                // [BUG-08] 显式条件赋值
                if (nsSelect !== 'ALL') {
                    const k = { categorymembers: 'cmnamespace', backlinks: 'blnamespace', recentchanges: 'rcnamespace' }[listType];
                    if (k) p[k] = nsSelect;
                }
                return await apiQueryAll(p, i => i.title);
            }

            if (listType === 'allpages') {
                const ids = (nsSelect === 'ALL') ? Object.keys(siteNamespaces).filter(id => parseInt(id) >= 0) : [nsSelect];
                for (let i = 0; i < ids.length; i++) {
                    if (State.stopSignal) break;
                    uiProgress(Math.round(((i + 1) / ids.length) * 100), `扫描 NS: ${siteNamespaces[ids[i]] || ids[i]}`);
                    const chunk = await apiQueryAll({ list: 'allpages', aplimit: 'max', apnamespace: ids[i], apprefix: params.apprefix || '' }, i => i.title);
                    total.push(...chunk);
                }
                return total;
            }
        } finally {
            pBar.classList.remove('shimmer');
            setTaskState(false);
        }
        return total;
    }

    async function startBatchProcess(items, actionFunc, task) {
        if (State.isRunning) return mw.notify('已有任务正在执行中，请先停止！', { type: 'error' });
        setTaskState(true);
        try { await executeBatch(items, actionFunc, task, true, true); } finally { setTaskState(false); }
    }

    // [BUG-03] 修复：限速重试等待期间使用 sleepWithStop，可被停止信号中断
    async function executeBatch(items, actionFunc, task, clearLog = true, resetStop = true, disableProgressUI = false) {
        const parsedRate = parseFloat(document.getElementById('process-rate').value);
        const rate = isNaN(parsedRate) ? 1.0 : Math.max(0, parsedRate);

        if (!disableProgressUI) {
            document.getElementById('status-area').style.display = 'block';
            document.getElementById('btn-pause').style.display = 'inline-flex';
            document.getElementById('btn-stop').style.display  = 'inline-flex';
            document.getElementById('progress-bar').classList.remove('shimmer');
        }

        if (resetStop) State.stopSignal = false;
        if (clearLog) document.getElementById('deletion-results').innerHTML = '';
        if (resetStop) State.isPaused = false;

        for (let i = 0; i < items.length; i++) {
            if (State.stopSignal) break;

            while (State.isPaused) {
                await new Promise(r => setTimeout(r, 500));
                if (State.stopSignal) break;
            }
            if (State.stopSignal) break;

            const item = items[i];
            const itemName = (typeof item === 'object' && item !== null) ? (item.title || JSON.stringify(item)) : item;

            if (!disableProgressUI) uiProgress(Math.round(((i + 1) / items.length) * 100), `${task || '执行中'}: ${i + 1}/${items.length}`);

            try {
                let retry = 0;
                while (retry++ < 3) {
                    try {
                        await actionFunc(item);
                        uiLog(itemName, 'success');
                        break;
                    } catch (e) {
                        if (e.code === 'maxlag' || e.code === 'ratelimited') {
                            if (retry >= 3) throw e;
                            let waitTime = 5000;
                            if (e.xhr && typeof e.xhr.getResponseHeader === 'function') {
                                const retryAfter = e.xhr.getResponseHeader('Retry-After');
                                if (retryAfter && !isNaN(parseInt(retryAfter))) {
                                    waitTime = Math.min(parseInt(retryAfter) * 1000, 30000);
                                }
                            }
                            uiLog(`频率受限，等待 ${waitTime / 1000}s 重试 (${retry}/3)...`, 'warning');
                            await sleepWithStop(waitTime); // [BUG-03] 可中断等待
                            if (State.stopSignal) throw { code: 'stopped', info: '任务已停止' };
                        } else throw e;
                    }
                }
            } catch (e) {
                if (e.code === 'stopped') { /* 优雅停止，不记录错误 */ }
                else if (e.code === 'missingtitle') uiLog(`${itemName} (无需处理，页面不存在)`, 'info');
                else uiLog(`${itemName} (${e.info || e.code || '未知错误'})`, 'error');
            }

            if (i < items.length - 1) {
                const sleepMs = rate * 1000;
                const steps = Math.ceil(sleepMs / 100);
                for (let s = 0; s < steps; s++) {
                    if (State.stopSignal || State.isPaused) break;
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }
        if (!disableProgressUI) {
            document.getElementById('btn-pause').style.display = 'none';
            document.getElementById('btn-stop').style.display  = 'none';
        }
    }

    async function executeFilter() {
        if (State.isRunning) return mw.notify('有任务在运行，请先停止', { type: 'error' });
        const list = getList();
        if (!list.length || !confirm('筛选将覆盖当前列表。继续？')) return;

        setTaskState(true);
        document.getElementById('status-area').style.display = 'block';
        document.getElementById('btn-pause').style.display = 'inline-flex';
        document.getElementById('btn-stop').style.display  = 'inline-flex';
        document.getElementById('progress-bar').classList.add('shimmer');
        State.stopSignal = false; State.isPaused = false;
        let filtered = [];

        const redirType = document.getElementById('filter-redir-type').value;
        const sizeL     = parseInt(document.getElementById('filter-size-less').value);
        const dayM      = parseInt(document.getElementById('filter-days-more').value);
        const creator   = document.getElementById('filter-creator').value.trim().toLowerCase();

        try {
            for (let i = 0; i < list.length; i += 50) {
                if (State.stopSignal) break;
                while (State.isPaused) { await new Promise(r => setTimeout(r, 500)); if (State.stopSignal) break; }
                if (State.stopSignal) break;

                const chunk = list.slice(i, i + 50);
                const res = await mwApiPost({ action: 'query', titles: chunk.join('|'), prop: 'info|revisions', rvprop: 'user|timestamp', rvlimit: 1 });
                if (!res?.query?.pages) continue;

                let passedIdleCheck = [];
                Object.values(res.query.pages).forEach(p => {
                    if (p.missing !== undefined) return;
                    let m = true;
                    if (redirType === 'only-redir' && !p.redirect) m = false;
                    if (redirType === 'no-redir'   &&  p.redirect) m = false;
                    if (!isNaN(sizeL) && p.length >= sizeL) m = false;
                    if (!isNaN(dayM) && p.revisions?.[0]) { if (Date.now() - new Date(p.revisions[0].timestamp).getTime() < dayM * 86400000) m = false; }
                    if (m) passedIdleCheck.push(p.title);
                });

                if (creator && passedIdleCheck.length > 0) {
                    const resCreator = await mwApiPost({ action: 'query', titles: passedIdleCheck.join('|'), prop: 'revisions', rvprop: 'user', rvdir: 'newer', rvlimit: 1 });
                    if (resCreator?.query?.pages) {
                        Object.values(resCreator.query.pages).forEach(p => { if (p.revisions?.[0]?.user?.toLowerCase() === creator) filtered.push(p.title); });
                    }
                } else filtered.push(...passedIdleCheck);

                const currentProcessed = Math.min(i + 50, list.length);
                uiProgress(Math.round((currentProcessed / list.length) * 100), `已筛选: ${currentProcessed}/${list.length}`);
            }
            document.getElementById('pages-to-process').value = filtered.join('\n');
            mw.notify(`已筛选保留 ${filtered.length} 条。`);
        } finally {
            document.getElementById('progress-bar').classList.remove('shimmer');
            document.getElementById('btn-pause').style.display = 'none';
            document.getElementById('btn-stop').style.display  = 'none';
            setTaskState(false);
        }
    }

    function getList()   { return document.getElementById('pages-to-process').value.split('\n').map(s => s.trim()).filter(s => s); }
    function getReason() { return document.getElementById('common-reason').value || '批量管理'; }
    function appendPages(ts) {
        if (!ts || !ts.length) return;
        document.getElementById('pages-to-process').value = [...new Set([...getList(), ...ts])].join('\n');
        mw.notify(`已新增 ${ts.length} 条数据`);
    }

    // [BUG-07] 修复：
    //   1. 点击遮罩层可关闭弹窗
    //   2. 防止多次调用导致监听器堆叠（通过 _promptCloseHandler 追踪并清除旧监听器）
    function customPrompt(title, label, callback, isTextArea) {
        const area = document.getElementById('modal-content-area');
        area.innerHTML = `<div style="font-weight:700; font-size:15px; color:var(--fd-text-primary); margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid var(--fd-border-light);">${escapeHTML(title)}</div><label class="filter-label">${escapeHTML(label)}</label>${isTextArea ? `<textarea id="modal-input-val" class="tool-textarea" style="height:120px; font-family:monospace;"></textarea>` : `<input type="text" id="modal-input-val" class="tool-input">`}<div style="display:flex; gap:10px; justify-content:flex-end; margin-top:12px;"><button class="mw-ui-button" id="modal-cancel">取消</button><button class="mw-ui-button mw-ui-progressive" id="modal-ok">确定</button></div>`;
        applyRevealToButtons(area);

        const overlay = document.getElementById('modal-overlay');

        // 清除上一次遗留的遮罩层监听器，防止堆叠
        if (overlay._promptCloseHandler) {
            overlay.removeEventListener('click', overlay._promptCloseHandler);
            overlay._promptCloseHandler = null;
        }

        overlay.style.display = 'flex';

        const input = document.getElementById('modal-input-val');
        input.focus();
        input.onkeydown = null;
        if (!isTextArea) input.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('modal-ok').click(); };

        const closeModal = () => {
            overlay.style.display = 'none';
            if (overlay._promptCloseHandler) {
                overlay.removeEventListener('click', overlay._promptCloseHandler);
                overlay._promptCloseHandler = null;
            }
        };

        // [BUG-07] 点击遮罩层关闭
        const overlayClose = (e) => { if (e.target === overlay) closeModal(); };
        overlay._promptCloseHandler = overlayClose;
        overlay.addEventListener('click', overlayClose);

        document.getElementById('modal-ok').onclick     = () => { closeModal(); callback(input.value); };
        document.getElementById('modal-cancel').onclick = closeModal;
    }

    function createModalContainer() {
        if (document.getElementById('modal-overlay')) return;
        const overlay = document.createElement('div'); overlay.id = 'modal-overlay';
        overlay.innerHTML = `<div id="modal-box"><div id="modal-content-area"></div></div>`;
        document.body.appendChild(overlay);
    }

    function exportLogReport() {
        const lines = Array.from(document.getElementById('deletion-results').querySelectorAll('div')).map(el => el.innerText);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['MediaWiki Batch Tool Report\n' + new Date().toLocaleString() + '\n' + '='.repeat(32) + '\n' + lines.join('\n')], { type: 'text/plain' }));
        a.download = `BatchLog_${Date.now()}.txt`; a.click();
    }
})();
