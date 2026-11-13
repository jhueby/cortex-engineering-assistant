javascript:void(function(){
if(document.getElementById('xsiam-log-viewer')){
  const el=document.getElementById('xsiam-log-viewer');
  el.style.display=el.style.display==='none'?'flex':'none';
  return;
}

const PAGE_SIZE=100;
let currentPage=0;
let currentLogs=[];
let allIntegrations=[];
let refreshTimer=null;
let lastTopTimestamp=null;
let liveMode=false;
let liveSeenIds=new Set();
let isFullPage=false;
let closerMode='issues';

function getCsrf(){
  const m=document.cookie.match(/(?:^|; )csrf_token=([^;]*)/);
  return m?m[1]:null;
}

function escHtml(s){
  const d=document.createElement('div');
  d.textContent=s;
  return d.innerHTML;
}

async function apiCall(endpoint,params,body){
  const q=params?'?'+new URLSearchParams(params).toString():'';
  const r=await fetch(endpoint+q,{
    method:'POST',
    headers:{'accept':'application/json, text/plain, */*','content-type':'application/json','x-csrf-token':getCsrf()},
    body:JSON.stringify(body),
    credentials:'include'
  });
  if(!r.ok)throw new Error('HTTP '+r.status);
  const d=await r.json();
  if(d.reply?.err_code)throw new Error(d.reply.err_msg||'API error');
  return d.reply;
}

async function getIntegrations(){
  const r=await apiCall('/api/webapp/data_sources/get_data_sources_instances/',null,{from_cache:true});
  return(r.xsoar_integrations?.configurations||[]).map(c=>({
    brand:c.name,display:c.display,
    instances:(c.instances||[]).map(i=>({name:i.name,enabled:i.enabled!==false}))
  })).filter(i=>i.instances.length>0).sort((a,b)=>(a.display||a.brand).localeCompare(b.display||b.brand));
}

function buildPayload(f){
  const conds=[];
  if(f.source)conds.push({SEARCH_FIELD:'INTEGRATION_LOG_SOURCE',SEARCH_TYPE:'EQ',SEARCH_VALUE:f.source});
  if(f.instance)conds.push({SEARCH_FIELD:'INTEGRATION_LOG_INSTANCE',SEARCH_TYPE:'EQ',SEARCH_VALUE:f.instance});
  if(f.level)conds.push({SEARCH_FIELD:'INTEGRATION_LOG_LEVEL',SEARCH_TYPE:'EQ',SEARCH_VALUE:f.level});
  return{extraData:null,filter_data:{sort:[{FIELD:'INTEGRATION_LOG_TIMESTAMP',ORDER:'DESC'}],filter:conds.length>0?{AND:conds}:{},free_text:f.freeText||'',visible_columns:null,locked:null,paging:{from:f.from||0,to:f.to||PAGE_SIZE}},jsons:[]};
}

async function getLogs(filters){
  return apiCall('/api/webapp/get_data',{type:'grid',table_name:'INTEGRATION_LOGS_TABLE'},buildPayload(filters));
}

function exportData(fmt){
  if(!currentLogs.length)return;
  let blob,name;
  if(fmt==='json'){
    blob=new Blob([JSON.stringify(currentLogs,null,2)],{type:'application/json'});
    name='xsiam-logs.json';
  }else{
    const hdr=['INTEGRATION_LOG_TIMESTAMP','INTEGRATION_LOG_LEVEL','INTEGRATION_LOG_SOURCE','INTEGRATION_LOG_INSTANCE','INTEGRATION_LOG_COMMAND','INTEGRATION_LOG_RUN_BY','INTEGRATION_LOG_CONTENT'];
    const rows=currentLogs.map(l=>hdr.map(h=>{let v=l[h]||'';if(h==='INTEGRATION_LOG_TIMESTAMP')v=new Date(v).toISOString();return'"'+String(v).replace(/"/g,'""')+'"';}).join(','));
    blob=new Blob([hdr.join(',')+'\n'+rows.join('\n')],{type:'text/csv'});
    name='xsiam-logs.csv';
  }
  const u=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=u;a.download=name;a.click();
  URL.revokeObjectURL(u);
}

const CSS=`
#xsiam-log-viewer{position:fixed;top:0;right:0;width:540px;height:100vh;z-index:999999;min-width:320px;
font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;
background:#1a1a2e;color:#e0e0e0;border:1px solid #2a3a5c;border-radius:8px;
box-shadow:0 8px 32px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;resize:both;}
#xsiam-log-viewer.xlv-fullpage{top:0!important;left:0!important;right:0!important;bottom:0!important;
width:100%!important;height:100%!important;border-radius:0;resize:none;}
#xlv-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;
background:#16213e;border-bottom:1px solid #2a3a5c;cursor:move;user-select:none;}
#xlv-header h2{font-size:14px;font-weight:600;color:#4fc3f7;margin:0;display:flex;align-items:center;gap:6px;}
.xlv-logo{width:18px;height:18px;border-radius:50%;background:#00C853;display:inline-flex;align-items:center;
justify-content:center;flex-shrink:0;}
.xlv-logo::after{content:'';display:block;width:10px;height:10px;
background:white;clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);}
.xlv-hdr-btns{display:flex;align-items:center;gap:4px;}
.xlv-close,.xlv-fullpage-btn{background:none;border:none;color:#8892a4;font-size:18px;cursor:pointer;padding:0 4px;}
.xlv-close:hover{color:#ef5350;}
.xlv-fullpage-btn:hover{color:#4fc3f7;}
.xlv-fullpage-btn{font-size:14px;}
.xlv-tabs{display:flex;background:#16213e;border-bottom:1px solid #2a3a5c;}
.xlv-tab{flex:1;padding:8px 14px;font-size:12px;font-weight:600;text-align:center;cursor:pointer;
color:#8892a4;border:none;background:none;border-bottom:2px solid transparent;font-family:inherit;transition:all .15s;}
.xlv-tab:hover{color:#e0e0e0;background:#1f3055;}
.xlv-tab.active{color:#4fc3f7;border-bottom-color:#4fc3f7;}
.xlv-tab-content{display:none;flex-direction:column;flex:1;overflow:hidden;}
.xlv-tab-content.active{display:flex;}
.xlv-filters{padding:10px 14px;display:flex;flex-direction:column;gap:8px;border-bottom:1px solid #2a3a5c;}
.xlv-row{display:flex;align-items:center;gap:8px;}
.xlv-row label{width:80px;font-size:11px;color:#8892a4;text-transform:uppercase;letter-spacing:.5px;flex-shrink:0;}
.xlv-row select,.xlv-row input[type=text],.xlv-row textarea{flex:1;background:#16213e;color:#e0e0e0;border:1px solid #2a3a5c;
border-radius:4px;padding:5px 8px;font-size:12px;font-family:inherit;outline:none;}
.xlv-row textarea{resize:vertical;min-height:60px;font-family:'Menlo','Consolas',monospace;line-height:1.5;}
.xlv-row select:focus,.xlv-row input:focus,.xlv-row textarea:focus{border-color:#4fc3f7;}
.xlv-row select:disabled,.xlv-row textarea:disabled,.xlv-row input:disabled{opacity:.5;}
.xlv-levels{display:flex;gap:4px;flex:1;}
.xlv-lvl{flex:1;padding:4px 8px;font-size:11px;border:1px solid #2a3a5c;border-radius:4px;
background:#16213e;color:#8892a4;cursor:pointer;font-family:inherit;}
.xlv-lvl:hover{background:#1f3055;}
.xlv-lvl.active{background:#2a7fb5;color:#fff;border-color:#4fc3f7;}
.xlv-search{flex:1;display:flex;gap:4px;}
.xlv-search input{flex:1;}
.xlv-btn{background:#16213e;color:#4fc3f7;border:1px solid #2a3a5c;border-radius:4px;
padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit;}
.xlv-btn:hover{background:#1f3055;}
.xlv-btn:disabled{opacity:.4;cursor:default;}
.xlv-actions{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;
border-bottom:1px solid #2a3a5c;background:#16213e;}
.xlv-act-left{display:flex;align-items:center;gap:8px;}
.xlv-act-left label{display:flex;align-items:center;gap:4px;font-size:12px;color:#8892a4;cursor:pointer;}
.xlv-act-left input[type=checkbox]{accent-color:#4fc3f7;}
.xlv-act-left select{width:60px;background:#16213e;color:#e0e0e0;border:1px solid #2a3a5c;
border-radius:4px;padding:3px 6px;font-size:12px;outline:none;}
.xlv-results-hdr{display:flex;justify-content:space-between;align-items:center;padding:6px 14px;
font-size:11px;color:#8892a4;border-bottom:1px solid #2a3a5c;}
.xlv-paging{display:flex;align-items:center;gap:6px;}
.xlv-paging button{background:#16213e;color:#e0e0e0;border:1px solid #2a3a5c;border-radius:3px;
padding:2px 8px;cursor:pointer;font-size:12px;}
.xlv-paging button:disabled{opacity:.3;cursor:default;}
.xlv-paging button:not(:disabled):hover{background:#1f3055;}
#xlv-logs{flex:1;overflow-y:auto;padding:0;}
#xlv-logs::-webkit-scrollbar{width:6px;}
#xlv-logs::-webkit-scrollbar-track{background:#1a1a2e;}
#xlv-logs::-webkit-scrollbar-thumb{background:#2a3a5c;border-radius:3px;}
.xlv-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#8892a4;
font-size:12px;padding:20px;text-align:center;}
.xlv-loading{color:#4fc3f7;}
.xlv-error{color:#ef5350;}
.xlv-entry{padding:8px 14px;border-bottom:1px solid #2a3a5c;cursor:pointer;transition:background .15s;}
.xlv-entry:hover{background:#1f3055;}
.xlv-entry.xlv-new{animation:xlvHighlight 1.5s ease-out;}
@keyframes xlvHighlight{from{background:#2a7fb5;}to{background:transparent;}}
.xlv-entry-hdr{display:flex;align-items:center;gap:8px;margin-bottom:4px;}
.xlv-time{font-family:'Menlo','Consolas',monospace;font-size:11px;color:#8892a4;}
.xlv-level{font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.5px;}
.xlv-level.debug{background:#2a2a3e;color:#9e9e9e;}
.xlv-level.info{background:#1a2e4a;color:#4fc3f7;}
.xlv-level.error{background:#3e1a1a;color:#ef5350;}
.xlv-cmd{font-size:11px;color:#8892a4;margin-left:auto;}
.xlv-content{font-family:'Menlo','Consolas',monospace;font-size:11px;line-height:1.5;color:#e0e0e0;
white-space:pre-wrap;word-break:break-word;max-height:60px;overflow:hidden;transition:max-height .2s;}
.xlv-entry.expanded .xlv-content{max-height:none;}
.xlv-live-btn{padding:4px 10px;font-size:11px;border:1px solid #2a3a5c;border-radius:4px;
background:#16213e;color:#8892a4;cursor:pointer;font-family:inherit;font-weight:600;}
.xlv-live-btn:hover{background:#1f3055;}
.xlv-live-btn.active{background:#3e1a1a;color:#ef5350;border-color:#ef5350;animation:xlvPulse 2s infinite;}
@keyframes xlvPulse{0%,100%{opacity:1;}50%{opacity:.6;}}
.xlv-closer-form{padding:14px;display:flex;flex-direction:column;gap:12px;}
.xlv-closer-form label{font-size:11px;color:#8892a4;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px;display:block;}
.xlv-closer-form select,.xlv-closer-form textarea,.xlv-closer-form input{width:100%;background:#16213e;color:#e0e0e0;
border:1px solid #2a3a5c;border-radius:4px;padding:8px;font-size:12px;font-family:inherit;outline:none;box-sizing:border-box;}
.xlv-closer-form textarea{font-family:'Menlo','Consolas',monospace;min-height:80px;resize:vertical;line-height:1.5;}
.xlv-closer-form select:focus,.xlv-closer-form textarea:focus,.xlv-closer-form input:focus{border-color:#4fc3f7;}
.xlv-close-btn{padding:10px 20px;font-size:13px;font-weight:600;border:none;border-radius:4px;cursor:pointer;
font-family:inherit;transition:all .15s;}
.xlv-close-btn.danger{background:#ef5350;color:#fff;}
.xlv-close-btn.danger:hover{background:#f44336;}
.xlv-close-btn.danger:disabled{background:#5a2a2a;color:#8892a4;cursor:default;}
.xlv-closer-result{flex:1;overflow-y:auto;padding:14px;}
.xlv-result-item{padding:8px 12px;margin-bottom:6px;border-radius:4px;font-size:12px;font-family:'Menlo','Consolas',monospace;}
.xlv-result-item.success{background:#1a3e1a;color:#66bb6a;border:1px solid #2d5a2d;}
.xlv-result-item.failure{background:#3e1a1a;color:#ef5350;border:1px solid #5a2d2d;}
.xlv-result-item.pending{background:#16213e;color:#8892a4;border:1px solid #2a3a5c;}
.xlv-id-count{font-size:11px;color:#8892a4;margin-top:4px;}
.xlv-btn-row{display:flex;gap:8px;align-items:center;}
.xlv-alert-item{display:flex;align-items:flex-start;gap:8px;padding:6px 14px;border-bottom:1px solid #2a3a5c;font-size:12px;cursor:pointer;transition:background .1s;}
.xlv-alert-item:hover{background:#1f3055;}
.xlv-alert-item input[type=checkbox]{accent-color:#4fc3f7;margin-top:3px;flex-shrink:0;}
.xlv-alert-item .xlv-alert-info{flex:1;min-width:0;}
.xlv-alert-item .xlv-alert-name{color:#e0e0e0;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.xlv-alert-item .xlv-alert-meta{font-size:10px;color:#8892a4;margin-top:2px;}
.xlv-alert-sev{font-size:9px;font-weight:700;padding:1px 4px;border-radius:2px;text-transform:uppercase;margin-left:6px;}
.xlv-alert-sev.critical,.xlv-alert-sev.high{background:#3e1a1a;color:#ef5350;}
.xlv-alert-sev.medium{background:#3e2e1a;color:#ffa726;}
.xlv-alert-sev.low,.xlv-alert-sev.informational{background:#1a2e4a;color:#4fc3f7;}
.xlv-select-bar{display:flex;justify-content:space-between;align-items:center;padding:4px 14px;background:#16213e;border-bottom:1px solid #2a3a5c;font-size:11px;color:#8892a4;}
.xlv-select-bar button{background:none;border:none;color:#4fc3f7;cursor:pointer;font-size:11px;font-family:inherit;padding:2px 4px;}
.xlv-select-bar button:hover{text-decoration:underline;}
.xlv-mode-toggle{display:flex;border:1px solid #2a3a5c;border-radius:4px;overflow:hidden;margin-bottom:0;}
.xlv-mode-btn{flex:1;padding:6px 12px;font-size:11px;font-weight:600;text-align:center;cursor:pointer;
border:none;background:#16213e;color:#8892a4;font-family:inherit;transition:all .15s;}
.xlv-mode-btn:first-child{border-right:1px solid #2a3a5c;}
.xlv-mode-btn:hover{background:#1f3055;color:#e0e0e0;}
.xlv-mode-btn.active{background:#2a7fb5;color:#fff;}
.xlv-modal-overlay{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);
display:flex;align-items:center;justify-content:center;z-index:10;}
.xlv-modal{background:#1a1a2e;border:1px solid #2a3a5c;border-radius:8px;padding:20px;width:380px;max-width:90%;
box-shadow:0 8px 32px rgba(0,0,0,0.5);}
.xlv-modal h3{color:#4fc3f7;font-size:14px;margin:0 0 16px 0;}
.xlv-modal label{font-size:11px;color:#8892a4;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;display:block;}
.xlv-modal select,.xlv-modal textarea{width:100%;background:#16213e;color:#e0e0e0;border:1px solid #2a3a5c;
border-radius:4px;padding:8px;font-size:12px;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:12px;}
.xlv-modal textarea{font-family:'Menlo','Consolas',monospace;min-height:60px;resize:vertical;line-height:1.5;}
.xlv-modal select:focus,.xlv-modal textarea:focus{border-color:#4fc3f7;}
.xlv-modal-btns{display:flex;gap:8px;justify-content:flex-end;margin-top:4px;}
.xlv-modal-btns button{padding:8px 16px;font-size:12px;font-weight:600;border:none;border-radius:4px;
cursor:pointer;font-family:inherit;transition:all .15s;}
.xlv-modal-cancel{background:#16213e;color:#8892a4;border:1px solid #2a3a5c!important;}
.xlv-modal-cancel:hover{background:#1f3055;color:#e0e0e0;}
.xlv-modal-confirm{background:#ef5350;color:#fff;}
.xlv-modal-confirm:hover{background:#f44336;}
.xlv-ds-group{border-bottom:1px solid #2a3a5c;}
.xlv-ds-hdr{display:flex;align-items:center;gap:8px;padding:7px 14px;background:#16213e;cursor:pointer;
font-size:12px;font-weight:600;color:#e0e0e0;}
.xlv-ds-hdr:hover{background:#1f3055;}
.xlv-ds-arrow{color:#8892a4;font-size:9px;width:9px;flex-shrink:0;}
.xlv-ds-group.expanded .xlv-ds-arrow{transform:rotate(90deg);}
.xlv-ds-badge{margin-left:auto;font-size:10px;color:#8892a4;font-weight:400;}
.xlv-ds-body{display:none;}
.xlv-ds-group.expanded .xlv-ds-body{display:block;}
.xlv-ds-inst{display:flex;align-items:center;gap:8px;padding:5px 14px 5px 31px;font-size:11px;
border-top:1px solid #1f2b45;font-family:'Menlo','Consolas',monospace;}
.xlv-ds-inst-name{color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.xlv-ds-status{margin-left:auto;font-size:9px;font-weight:700;padding:1px 5px;border-radius:2px;
text-transform:uppercase;letter-spacing:.3px;flex-shrink:0;}
.xlv-ds-status.ok{background:#1a3e1a;color:#66bb6a;}
.xlv-ds-status.bad{background:#3e1a1a;color:#ef5350;}
.xlv-ds-status.warn{background:#3e2e1a;color:#ffa726;}
.xlv-ds-status.unknown{background:#2a2a3e;color:#9e9e9e;}
.xlv-footer{padding:5px 14px;background:#16213e;border-top:1px solid #2a3a5c;font-size:10px;
color:#8892a4;text-align:center;flex-shrink:0;}
.xlv-resize-left{position:absolute;left:0;top:0;bottom:0;width:5px;cursor:ew-resize;z-index:2;background:transparent;}
.xlv-resize-left:hover,.xlv-resize-left.active{background:rgba(79,195,247,0.3);}
#xsiam-log-viewer.xlv-fullpage .xlv-resize-left{display:none;}
`;

const style=document.createElement('style');
style.textContent=CSS;
document.head.appendChild(style);

const panel=document.createElement('div');
panel.id='xsiam-log-viewer';
panel.innerHTML=`
<div class="xlv-resize-left" id="xlv-resize-left"></div>
<div id="xlv-header"><h2><span class="xlv-logo"></span>Cortex Engineering Assistant</h2><div class="xlv-hdr-btns"><button class="xlv-fullpage-btn" id="xlv-fullpage-toggle" title="Toggle full page">&#x26F6;</button><button class="xlv-close" title="Close">&times;</button></div></div>
<div class="xlv-tabs">
  <button class="xlv-tab active" data-tab="logs">Log Viewer</button>
  <button class="xlv-tab" data-tab="closer">Closer</button>
  <button class="xlv-tab" data-tab="sources">Data Sources</button>
</div>
<div class="xlv-tab-content active" id="xlv-tab-logs">
  <div class="xlv-filters">
    <div class="xlv-row"><label>Integration</label><select id="xlv-integration" disabled><option>Loading...</option></select></div>
    <div class="xlv-row"><label>Instance</label><select id="xlv-instance" disabled><option>Select integration first</option></select></div>
    <div class="xlv-row"><label>Log Level</label><div class="xlv-levels">
      <button class="xlv-lvl active" data-level="">All</button>
      <button class="xlv-lvl" data-level="debug">Debug</button>
      <button class="xlv-lvl" data-level="info">Info</button>
      <button class="xlv-lvl" data-level="error">Error</button>
    </div></div>
    <div class="xlv-row"><label>Search</label><div class="xlv-search">
      <input type="text" id="xlv-search" placeholder="Free text search...">
      <button class="xlv-btn" id="xlv-search-btn">Search</button>
    </div></div>
  </div>
  <div class="xlv-actions">
    <div class="xlv-act-left">
      <button class="xlv-live-btn" id="xlv-live" title="Stream new logs like tail -f">LIVE</button>
      <label><input type="checkbox" id="xlv-auto-refresh">Auto-refresh</label>
      <select id="xlv-interval" disabled>
        <option value="5000">5s</option><option value="10000" selected>10s</option>
        <option value="30000">30s</option><option value="60000">60s</option>
      </select>
    </div>
    <div>
      <select class="xlv-btn" id="xlv-export">
        <option value="">Export...</option><option value="json">JSON</option><option value="csv">CSV</option>
      </select>
    </div>
  </div>
  <div class="xlv-results-hdr">
    <span id="xlv-count">No logs loaded</span>
    <div class="xlv-paging">
      <button id="xlv-prev" disabled>&lt;</button>
      <span id="xlv-page">--</span>
      <button id="xlv-next" disabled>&gt;</button>
    </div>
  </div>
  <div id="xlv-logs"><div class="xlv-empty">Select an integration to view logs.</div></div>
</div>
<div class="xlv-tab-content" id="xlv-tab-closer">
  <div class="xlv-closer-form" id="xlv-closer-filters">
    <div class="xlv-mode-toggle">
      <button class="xlv-mode-btn" data-mode="cases">Cases</button>
      <button class="xlv-mode-btn active" data-mode="issues">Issues</button>
    </div>
    <div class="xlv-row"><label>Search</label><div class="xlv-search">
      <input type="text" id="xlv-closer-search" placeholder="Search by name, description...">
      <button class="xlv-btn" id="xlv-closer-search-btn">Search</button>
    </div></div>
    <div class="xlv-row"><label>Severity</label>
      <select id="xlv-closer-severity">
        <option value="">All</option>
        <option value="SEV_010_INFO">Informational</option>
        <option value="SEV_020_LOW">Low</option>
        <option value="SEV_030_MEDIUM">Medium</option>
        <option value="SEV_040_HIGH">High</option>
        <option value="SEV_050_CRITICAL">Critical</option>
      </select>
    </div>
    <div class="xlv-row"><label>Status</label>
      <select id="xlv-closer-status">
        <option value="STATUS_010_NEW" selected>New</option>
        <option value="STATUS_020_UNDER_INVESTIGATION">Under Investigation</option>
        <option value="">All Open</option>
      </select>
    </div>
    <div class="xlv-btn-row" style="padding:0;">
      <button class="xlv-btn" id="xlv-closer-fetch">Fetch Issues</button>
      <span style="color:#8892a4;font-size:11px;">or enter IDs manually below</span>
    </div>
  </div>
  <div id="xlv-closer-list" style="max-height:200px;overflow-y:auto;border-bottom:1px solid #2a3a5c;display:none;"></div>
  <div class="xlv-closer-form">
    <div>
      <label for="xlv-close-ids">Selected IDs</label>
      <textarea id="xlv-close-ids" placeholder="e.g. 12345, 12346, 12347&#10;or one per line&#10;or use Search above to find and select"></textarea>
      <div class="xlv-id-count" id="xlv-id-count">0 IDs entered</div>
    </div>
    <div class="xlv-btn-row">
      <button class="xlv-close-btn danger" id="xlv-close-submit" disabled>Close 0 Issues</button>
    </div>
  </div>
  <div class="xlv-closer-result" id="xlv-close-results">
    <div class="xlv-empty">Search above or enter IDs manually, then click Close.</div>
  </div>
</div>
<div class="xlv-tab-content" id="xlv-tab-sources">
  <div class="xlv-closer-form" style="gap:8px;">
    <div class="xlv-mode-toggle">
      <button class="xlv-mode-btn active" data-ds="xsoar">XSOAR</button>
      <button class="xlv-mode-btn" data-ds="xdr">XDR</button>
    </div>
    <div class="xlv-row"><label>Filter</label><div class="xlv-search">
      <input type="text" id="xlv-ds-filter" placeholder="Filter by data source or instance name...">
      <button class="xlv-btn" id="xlv-ds-refresh" title="Re-fetch from API">Refresh</button>
    </div></div>
    <div class="xlv-btn-row">
      <button class="xlv-btn" id="xlv-ds-copy">Copy JSON</button>
      <button class="xlv-btn" id="xlv-ds-export">Export JSON</button>
      <button class="xlv-btn" id="xlv-ds-csv">Export CSV</button>
      <span id="xlv-ds-count" style="color:#8892a4;font-size:11px;margin-left:auto;"></span>
    </div>
  </div>
  <div id="xlv-ds-list" style="flex:1;overflow-y:auto;"><div class="xlv-empty xlv-loading">Loading data sources...</div></div>
</div>
<div class="xlv-footer">Credit to Daniel Spier</div>`;
document.body.appendChild(panel);

/* Tab switching */
document.querySelectorAll('.xlv-tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.xlv-tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.xlv-tab-content').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('xlv-tab-'+tab.dataset.tab).classList.add('active');
  });
});

/* Full page toggle */
const $=id=>document.getElementById(id);
let savedPos={};
$('xlv-fullpage-toggle').onclick=()=>{
  isFullPage=!isFullPage;
  if(isFullPage){
    savedPos={top:panel.style.top,left:panel.style.left,right:panel.style.right};
    panel.classList.add('xlv-fullpage');
  }else{
    panel.classList.remove('xlv-fullpage');
    panel.style.top=savedPos.top||'0';
    panel.style.left=savedPos.left||'';
    panel.style.right=savedPos.right||'0';
  }
};

/* Drag support */
const hdr=document.getElementById('xlv-header');
let dragging=false,dx=0,dy=0;
hdr.addEventListener('mousedown',e=>{
  if(e.target.closest('.xlv-close')||e.target.closest('.xlv-fullpage-btn'))return;
  if(isFullPage)return;
  dragging=true;
  const r=panel.getBoundingClientRect();
  dx=e.clientX-r.left;dy=e.clientY-r.top;
  panel.style.transition='none';
});
document.addEventListener('mousemove',e=>{
  if(resizingLeft){
    const diff=resizeStartX-e.clientX;
    const newW=Math.max(320,resizeStartW+diff);
    panel.style.width=newW+'px';
    return;
  }
  if(!dragging)return;
  panel.style.left=(e.clientX-dx)+'px';
  panel.style.top=(e.clientY-dy)+'px';
  panel.style.right='auto';
});
document.addEventListener('mouseup',()=>{
  dragging=false;resizingLeft=false;
  const rl=document.getElementById('xlv-resize-left');
  if(rl)rl.classList.remove('active');
});

/* Left resize handle */
let resizingLeft=false,resizeStartX=0,resizeStartW=0;
const resizeHandle=document.getElementById('xlv-resize-left');
resizeHandle.addEventListener('mousedown',e=>{
  if(isFullPage)return;
  e.preventDefault();e.stopPropagation();
  resizingLeft=true;
  resizeStartX=e.clientX;
  resizeStartW=panel.offsetWidth;
  resizeHandle.classList.add('active');
});

$('xlv-header').querySelector('.xlv-close').onclick=()=>{panel.style.display='none';};

/* ===== LOG VIEWER TAB ===== */
const intSel=$('xlv-integration');
const instSel=$('xlv-instance');
const searchInput=$('xlv-search');
const logsDiv=$('xlv-logs');
const countEl=$('xlv-count');
const pageEl=$('xlv-page');
const prevBtn=$('xlv-prev');
const nextBtn=$('xlv-next');
const autoChk=$('xlv-auto-refresh');
const intervalSel=$('xlv-interval');
const exportSel=$('xlv-export');

document.querySelectorAll('.xlv-lvl').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.xlv-lvl').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    doFetch();
  });
});

