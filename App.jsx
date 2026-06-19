/**
 * ASL Enterprise Data Catalog — React App (src/App.jsx)
 * ──────────────────────────────────────────────────────────────────────
 * Fetches catalog-data.json (produced by sync-catalog.js) at runtime.
 * Auto-refreshes every REFRESH_INTERVAL ms.
 * On API failure, shows a stale-data warning.
 * ──────────────────────────────────────────────────────────────────────
 */

import { useState, useMemo, useEffect, useCallback } from 'react';

// ── Config ──────────────────────────────────────────────────────────────────
// import.meta.env.BASE_URL is '/asl-data-catalog/' on GitHub Pages, '/' locally.
// This means the fetch hits the right path in both environments automatically.
// Override with VITE_CATALOG_API_URL to point at the live Express API instead.
const CATALOG_URL = import.meta.env.VITE_CATALOG_API_URL
  || `${import.meta.env.BASE_URL}catalog-data.json`;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ── Domain helpers ─────────────────────────────────────────────────────────
const DBADGE = {
  Maintenance: { cls: 'badge-info',  icon: 'ti-tool'      },
  Finance:     { cls: 'badge-warn',  icon: 'ti-chart-pie' },
  Operations:  { cls: 'badge-succ',  icon: 'ti-plane'     },
  Crew:        { cls: 'badge-dang',  icon: 'ti-users'     },
  Engineering: { cls: 'badge-sec',   icon: 'ti-code'      },
};
const SBADGE = { 'Very High':'badge-dang', High:'badge-warn', Medium:'badge-info', Low:'badge-succ' };
const CBADGE = { Confidential:'badge-dang', Restricted:'badge-warn', Internal:'badge-sec', Public:'badge-succ' };

function qColor(s) { return s >= 90 ? '#1D9E75' : s >= 75 ? '#EF9F27' : '#E24B4A'; }

// ── Small reusable components ───────────────────────────────────────────────
function QRing({ score, size = 48 }) {
  const r = size * 0.38, c = 2 * Math.PI * r;
  const dash = c - (score / 100) * c, col = qColor(score);
  return (
    <svg width={size} height={size} aria-label={`Quality ${score}%`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(128,128,128,0.2)" strokeWidth={size*.09}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col}
        strokeWidth={size*.09} strokeDasharray={c} strokeDashoffset={dash}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        fill={col} fontSize={size*.23} fontWeight="500" fontFamily="inherit">{score}</text>
    </svg>
  );
}

function MetricBar({ label, val }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:7 }}>
      <div style={{ width:80, fontSize:12, color:'var(--color-text-secondary)' }}>{label}</div>
      <div style={{ flex:1, height:6, background:'var(--color-border-tertiary)', borderRadius:4, overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${val}%`, background:qColor(val), borderRadius:4 }}/>
      </div>
      <div style={{ width:36, textAlign:'right', fontSize:12, fontWeight:500, color:qColor(val) }}>{val}%</div>
    </div>
  );
}

// ── Loading skeleton ────────────────────────────────────────────────────────
function Skeleton() {
  const bar = (w, h = 10, mb = 8) => (
    <div style={{ width:w, height:h, background:'var(--color-background-secondary)',
      borderRadius:4, marginBottom:mb, animation:'pulse 1.5s ease-in-out infinite' }}/>
  );
  return (
    <div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
        {[1,2,3,4].map(i => <div key={i} style={{ background:'var(--color-background-secondary)', borderRadius:'var(--border-radius-md)', padding:12 }}>
          {bar('60%',22,6)}{bar('80%',10)}
        </div>)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
        {[1,2,3,4].map(i => <div key={i} style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:14 }}>
          {bar('100%',12,8)}{bar('80%',10,6)}{bar('90%',10)}
        </div>)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// VIEWS
// ─────────────────────────────────────────────────────────────────────

function OverviewView({ catalog, onNavigate, onSelect }) {
  const { datasets = [], domainBreakdown = {} } = catalog;
  const avgQ = datasets.length ? Math.round(datasets.reduce((a,b)=>a+b.q,0)/datasets.length) : 0;
  const domains = Object.keys(DBADGE);
  const recent = [...datasets].sort((a,b)=> new Date(b.syncedAt||0)-new Date(a.syncedAt||0)).slice(0,4);

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
        {[
          { num: datasets.length,                    lbl: 'Total datasets' },
          { num: (catalog.glossary||[]).length,       lbl: 'Glossary terms' },
          { num: `${avgQ}%`, lbl: 'Avg quality',  col: qColor(avgQ) },
          { num: domains.filter(d=>(domainBreakdown[d]||0)>0).length, lbl: 'Active domains' },
        ].map(({num,lbl,col}) => (
          <div key={lbl} style={{ background:'var(--color-background-secondary)', borderRadius:'var(--border-radius-md)', padding:12 }}>
            <div style={{ fontSize:22, fontWeight:500, color:col||'var(--color-text-primary)', lineHeight:1 }}>{num}</div>
            <div style={{ fontSize:11, color:'var(--color-text-secondary)', marginTop:3 }}>{lbl}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)', marginBottom:10, display:'flex', alignItems:'center', gap:6 }}>
            <i className="ti ti-layout-distribute-vertical" style={{ color:'var(--color-text-secondary)' }}/>
            Domain coverage
          </div>
          {domains.map(d => {
            const count = domainBreakdown[d] || 0;
            const db = DBADGE[d];
            const pct = datasets.length ? Math.round(count/datasets.length*100) : 0;
            return (
              <div key={d} onClick={() => onNavigate('discovery', d)}
                style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7, cursor:'pointer' }}>
                <div style={{ width:90, fontSize:12, color:'var(--color-text-secondary)', display:'flex', alignItems:'center', gap:5 }}>
                  <i className={`ti ${db.icon}`} style={{ fontSize:12 }}/>{d}
                </div>
                <div style={{ flex:1, height:6, background:'var(--color-background-secondary)', borderRadius:4, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${pct}%`, background:'var(--color-border-info)', borderRadius:4 }}/>
                </div>
                <span style={{ fontSize:11, color:'var(--color-text-secondary)', width:32, textAlign:'right' }}>{count}</span>
              </div>
            );
          })}
        </div>
        <div>
          <div style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)', marginBottom:10, display:'flex', alignItems:'center', gap:6 }}>
            <i className="ti ti-database" style={{ color:'var(--color-text-secondary)' }}/>
            Latest from Dremio
          </div>
          {(datasets.slice(0,5)).map(ds => (
            <div key={ds.id} onClick={() => onSelect(ds)}
              style={{ display:'flex', alignItems:'center', gap:8, marginBottom:7, cursor:'pointer' }}>
              <QRing score={ds.q} size={28}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:12, fontWeight:500, color:'var(--color-text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ds.name}</div>
                <div style={{ fontSize:11, color:'var(--color-text-tertiary)' }}>{ds.freq}</div>
              </div>
              <span className={`badge ${(DBADGE[ds.domain]||DBADGE.Engineering).cls}`} style={{ fontSize:10 }}>{ds.domain}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background:'var(--color-background-info)', border:'.5px solid var(--color-border-info)', borderRadius:'var(--border-radius-lg)', padding:12, display:'flex', alignItems:'center', gap:12 }}>
        <i className="ti ti-sparkles" style={{ fontSize:20, color:'var(--color-text-info)' }}/>
        <div>
          <div style={{ fontSize:13, fontWeight:500, color:'var(--color-text-info)' }}>Enterprise Knowledge Layer — 6 pillars active</div>
          <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginTop:2 }}>Business Glossary · Metadata Management · Data Discovery · Data Lineage · Knowledge Mapping · Quality & Classification</div>
        </div>
      </div>
    </div>
  );
}