$('xlv-search-btn').onclick=()=>doFetch();
searchInput.addEventListener('keydown',e=>{if(e.key==='Enter')doFetch();});

intSel.addEventListener('change',()=>{
  const brand=intSel.value;
  instSel.innerHTML='<option value="">All instances</option>';
  const isBuiltin=BUILTIN_SOURCES.includes(brand);
  if(isBuiltin){
    instSel.disabled=true;
  }else{
    const instances=brand
      ?allIntegrations.find(i=>i.brand===brand)?.instances||[]
      :allIntegrations.flatMap(i=>i.instances);
    instances.forEach(i=>{const o=document.createElement('option');o.value=i.name;o.textContent=i.name;instSel.appendChild(o);});
    instSel.disabled=false;
  }
  currentPage=0;doFetch();
});

instSel.addEventListener('change',()=>doFetch());

prevBtn.onclick=()=>{if(currentPage>0){currentPage--;doFetch();}};
nextBtn.onclick=()=>{currentPage++;doFetch();};

const liveBtn=$('xlv-live');

liveBtn.addEventListener('click',()=>{
  liveMode=!liveMode;
  liveBtn.classList.toggle('active',liveMode);
  if(liveMode){
    autoChk.checked=false;autoChk.disabled=true;intervalSel.disabled=true;stopRefresh();
    prevBtn.disabled=true;nextBtn.disabled=true;
    liveSeenIds.clear();lastTopTimestamp=null;
    logsDiv.innerHTML='';currentLogs=[];
    countEl.textContent='Live: 0 logs';
    doLivePoll();
    refreshTimer=setInterval(()=>doLivePoll(),3000);
  }else{
    autoChk.disabled=false;stopRefresh();
    doFetch();
  }
});

autoChk.addEventListener('change',()=>{
  if(autoChk.checked){intervalSel.disabled=false;startRefresh();}
  else{intervalSel.disabled=true;stopRefresh();}
});
intervalSel.addEventListener('change',()=>{if(autoChk.checked){stopRefresh();startRefresh();}});

exportSel.addEventListener('change',()=>{
  if(exportSel.value&&currentLogs.length)exportData(exportSel.value);
  exportSel.value='';
});

function startRefresh(){refreshTimer=setInterval(()=>doFetch(),parseInt(intervalSel.value));}
function stopRefresh(){if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}}

function makeEntryEl(l,isNew){
  const ts=new Date(l.INTEGRATION_LOG_TIMESTAMP);
  const t=ts.toLocaleTimeString('en-US',{hour12:false});
  const lv=(l.INTEGRATION_LOG_LEVEL||'').toLowerCase();
  const el=document.createElement('div');
  el.className='xlv-entry'+(isNew?' xlv-new':'');
  el.onclick=function(){this.classList.toggle('expanded');};
  el.innerHTML='<div class="xlv-entry-hdr"><span class="xlv-time">'+t+'</span>'
    +'<span class="xlv-level '+lv+'">'+lv+'</span>'
    +'<span class="xlv-cmd">'+escHtml(l.INTEGRATION_LOG_COMMAND||'')+'</span></div>'
    +'<div class="xlv-content">'+escHtml(l.INTEGRATION_LOG_CONTENT||'')+'</div>';
  return el;
}