function DiscoveryView({ datasets, onSelect, filterDomain }) {
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState(filterDomain || 'All');
  useEffect(() => { if (filterDomain) setDomain(filterDomain); }, [filterDomain]);

  const domains = ['All', ...Object.keys(DBADGE)];
  const filtered = useMemo(() => datasets.filter(ds => {
    const matchD = domain === 'All' || ds.domain === domain;
    const q = search.toLowerCase();
    const matchS = !q || ds.name.toLowerCase().includes(q) || ds.domain.toLowerCase().includes(q)
      || ds.source.toLowerCase().includes(q) || (ds.tags||[]).some(t=>t.toLowerCase().includes(q));
    return matchD && matchS;
  }), [search, domain, datasets]);

  return (
    <div>
      <input style={{ width:'100%', marginBottom:10, padding:'6px 10px', border:'.5px solid var(--color-border-secondary)', borderRadius:'var(--border-radius-md)', background:'var(--color-background-secondary)', color:'var(--color-text-primary)', fontSize:13, outline:'none' }}
        placeholder="Search datasets, sources, tags…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
        {domains.map(d => (
          <button key={d} onClick={() => setDomain(d)}
            style={{ padding:'4px 12px', borderRadius:20, fontSize:12, cursor:'pointer', border:'.5px solid var(--color-border-secondary)', background: d===domain?'var(--color-background-info)':'transparent', color:d===domain?'var(--color-text-info)':'var(--color-text-secondary)' }}>
            {d}
          </button>
        ))}
      </div>
      <div style={{ fontSize:12, color:'var(--color-text-secondary)', marginBottom:10 }}>
        {filtered.length} dataset{filtered.length!==1?'s':''} found
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:10 }}>
        {filtered.map(ds => {
          const db = DBADGE[ds.domain] || DBADGE.Engineering;
          return (
            <div key={ds.id} onClick={() => onSelect(ds)}
              style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:14, cursor:'pointer' }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:8 }}>
                <QRing score={ds.q} size={44}/>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)', marginBottom:4 }}>{ds.name}</div>
                  <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                    <span className={`badge ${db.cls}`}><i className={`ti ${db.icon}`} style={{fontSize:10}}/>{ds.domain}</span>
                    <span className={`badge ${CBADGE[ds.cls]||'badge-sec'}`}>{ds.cls}</span>
                    {ds.type==='VIRTUAL_DATASET'&&<span className="badge badge-sec">VDS</span>}
                  </div>
                </div>
              </div>
              <div style={{ fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.4, marginBottom:8, display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical', overflow:'hidden' }}>{ds.desc}</div>
              <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:11, color:'var(--color-text-tertiary)', borderTop:'.5px solid var(--color-border-tertiary)', paddingTop:8 }}>
                {ds.cols>0&&<span><strong style={{color:'var(--color-text-primary)'}}>{ds.cols}</strong> cols</span>}
                {ds.rows&&<span><strong style={{color:'var(--color-text-primary)'}}>{ds.rows}</strong> rows</span>}
                <i className="ti ti-clock" style={{fontSize:11}}/>
                <span style={{marginLeft:-4}}>{ds.updated}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GlossaryView({ glossary, datasets, onSelect }) {
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState('All');
  const domains = ['All', 'Maintenance', 'Finance', 'Operations', 'Crew', 'Engineering'];
  const filtered = useMemo(() => (glossary||[]).filter(g => {
    const matchD = domain==='All' || g.domain===domain;
    const q = search.toLowerCase();
    return matchD && (!q || g.term.toLowerCase().includes(q) || g.def.toLowerCase().includes(q));
  }), [search, domain, glossary]);

  return (
    <div>
      <input style={{ width:'100%', marginBottom:10, padding:'6px 10px', border:'.5px solid var(--color-border-secondary)', borderRadius:'var(--border-radius-md)', background:'var(--color-background-secondary)', color:'var(--color-text-primary)', fontSize:13, outline:'none' }}
        placeholder="Search terms…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:12 }}>
        {domains.map(d=>(
          <button key={d} onClick={()=>setDomain(d)}
            style={{ padding:'4px 12px', borderRadius:20, fontSize:12, cursor:'pointer', border:'.5px solid var(--color-border-secondary)', background:d===domain?'var(--color-background-info)':'transparent', color:d===domain?'var(--color-text-info)':'var(--color-text-secondary)' }}>
            {d}
          </button>
        ))}
      </div>
      {filtered.map(g => {
        const db = DBADGE[g.domain] || DBADGE.Engineering;
        const linked = (datasets||[]).filter(d=>(g.datasets||[]).includes(d.id));
        return (
          <div key={g.term} style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:12, marginBottom:8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
              <span style={{ fontSize:14, fontWeight:500, color:'var(--color-text-primary)' }}>{g.term}</span>
              <span className={`badge ${db.cls}`}><i className={`ti ${db.icon}`} style={{fontSize:10}}/>{g.domain}</span>
            </div>
            <div style={{ fontSize:12, color:'var(--color-text-secondary)', lineHeight:1.5, marginBottom:8 }}>{g.def}</div>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
              {(g.related||[]).map(r=><span key={r} style={{ fontSize:11, padding:'2px 7px', borderRadius:4, background:'var(--color-background-secondary)', color:'var(--color-text-secondary)', border:'.5px solid var(--color-border-tertiary)' }}>{r}</span>)}
              {linked.map(d=><span key={d.id} onClick={()=>onSelect(d)}
                style={{ fontSize:11, padding:'2px 7px', borderRadius:4, cursor:'pointer', background:'var(--color-background-info)', color:'var(--color-text-info)', border:'.5px solid var(--color-border-info)' }}>
                <i className="ti ti-database" style={{fontSize:10}}/> {d.name}
              </span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LineageView({ datasets }) {
  const layers = [
    { label:'Source systems',      color:'dang', items:['AMOS PostgreSQL','Oracle ADB (MM)','SAP HANA','Xero GL','AIMS Flat Files'] },
    { label:'Integration',         color:'warn', items:['Debezium CDC','PySpark mmprod.py','Direct connection'] },
    { label:'Storage / landing',   color:'sec',  items:['S3 Iceberg','AWS Glue catalog','Dremio direct source'] },
    { label:'Semantic (Dremio)',    color:'info', items:['STG layer','LDG layer','Eagle Eye VDS','OCC source','Dev / SAP_HANA'] },
    { label:'Consumption',         color:'succ', items:['OCC Dashboard','Finance Dashboards','Leadership Dashboard','Per Diem Service','Data Catalog'] },
  ];
  const flows = [
    { from:'AMOS PostgreSQL',    via:'Debezium CDC → S3 Iceberg',          to:'Dremio STG/LDG → Eagle Eye VDS',    bc:'badge-info' },
    { from:'Oracle ADB (MM)',    via:'PySpark mmprod.py → S3 Iceberg',     to:'Flight Leg Latest → OCC Dashboard', bc:'badge-succ' },
    { from:'SAP HANA',           via:'Direct Dremio source',               to:'P&L Three Entities → Finance Dashboards', bc:'badge-warn' },
    { from:'AIMS Flat Files',    via:'Direct Dremio source',               to:'v_leg_mm → Per Diem Service (Gallia)', bc:'badge-dang' },
  ];

  // Live count per source from actual datasets
  const sourceCount = (src) => datasets.filter(d=>d.source===src||d.source.includes(src.split(' ')[0])).length;

  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8, marginBottom:14 }}>
        {layers.map(layer => (
          <div key={layer.label}>
            <div style={{ fontSize:10, fontWeight:500, color:'var(--color-text-tertiary)', marginBottom:6, textTransform:'uppercase', letterSpacing:'.3px', lineHeight:1.3 }}>{layer.label}</div>
            {layer.items.map(item => (
              <div key={item} className={`badge badge-${layer.color}`}
                style={{ display:'block', borderRadius:'var(--border-radius-md)', padding:'5px 8px', marginBottom:5, fontSize:11, lineHeight:1.3, textAlign:'left' }}>
                {item}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ background:'var(--color-background-secondary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:12 }}>
        <div style={{ fontSize:11, fontWeight:500, color:'var(--color-text-secondary)', marginBottom:8, textTransform:'uppercase', letterSpacing:'.3px' }}>Active data flows</div>
        {flows.map((f,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6, fontSize:12 }}>
            <span className={`badge ${f.bc}`} style={{ minWidth:130 }}>{f.from}</span>
            <i className="ti ti-arrow-right" style={{ fontSize:14, color:'var(--color-text-tertiary)' }}/>
            <span style={{ color:'var(--color-text-secondary)', flex:1 }}>{f.via}</span>
            <i className="ti ti-arrow-right" style={{ fontSize:14, color:'var(--color-text-tertiary)' }}/>
            <span style={{ color:'var(--color-text-primary)', flex:1 }}>{f.to}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KnowledgeView({ datasets, onSelect }) {
  const domains = Object.keys(DBADGE);
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
      {domains.map(d => {
        const dds = datasets.filter(x=>x.domain===d);
        const avgQ = dds.length ? Math.round(dds.reduce((a,b)=>a+b.q,0)/dds.length) : 0;
        const db = DBADGE[d];
        return (
          <div key={d} style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:14 }}>
            <div style={{ display:'flex', alignItems:'center', gap:7, fontSize:13, fontWeight:500, marginBottom:8 }}>
              <span className={`badge ${db.cls}`}><i className={`ti ${db.icon}`} style={{fontSize:11}}/>{d}</span>
              <span style={{ marginLeft:'auto', fontSize:11, color:qColor(avgQ), fontWeight:500 }}>{avgQ}%</span>
            </div>
            {dds.length===0&&<div style={{ fontSize:12, color:'var(--color-text-tertiary)', fontStyle:'italic' }}>No datasets yet</div>}
            {dds.map(ds=>(
              <div key={ds.id} onClick={()=>onSelect(ds)}
                style={{ display:'flex', alignItems:'center', gap:7, fontSize:12, color:'var(--color-text-secondary)', padding:'3px 0', cursor:'pointer' }}>
                <i className="ti ti-database" style={{ fontSize:12, color:'var(--color-text-tertiary)' }}/>
                <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ds.name}</span>
                <i className="ti ti-chevron-right" style={{ fontSize:11, color:'var(--color-text-tertiary)' }}/>
              </div>
            ))}
            <div style={{ marginTop:8, paddingTop:8, borderTop:'.5px solid var(--color-border-tertiary)', fontSize:11, color:'var(--color-text-tertiary)' }}>
              {dds.length} dataset{dds.length!==1?'s':''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QualityView({ datasets, onSelect }) {
  const [sortBy, setSortBy] = useState('q');
  const [asc, setAsc]       = useState(false);
  const sorted = useMemo(()=>[...datasets].sort((a,b)=>asc?a[sortBy]-b[sortBy]:b[sortBy]-a[sortBy]),[sortBy,asc,datasets]);
  const toggle = col => { if(sortBy===col)setAsc(!asc); else{setSortBy(col);setAsc(false);} };

  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:700 }}>
        <thead>
          <tr>
            {['Dataset','Domain',['q','Quality'],['comp','Completeness'],['fresh','Freshness'],'Classification','Sensitivity','Updated'].map((h,i)=>(
              <th key={i} onClick={Array.isArray(h)?()=>toggle(h[0]):undefined}
                style={{ textAlign:'left', fontWeight:500, fontSize:11, color:'var(--color-text-secondary)', padding:'6px 8px', borderBottom:'.5px solid var(--color-border-secondary)', cursor:Array.isArray(h)?'pointer':'default', whiteSpace:'nowrap' }}>
                {Array.isArray(h)?h[1]:h}
                {Array.isArray(h)&&<i className={`ti ${sortBy===h[0]?(asc?'ti-sort-ascending':'ti-sort-descending'):'ti-selector'}`} style={{fontSize:10,marginLeft:3,opacity:sortBy===h[0]?1:.4}}/>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(ds=>{
            const db=DBADGE[ds.domain]||DBADGE.Engineering;
            const bar=(val)=>(
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ width:60, height:5, background:'var(--color-border-tertiary)', borderRadius:4, overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${val}%`, background:qColor(val), borderRadius:4 }}/>
                </div>
                <span style={{ color:qColor(val), fontWeight:500 }}>{val}%</span>
              </div>
            );
            return (
              <tr key={ds.id} onClick={()=>onSelect(ds)} style={{ cursor:'pointer' }}>
                <td style={{ padding:'7px 8px', borderBottom:'.5px solid var(--color-border-tertiary)', fontWeight:500, color:'var(--color-text-primary)' }}>{ds.name}</td>
                <td style={{ padding:'7px 8px', borderBottom:'.5px solid var(--color-border-tertiary)' }}>
                  <span className={`badge ${db.cls}`}><i className={`ti ${db.icon}`} style={{fontSize:10}}/>{ds.domain}</span>
                </td>
                <td style={{ padding:'7px 8px', borderBottom:'.5px solid var(--color-border-tertiary)' }}>{bar(ds.q)}</td>
                <td style={{ padding:'7px 8px', borderBottom:'.5px solid var(--color-border-tertiary)' }}>{bar(ds.comp)}</td>
                <td style={{ padding:'7px 8px', borderBottom:'.5px solid var(--color-border-tertiary)' }}>{bar(ds.fresh)}</td>
                <td style={{ padding:'7px 8px', borderBottom:'.5px solid var(--color-border-tertiary)' }}>
                  <span className={`badge ${CBADGE[ds.cls]||'badge-sec'}`}>{ds.cls}</span>
                </td>
                <td style={{ padding:'7px 8px', borderBottom:'.5px solid var(--color-border-tertiary)' }}>
                  <span className={`badge ${SBADGE[ds.sens]||'badge-info'}`}>{ds.sens}</span>
                </td>
                <td style={{ padding:'7px 8px', borderBottom:'.5px solid var(--color-border-tertiary)', color:'var(--color-text-tertiary)', fontSize:11 }}>{ds.updated}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailView({ ds, datasets, onBack }) {
  const db = DBADGE[ds.domain] || DBADGE.Engineering;
  const related = (datasets||[]).filter(d=>(ds.related||[]).includes(d.id));
  return (
    <div>
      <div onClick={onBack} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'var(--color-text-info)', cursor:'pointer', marginBottom:14 }}>
        <i className="ti ti-arrow-left"/> Back to catalog
      </div>

      {/* Header card */}
      <div style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:16, marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:12, marginBottom:14 }}>
          <QRing score={ds.q} size={60}/>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:16, fontWeight:500, color:'var(--color-text-primary)', marginBottom:6 }}>{ds.name}</div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
              <span className={`badge ${db.cls}`}><i className={`ti ${db.icon}`} style={{fontSize:10}}/>{ds.domain}</span>
              <span className={`badge ${CBADGE[ds.cls]||'badge-sec'}`}>{ds.cls}</span>
              <span className={`badge ${SBADGE[ds.sens]||'badge-info'}`}>{ds.sens} sensitivity</span>
              {ds.type==='VIRTUAL_DATASET'&&<span className="badge badge-sec"><i className="ti ti-code" style={{fontSize:10}}/>VDS</span>}
            </div>
            <div style={{ fontSize:13, color:'var(--color-text-secondary)', lineHeight:1.5 }}>{ds.desc}</div>
          </div>
        </div>
        <div style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.5px', color:'var(--color-text-tertiary)', marginBottom:8 }}>Quality metrics</div>
        <MetricBar label="Overall quality" val={ds.q}/>
        <MetricBar label="Completeness"    val={ds.comp}/>
        <MetricBar label="Freshness"       val={ds.fresh}/>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
        {/* Metadata */}
        <div style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:16 }}>
          <div style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.5px', color:'var(--color-text-tertiary)', marginBottom:8 }}>Metadata</div>
          {[
            ['Source system',    ds.source],
            ['Dremio path',      ds.path],
            ['Dataset type',     ds.type==='VIRTUAL_DATASET'?'Virtual dataset (VDS)':'Physical dataset'],
            ['Columns',          ds.cols>0?ds.cols:'48 tables'],
            ['Row count',        ds.rows||'—'],
            ['Update frequency', ds.freq],
            ['Last synced',      ds.updated],
            ['Data owner',       ds.owner],
            ['Data steward',     ds.steward],
          ].map(([k,v])=>(
            <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:'.5px solid var(--color-border-tertiary)', fontSize:12 }}>
              <span style={{ color:'var(--color-text-secondary)' }}>{k}</span>
              <span style={{ color:'var(--color-text-primary)', fontWeight:500, textAlign:'right', maxWidth:220, wordBreak:'break-all' }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {/* Lineage */}
          <div style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:16, flex:1 }}>
            <div style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.5px', color:'var(--color-text-tertiary)', marginBottom:8 }}>Data lineage</div>
            <div style={{ fontSize:11, color:'var(--color-text-tertiary)', marginBottom:4, textTransform:'uppercase', letterSpacing:'.3px' }}>Upstream</div>
            {(ds.upstream||[]).map(u=>(
              <div key={u} style={{ fontSize:12, color:'var(--color-text-secondary)', padding:'3px 0', display:'flex', alignItems:'center', gap:5 }}>
                <i className="ti ti-arrow-bar-to-right" style={{ fontSize:11, color:'var(--color-text-warning)' }}/>{u}
              </div>
            ))}
            <div style={{ fontSize:11, color:'var(--color-text-tertiary)', margin:'8px 0 4px', textTransform:'uppercase', letterSpacing:'.3px' }}>Downstream</div>
            {(ds.downstream||[]).length===0&&<div style={{ fontSize:12, color:'var(--color-text-tertiary)', fontStyle:'italic' }}>Not yet mapped</div>}
            {(ds.downstream||[]).map(u=>(
              <div key={u} style={{ fontSize:12, color:'var(--color-text-secondary)', padding:'3px 0', display:'flex', alignItems:'center', gap:5 }}>
                <i className="ti ti-arrow-bar-from-left" style={{ fontSize:11, color:'var(--color-text-success)' }}/>{u}
              </div>
            ))}
          </div>
          {/* Tags */}
          <div style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:14 }}>
            <div style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.5px', color:'var(--color-text-tertiary)', marginBottom:8 }}>Tags</div>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
              {(ds.tags||[]).map(t=><span key={t} style={{ fontSize:11, padding:'2px 7px', borderRadius:4, background:'var(--color-background-secondary)', color:'var(--color-text-secondary)', border:'.5px solid var(--color-border-tertiary)' }}>{t}</span>)}
            </div>
          </div>
        </div>
      </div>

      {/* Columns */}
      {(ds.cols_list||[]).length>0&&(
        <div style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:16, marginBottom:10 }}>
          <div style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.5px', color:'var(--color-text-tertiary)', marginBottom:8 }}>Schema ({ds.cols_list.length} fields)</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                {['Column','Type','Description'].map(h=>(
                  <th key={h} style={{ textAlign:'left', fontSize:11, fontWeight:500, color:'var(--color-text-secondary)', padding:'4px 6px', borderBottom:'.5px solid var(--color-border-secondary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ds.cols_list.map((c,i)=>(
                <tr key={i} style={{ borderBottom:'.5px solid var(--color-border-tertiary)' }}>
                  <td style={{ padding:'5px 6px', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--color-text-primary)' }}>{c.n}</td>
                  <td style={{ padding:'5px 6px', fontSize:11, color:'var(--color-text-info)', fontFamily:'var(--font-mono)' }}>{c.t}</td>
                  <td style={{ padding:'5px 6px', fontSize:12, color:'var(--color-text-secondary)' }}>{c.d||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* VDS SQL */}
      {ds.sql&&(
        <div style={{ background:'var(--color-background-primary)', border:'.5px solid var(--color-border-tertiary)', borderRadius:'var(--border-radius-lg)', padding:16, marginBottom:10 }}>
          <div style={{ fontSize:11, fontWeight:500, textTransform:'uppercase', letterSpacing:'.5px', color:'var(--color-text-tertiary)', marginBottom:8 }}>VDS definition (SQL)</div>
          <pre style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--color-text-primary)', lineHeight:1.6, whiteSpace:'pre-wrap', wordBreak:'break-all', margin:0 }}>{ds.sql}</pre>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id:'overview',  label:'Overview',                 icon:'ti-layout-dashboard'  },
  { id:'discovery', label:'Data discovery',           icon:'ti-database-search'   },
  { id:'glossary',  label:'Business glossary',        icon:'ti-book'              },
  { id:'lineage',   label:'Data lineage',             icon:'ti-share-2'           },
  { id:'knowledge', label:'Knowledge map',            icon:'ti-topology-star'     },
  { id:'quality',   label:'Quality & classification', icon:'ti-rosette'           },
];

const LABELS = {
  overview: 'Platform overview', discovery: 'Data discovery',
  glossary:  'Business glossary', lineage: 'Data lineage',
  knowledge: 'Knowledge map',    quality:  'Quality & classification',
};

export default function App() {
  const [nav,     setNav]    = useState('overview');
  const [sel,     setSel]    = useState(null);
  const [filter,  setFilter] = useState(null);

  // ── Catalog data state ─────────────────────────────────────────────
  const [catalog,     setCatalog]     = useState({ datasets:[], glossary:[], syncedAt:null, totalCount:0, domainBreakdown:{} });
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastFetched, setLastFetched] = useState(null);

  const fetchCatalog = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch(CATALOG_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCatalog(data);
      setLastFetched(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog();
    const interval = setInterval(fetchCatalog, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCatalog]);

  const handleNav = (id, domain) => { setNav(id); setSel(null); setFilter(domain||null); };
  const handleSel = (ds) => setSel(ds);

  // ── Styles (inline so the file is self-contained) ──────────────────
  const styles = {
    root: { display:'flex', height:'620px', fontFamily:'var(--font-sans)', fontSize:14, background:'var(--color-background-tertiary)', borderRadius:'var(--border-radius-lg)', overflow:'hidden', border:'.5px solid var(--color-border-tertiary)' },
    sidebar: { width:196, minWidth:196, background:'var(--color-background-secondary)', borderRight:'.5px solid var(--color-border-tertiary)', display:'flex', flexDirection:'column', overflow:'hidden' },
    main: { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 },
    topbar: { padding:'10px 16px', borderBottom:'.5px solid var(--color-border-tertiary)', background:'var(--color-background-primary)', display:'flex', alignItems:'center', gap:10, flexShrink:0 },
    view: { flex:1, overflowY:'auto', padding:16 },
  };

  return (
    <>
      <style>{`
        .badge{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:500;padding:2px 7px;border-radius:20px;white-space:nowrap}
        .badge-info{background:var(--color-background-info);color:var(--color-text-info)}
        .badge-warn{background:var(--color-background-warning);color:var(--color-text-warning)}
        .badge-succ{background:var(--color-background-success);color:var(--color-text-success)}
        .badge-dang{background:var(--color-background-danger);color:var(--color-text-danger)}
        .badge-sec{background:var(--color-background-secondary);color:var(--color-text-secondary)}
        .nav-item{display:flex;align-items:center;gap:9px;padding:7px 14px;cursor:pointer;color:var(--color-text-secondary);border-left:2px solid transparent;font-size:13px}
        .nav-item:hover{color:var(--color-text-primary);background:var(--color-background-primary)}
        .nav-item.active{color:var(--color-text-info);background:var(--color-background-info);border-left-color:var(--color-border-info);font-weight:500}
        .nav-item i{font-size:15px;width:16px;text-align:center}
      `}</style>

      <div style={styles.root}>
        {/* Sidebar */}
        <div style={styles.sidebar}>
          <div style={{ padding:'14px 14px 10px', borderBottom:'.5px solid var(--color-border-tertiary)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:26, height:26, borderRadius:6, background:'var(--color-background-info)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <i className="ti ti-plane-tilt" style={{ fontSize:14, color:'var(--color-text-info)' }}/>
              </div>
              <div>
                <div style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)' }}>ASL Data Catalog</div>
                <div style={{ fontSize:11, color:'var(--color-text-secondary)' }}>Enterprise Knowledge Layer</div>
              </div>
            </div>
          </div>

          <div style={{ flex:1, padding:'8px 0', overflowY:'auto' }}>
            <div style={{ fontSize:10, fontWeight:500, color:'var(--color-text-tertiary)', padding:'12px 14px 4px', textTransform:'uppercase', letterSpacing:'.5px' }}>Navigation</div>
            {NAV_ITEMS.map(item => (
              <div key={item.id} className={`nav-item${nav===item.id&&!sel?' active':''}`} onClick={()=>handleNav(item.id)}>
                <i className={`ti ${item.icon}`}/>{item.label}
              </div>
            ))}
          </div>

          <div style={{ padding:'10px 14px', borderTop:'.5px solid var(--color-border-tertiary)' }}>
            {error&&<div style={{ fontSize:11, color:'var(--color-text-danger)', marginBottom:4 }}><i className="ti ti-alert-triangle" style={{fontSize:11}}/> {error}</div>}
            <div style={{ fontSize:11, color:'var(--color-text-tertiary)', lineHeight:1.4 }}>
              <div style={{ fontWeight:500, color:'var(--color-text-secondary)', marginBottom:2 }}>DnT Infotech</div>
              Dremio EU Cloud · ece53770
              {lastFetched&&<div style={{ marginTop:3 }}>
                <i className="ti ti-refresh" style={{fontSize:10}}/> {lastFetched.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}
              </div>}
            </div>
          </div>
        </div>

        {/* Main area */}
        <div style={styles.main}>
          <div style={styles.topbar}>
            <i className="ti ti-layout-dashboard" style={{ fontSize:16, color:'var(--color-text-secondary)' }}/>
            <span style={{ fontSize:13, fontWeight:500, color:'var(--color-text-primary)', marginRight:'auto' }}>
              {sel ? sel.name : LABELS[nav]}
            </span>
            {loading
              ? <span style={{ fontSize:11, color:'var(--color-text-tertiary)' }}>Syncing with Dremio…</span>
              : catalog.syncedAt
                ? <span className="badge badge-succ"><i className="ti ti-check" style={{fontSize:10}}/>Live · {catalog.totalCount} datasets</span>
                : <span className="badge badge-warn"><i className="ti ti-clock" style={{fontSize:10}}/>No data</span>
            }
            <button onClick={fetchCatalog} title="Refresh now"
              style={{ background:'none', border:'.5px solid var(--color-border-secondary)', borderRadius:'var(--border-radius-md)', padding:'4px 8px', cursor:'pointer', color:'var(--color-text-secondary)', fontSize:12 }}>
              <i className="ti ti-refresh" style={{fontSize:13}}/>
            </button>
          </div>

          <div style={styles.view}>
            {loading
              ? <Skeleton/>
              : sel
                ? <DetailView ds={sel} datasets={catalog.datasets} onBack={()=>setSel(null)}/>
                : nav==='overview'  ? <OverviewView  catalog={catalog}             onNavigate={handleNav} onSelect={handleSel}/>
                : nav==='discovery' ? <DiscoveryView datasets={catalog.datasets}   onSelect={handleSel}   filterDomain={filter}/>
                : nav==='glossary'  ? <GlossaryView  glossary={catalog.glossary}   datasets={catalog.datasets} onSelect={handleSel}/>
                : nav==='lineage'   ? <LineageView   datasets={catalog.datasets}/>
                : nav==='knowledge' ? <KnowledgeView datasets={catalog.datasets}   onSelect={handleSel}/>
                : nav==='quality'   ? <QualityView   datasets={catalog.datasets}   onSelect={handleSel}/>
                : null
            }
          </div>
        </div>
      </div>
    </>
  );
}