async function doLivePoll(){
  if(!liveMode)return;
  const f=getFilters();
  f.from=0;f.to=PAGE_SIZE;
  try{
    const r=await getLogs(f);
    const logs=r.DATA||[];
    const newLogs=[];
    for(const l of logs){
      const id=l.INTEGRATION_LOG_BUNDLE_ID+'_'+l.INTEGRATION_LOG_TIMESTAMP;
      if(!liveSeenIds.has(id)){
        liveSeenIds.add(id);
        newLogs.push(l);
      }
    }
    if(newLogs.length>0){
      newLogs.sort((a,b)=>a.INTEGRATION_LOG_TIMESTAMP-b.INTEGRATION_LOG_TIMESTAMP);
      const wasAtTop=logsDiv.scrollTop<10;
      for(const l of newLogs){
        currentLogs.unshift(l);
        logsDiv.prepend(makeEntryEl(l,true));
      }
      if(wasAtTop)logsDiv.scrollTop=0;
    }
    countEl.textContent='Live: '+currentLogs.length+' logs'+(newLogs.length>0?' (+'+newLogs.length+')':'');
  }catch(e){
    countEl.textContent='Live: error polling';
  }
}

function getFilters(){
  const lvl=document.querySelector('.xlv-lvl.active');
  return{source:intSel.value,instance:instSel.value,level:lvl?.dataset.level||'',
    freeText:searchInput.value.trim(),from:currentPage*PAGE_SIZE,to:(currentPage+1)*PAGE_SIZE};
}

async function doFetch(){
  const f=getFilters();
  logsDiv.innerHTML='<div class="xlv-empty xlv-loading">Loading logs...</div>';
  try{
    const r=await getLogs(f);
    currentLogs=r.DATA||[];
    renderLogs(currentLogs,r.TOTAL_COUNT||0,r.FILTER_COUNT||0);
  }catch(e){
    logsDiv.innerHTML='<div class="xlv-empty xlv-error">Error: '+escHtml(e.message)+'</div>';
    countEl.textContent='Error';
  }
}

function renderLogs(logs,total,filtered){
  const count=filtered||total||logs.length;
  countEl.textContent='Showing '+logs.length+' of '+count+' logs';
  const pages=Math.max(1,Math.ceil(count/PAGE_SIZE));
  pageEl.textContent=(currentPage+1)+' / '+pages;
  prevBtn.disabled=currentPage===0;
  nextBtn.disabled=(currentPage+1)>=pages;
  if(!logs.length){logsDiv.innerHTML='<div class="xlv-empty">No logs found.</div>';return;}
  const newTop=logs[0]?.INTEGRATION_LOG_TIMESTAMP;
  let html='';
  for(const l of logs){
    const ts=new Date(l.INTEGRATION_LOG_TIMESTAMP);
    const t=ts.toLocaleTimeString('en-US',{hour12:false});
    const lv=(l.INTEGRATION_LOG_LEVEL||'').toLowerCase();
    const c=l.INTEGRATION_LOG_CONTENT||'';
    const isNew=lastTopTimestamp&&l.INTEGRATION_LOG_TIMESTAMP>lastTopTimestamp;
    html+='<div class="xlv-entry'+(isNew?' xlv-new':'')+'" onclick="this.classList.toggle(\'expanded\')">'
      +'<div class="xlv-entry-hdr"><span class="xlv-time">'+t+'</span>'
      +'<span class="xlv-level '+lv+'">'+lv+'</span>'
      +'<span class="xlv-cmd">'+escHtml(l.INTEGRATION_LOG_COMMAND||'')+'</span></div>'
      +'<div class="xlv-content">'+escHtml(c)+'</div></div>';
  }
  logsDiv.innerHTML=html;
  lastTopTimestamp=newTop;
}

const BUILTIN_SOURCES=['Automation','Playbook','Scripts'];
getIntegrations().then(data=>{
  allIntegrations=data;
  intSel.innerHTML='<option value="">All sources</option>';
  const grpInt=document.createElement('optgroup');grpInt.label='Integrations';
  data.forEach(i=>{const o=document.createElement('option');o.value=i.brand;
    o.textContent=(i.display||i.brand)+' ('+i.instances.length+')';grpInt.appendChild(o);});
  intSel.appendChild(grpInt);
  const grpOther=document.createElement('optgroup');grpOther.label='Other Sources';
  BUILTIN_SOURCES.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;grpOther.appendChild(o);});
  intSel.appendChild(grpOther);
  intSel.disabled=false;
}).catch(e=>{
  intSel.innerHTML='<option value="">Error: '+e.message+'</option>';
});

/* ===== CLOSER TAB ===== */
const closerSearch=$('xlv-closer-search');
const closerSearchBtn=$('xlv-closer-search-btn');
const closerSeverity=$('xlv-closer-severity');
const closerStatus=$('xlv-closer-status');
const closerFetchBtn=$('xlv-closer-fetch');
const closerList=$('xlv-closer-list');
const closeIds=$('xlv-close-ids');
const closeSubmit=$('xlv-close-submit');
const closeResults=$('xlv-close-results');
const idCountEl=$('xlv-id-count');

function modeLabel(plural){
  return closerMode==='cases'?(plural?'Cases':'Case'):(plural?'Issues':'Issue');
}

function updateModeLabels(){
  closerFetchBtn.textContent='Fetch '+modeLabel(true);
  const n=parseIds().length;
  closeSubmit.textContent='Close '+n+' '+modeLabel(n!==1);
  closerSearch.placeholder='Search '+modeLabel(true).toLowerCase()+' by name, description...';
}

/* Cases / Issues toggle */
const closerModeBtns=document.querySelectorAll('#xlv-tab-closer .xlv-mode-btn');
closerModeBtns.forEach(btn=>{
  btn.addEventListener('click',()=>{
    closerModeBtns.forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    closerMode=btn.dataset.mode;
    updateModeLabels();
    closerList.style.display='none';
    closerList.innerHTML='';
  });
});

async function fetchItems(){
  const conds=[];
  if(closerMode==='cases'){
    conds.push({SEARCH_FIELD:'LAST_UPDATE_TIME',SEARCH_TYPE:'RELATIVE_TIMESTAMP',SEARCH_VALUE:604800000});
    const status=closerStatus.value;
    if(status)conds.push({SEARCH_FIELD:'STATUS_PROGRESS',SEARCH_TYPE:'EQ',SEARCH_VALUE:status});
    else conds.push({SEARCH_FIELD:'STATUS_PROGRESS',SEARCH_TYPE:'NEQ',SEARCH_VALUE:'STATUS_025_RESOLVED'});
    const sev=closerSeverity.value;
    if(sev)conds.push({SEARCH_FIELD:'SEVERITY',SEARCH_TYPE:'EQ',SEARCH_VALUE:sev});
    const search=closerSearch.value.trim();
    if(search)conds.push({SEARCH_FIELD:'DESCRIPTION',SEARCH_TYPE:'CONTAINS',SEARCH_VALUE:search});
    const body={extraData:{fetch_blocked_incidents:false},filter_data:{sort:[{FIELD:'LAST_UPDATE_TIME',ORDER:'DESC'}],filter:{AND:conds},free_text:'',visible_columns:null,locked:{},paging:{from:0,to:100}},jsons:[]};
    return apiCall('/api/webapp/get_data',{type:'grid',table_name:'CASE_MANAGER_TABLE',data_id:'null',counts:'false'},body);
  }else{
    conds.push({SEARCH_FIELD:'source_insert_ts',SEARCH_TYPE:'RELATIVE_TIMESTAMP',SEARCH_VALUE:604800000});
    const status=closerStatus.value;
    if(status)conds.push({SEARCH_FIELD:'status.progress',SEARCH_TYPE:'EQ',SEARCH_VALUE:status});
    else conds.push({SEARCH_FIELD:'status.progress',SEARCH_TYPE:'NEQ',SEARCH_VALUE:'STATUS_025_RESOLVED'});
    const sev=closerSeverity.value;
    if(sev)conds.push({SEARCH_FIELD:'severity',SEARCH_TYPE:'EQ',SEARCH_VALUE:sev});
    const search=closerSearch.value.trim();
    if(search)conds.push({SEARCH_FIELD:'alert_name',SEARCH_TYPE:'CONTAINS',SEARCH_VALUE:search});
    const body={extraData:{fieldsToExclude:['extended_fields']},filter_data:{sort:[{FIELD:'source_insert_ts',ORDER:'DESC'}],filter:{AND:conds},free_text:'',visible_columns:null,locked:{},paging:{from:0,to:100}},jsons:[]};
    return apiCall('/api/webapp/get_data',{type:'grid',table_name:'ALERTS_VIEW_TABLE'},body);
  }
}

function renderItemList(items){
  closerList.style.display='block';
  const label=modeLabel(true).toLowerCase();
  if(!items.length){
    closerList.innerHTML='<div class="xlv-empty" style="height:auto;padding:12px;">No '+label+' found.</div>';
    return;
  }
  let html='<div class="xlv-select-bar"><span>'+items.length+' '+label+'</span><span><button id="xlv-sel-all">Select All</button> | <button id="xlv-sel-none">Clear</button> | <button id="xlv-sel-add">Add Selected to IDs</button></span></div>';
  for(const a of items){
    let id,name,ts,sev;
    if(closerMode==='cases'){
      id=a.CASE_ID||'';
      name=a.DESCRIPTION||'Case '+id;
      const rawSev=(a.SEVERITY||'').replace(/^SEV_\d+_/,'').toLowerCase();
      sev=rawSev||'';
      ts=a.CREATION_TIME?new Date(a.CREATION_TIME).toLocaleDateString():'';
    }else{
      id=a.internal_id||a.alert_id||a.id||'';
      name=a.alert_name||a.name||a.description||'Issue '+id;
      const rawSev=(a.severity||'').replace(/^SEV_\d+_/,'').toLowerCase();
      sev=rawSev||'';
      ts=a.source_insert_ts?new Date(a.source_insert_ts).toLocaleDateString():(a.creation_time?new Date(a.creation_time).toLocaleDateString():'');
    }
    const src=a.alert_source||'';
    html+='<div class="xlv-alert-item" data-id="'+escHtml(String(id))+'">'
      +'<input type="checkbox" class="xlv-alert-chk">'
      +'<div class="xlv-alert-info"><div class="xlv-alert-name">'+escHtml(String(id))+': '+escHtml(name)
      +'<span class="xlv-alert-sev '+sev+'">'+sev+'</span></div>'
      +'<div class="xlv-alert-meta">'+escHtml(ts)+(src?' | '+escHtml(String(src)):'')+'</div></div></div>';
  }
  closerList.innerHTML=html;

  closerList.querySelectorAll('.xlv-alert-item').forEach(item=>{
    item.addEventListener('click',e=>{
      if(e.target.type==='checkbox')return;
      const chk=item.querySelector('.xlv-alert-chk');
      chk.checked=!chk.checked;
    });
  });

  const selAll=document.getElementById('xlv-sel-all');
  const selNone=document.getElementById('xlv-sel-none');
  const selAdd=document.getElementById('xlv-sel-add');
  if(selAll)selAll.onclick=()=>closerList.querySelectorAll('.xlv-alert-chk').forEach(c=>{c.checked=true;});
  if(selNone)selNone.onclick=()=>closerList.querySelectorAll('.xlv-alert-chk').forEach(c=>{c.checked=false;});
  if(selAdd)selAdd.onclick=()=>{
    const selected=[];
    closerList.querySelectorAll('.xlv-alert-item').forEach(item=>{
      if(item.querySelector('.xlv-alert-chk').checked)selected.push(item.dataset.id);
    });
    if(!selected.length)return;
    const existing=parseIds();
    const merged=[...new Set([...existing,...selected])];
    closeIds.value=merged.join(', ');
    closeIds.dispatchEvent(new Event('input'));
  };
}

closerFetchBtn.addEventListener('click',async()=>{
  closerList.style.display='block';
  closerList.innerHTML='<div class="xlv-empty xlv-loading" style="height:auto;padding:12px;">Loading '+modeLabel(true).toLowerCase()+'...</div>';
  try{
    const r=await fetchItems();
    renderItemList(r.DATA||[]);
  }catch(e){
    closerList.innerHTML='<div class="xlv-empty xlv-error" style="height:auto;padding:12px;">Error: '+escHtml(e.message)+'</div>';
  }
});

closerSearchBtn.addEventListener('click',()=>closerFetchBtn.click());
closerSearch.addEventListener('keydown',e=>{if(e.key==='Enter')closerFetchBtn.click();});

function parseIds(){
  return closeIds.value.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
}

closeIds.addEventListener('input',()=>{
  const ids=parseIds();
  const n=ids.length;
  idCountEl.textContent=n+' ID'+(n!==1?'s':'')+' entered';
  closeSubmit.textContent='Close '+n+' '+modeLabel(n!==1);
  closeSubmit.disabled=n===0;
});

function showCloseModal(ids){
  const label=modeLabel(ids.length!==1);
  const overlay=document.createElement('div');
  overlay.className='xlv-modal-overlay';
  overlay.innerHTML='<div class="xlv-modal">'
    +'<h3>Close '+ids.length+' '+label+'</h3>'
    +'<label for="xlv-modal-reason">Resolution Status</label>'
    +'<select id="xlv-modal-reason">'
    +'<option value="STATUS_030_RESOLVED_TRUE_POSITIVE">Resolved - True Positive</option>'
    +'<option value="STATUS_040_RESOLVED_SECURITY_TESTING">Resolved - Security Testing</option>'
    +'<option value="STATUS_050_RESOLVED_DUPLICATE">Resolved - Duplicate</option>'
    +'<option value="STATUS_060_RESOLVED_FALSE_POSITIVE">Resolved - False Positive</option>'
    +'<option value="STATUS_070_RESOLVED_OTHER" selected>Resolved - Other</option>'
    +'</select>'
    +'<label for="xlv-modal-comment">Comment (optional)</label>'
    +'<textarea id="xlv-modal-comment" placeholder="Enter close reason / notes..."></textarea>'
    +'<div class="xlv-modal-btns">'
    +'<button class="xlv-modal-cancel">Cancel</button>'
    +'<button class="xlv-modal-confirm">Close '+label+'</button>'
    +'</div></div>';
  panel.appendChild(overlay);

  overlay.querySelector('.xlv-modal-cancel').onclick=()=>overlay.remove();
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});

  overlay.querySelector('.xlv-modal-confirm').onclick=async()=>{
    const reason=document.getElementById('xlv-modal-reason').value;
    const reasonLabel=document.getElementById('xlv-modal-reason').options[document.getElementById('xlv-modal-reason').selectedIndex].text;
    const comment=document.getElementById('xlv-modal-comment').value.trim();
    overlay.remove();
    await doClose(ids,reason,reasonLabel,comment);
  };
}

async function doClose(ids,reason,reasonLabel,comment){
  const label=modeLabel(true).toLowerCase();
  closeSubmit.disabled=true;
  closeSubmit.textContent='Closing...';
  closeResults.innerHTML='<div class="xlv-result-item pending">Sending close request for '+ids.length+' '+label+'...<br>Resolution: '+escHtml(reasonLabel)+(comment?'<br>Comment: '+escHtml(comment):'')+'</div>';

  async function safePost(url,body){
    const r=await fetch(url,{
      method:'POST',
      headers:{'accept':'application/json, text/plain, */*','content-type':'application/json','x-csrf-token':getCsrf()},
      body:JSON.stringify(body),
      credentials:'include'
    });
    const text=await r.text();
    if(!r.ok)throw new Error('HTTP '+r.status+': '+text.substring(0,120));
    try{return JSON.parse(text);}catch(e){throw new Error('Invalid response: '+text.substring(0,120));}
  }

  try{
    if(closerMode==='cases'){
      let allIssueIds=[];
      closeResults.innerHTML='<div class="xlv-result-item pending">Fetching issues for '+ids.length+' case(s)...</div>';
      for(const cid of ids){
        try{
          const r=await fetch('/api/webapp/case/get_issue_ids_in_case?case_id='+encodeURIComponent(cid),{
            method:'GET',
            headers:{'accept':'application/json','x-csrf-token':getCsrf()},
            credentials:'include'
          });
          const d=await r.json();
          const issueIds=d.reply||[];
          allIssueIds=allIssueIds.concat(issueIds);
        }catch(e){
          closeResults.innerHTML='<div class="xlv-result-item failure">Failed to get issues for case '+escHtml(String(cid))+': '+escHtml(e.message)+'</div>';
          closeSubmit.textContent='Close 0 '+modeLabel(true);
          closeSubmit.disabled=true;
          return;
        }
      }
      if(!allIssueIds.length){
        closeResults.innerHTML='<div class="xlv-result-item failure">No issues found in the selected case(s).</div>';
        closeSubmit.textContent='Close 0 '+modeLabel(true);
        closeSubmit.disabled=true;
        return;
      }
      closeResults.innerHTML='<div class="xlv-result-item pending">Closing '+allIssueIds.length+' issue(s) across '+ids.length+' case(s)...</div>';
      const orConditions=allIssueIds.map(id=>({
        SEARCH_FIELD:'internal_id',
        SEARCH_TYPE:'EQ',
        SEARCH_VALUE:String(id)
      }));
      const payload={
        filter_data:{filter:{OR:orConditions}},
        filter_type:'static',
        update_data:{
          resolution_status:reason,
          resolution_comment:comment||'Closed via Cortex Engineering Assistant'
        }
      };
      const d=await safePost('/api/webapp/alerts/update_alerts',payload);
      if(d.reply?.err_code){
        closeResults.innerHTML='<div class="xlv-result-item failure">Error: '+escHtml(d.reply.err_msg||'API error '+d.reply.err_code)+'</div>';
      }else{
        const updated=d.reply?.alerts_count||d.reply?.updated_count||allIssueIds.length;
        closeResults.innerHTML='<div class="xlv-result-item success">Successfully closed '+updated+' issue(s) across '+ids.length+' case(s)<br>Resolution: '+escHtml(reasonLabel)+(comment?'<br>Comment: '+escHtml(comment):'')+'<br>Case IDs: '+escHtml(ids.join(', '))+'</div>';
        closeIds.value='';
        idCountEl.textContent='0 IDs entered';
      }
    }else{
      const orConditions=ids.map(id=>({
        SEARCH_FIELD:'internal_id',
        SEARCH_TYPE:'EQ',
        SEARCH_VALUE:id
      }));
      const payload={
        filter_data:{filter:{OR:orConditions}},
        filter_type:'static',
        update_data:{
          resolution_status:reason,
          resolution_comment:comment||'Closed via Cortex Engineering Assistant'
        }
      };
      const d=await safePost('/api/webapp/alerts/update_alerts',payload);
      if(d.reply?.err_code){
        closeResults.innerHTML='<div class="xlv-result-item failure">Error: '+escHtml(d.reply.err_msg||'API error '+d.reply.err_code)+'</div>';
      }else{
        const updated=d.reply?.alerts_count||d.reply?.updated_count||ids.length;
        closeResults.innerHTML='<div class="xlv-result-item success">Successfully closed '+updated+' issue(s)<br>Resolution: '+escHtml(reasonLabel)+(comment?'<br>Comment: '+escHtml(comment):'')+'<br>IDs: '+escHtml(ids.join(', '))+'</div>';
        closeIds.value='';
        idCountEl.textContent='0 IDs entered';
      }
    }
  }catch(e){
    closeResults.innerHTML='<div class="xlv-result-item failure">Request failed: '+escHtml(e.message)+'</div>';
  }

  closeSubmit.textContent='Close 0 '+modeLabel(true);
  closeSubmit.disabled=true;
}

closeSubmit.addEventListener('click',()=>{
  const ids=parseIds();
  if(!ids.length)return;
  showCloseModal(ids);
});

/* ===== DATA SOURCES TAB ===== */
const dsList=$('xlv-ds-list');
const dsFilter=$('xlv-ds-filter');
const dsCount=$('xlv-ds-count');
let dsMode='xsoar';
let dsReport=null;

function buildSourcesReport(reply){
  const xdrNameMap=Object.fromEntries(
    (reply.xdr_integrations?.configurations||[])
      .filter(c=>c.collector!=null)
      .map(c=>[c.collector,c.name||c.collector])
  );
  const xdrGrouped={},xdrSummary={};
  for(const inst of reply.xdr_integrations?.instances||[]){
    const key=xdrNameMap[inst.collector]||inst.collector||'UNKNOWN';
    (xdrGrouped[key]=xdrGrouped[key]||[]).push(inst);
    (xdrSummary[key]=xdrSummary[key]||[]).push({name:inst.name,StatusUI:inst.StatusUI});
  }
  const xsoarGrouped={},xsoarSummary={};
  for(const cfg of reply.xsoar_integrations?.configurations||[]){
    const instances=cfg.instances||[];
    if(!instances.length)continue;
    const key=cfg.display||cfg.name||'UNKNOWN';
    (xsoarGrouped[key]=xsoarGrouped[key]||[]).push(...instances);
    (xsoarSummary[key]=xsoarSummary[key]||[]).push(...instances.map(i=>({name:i.name,status:i.status})));
  }
  return{
    integration_types:Object.keys(reply).sort(),
    xdr_integrations:{
      data_source_names:Object.keys(xdrSummary).sort(),
      status_summary:{data_sources:xdrSummary},
      grouped_sources:{data_sources:xdrGrouped}
    },
    xsoar_integrations:{
      data_source_names:Object.keys(xsoarSummary).sort(),
      status_summary:{data_sources:xsoarSummary},
      grouped_sources:{data_sources:xsoarGrouped}
    }
  };
}

function statusClass(s){
  const v=String(s==null?'':s).toLowerCase();
  if(!v)return'unknown';
  if(/error|fail|disabled|inactive|down|unhealth/.test(v))return'bad';
  if(/warn|pending|partial/.test(v))return'warn';
  if(/active|enabled|ok|success|healthy|connected|up|true/.test(v))return'ok';
  return'unknown';
}

function renderSources(){
  if(!dsReport)return;
  const grp=dsMode==='xdr'?dsReport.xdr_integrations:dsReport.xsoar_integrations;
  const summary=grp.status_summary.data_sources;
  const q=dsFilter.value.trim().toLowerCase();
  const names=grp.data_source_names.filter(n=>{
    if(!q)return true;
    if(n.toLowerCase().includes(q))return true;
    return(summary[n]||[]).some(i=>String(i.name||'').toLowerCase().includes(q));
  });
  let totalInst=0;
  grp.data_source_names.forEach(n=>{totalInst+=(summary[n]||[]).length;});
  dsCount.textContent=names.length+' of '+grp.data_source_names.length+' sources | '+totalInst+' instances';
  if(!names.length){
    dsList.innerHTML='<div class="xlv-empty" style="height:auto;padding:20px;">No data sources match that filter.</div>';
    return;
  }
  let html='';
  for(const n of names){
    const insts=summary[n]||[];
    const shown=q?insts.filter(i=>n.toLowerCase().includes(q)||String(i.name||'').toLowerCase().includes(q)):insts;
    const use=shown.length?shown:insts;
    html+='<div class="xlv-ds-group'+(q?' expanded':'')+'">'
      +'<div class="xlv-ds-hdr"><span class="xlv-ds-arrow">&#9654;</span>'+escHtml(n)
      +'<span class="xlv-ds-badge">'+use.length+' instance'+(use.length!==1?'s':'')+'</span></div>'
      +'<div class="xlv-ds-body">';
    for(const i of use){
      const st=dsMode==='xdr'?i.StatusUI:i.status;
      const label=st==null||st===''?'n/a':String(st);
      html+='<div class="xlv-ds-inst"><span class="xlv-ds-inst-name">'+escHtml(String(i.name||'(unnamed)'))+'</span>'
        +'<span class="xlv-ds-status '+statusClass(st)+'">'+escHtml(label)+'</span></div>';
    }
    html+='</div></div>';
  }
  dsList.innerHTML=html;
  dsList.querySelectorAll('.xlv-ds-hdr').forEach(h=>{
    h.addEventListener('click',()=>h.parentElement.classList.toggle('expanded'));
  });
}

async function loadSources(){
  dsList.innerHTML='<div class="xlv-empty xlv-loading">Loading data sources...</div>';
  dsCount.textContent='';
  try{
    const reply=await apiCall('/api/webapp/data_sources/get_data_sources_instances/',null,{from_cache:true});
    dsReport=buildSourcesReport(reply);
    renderSources();
  }catch(e){
    dsList.innerHTML='<div class="xlv-empty xlv-error">Error: '+escHtml(e.message)+'</div>';
  }
}

document.querySelectorAll('#xlv-tab-sources .xlv-mode-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#xlv-tab-sources .xlv-mode-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    dsMode=btn.dataset.ds;
    renderSources();
  });
});

dsFilter.addEventListener('input',()=>renderSources());
$('xlv-ds-refresh').onclick=()=>loadSources();

$('xlv-ds-copy').onclick=async()=>{
  if(!dsReport)return;
  const btn=$('xlv-ds-copy');
  try{
    await navigator.clipboard.writeText(JSON.stringify(dsReport,null,2));
    btn.textContent='Copied!';
  }catch(e){
    btn.textContent='Copy failed';
  }
  setTimeout(()=>{btn.textContent='Copy JSON';},1500);
};

function dsDownload(blob,name){
  const u=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=u;a.download=name;a.click();
  URL.revokeObjectURL(u);
}

$('xlv-ds-export').onclick=()=>{
  if(!dsReport)return;
  dsDownload(new Blob([JSON.stringify(dsReport,null,2)],{type:'application/json'}),'xsiam-data-sources.json');
};

document.querySelector('.xlv-tab[data-tab="sources"]').addEventListener('click',()=>{
  if(!dsReport)loadSources();
});

$('xlv-ds-csv').onclick=()=>{
  if(!dsReport)return;
  const rows=[['group','data_source','instance','status']];
  for(const[grpKey,grpName]of[['xsoar_integrations','XSOAR'],['xdr_integrations','XDR']]){
    const g=dsReport[grpKey];
    for(const n of g.data_source_names){
      for(const i of g.status_summary.data_sources[n]||[]){
        const st=grpKey==='xdr_integrations'?i.StatusUI:i.status;
        rows.push([grpName,n,i.name||'',st==null?'':st]);
      }
    }
  }
  const csv=rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  dsDownload(new Blob([csv],{type:'text/csv'}),'xsiam-data-sources.csv');
};

dsList.innerHTML='<div class="xlv-empty">Open this tab to load data sources.</div>';

})();
